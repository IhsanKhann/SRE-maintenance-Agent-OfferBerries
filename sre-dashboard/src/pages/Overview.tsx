import React from "react";
import type { TelemetrySnapshot, Incident } from "../hooks/useSocket";

interface Props {
  telemetry: TelemetrySnapshot | null;
  incidents: Incident[];
  connected: boolean;
}

function StatusDot({ up }: { up: boolean }) {
  return <span className={`dot ${up ? "dot-green" : "dot-red"}`} />;
}

function SeverityBadge({ severity }: { severity: string }) {
  return <span className={`badge badge-${severity}`}>{severity.toUpperCase()}</span>;
}

function StatCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={color ? { color } : undefined}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export function Overview({ telemetry, incidents, connected }: Props) {
  const openIncidents = incidents.filter((i) => i.status === "open" || i.status === "investigating");
  const p1Count = openIncidents.filter((i) => i.severity === "p1").length;

  const backendUp = telemetry?.backendBSync.syncEndpointUp ?? false;
  const errorRate = ((telemetry?.prometheus.httpErrorRate ?? 0) * 100).toFixed(2);
  const p95 = (telemetry?.prometheus.p95LatencyMs ?? 0).toFixed(0);

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">System Overview</div>
          <div className="page-subtitle">
            {connected ? "● Live" : "○ Disconnected"} — Last update:{" "}
            {telemetry ? new Date(telemetry.capturedAt).toLocaleTimeString() : "—"}
          </div>
        </div>
        {p1Count > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--p1-color)", fontWeight: 700 }}>
            <span className="dot dot-red" />
            {p1Count} P1 ACTIVE
          </div>
        )}
      </div>

      {/* ── Health Bar ─────────────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 20, display: "flex", gap: 32, alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <StatusDot up={backendUp} />
          <span style={{ fontWeight: 600, color: backendUp ? "var(--ok-color)" : "var(--p1-color)" }}>
            Backend-A {backendUp ? "UP" : "DOWN"}
          </span>
        </div>
        <div style={{ color: "var(--text-muted)", fontSize: "0.8125rem" }}>
          Error Rate: <strong style={{ color: parseFloat(errorRate) > 3 ? "var(--p1-color)" : "var(--text-primary)" }}>{errorRate}%</strong>
        </div>
        <div style={{ color: "var(--text-muted)", fontSize: "0.8125rem" }}>
          p95 Latency: <strong style={{ color: parseFloat(p95) > 2000 ? "var(--p2-color)" : "var(--text-primary)" }}>{p95}ms</strong>
        </div>
        <div style={{ color: "var(--text-muted)", fontSize: "0.8125rem" }}>
          Open Incidents: <strong style={{ color: openIncidents.length > 0 ? "var(--p2-color)" : "var(--text-primary)" }}>{openIncidents.length}</strong>
        </div>
      </div>

      {/* ── Stats Grid ─────────────────────────────────────────────────── */}
      <div className="stat-grid">
        <StatCard
          label="HTTP Requests"
          value={(telemetry?.prometheus.httpRequestsTotal ?? 0).toLocaleString()}
          sub="total"
        />
        <StatCard
          label="Error Rate"
          value={`${errorRate}%`}
          color={parseFloat(errorRate) > 3 ? "var(--p1-color)" : "var(--ok-color)"}
          sub="5xx responses"
        />
        <StatCard
          label="p95 Latency"
          value={`${p95}ms`}
          color={parseFloat(p95) > 2000 ? "var(--p2-color)" : undefined}
          sub="response time"
        />
        <StatCard
          label="Outbox Relay"
          value={`${telemetry?.bullmq.outboxRelay.failed ?? 0}f`}
          color={(telemetry?.bullmq.outboxRelay.failed ?? 0) > 20 ? "var(--p2-color)" : undefined}
          sub={`${telemetry?.bullmq.outboxRelay.waiting ?? 0}w ${telemetry?.bullmq.outboxRelay.active ?? 0}a`}
        />
        <StatCard
          label="Doc Worker"
          value={`${telemetry?.bullmq.documentWorker.failed ?? 0}f`}
          color={(telemetry?.bullmq.documentWorker.failed ?? 0) > 10 ? "var(--p2-color)" : undefined}
          sub={`${telemetry?.bullmq.documentWorker.waiting ?? 0}w ${telemetry?.bullmq.documentWorker.active ?? 0}a`}
        />
        <StatCard
          label="Loki Errors/5m"
          value={telemetry?.loki.errorLogCount5m ?? 0}
          color={(telemetry?.loki.errorLogCount5m ?? 0) > 50 ? "var(--p2-color)" : undefined}
        />
        <StatCard
          label="Disk Usage"
          value={`${telemetry?.system.diskUsagePercent ?? 0}%`}
          color={(telemetry?.system.diskUsagePercent ?? 0) > 85 ? "var(--p1-color)" : undefined}
        />
        <StatCard
          label="Redis Memory"
          value={`${(telemetry?.system.redisMemoryPercent ?? 0).toFixed(1)}%`}
          color={(telemetry?.system.redisMemoryPercent ?? 0) > 80 ? "var(--p2-color)" : undefined}
        />
      </div>

      <div className="grid-2" style={{ gap: 20 }}>
        {/* ── Docker Containers ─────────────────────────────────────────── */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">Docker Containers</div>
          </div>
          {(telemetry?.docker.containers.length ?? 0) === 0 ? (
            <div className="empty-state"><span className="empty-state-icon">🐳</span>No containers visible</div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Container</th>
                  <th>Status</th>
                  <th>CPU</th>
                  <th>MEM</th>
                  <th>Restarts</th>
                </tr>
              </thead>
              <tbody>
                {telemetry?.docker.containers.map((c) => (
                  <tr key={c.name}>
                    <td style={{ color: "var(--text-primary)", fontFamily: "var(--font-mono)", fontSize: "0.75rem" }}>{c.name}</td>
                    <td>
                      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span className={`dot dot-${c.status === "running" ? "green" : "red"}`} />
                        {c.status}
                      </span>
                    </td>
                    <td style={{ fontFamily: "var(--font-mono)" }}>{c.cpuPercent.toFixed(1)}%</td>
                    <td style={{ fontFamily: "var(--font-mono)" }}>{c.memUsageMb.toFixed(0)}MB</td>
                    <td style={{ color: c.restartCount > 2 ? "var(--p2-color)" : "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                      {c.restartCount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* ── Active Incidents ──────────────────────────────────────────── */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">Active Incidents</div>
            <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{openIncidents.length} open</span>
          </div>
          {openIncidents.length === 0 ? (
            <div className="empty-state">
              <span className="empty-state-icon">✅</span>
              All systems nominal
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {openIncidents.map((i) => (
                <div key={i._id} style={{
                  padding: "10px 12px",
                  background: "var(--bg-elevated)",
                  borderRadius: "var(--radius-sm)",
                  border: `1px solid ${i.severity === "p1" ? "rgba(239,68,68,0.2)" : "var(--border-subtle)"}`,
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <SeverityBadge severity={i.severity} />
                    <span style={{ fontSize: "0.6875rem", color: "var(--text-muted)" }}>
                      {new Date(i.openedAt).toLocaleTimeString()}
                    </span>
                  </div>
                  <div style={{ fontSize: "0.8125rem", color: "var(--text-secondary)" }}>
                    {i.trigger?.signal}
                  </div>
                  {i.status === "investigating" && (
                    <div style={{ fontSize: "0.75rem", color: "var(--ops-accent)", marginTop: 4 }}>
                      🤖 AI triage in progress...
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Recent Loki Errors ────────────────────────────────────────────── */}
      {(telemetry?.loki.recentErrors.length ?? 0) > 0 && (
        <div className="card" style={{ marginTop: 20 }}>
          <div className="card-header">
            <div className="card-title">Recent Log Errors</div>
            {telemetry?.loki.oomKillDetected && (
              <span className="badge badge-p1">OOM DETECTED</span>
            )}
          </div>
          <div className="terminal" style={{ height: "auto", maxHeight: 200 }}>
            {telemetry?.loki.recentErrors.map((line, i) => (
              <div key={i} className="terminal-line error">{line}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
