// Patch generator — uses Google Gemini 2.0 Flash by default (free tier covers this workload).
// Falls back to Anthropic Claude if ANTHROPIC_API_KEY is set and PATCH_MODEL=claude.
// To use Claude instead: set PATCH_MODEL=claude in .env
//
// Gemini 2.0 Flash:  $0.10/M input, $0.40/M output  (~$0.004 per patch call)
// Claude 3.5 Sonnet: $3.00/M input, $15.00/M output (~$0.14 per patch call)
// Free tier: Gemini gives 1,500 requests/day free — more than enough for 30 incidents/month.

import { cfg } from "../config.js";
import { logger } from "../utils/logger.js";
import { emitAgentLog } from "../comms/socketServer.js";

const SYSTEM_PROMPT = `You are a senior engineer on the OfferBerries ERP codebase.

Architecture rules (non-negotiable):
- Express 5, MongoDB Atlas, BullMQ outbox pattern
- All financial values in integer paise (Math.round() at every arithmetic boundary)
- Session-first: all multi-document writes use mongoose.startSession() + withTransaction()
- Never delete financial records — post reversal journals instead
- No relative imports — use #alias/* form as defined in backend/package.json imports map
- queueOutboxEvent() for cross-domain events inside transactions (never eventBus.emit())
- AuditService.log() with session always passed for financial operations

Output format:
1. Unified diff format patch (--- a/file, +++ b/file, @@ hunks)
2. Blank line
3. "---"
4. Explanation paragraph (max 3 sentences: what changed, why, what it fixes)

Rules:
- Minimal change — fix only the exact root cause, nothing else
- No refactoring, no new features, no extra error handling
- No hallucinated imports or function names
- If you cannot determine a safe fix, say "INSUFFICIENT_CONTEXT: <reason>"`;

export interface PatchResult {
  patch: string;
  explanation: string;
  tokensUsed: number;
  model: string;
}

export async function generateCodePatch(context: {
  errorMessage: string;
  stackTrace: string;
  relevantSourceFiles: Record<string, string>;
}): Promise<PatchResult> {
  const patchModel = process.env.PATCH_MODEL ?? "gemini";

  if (patchModel === "claude" && process.env.ANTHROPIC_API_KEY) {
    return generateWithClaude(context);
  }

  if (process.env.GOOGLE_AI_KEY) {
    return generateWithGemini(context);
  }

  if (process.env.ANTHROPIC_API_KEY) {
    return generateWithClaude(context);
  }

  return {
    patch: "",
    explanation: "No patch model configured. Set GOOGLE_AI_KEY (recommended, free tier) or ANTHROPIC_API_KEY.",
    tokensUsed: 0,
    model: "none",
  };
}

// ── Gemini 2.0 Flash (default — free tier covers this workload) ───────────────
async function generateWithGemini(context: {
  errorMessage: string;
  stackTrace: string;
  relevantSourceFiles: Record<string, string>;
}): Promise<PatchResult> {
  const { GoogleGenerativeAI } = await import("@google/generative-ai");
  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_KEY!);

  const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash",
    systemInstruction: SYSTEM_PROMPT,
  });

  const sourceBlock = Object.entries(context.relevantSourceFiles)
    .map(([file, content]) => `// FILE: ${file}\n${content}`)
    .join("\n\n---\n\n");

  const prompt = `ERROR: ${context.errorMessage}\n\nSTACK TRACE:\n${context.stackTrace}\n\nSOURCE FILES:\n${sourceBlock}`;

  emitAgentLog({
    timestamp: new Date().toISOString(),
    message: `[Gemini] Generating patch for: ${context.errorMessage.slice(0, 80)}`,
    level: "info",
  });

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const parts = text.split("\n---\n");

    const usage = result.response.usageMetadata;
    const tokensUsed = (usage?.promptTokenCount ?? 0) + (usage?.candidatesTokenCount ?? 0);

    emitAgentLog({
      timestamp: new Date().toISOString(),
      message: `[Gemini] Patch generated. Tokens: ${tokensUsed}`,
      level: "info",
    });

    return {
      patch: parts[0]?.trim() ?? "",
      explanation: parts.slice(1).join("\n").trim(),
      tokensUsed,
      model: "gemini-2.0-flash",
    };
  } catch (err: any) {
    logger.error("[Gemini] Patch generation failed", { error: err.message });
    return { patch: "", explanation: `Gemini error: ${err.message}`, tokensUsed: 0, model: "gemini-2.0-flash" };
  }
}

// ── Claude 3.5 Sonnet (fallback — set PATCH_MODEL=claude) ────────────────────
async function generateWithClaude(context: {
  errorMessage: string;
  stackTrace: string;
  relevantSourceFiles: Record<string, string>;
}): Promise<PatchResult> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const sourceBlock = Object.entries(context.relevantSourceFiles)
    .map(([file, content]) => `// FILE: ${file}\n${content}`)
    .join("\n\n---\n\n");

  emitAgentLog({
    timestamp: new Date().toISOString(),
    message: `[Claude] Generating patch for: ${context.errorMessage.slice(0, 80)}`,
    level: "info",
  });

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ] as any,
      messages: [
        {
          role: "user",
          content: `ERROR: ${context.errorMessage}\n\nSTACK TRACE:\n${context.stackTrace}\n\nSOURCE FILES:\n${sourceBlock}`,
        },
      ],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const parts = text.split("\n---\n");
    const tokensUsed = response.usage.input_tokens + response.usage.output_tokens;

    return {
      patch: parts[0]?.trim() ?? "",
      explanation: parts.slice(1).join("\n").trim(),
      tokensUsed,
      model: "claude-sonnet-4-6",
    };
  } catch (err: any) {
    logger.error("[Claude] Patch generation failed", { error: err.message });
    return { patch: "", explanation: `Claude error: ${err.message}`, tokensUsed: 0, model: "claude-sonnet-4-6" };
  }
}
