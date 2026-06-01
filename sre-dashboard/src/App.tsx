import React, { useState } from "react";
import { useSocket } from "./hooks/useSocket";
import { Overview } from "./pages/Overview";
import { Incidents } from "./pages/Incidents";
import { Terminal } from "./pages/Terminal";
import { Settings } from "./pages/Settings";
import "./styles/index.css";

type Page = "overview" | "incidents" | "terminal" | "actions" | "settings";

const NAV_ITEMS: { id: Page; label: string; icon: string }[] = [
  { id: "overview",  label: "Overview",  icon: "◈" },
  { id: "incidents", label: "Incidents", icon: "⚡" },
  { id: "terminal",  label: "Terminal",  icon: "▸" },
  { id: "actions",   label: "Actions",   icon: "⚙" },
  { id: "settings",  label: "Settings",  icon: "◎" },
];

const SRE_URL = import.meta.env.VITE_SRE_URL ?? "";

export default function App() {
  const [page, setPage] = useState<Page>("overview");
  const {
    connected, telemetry, incidents, agentLogs,
    actionResults, codePatch, containerList, containerLogs,
    requestTelemetry, refreshIncidents, requestContainerLogs,
  } = useSocket();

  const openP1 = incidents.filter(
    (i) => i.severity === "p1" && (i.status === "open" || i.status === "investigating")
  ).length;

  const openCount = incidents.filter(
    (i) => i.status === "open" || i.status === "investigating"
  ).length;

  const backendUnconfigured = !SRE_URL;

  return (
    <div className="sre-layout">

      {/* ── Topbar ──────────────────────────────────────────────────────── */}
      <header className="sre-topbar">
        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <div style={{
            width: 32, height: 32,
            background: "var(--sre-gradient)",
            borderRadius: "var(--radius-md)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 15, fontWeight: 800, color: "white",
            boxShadow: "0 2px 8px rgba(239,68,68,0.35)",
            letterSpacing: "-0.5px", flexShrink: 0,
          }}>OB</div>
          <div>
            <div style={{ fontSize: "var(--text-md)", fontWeight: 600, color: "var(--text-primary)", letterSpacing: "-0.01em", lineHeight: 1.2 }}>
              OfferBerries <span style={{ color: "var(--sre-accent)" }}>SRE</span>
            </div>
            <div style={{ fontSize: "var(--text-2xs)", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Command Center
            </div>
          </div>
        </div>

        <div style={{ flex: 1 }} />

        {/* P1 alert pill */}
        {openP1 > 0 && (
          <button
            className="topbar-compact"
            onClick={() => setPage("incidents")}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)",
              padding: "4px 10px", borderRadius: "var(--radius-full)",
              color: "var(--p1-color)", fontSize: "0.6875rem", fontWeight: 700,
              animation: "pulse-red 2s infinite", cursor: "pointer",
              flexShrink: 0,
            }}
          >
            <span className="dot dot-red" />
            {openP1} P1{openP1 > 1 ? "s" : ""}
          </button>
        )}

        {/* Desktop controls */}
        <div className="topbar-hide-mobile" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button className="btn btn-ghost topbar-compact" onClick={requestTelemetry}>
            ↻ Refresh
          </button>
          <div style={{
            display: "flex", alignItems: "center", gap: 6,
            fontSize: "0.75rem",
            color: connected ? "var(--ok-color)" : "var(--text-muted)",
          }}>
            <span className={`dot ${connected ? "dot-green" : "dot-gray"}`} />
            {connected ? "Live" : "Offline"}
          </div>
        </div>

        {/* Mobile: connection dot only */}
        <div style={{
          display: "none",
          alignItems: "center", gap: 6,
          fontSize: "0.75rem",
          color: connected ? "var(--ok-color)" : "var(--text-muted)",
        }}
          className="mobile-conn-dot"
        >
          <span className={`dot ${connected ? "dot-green" : "dot-gray"}`} />
        </div>
      </header>

      {/* ── Sidebar (desktop) ───────────────────────────────────────────── */}
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
            <span style={{ fontSize: "0.875rem", opacity: 0.7, flexShrink: 0 }}>{item.icon}</span>
            <span style={{ flex: 1 }}>{item.label}</span>
            {item.id === "incidents" && openCount > 0 && (
              <span style={{
                background: "var(--p1-bg)", color: "var(--p1-color)",
                borderRadius: "var(--radius-full)", fontSize: "0.625rem",
                padding: "1px 6px", fontWeight: 700,
              }}>
                {openCount}
              </span>
            )}
          </button>
        ))}

        {/* Backend-A mini status */}
        <div style={{ margin: "24px 0 8px", padding: "0 20px", fontSize: "0.625rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
          Backend-A
        </div>
        <div style={{ padding: "8px 20px", fontSize: "0.75rem" }}>
          <StatusRow label="Status" value={telemetry?.backendBSync.syncEndpointUp ? "UP" : "DOWN"} ok={telemetry?.backendBSync.syncEndpointUp} />
          <StatusRow label="Error Rate" value={`${((telemetry?.prometheus.httpErrorRate ?? 0) * 100).toFixed(2)}%`} />
          <StatusRow label="p95" value={`${(telemetry?.prometheus.p95LatencyMs ?? 0).toFixed(0)}ms`} />
        </div>
      </nav>

      {/* ── Main ────────────────────────────────────────────────────────── */}
      <main className="sre-main">
        {/* Connection / config banner */}
        {backendUnconfigured && (
          <div className="conn-banner conn-banner-warn">
            <span>⚠</span>
            <span>
              <strong>Backend not configured.</strong> Set <code style={{ fontFamily: "var(--font-mono)", fontSize: "0.8125rem" }}>VITE_SRE_URL</code> in Vercel Environment Variables to your Railway URL, then redeploy.
            </span>
          </div>
        )}
        {!backendUnconfigured && !connected && (
          <div className="conn-banner conn-banner-error" style={{ marginBottom: "var(--space-4)" }}>
            <span className="dot dot-red" />
            <span>Connecting to backend at <code style={{ fontFamily: "var(--font-mono)", fontSize: "0.8125rem" }}>{SRE_URL}</code>…</span>
          </div>
        )}

        {page === "overview"  && <Overview telemetry={telemetry} incidents={incidents} connected={connected} />}
        {page === "incidents" && <Incidents incidents={incidents} onRefresh={refreshIncidents} />}
        {page === "terminal"  && (
          <Terminal
            logs={agentLogs}
            codePatch={codePatch}
            containerList={containerList}
            containerLogs={containerLogs}
            onRequestContainerLogs={requestContainerLogs}
          />
        )}
        {page === "settings"  && <Settings />}
        {page === "actions"   && <ActionsPage actionResults={actionResults} />}
      </main>

      {/* ── Mobile bottom nav ───────────────────────────────────────────── */}
      <nav className="sre-mobile-nav">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            className={`mobile-nav-item ${page === item.id ? "active" : ""}`}
            onClick={() => setPage(item.id)}
          >
            {item.id === "incidents" && openCount > 0 && (
              <span className="mobile-nav-badge">{openCount}</span>
            )}
            <span className="mobile-nav-icon">{item.icon}</span>
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

function StatusRow({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
      <span style={{ color: "var(--text-muted)" }}>{label}</span>
      <span style={{
        display: "flex", alignItems: "center", gap: 4,
        fontFamily: "var(--font-mono)",
        color: ok === true ? "var(--ok-color)" : ok === false ? "var(--p1-color)" : "var(--text-secondary)",
      }}>
        {ok !== undefined && <span className={`dot ${ok ? "dot-green" : "dot-red"}`} style={{ width: 6, height: 6 }} />}
        {value}
      </span>
    </div>
  );
}

function ActionsPage({ actionResults }: { actionResults: unknown[] }) {
  return (
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
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Time</th><th>Tool</th><th>Source</th><th>Result</th>
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
          </div>
        )}
      </div>
    </div>
  );
}
