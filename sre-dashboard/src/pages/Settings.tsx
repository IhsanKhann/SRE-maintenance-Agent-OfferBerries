import React, { useState, useEffect } from "react";
import axios from "axios";

const SRE_URL = import.meta.env.VITE_SRE_URL ?? "http://localhost:3500";

interface AgentStatus {
  uptime: number;
  memoryMb: string;
  dashboardClients: number;
  paused: boolean;
  timestamp: string;
}

function formatUptime(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function Settings() {
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [testSending, setTestSending] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [reportSending, setReportSending] = useState(false);

  useEffect(() => {
    axios.get(`${SRE_URL}/api/agent/status`)
      .then((r) => setStatus(r.data.data))
      .catch(() => {});
  }, []);

  async function sendTestEmail() {
    setTestSending(true);
    setTestResult(null);
    try {
      await axios.post(`${SRE_URL}/api/notifications/test`);
      setTestResult({ ok: true, msg: "Test email sent — check your inbox" });
    } catch (err: any) {
      setTestResult({ ok: false, msg: err.response?.data?.error ?? "Failed to send test email" });
    } finally {
      setTestSending(false);
    }
  }

  async function sendReport() {
    setReportSending(true);
    try {
      await axios.post(`${SRE_URL}/api/analytics/report`);
      setTestResult({ ok: true, msg: "Weekly report sent via email" });
    } catch (err: any) {
      setTestResult({ ok: false, msg: err.response?.data?.error ?? "Failed to send report" });
    } finally {
      setReportSending(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Settings</div>
          <div className="page-subtitle">Agent configuration and notifications</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        {/* Agent Status */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">Agent Status</div>
            <span className={`badge ${status ? "badge-ok" : "badge-gray"}`}>
              {status ? "Running" : "Connecting..."}
            </span>
          </div>
          {status && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <StatusRow label="Uptime" value={formatUptime(status.uptime)} mono />
              <StatusRow label="Memory" value={`${status.memoryMb} MB`} mono />
              <StatusRow label="Dashboard Clients" value={String(status.dashboardClients)} mono />
              <StatusRow
                label="Autonomous Actions"
                value={status.paused ? "Paused" : "Active"}
                color={status.paused ? "var(--p2-color)" : "var(--ok-color)"}
              />
              <StatusRow
                label="Last Heartbeat"
                value={new Date(status.timestamp).toLocaleTimeString()}
                mono
              />
            </div>
          )}
        </div>

        {/* Email Notifications */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">Email Notifications</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <p style={{ color: "var(--text-muted)", fontSize: "0.8125rem", lineHeight: 1.6 }}>
              SRE alerts and incident authorization requests are sent via SMTP email.
              Configure <code style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>SMTP_*</code> and{" "}
              <code style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>ADMIN_EMAIL</code> in your{" "}
              <code style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>.env</code> file.
            </p>

            <div style={{ background: "var(--bg-elevated)", borderRadius: "var(--radius-sm)", padding: "12px 16px", fontSize: "0.75rem" }}>
              <div style={{ color: "var(--text-muted)", marginBottom: 8, textTransform: "uppercase", fontSize: "0.625rem", letterSpacing: "0.08em" }}>
                .env configuration
              </div>
              {[
                ["SMTP_HOST", "smtp.gmail.com"],
                ["SMTP_PORT", "587"],
                ["SMTP_USER", "youremail@gmail.com"],
                ["SMTP_PASS", "app_password"],
                ["ADMIN_EMAIL", "youremail@gmail.com"],
              ].map(([k, v]) => (
                <div key={k} style={{ display: "flex", gap: 8, marginBottom: 4 }}>
                  <span style={{ color: "var(--p2-color)", fontFamily: "var(--font-mono)" }}>{k}</span>
                  <span style={{ color: "var(--text-dim)" }}>=</span>
                  <span style={{ color: "var(--ok-color)", fontFamily: "var(--font-mono)" }}>{v}</span>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                className="btn btn-primary"
                style={{ fontSize: "0.8125rem" }}
                onClick={sendTestEmail}
                disabled={testSending}
              >
                {testSending ? "Sending..." : "Send Test Email"}
              </button>
              <button
                className="btn btn-ghost"
                style={{ fontSize: "0.8125rem" }}
                onClick={sendReport}
                disabled={reportSending}
              >
                {reportSending ? "Sending..." : "Send Weekly Report"}
              </button>
            </div>

            {testResult && (
              <div style={{
                padding: "10px 14px",
                borderRadius: "var(--radius-sm)",
                background: testResult.ok ? "rgba(16,185,129,0.1)" : "rgba(239,68,68,0.1)",
                border: `1px solid ${testResult.ok ? "rgba(16,185,129,0.2)" : "rgba(239,68,68,0.2)"}`,
                color: testResult.ok ? "var(--ok-color)" : "var(--p1-color)",
                fontSize: "0.8125rem",
              }}>
                {testResult.ok ? "✓" : "✗"} {testResult.msg}
              </div>
            )}
          </div>
        </div>

        {/* Notification Channels */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">Notification Channels</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <ChannelRow
              icon="✉️"
              name="Email (SMTP)"
              description="Incident alerts with one-click FIX / IGNORE / ESCALATE buttons"
              active
            />
            <ChannelRow
              icon="🖥"
              name="Dashboard"
              description="Real-time updates via WebSocket — always available when dashboard is open"
              active
            />
            <ChannelRow
              icon="📱"
              name="WhatsApp (Twilio)"
              description="Disabled — replaced by email + dashboard"
              active={false}
            />
          </div>
        </div>

        {/* How it works */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">How Alerts Work</div>
          </div>
          <ol style={{ paddingLeft: 20, margin: 0, display: "flex", flexDirection: "column", gap: 10 }}>
            {[
              "SRE Agent detects an anomaly (high error rate, memory spike, container crash)",
              "AI triage runs — Groq analyzes logs and suggests an action",
              "An email is sent to ADMIN_EMAIL with incident details and action buttons",
              "Click FIX in the email to authorize the action, or use the Incidents tab",
              "The agent executes the action and confirms via a second email",
            ].map((step, i) => (
              <li key={i} style={{ color: "var(--text-secondary)", fontSize: "0.8125rem", lineHeight: 1.5 }}>
                <span style={{ color: "var(--text-muted)", marginRight: 6 }}>Step {i + 1}.</span>
                {step}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}

function StatusRow({ label, value, mono, color }: {
  label: string; value: string; mono?: boolean; color?: string;
}) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <span style={{ color: "var(--text-muted)", fontSize: "0.8125rem" }}>{label}</span>
      <span style={{
        fontFamily: mono ? "var(--font-mono)" : undefined,
        fontSize: "0.8125rem",
        color: color ?? "var(--text-primary)",
      }}>
        {value}
      </span>
    </div>
  );
}

function ChannelRow({ icon, name, description, active }: {
  icon: string; name: string; description: string; active: boolean;
}) {
  return (
    <div style={{
      display: "flex", gap: 12, alignItems: "flex-start",
      padding: "10px 12px",
      background: "var(--bg-elevated)", borderRadius: "var(--radius-sm)",
      border: `1px solid ${active ? "var(--border-default)" : "var(--border-subtle)"}`,
      opacity: active ? 1 : 0.5,
    }}>
      <span style={{ fontSize: "1.25rem", flexShrink: 0 }}>{icon}</span>
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
          <span style={{ fontWeight: 600, fontSize: "0.8125rem", color: "var(--text-primary)" }}>{name}</span>
          <span className={`badge ${active ? "badge-ok" : "badge-gray"}`} style={{ fontSize: "0.5625rem" }}>
            {active ? "Active" : "Inactive"}
          </span>
        </div>
        <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "0.75rem", lineHeight: 1.5 }}>{description}</p>
      </div>
    </div>
  );
}
