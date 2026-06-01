/**
 * Email notification module — replaces WhatsApp/Twilio.
 * Exports the same interface so all callers work without changes.
 */
import nodemailer from "nodemailer";
import crypto from "crypto";
import express, { type Router, type Request, type Response } from "express";
import { EmailSession } from "../db/models/EmailSession.js";
import { Incident } from "../db/models/Incident.js";
import { ActionHistory } from "../db/models/ActionHistory.js";
import { executeScript } from "../executor/scriptExecutor.js";
import { emitActionResult, emitAgentLog } from "./socketServer.js";
import { closeIncident } from "../incident/incidentManager.js";
import { cfg, hasEmail } from "../config.js";
import { logger } from "../utils/logger.js";
import { collectAll } from "../collector/index.js";

// ── Transporter (lazy init) ───────────────────────────────────────────────────
let _transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  if (!hasEmail) return null;
  if (!_transporter) {
    _transporter = nodemailer.createTransport({
      host:   cfg.SMTP_HOST!,
      port:   cfg.SMTP_PORT!,
      secure: cfg.SMTP_SECURE,
      auth: {
        user: cfg.SMTP_USER!,
        pass: cfg.SMTP_PASS!,
      },
    });
  }
  return _transporter;
}

// ── Email router (action approval one-click links) ────────────────────────────
export const whatsappRouter: Router = express.Router();

whatsappRouter.get("/action", async (req: Request, res: Response) => {
  const { token, cmd } = req.query as { token?: string; cmd?: string };
  if (!token || !cmd) {
    return res.status(400).send(htmlPage("Bad Request", "Missing token or cmd parameter.", false));
  }

  const session = await EmailSession.findOne({
    token,
    awaitingReply: true,
    expiresAt: { $gt: new Date() },
  });

  if (!session) {
    return res.status(410).send(htmlPage("Expired", "This action link has already been used or has expired.", false));
  }

  const command = cmd.toUpperCase();
  await EmailSession.updateOne(
    { _id: session._id },
    { reply: command, repliedAt: new Date(), awaitingReply: false }
  );

  emitAgentLog({
    timestamp: new Date().toISOString(),
    message: `[Email] One-click action: "${command}" for incident ${session.incidentId}`,
    level: "info",
  });

  if (command === "FIX" || command === "YES") {
    const result = await executeScript(session.proposedAction, session.proposedParams ?? {});
    emitActionResult({ source: "email", tool: session.proposedAction, result });

    if (session.incidentId) {
      await ActionHistory.create({
        incidentId: session.incidentId,
        executedAt: new Date(),
        toolName: session.proposedAction,
        parameters: session.proposedParams ?? {},
        authorizedBy: "email_reply",
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        success: result.exitCode === 0,
      });

      if (result.exitCode === 0) {
        await closeIncident(session.incidentId.toString(), "manual_email");
      }
    }

    const ok = result.exitCode === 0;
    return res.send(htmlPage(
      ok ? "Action Executed" : "Action Failed",
      ok
        ? `✅ ${session.proposedAction} completed in ${result.durationMs}ms.`
        : `❌ ${session.proposedAction} failed: ${result.stderr.slice(0, 200)}`,
      ok
    ));
  }

  if (command === "IGNORE" || command === "NO") {
    if (session.incidentId) {
      await closeIncident(session.incidentId.toString(), "manual_email");
    }
    return res.send(htmlPage("Incident Ignored", "The incident has been closed without action.", true));
  }

  if (command === "ESCALATE") {
    if (session.incidentId) {
      await Incident.updateOne({ _id: session.incidentId }, { status: "escalated" });
    }
    return res.send(htmlPage("Incident Escalated", "The incident has been marked as escalated. Check the dashboard for details.", true));
  }

  return res.status(400).send(htmlPage("Unknown Command", `Unknown command: ${command}`, false));
});

// ── Core send function ────────────────────────────────────────────────────────
export async function sendWhatsApp(message: string): Promise<void> {
  if (!hasEmail) {
    logger.info("[Email] (Dev mode — would send):", { message: message.slice(0, 100) });
    return;
  }
  const t = getTransporter();
  if (!t) return;

  const subject = message.startsWith("❌") ? "SRE Alert — Action Failed"
    : message.startsWith("✅") ? "SRE — Action Completed"
    : message.startsWith("📊") ? "SRE — System Status Report"
    : message.startsWith("⚠️") ? "SRE Warning"
    : message.startsWith("🚨") ? "SRE CRITICAL Alert"
    : "SRE Agent Notification";

  try {
    await t.sendMail({
      from: cfg.SMTP_FROM ?? `SRE Agent <${cfg.SMTP_USER}>`,
      to: cfg.ADMIN_EMAIL!,
      subject,
      text: message,
      html: `<pre style="font-family:monospace;white-space:pre-wrap;color:#f1f1f5;background:#111118;padding:20px;border-radius:8px">${escapeHtml(message)}</pre>`,
    });
  } catch (err: any) {
    logger.error("[Email] Failed to send notification", { error: err.message });
  }
}

// ── Authorization request (incident alert with action buttons) ────────────────
export async function requestAuthorization(params: {
  incidentId: string;
  summary: string;
  proposedAction: string;
  severity: string;
  requiresAuthorization: boolean;
}): Promise<void> {
  if (!hasEmail) {
    logger.info("[Email] (Dev mode) Would send authorization request:", { params });
    return;
  }

  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

  if (params.requiresAuthorization) {
    await EmailSession.create({
      incidentId: params.incidentId,
      token,
      sentAt: new Date(),
      expiresAt,
      awaitingReply: true,
      proposedAction: params.proposedAction,
      proposedParams: {},
      toEmail: cfg.ADMIN_EMAIL!,
    });
  }

  const t = getTransporter();
  if (!t) return;

  const sevColor = params.severity === "p1" ? "#ef4444" : params.severity === "p2" ? "#f59e0b" : "#6366f1";
  const baseUrl = cfg.SRE_PUBLIC_URL;

  const html = buildAlertEmail({
    severity: params.severity,
    sevColor,
    summary: params.summary,
    proposedAction: params.proposedAction,
    requiresAuthorization: params.requiresAuthorization,
    token,
    baseUrl,
    expiresAt,
  });

  try {
    await t.sendMail({
      from: cfg.SMTP_FROM ?? `SRE Agent <${cfg.SMTP_USER}>`,
      to: cfg.ADMIN_EMAIL!,
      subject: `[${params.severity.toUpperCase()}] OfferBerries SRE — ${params.summary.slice(0, 60)}`,
      html,
      text: `${params.severity.toUpperCase()} — ${params.summary}\n\nProposed action: ${params.proposedAction}\n${params.requiresAuthorization ? `\nFIX: ${baseUrl}/api/email/action?token=${token}&cmd=FIX\nIGNORE: ${baseUrl}/api/email/action?token=${token}&cmd=IGNORE\nESCALATE: ${baseUrl}/api/email/action?token=${token}&cmd=ESCALATE` : ""}`,
    });
    logger.info("[Email] Alert sent", { severity: params.severity, to: cfg.ADMIN_EMAIL });
  } catch (err: any) {
    logger.error("[Email] Failed to send alert", { error: err.message });
  }
}

// ── HTML builders ─────────────────────────────────────────────────────────────
function buildAlertEmail(p: {
  severity: string;
  sevColor: string;
  summary: string;
  proposedAction: string;
  requiresAuthorization: boolean;
  token: string;
  baseUrl: string;
  expiresAt: Date;
}): string {
  const actionButtons = p.requiresAuthorization ? `
    <div style="margin:32px 0;display:flex;gap:12px;flex-wrap:wrap">
      <a href="${p.baseUrl}/api/email/action?token=${p.token}&cmd=FIX"
         style="display:inline-block;padding:12px 28px;background:#10b981;color:white;text-decoration:none;border-radius:8px;font-weight:700;font-size:15px;letter-spacing:.5px">
        ✅ FIX IT
      </a>
      <a href="${p.baseUrl}/api/email/action?token=${p.token}&cmd=IGNORE"
         style="display:inline-block;padding:12px 28px;background:#374151;color:#f1f1f5;text-decoration:none;border-radius:8px;font-weight:700;font-size:15px;letter-spacing:.5px">
        ⏭ IGNORE
      </a>
      <a href="${p.baseUrl}/api/email/action?token=${p.token}&cmd=ESCALATE"
         style="display:inline-block;padding:12px 28px;background:#7f1d1d;color:white;text-decoration:none;border-radius:8px;font-weight:700;font-size:15px;letter-spacing:.5px">
        🚨 ESCALATE
      </a>
    </div>
    <p style="color:#6b7280;font-size:13px">Links expire at ${p.expiresAt.toUTCString()}</p>
  ` : `<p style="color:#6b7280;font-size:14px;margin-top:20px">No action required — for your awareness only.</p>`;

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0a0f;font-family:Inter,system-ui,sans-serif;color:#f1f1f5">
  <div style="max-width:600px;margin:40px auto;padding:0 16px">
    <div style="background:#111118;border:1px solid rgba(255,255,255,0.08);border-radius:14px;overflow:hidden">
      <!-- Header -->
      <div style="background:${p.sevColor};padding:20px 28px;display:flex;align-items:center;gap:12px">
        <div style="font-size:28px">${p.severity === "p1" ? "🚨" : p.severity === "p2" ? "⚠️" : "📋"}</div>
        <div>
          <div style="font-weight:800;font-size:18px;color:white;letter-spacing:.5px">${p.severity.toUpperCase()} INCIDENT</div>
          <div style="font-size:12px;color:rgba(255,255,255,.8);margin-top:2px">OfferBerries SRE Agent</div>
        </div>
      </div>
      <!-- Body -->
      <div style="padding:28px">
        <h2 style="margin:0 0 16px;font-size:16px;color:#f1f1f5;line-height:1.5">${escapeHtml(p.summary)}</h2>
        ${p.requiresAuthorization ? `
        <div style="background:#1a1a24;border:1px solid rgba(255,255,255,.06);border-radius:8px;padding:16px;margin-bottom:20px">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#6b7280;margin-bottom:8px">Proposed Action</div>
          <code style="font-family:'JetBrains Mono',monospace;font-size:14px;color:#f59e0b">${escapeHtml(p.proposedAction)}</code>
        </div>
        ${actionButtons}
        ` : actionButtons}
        <hr style="border:none;border-top:1px solid rgba(255,255,255,.06);margin:24px 0">
        <p style="margin:0;font-size:12px;color:#6b7280">
          You can also manage this incident from the
          <a href="${p.baseUrl.replace("3500", "5174")}" style="color:#ef4444;text-decoration:none">SRE Dashboard</a>.
        </p>
      </div>
    </div>
    <p style="text-align:center;font-size:11px;color:#374151;margin-top:16px">OfferBerries SRE Agent • Auto-generated alert</p>
  </div>
</body>
</html>`;
}

function htmlPage(title: string, message: string, success: boolean): string {
  const color = success ? "#10b981" : "#ef4444";
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>SRE Agent — ${title}</title></head>
<body style="margin:0;padding:60px 20px;background:#0a0a0f;font-family:Inter,system-ui,sans-serif;color:#f1f1f5;text-align:center">
  <div style="max-width:480px;margin:0 auto;background:#111118;border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:40px">
    <div style="font-size:48px;margin-bottom:16px">${success ? "✅" : "❌"}</div>
    <h1 style="margin:0 0 12px;font-size:22px;color:${color}">${title}</h1>
    <p style="margin:0;color:#9ca3af;font-size:15px;line-height:1.6">${message}</p>
    <p style="margin:24px 0 0;font-size:12px;color:#374151">You can close this tab.</p>
  </div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
