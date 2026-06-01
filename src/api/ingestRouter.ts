import express from "express";
import { b2bAuthMiddleware } from "#comms/b2bAuth";
import { emitAgentLog, emitIncidentAlert } from "#comms/socketServer";
import { Incident } from "#models/Incident";
import { logger } from "#utils/logger";

export const ingestRouter = express.Router();

// All ingest routes require a valid SRE_INTERNAL_KEY from Backend-A
ingestRouter.use(b2bAuthMiddleware);

/**
 * GET /api/ingest/ping
 * Backend-A calls this to verify the SRE agent is reachable.
 */
ingestRouter.get("/ping", (_req, res) => {
  res.json({
    success: true,
    agent: "sre-agent",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

/**
 * POST /api/ingest/event
 * Backend-A pushes critical application events here for immediate triage.
 *
 * Body: { eventType, severity?, payload, source? }
 *
 * eventType examples: "HIGH_ERROR_RATE", "SALARY_TX_FAILED", "OUTBOX_STALLED",
 *                     "MEMORY_SPIKE", "QUEUE_OVERLOADED"
 */
ingestRouter.post("/event", async (req, res) => {
  const { eventType, severity = "p2", payload = {}, source = "backend-a" } = req.body as {
    eventType: string;
    severity?: "p1" | "p2" | "p3";
    payload?: Record<string, unknown>;
    source?: string;
  };

  if (!eventType) {
    res.status(400).json({ success: false, message: "eventType required" });
    return;
  }

  logger.info("[Ingest] Event received from Backend-A", { eventType, severity, source });

  emitAgentLog({
    timestamp: new Date().toISOString(),
    message: `[Ingest/${source}] ${eventType} — ${JSON.stringify(payload).slice(0, 120)}`,
    level: severity === "p1" ? "error" : "warn",
  });

  // Auto-create an incident for P1/P2 events pushed by Backend-A
  if (severity === "p1" || severity === "p2") {
    try {
      const incident = await Incident.create({
        status: "open",
        severity,
        trigger: {
          source,
          signal: eventType,
          description: payload?.description ?? `${eventType} reported by ${source}`,
          rawData: payload,
        },
        aiAnalysis: null,
        resolvedBy: null,
        closedAt: null,
      });

      emitIncidentAlert(incident.toObject());

      logger.info("[Ingest] Incident created from Backend-A event", {
        incidentId: incident._id,
        eventType,
      });

      res.json({ success: true, incidentId: incident._id });
    } catch (err: any) {
      logger.error("[Ingest] Failed to create incident", { error: err.message });
      res.status(500).json({ success: false, message: "Failed to record incident" });
    }
    return;
  }

  // P3 events just get logged to the dashboard terminal
  res.json({ success: true, logged: true });
});

/**
 * POST /api/ingest/heartbeat
 * Backend-A can push a heartbeat so the SRE agent knows the server is alive
 * even between polling cycles. Optional — the collector already polls health.
 */
ingestRouter.post("/heartbeat", (req, res) => {
  const { version, env } = req.body as { version?: string; env?: string };
  logger.debug("[Ingest] Backend-A heartbeat received", { version, env });
  emitAgentLog({
    timestamp: new Date().toISOString(),
    message: `[Ingest] Backend-A heartbeat — v${version ?? "?"} (${env ?? "?"})`,
    level: "debug",
  });
  res.json({ success: true });
});
