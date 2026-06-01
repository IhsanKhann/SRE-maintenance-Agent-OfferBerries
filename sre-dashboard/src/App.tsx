import React, { useState } from "react";
import { useSocket } from "./hooks/useSocket";
import { Overview } from "./pages/Overview";
import { Incidents } from "./pages/Incidents";
import { Terminal } from "./pages/Terminal";
import { Settings } from "./pages/Settings";
import "./styles/index.css";

type Page = "overview" | "incidents" | "terminal" | "actions" | "settings";

const NAV_ITEMS: { id: Page; label: string; icon: string }[] = [
  { id: "overview",  label: "Overview",       icon: "◈" },
  { id: "incidents", label: "Incidents",       icon: "⚡" },
  { id: "terminal",  label: "Agent Terminal",  icon: "▸" },
  { id: "actions",   label: "Actions",         icon: "⚙" },
  { id: "settings",  label: "Settings",        icon: "◎" },
];

export default function App() {
  const [page, setPage] = useState<Page>("overview");
  const { connected, telemetry, incidents, agentLogs, actionResults, codePatch, requestTelemetry, refreshIncidents } = useSocket();

  const openP1 = incidents.filter((i) => i.severity === "p1" && (i.status === "open" || i.status === "investigating")).length;

  return (
    <div className="sre-layout">
      {/* ── Topbar ──────────────────────────────────────────────────────── */}
      <header className="sre-topbar">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 32, height: 32,
            background: "var(--sre-gradient)",
            borderRadius: "var(--radius-md)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 15, fontWeight: 800, color: "white",
            boxShadow: "0 2px 8px rgba(239,68,68,0.35)",
            letterSpacing: "-0.5px",
          }}>OB</div>
          <div>
            <div style={{ fontSize: "var(--text-md)", fontWeight: 600, color: "var(--text-primary)", letterSpacing: "-0.01em" }}>
              OfferBerries <span style={{ color: "var(--sre-accent)" }}>SRE</span>
            </div>
            <div style={{ fontSize: "var(--text-2xs)", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Command Center
            </div>
          </div>
        </div>

        <div style={{ flex: 1 }} />

        {openP1 > 0 && (
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)",
            padding: "4px 12px", borderRadius: "var(--radius-full)",
            color: "var(--p1-color)", fontSize: "0.75rem", fontWeight: 700,
            animation: "pulse-red 2s infinite",
          }}>
            <span className="dot dot-red" />
            {openP1} P1 INCIDENT{openP1 > 1 ? "S" : ""} ACTIVE
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button className="btn btn-ghost" onClick={requestTelemetry} style={{ fontSize: "0.75rem" }}>
            ↻ Refresh
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.75rem", color: connected ? "var(--ok-color)" : "var(--p1-color)" }}>
            <span className={`dot ${connected ? "dot-green" : "dot-red"}`} />
            {connected ? "Live" : "Reconnecting..."}
          </div>
        </div>
      </header>

      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <nav className="sre-sidebar">
        <div style={{ padding: "8px 20px 16px", fontSize: "0.625rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
          Navigation
        </div>

        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            className={`nav-item ${page === item.id ? "active" : ""}`}
            onClick={() => setPage(item.id)}
            style={{ width: "100%", background: "none", border: "none", textAlign: "left", cursor: "pointer" }}
          >
            <span style={{ fontSize: "0.875rem", opacity: 0.7 }}>{item.icon}</span>
            <span>{item.label}</span>
            {item.id === "incidents" && incidents.filter((i) => i.status === "open" || i.status === "investigating").length > 0 && (
              <span style={{
                marginLeft: "auto",
                background: "var(--p1-bg)",
                color: "var(--p1-color)",
                borderRadius: "var(--radius-full)",
                fontSize: "0.625rem",
                padding: "1px 6px",
                fontWeight: 700,
              }}>
                {incidents.filter((i) => i.status === "open" || i.status === "investigating").length}
              </span>
            )}
          </button>
        ))}

        {/* ── Status section ─────────────────────────────────────────── */}
        <div style={{ margin: "24px 0 8px", padding: "0 20px", fontSize: "0.625rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
          Backend-A
        </div>

        <div style={{ padding: "8px 20px", fontSize: "0.75rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ color: "var(--text-muted)" }}>Health</span>
            <span style={{ display: "flex", alignItems: "center", gap: 4, color: telemetry?.backendBSync.syncEndpointUp ? "var(--ok-color)" : "var(--p1-color)" }}>
              <span className={`dot ${telemetry?.backendBSync.syncEndpointUp ? "dot-green" : "dot-red"}`} />
              {telemetry?.backendBSync.syncEndpointUp ? "UP" : "DOWN"}
            </span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ color: "var(--text-muted)" }}>Error Rate</span>
            <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
              {((telemetry?.prometheus.httpErrorRate ?? 0) * 100).toFixed(2)}%
            </span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "var(--text-muted)" }}>p95</span>
            <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
              {(telemetry?.prometheus.p95LatencyMs ?? 0).toFixed(0)}ms
            </span>
          </div>
        </div>
      </nav>

      {/* ── Main content ────────────────────────────────────────────────── */}
      <main className="sre-main">
        {page === "overview" && <Overview telemetry={telemetry} incidents={incidents} connected={connected} />}
        {page === "incidents" && <Incidents incidents={incidents} onRefresh={refreshIncidents} />}
        {page === "terminal" && <Terminal logs={agentLogs} codePatch={codePatch} />}
        {page === "settings" && <Settings />}
        {page === "actions" && (
          <div>
            <div className="page-header">
              <div>
                <div className="page-title">Action History</div>
                <div className="page-subtitle">{actionResults.length} recent actions</div>
              </div>
            </div>
            <div className="card" style={{ padding: 0 }}>
              {actionResults.length === 0 ? (
                <div className="empty-state">
                  <span className="empty-state-icon">⚙</span>
                  No actions executed yet
                </div>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Tool</th>
                      <th>Source</th>
                      <th>Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(actionResults as any[]).map((a, i) => (
                      <tr key={i}>
                        <td style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem" }}>
                          {new Date().toLocaleTimeString()}
                        </td>
                        <td style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem" }}>{a.tool}</td>
                        <td style={{ textTransform: "capitalize" }}>{a.source}</td>
                        <td>
                          <span className={`badge ${a.result?.exitCode === 0 ? "badge-ok" : "badge-p1"}`}>
                            {a.result?.exitCode === 0 ? "SUCCESS" : "FAILED"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
