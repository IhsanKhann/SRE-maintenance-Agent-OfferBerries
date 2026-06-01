import { Incident, type IIncident } from "../db/models/Incident.js";
import { ActionHistory } from "../db/models/ActionHistory.js";
import { emitIncidentAlert, emitIncidentClosed, emitAgentLog } from "../comms/socketServer.js";
import { sendWhatsApp } from "../comms/whatsapp.js";
import { triageIncident } from "../ai/groqClient.js";
import { logger } from "../utils/logger.js";
import { cfg, hasAI, hasWhatsApp } from "../config.js";
import type { AnomalySignal } from "../detector/anomalyDetector.js";
import type { SnapshotData } from "../collector/index.js";

// Tracks signals that already have an open incident — prevents duplicate storms
const openIncidentsBySignal = new Map<string, string>(); // signal → incidentId

// Autonomous action ceiling (enforced in code, not in prompts)
const AUTONOMOUS_SIGNALS = new Set([
  "loki.oomKillDetected",
  "docker.backend.down",
  "docker.OfferBerries_backend.down",
  "loki.panicDetected",
]);

const AUTONOMOUS_BULLMQ_THRESHOLD = 50;

export async function processSignals(
  signals: AnomalySignal[],
  snapshot: SnapshotData
): Promise<void> {
  for (const signal of signals) {
    // Skip if already have an open incident for this exact signal
    if (openIncidentsBySignal.has(signal.signal)) {
      logger.debug("[IncidentManager] Skipping duplicate signal", { signal: signal.signal });
      continue;
    }

    await openIncident(signal, snapshot);
  }
}

async function openIncident(signal: AnomalySignal, snapshot: SnapshotData): Promise<void> {
  try {
    const incident = await Incident.create({
      openedAt: new Date(),
      status: "open",
      severity: signal.severity,
      trigger: {
        source: signal.source,
        signal: signal.signal,
        rawValue: signal.rawValue,
        threshold: signal.threshold,
      },
      tags: [signal.source, signal.severity],
    });

    openIncidentsBySignal.set(signal.signal, incident._id.toString());
    emitIncidentAlert(incident.toObject());

    emitAgentLog({
      timestamp: new Date().toISOString(),
      message: `[Incident #${incident._id}] Opened: ${signal.description} [${signal.severity.toUpperCase()}]`,
      level: "warn",
    });

    logger.warn("[IncidentManager] Incident opened", {
      id: incident._id,
      signal: signal.signal,
      severity: signal.severity,
    });

    // P3 — log only, no AI, no WhatsApp
    if (signal.severity === "p3") {
      if (hasWhatsApp) {
        await sendWhatsApp(
          `📋 P3 INFO — OfferBerries\n${signal.description}\n(No action required)`
        );
      }
      return;
    }

    // Determine if this signal is eligible for autonomous action
    const isAutonomous = isAutonomousEligible(signal, snapshot);

    if (!hasAI) {
      // No AI configured — just alert via WhatsApp
      await alertNoAI(incident, signal);
      return;
    }

    // Run Groq triage
    await runAITriage(incident, signal, snapshot, isAutonomous);
  } catch (err: any) {
    logger.error("[IncidentManager] Failed to open incident", { error: err.message, signal });
  }
}

function isAutonomousEligible(signal: AnomalySignal, snapshot: SnapshotData): boolean {
  if (AUTONOMOUS_SIGNALS.has(signal.signal)) return true;

  // BullMQ auto-drain only if failed count is very high
  if (
    signal.signal === "bullmq.outboxRelay.failed" &&
    snapshot.bullmq.outboxRelay.failed > AUTONOMOUS_BULLMQ_THRESHOLD
  ) return true;

  return false;
}

async function alertNoAI(incident: IIncident, signal: AnomalySignal): Promise<void> {
  if (!hasWhatsApp) return;

  const emoji = signal.severity === "p1" ? "🚨" : "⚠️";
  await sendWhatsApp(
    `${emoji} ${signal.severity.toUpperCase()} — OfferBerries\n` +
    `${signal.description}\n\n` +
    `Reply STATUS for current system state.`
  );
}

async function runAITriage(
  incident: IIncident,
  signal: AnomalySignal,
  snapshot: SnapshotData,
  isAutonomousEligible: boolean
): Promise<void> {
  try {
    await Incident.updateOne({ _id: incident._id }, { status: "investigating" });
    emitAgentLog({
      timestamp: new Date().toISOString(),
      message: `[Incident #${incident._id}] Starting Groq triage...`,
      level: "info",
    });

    const result = await triageIncident({
      incidentId: incident._id.toString(),
      signal: signal.description,
      prometheusSnapshot: snapshot.prometheus,
      dockerState: snapshot.docker,
      bullmqState: snapshot.bullmq,
      lokiState: snapshot.loki,
      isAutonomousEligible,
    });

    // Save AI analysis
    await Incident.updateOne(
      { _id: incident._id },
      {
        aiAnalysis: {
          model: "groq/llama-3.1-70b-versatile",
          summary: result.diagnosis,
          rootCause: result.rootCause,
          confidence: result.confidence,
          suggestedAction: result.actionTaken ?? "monitor",
          tokensUsed: result.tokensUsed,
          latencyMs: result.latencyMs,
        },
      }
    );

    emitAgentLog({
      timestamp: new Date().toISOString(),
      message: `[Incident #${incident._id}] Groq: confidence=${result.confidence.toFixed(2)} action=${result.actionTaken ?? "none"}`,
      level: "info",
    });

    if (result.actionTaken) {
      // Log the action
      const action = await ActionHistory.create({
        incidentId: incident._id,
        executedAt: new Date(),
        toolName: result.actionTaken,
        parameters: {},
        authorizedBy: isAutonomousEligible && result.confidence >= 0.85 ? "autonomous" : "whatsapp_reply",
        stdout: result.executionResult?.stdout ?? "",
        stderr: result.executionResult?.stderr ?? "",
        exitCode: result.executionResult?.exitCode ?? 0,
        durationMs: result.latencyMs,
        success: (result.executionResult?.exitCode ?? 0) === 0,
      });

      await Incident.updateOne(
        { _id: incident._id },
        { $push: { actionsExecuted: action._id } }
      );

      // Auto-close if action succeeded
      if (action.success) {
        await closeIncident(incident._id.toString(), "autonomous");
        if (hasWhatsApp) {
          await sendWhatsApp(
            `✅ Auto-resolved — OfferBerries\n` +
            `Incident: ${signal.description}\n` +
            `Action: ${result.actionTaken}\n` +
            `Groq confidence: ${(result.confidence * 100).toFixed(0)}%\n` +
            `Duration: ${(result.latencyMs / 1000).toFixed(1)}s`
          );
        }
      }
    }
  } catch (err: any) {
    logger.error("[IncidentManager] AI triage failed", { error: err.message });
    // Fallback to human alert
    await alertNoAI(incident, signal);
  }
}

export async function closeIncident(
  incidentId: string,
  resolvedBy: IIncident["resolvedBy"]
): Promise<void> {
  const now = new Date();
  const incident = await Incident.findById(incidentId);
  if (!incident) return;

  const mttrSeconds = Math.round((now.getTime() - incident.openedAt.getTime()) / 1000);

  await Incident.updateOne(
    { _id: incidentId },
    { status: "resolved", closedAt: now, resolvedBy, mttrSeconds }
  );

  openIncidentsBySignal.delete(incident.trigger.signal);
  emitIncidentClosed({ id: incidentId, resolvedBy, mttrSeconds });

  logger.info("[IncidentManager] Incident closed", { id: incidentId, resolvedBy, mttrSeconds });
}

// Called by health check loop when backend recovers
export function clearSignal(signal: string): void {
  const incidentId = openIncidentsBySignal.get(signal);
  if (incidentId) {
    closeIncident(incidentId, "autonomous").catch(() => {});
  }
}

export function getOpenIncidents(): Map<string, string> {
  return openIncidentsBySignal;
}
