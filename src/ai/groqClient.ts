import Groq from "groq-sdk";
import { cfg } from "../config.js";
import { TOOL_DEFINITIONS } from "./toolRegistry.js";
import { executeScript } from "../executor/scriptExecutor.js";
import { queryLokiLogs } from "../collector/loki.js";
import { getQueueStats } from "../collector/bullmq.js";
import { getContainerStats } from "../collector/docker.js";
import { requestAuthorization } from "../comms/whatsapp.js";
import { emitAgentLog } from "../comms/socketServer.js";
import { logger } from "../utils/logger.js";

const SYSTEM_PROMPT = `You are an autonomous SRE agent for OfferBerries ERP.

Stack: Node.js/Express 5, MongoDB Atlas, Redis 7, BullMQ, Docker on Hetzner, Nginx, Cloudflare Tunnel.
B2B critical: Backend-B (marketplace) sends thousands of orders via HMAC webhooks to /api/sync.
Downtime = order loss for thousands of sellers and buyers. Act urgently on P1.

Architecture context:
- OutboxRelay worker: polls MongoDB every 1s, delivers events to EventBus, 3-attempt retry
- DocumentWorker: BullMQ worker, generates DOCX files (salary breakups, commission reports)
- BullMQ queues use Redis 7. Queue name pattern: bull:{queueName}:wait/active/failed
- Financial operations use sessions + atomic $inc — data integrity is paramount

Decision rules (strictly enforced):
1. ALWAYS call queryLokiLogs FIRST before any state-changing action.
2. OOM kill confirmed → gracefulRestartContainer (autonomous if isAutonomousEligible=true).
3. Backend container exited/down → gracefulRestartContainer backend.
4. BullMQ failed > 50 + errors not transient → clearBullMQDeadLetters (autonomous if confidence > 0.85).
5. Never chain > 1 state-changing action per triage. One action, then report.
6. If confidence < 0.75 → sendHumanAlert (requiresAuthorization: true). Do NOT act.
7. If root cause requires code change → sendHumanAlert. Do NOT act.
8. Redis, Loki, Prometheus, Grafana containers → NEVER restart autonomously, always sendHumanAlert.
9. Always include confidence (0.0-1.0) and rootCause in your final JSON response.

Response format (final JSON after all tool calls):
{
  "diagnosis": "human-readable summary",
  "rootCause": "specific root cause",
  "confidence": 0.0-1.0,
  "recommendation": "what should happen next"
}`;

export interface TriageResult {
  diagnosis: string;
  rootCause: string;
  confidence: number;
  actionTaken: string | null;
  tokensUsed: number;
  latencyMs: number;
  executionResult?: { stdout: string; stderr: string; exitCode: number };
}

export async function triageIncident(context: {
  incidentId: string;
  signal: string;
  prometheusSnapshot: object;
  dockerState: object;
  bullmqState: object;
  lokiState: object;
  isAutonomousEligible: boolean;
}): Promise<TriageResult> {
  if (!cfg.GROQ_API_KEY) {
    return {
      diagnosis: "AI triage unavailable — GROQ_API_KEY not configured",
      rootCause: "Unknown",
      confidence: 0,
      actionTaken: null,
      tokensUsed: 0,
      latencyMs: 0,
    };
  }

  const groq = new Groq({ apiKey: cfg.GROQ_API_KEY });
  const startMs = Date.now();
  let actionTaken: string | null = null;
  let executionResult: TriageResult["executionResult"];
  let totalTokens = 0;

  const messages: Groq.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: JSON.stringify({
        incidentId: context.incidentId,
        signal: context.signal,
        isAutonomousEligible: context.isAutonomousEligible,
        currentState: {
          prometheus: context.prometheusSnapshot,
          docker: context.dockerState,
          bullmq: context.bullmqState,
          loki: context.lokiState,
        },
        timestamp: new Date().toISOString(),
      }),
    },
  ];

  const tools = TOOL_DEFINITIONS.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));

  // Agentic loop — continues until no more tool calls or max 8 iterations
  let iterations = 0;
  while (iterations < 8) {
    iterations++;

    const response = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages,
      tools,
      tool_choice: "auto",
      max_tokens: 1500,
      temperature: 0.1,
    });

    const choice = response.choices[0];
    totalTokens += response.usage?.total_tokens ?? 0;

    emitAgentLog({
      timestamp: new Date().toISOString(),
      message: `[Groq] Iteration ${iterations}: finish_reason=${choice.finish_reason} tokens=${response.usage?.total_tokens}`,
      level: "debug",
    });

    if (choice.finish_reason === "tool_calls" && choice.message.tool_calls?.length) {
      messages.push(choice.message);

      for (const call of choice.message.tool_calls) {
        const toolName = call.function.name;
        let params: Record<string, unknown> = {};
        try {
          params = JSON.parse(call.function.arguments);
        } catch { /* use empty params */ }

        emitAgentLog({
          timestamp: new Date().toISOString(),
          message: `[Groq] Tool call: ${toolName}(${JSON.stringify(params)})`,
          level: "info",
        });

        let toolResult: unknown;

        // Handle in-process tools directly (don't go through script executor)
        if (toolName === "queryLokiLogs") {
          toolResult = await queryLokiLogs(params as any);
        } else if (toolName === "getQueueState") {
          toolResult = await getQueueStats(params.queueName as any);
        } else if (toolName === "getContainerStats") {
          toolResult = await getContainerStats(params.containerName as string);
        } else if (toolName === "sendHumanAlert") {
          // Route to WhatsApp module
          await requestAuthorization({
            incidentId: context.incidentId,
            summary: params.summary as string,
            proposedAction: (params.proposedAction as string) ?? "monitor",
            severity: params.severity as string,
            requiresAuthorization: params.requiresAuthorization as boolean,
          });
          toolResult = { sent: true };
        } else {
          // State-changing script — check autonomous ceiling first
          const isAutonomous = context.isAutonomousEligible;
          const result = await executeScript(toolName, params);
          executionResult = result;
          if (!["getContainerStats", "getQueueState", "queryLokiLogs"].includes(toolName)) {
            actionTaken = toolName;
          }
          toolResult = result;
          emitAgentLog({
            timestamp: new Date().toISOString(),
            message: `[Groq] Script result: exitCode=${result.exitCode} stdout=${result.stdout.slice(0, 100)}`,
            level: result.exitCode === 0 ? "info" : "error",
          });
        }

        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(toolResult),
        });
      }
    } else {
      // Final response — parse diagnosis JSON
      const text = choice.message.content ?? "{}";
      let parsed: any = { diagnosis: text, confidence: 0.5, rootCause: "Unknown" };

      try {
        const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/) ?? [null, text];
        parsed = JSON.parse(jsonMatch[1] ?? text);
      } catch {
        // If not valid JSON, treat the text as the diagnosis
        parsed = { diagnosis: text, confidence: 0.5, rootCause: "Could not parse response" };
      }

      return {
        diagnosis: parsed.diagnosis ?? text,
        rootCause: parsed.rootCause ?? "Unknown",
        confidence: Math.min(1, Math.max(0, parsed.confidence ?? 0.5)),
        actionTaken,
        tokensUsed: totalTokens,
        latencyMs: Date.now() - startMs,
        executionResult,
      };
    }
  }

  // Max iterations reached
  return {
    diagnosis: "Max triage iterations reached — manual review required",
    rootCause: "Unknown",
    confidence: 0,
    actionTaken,
    tokensUsed: totalTokens,
    latencyMs: Date.now() - startMs,
    executionResult,
  };
}
