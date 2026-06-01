import express, { type Router, type Request, type Response } from "express";
import jwt from "jsonwebtoken";
import { cfg } from "../config.js";
import { Incident } from "../db/models/Incident.js";
import { ActionHistory } from "../db/models/ActionHistory.js";
import { TelemetrySnapshot } from "../db/models/TelemetrySnapshot.js";
import { AnalyticsDaily } from "../db/models/AnalyticsDaily.js";
import { SystemBaseline } from "../db/models/SystemBaseline.js";
import { closeIncident } from "../incident/incidentManager.js";
import { executeScript } from "../executor/scriptExecutor.js";
import { emitActionResult, getConnectedCount } from "../comms/socketServer.js";
import { buildAndSendWeeklyReport } from "../analytics/reportBuilder.js";
import { EmailSession } from "../db/models/EmailSession.js";

export const apiRouter: Router = express.Router();

// ── Auth middleware ───────────────────────────────────────────────────────────
function auth(req: Request, res: Response, next: express.NextFunction): void {
  if (cfg.NODE_ENV !== "production") return next(); // Open in dev

  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) { res.status(401).json({ error: "Unauthorized" }); return; }

  try {
    req.user = jwt.verify(token, cfg.JWT_SECRET) as Record<string, unknown>;
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

// ── Health ────────────────────────────────────────────────────────────────────
apiRouter.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    dashboardClients: getConnectedCount(),
    uptime: process.uptime(),
  });
});

// ── Latest Telemetry ──────────────────────────────────────────────────────────
apiRouter.get("/telemetry/latest", auth, async (_req, res) => {
  const snapshot = await TelemetrySnapshot.findOne().sort({ capturedAt: -1 }).lean();
  res.json({ success: true, data: snapshot });
});

apiRouter.get("/telemetry/history", auth, async (req, res) => {
  const limit = Math.min(parseInt((req.query.limit as string) ?? "96"), 480); // max 2h at 15s
  const snapshots = await TelemetrySnapshot.find()
    .sort({ capturedAt: -1 })
    .limit(limit)
    .lean();
  res.json({ success: true, data: snapshots.reverse() });
});

// ── Incidents ─────────────────────────────────────────────────────────────────
apiRouter.get("/incidents", auth, async (req, res) => {
  const status = req.query.status as string;
  const filter = status ? { status } : {};
  const incidents = await Incident.find(filter)
    .sort({ openedAt: -1 })
    .limit(50)
    .lean();
  res.json({ success: true, data: incidents });
});

apiRouter.get("/incidents/:id", auth, async (req, res) => {
  const incident = await Incident.findById(req.params.id).lean();
  if (!incident) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ success: true, data: incident });
});

apiRouter.patch("/incidents/:id/close", auth, async (req, res) => {
  await closeIncident(req.params.id as string, "manual_ui");
  res.json({ success: true });
});

// Authorize a pending action from the dashboard (FIX / IGNORE / ESCALATE)
apiRouter.post("/incidents/:id/authorize", auth, async (req, res) => {
  const { cmd } = req.body as { cmd: "FIX" | "IGNORE" | "ESCALATE" };
  if (!cmd) { res.status(400).json({ error: "cmd required" }); return; }

  const session = await EmailSession.findOne({
    incidentId: req.params.id,
    awaitingReply: true,
    expiresAt: { $gt: new Date() },
  }).sort({ sentAt: -1 });

  if (!session) {
    // No email session — treat as a direct manual action from the UI
    if (cmd === "IGNORE") {
      await closeIncident(req.params.id as string, "manual_ui");
      res.json({ success: true, message: "Incident closed" });
    } else if (cmd === "ESCALATE") {
      await Incident.updateOne({ _id: req.params.id }, { status: "escalated" });
      res.json({ success: true, message: "Incident escalated" });
    } else {
      res.status(404).json({ error: "No pending authorization session found" });
    }
    return;
  }

  await EmailSession.updateOne(
    { _id: session._id },
    { reply: cmd, repliedAt: new Date(), awaitingReply: false }
  );

  if (cmd === "FIX") {
    const result = await executeScript(session.proposedAction, session.proposedParams ?? {});
    emitActionResult({ source: "ui", tool: session.proposedAction, result });
    await ActionHistory.create({
      incidentId: session.incidentId,
      executedAt: new Date(),
      toolName: session.proposedAction,
      parameters: session.proposedParams ?? {},
      authorizedBy: "ui_button",
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      success: result.exitCode === 0,
    });
    if (result.exitCode === 0 && session.incidentId) {
      await closeIncident(session.incidentId.toString(), "manual_ui");
    }
    res.json({ success: true, data: { result } });
  } else if (cmd === "IGNORE") {
    if (session.incidentId) await closeIncident(session.incidentId.toString(), "manual_ui");
    res.json({ success: true, message: "Incident ignored and closed" });
  } else if (cmd === "ESCALATE") {
    if (session.incidentId) await Incident.updateOne({ _id: session.incidentId }, { status: "escalated" });
    res.json({ success: true, message: "Incident escalated" });
  }
});

// ── Actions ───────────────────────────────────────────────────────────────────
apiRouter.get("/actions", auth, async (req, res) => {
  const limit = Math.min(parseInt((req.query.limit as string) ?? "50"), 200);
  const actions = await ActionHistory.find()
    .sort({ executedAt: -1 })
    .limit(limit)
    .lean();
  res.json({ success: true, data: actions });
});

// Manual action execution via UI button
apiRouter.post("/actions/execute", auth, async (req, res) => {
  const { toolName, params = {} } = req.body as { toolName: string; params: Record<string, unknown> };
  if (!toolName) { res.status(400).json({ error: "toolName required" }); return; }

  const result = await executeScript(toolName, params);
  const action = await ActionHistory.create({
    incidentId: req.body.incidentId ?? null,
    executedAt: new Date(),
    toolName,
    parameters: params,
    authorizedBy: "ui_button",
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    success: result.exitCode === 0,
  });

  emitActionResult({ source: "ui", tool: toolName, result, actionId: action._id });
  res.json({ success: true, data: { result, actionId: action._id } });
});

// ── Analytics ─────────────────────────────────────────────────────────────────
apiRouter.get("/analytics/daily", auth, async (req, res) => {
  const days = Math.min(parseInt(req.query.days as string ?? "30"), 90);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const analytics = await AnalyticsDaily.find({ date: { $gte: since } })
    .sort({ date: 1 })
    .lean();
  res.json({ success: true, data: analytics });
});

apiRouter.get("/analytics/baseline", auth, async (_req, res) => {
  const baseline = await SystemBaseline.findOne().sort({ computedAt: -1 }).lean();
  res.json({ success: true, data: baseline });
});

apiRouter.post("/analytics/report", auth, async (_req, res) => {
  await buildAndSendWeeklyReport();
  res.json({ success: true, message: "Report sent via email" });
});

// ── Email Test ────────────────────────────────────────────────────────────────
apiRouter.post("/notifications/test", auth, async (_req, res) => {
  const { sendWhatsApp } = await import("../comms/whatsapp.js");
  await sendWhatsApp(`✅ Test email from SRE Agent\n\nSent at: ${new Date().toUTCString()}\nThis confirms email notifications are working.`);
  res.json({ success: true, message: "Test email sent" });
});

// ── Agent Status ──────────────────────────────────────────────────────────────
apiRouter.get("/agent/status", auth, (_req, res) => {
  res.json({
    success: true,
    data: {
      uptime: process.uptime(),
      memoryMb: (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1),
      dashboardClients: getConnectedCount(),
      paused: (global as any).__SRE_PAUSED__ ?? false,
      timestamp: new Date().toISOString(),
    },
  });
});

// Extend Request type to include user
declare global {
  namespace Express {
    interface Request {
      user?: Record<string, unknown>;
    }
  }
}
