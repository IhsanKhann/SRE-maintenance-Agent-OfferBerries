import React, { useState } from "react";
import axios from "axios";
import type { Incident } from "../hooks/useSocket";

const SRE_URL = import.meta.env.VITE_SRE_URL ?? "http://localhost:3500";

interface Props { incidents: Incident[]; onRefresh?: () => void }

function SeverityBadge({ severity }: { severity: string }) {
  return <span className={`badge badge-${severity}`}>{severity.toUpperCase()}</span>;
}

function StatusBadge({ status }: { status: string }) {
  if (status === "resolved")     return <span className="badge badge-ok">Resolved</span>;
  if (status === "escalated")    return <span className="badge badge-p2">Escalated</span>;
  if (status === "investigating") return <span className="badge badge-p3">Investigating</span>;
  return <span className="badge badge-p1">Open</span>;
}

function mttrLabel(secs: number | null): string {
  if (!secs) return "—";
  if (secs < 60) return `${secs}s`;
  return `${Math.round(secs / 60)}m ${secs % 60}s`;
}

export function Incidents({ incidents, onRefresh }: Props) {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selected, setSelected]         = useState<Incident | null>(null);
  const [authorizing, setAuthorizing]   = useState<string | null>(null);
  const [feedback, setFeedback]         = useState<{ id: string; msg: string; ok: boolean } | null>(null);

  const filtered = statusFilter === "all"
    ? incidents
    : incidents.filter((i) => i.status === statusFilter);

  const isActionable = (i: Incident) =>
    i.status === "open" || i.status === "investigating";

  async function handleAuthorize(incidentId: string, cmd: "FIX" | "IGNORE" | "ESCALATE") {
    setAuthorizing(incidentId + cmd);
    try {
      await axios.post(`${SRE_URL}/api/incidents/${incidentId}/authorize`, { cmd });
      const msg = cmd === "FIX" ? "Action executed" : cmd === "IGNORE" ? "Closed" : "Escalated";
      setFeedback({ id: incidentId, msg, ok: true });
      setTimeout(() => { onRefresh?.(); setSelected(null); }, 1500);
    } catch (err: any) {
      setFeedback({ id: incidentId, msg: err.response?.data?.error ?? "Request failed", ok: false });
    } finally {
      setAuthorizing(null);
      setTimeout(() => setFeedback(null), 4000);
    }
  }

  const filterLabels: Record<string, string> = {
    all: "All", open: "Open", investigating: "Investigating",
    resolved: "Resolved", escalated: "Escalated",
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Incidents</div>
          <div className="page-subtitle">{filtered.length} of {incidents.length}</div>
        </div>
      </div>

      {/* Filter pills */}
      <div className="filter-pills" style={{ marginBottom: "var(--space-4)" }}>
        {Object.entries(filterLabels).map(([key, label]) => {
          const count = key === "all" ? incidents.length : incidents.filter((i) => i.status === key).length;
          return (
            <button
              key={key}
              className={`btn ${statusFilter === key ? "btn-primary" : "btn-ghost"}`}
              onClick={() => setStatusFilter(key)}
              style={{ fontSize: "0.75rem", gap: 6, flexShrink: 0 }}
            >
              {label}
              {count > 0 && <span style={{ opacity: 0.7 }}>{count}</span>}
            </button>
          );
        })}
      </div>

      {/* ── Desktop: Table / Mobile: Cards ──────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: selected ? "1fr 400px" : "1fr", gap: 20 }}>

        <div className="card" style={{ padding: 0 }}>
          {filtered.length === 0 ? (
            <div className="empty-state">
              <span className="empty-state-icon">🎉</span>
              No incidents match this filter
            </div>
          ) : (
            <>
              {/* Desktop table */}
              <div className="table-wrap" style={{ display: "none" }} data-desktop-table>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Sev</th><th>Signal</th><th>Status</th><th>Opened</th><th>MTTR</th><th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((i) => (
                      <IncidentRow
                        key={i._id}
                        incident={i}
                        selected={selected?._id === i._id}
                        feedback={feedback?.id === i._id ? feedback : null}
                        authorizing={authorizing}
                        onSelect={() => setSelected(selected?._id === i._id ? null : i)}
                        onAuthorize={handleAuthorize}
                      />
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Card list (shown always — table hidden via media query approach below) */}
              <div>
                {filtered.map((i) => (
                  <IncidentCardItem
                    key={i._id}
                    incident={i}
                    selected={selected?._id === i._id}
                    feedback={feedback?.id === i._id ? feedback : null}
                    authorizing={authorizing}
                    onSelect={() => setSelected(selected?._id === i._id ? null : i)}
                    onAuthorize={handleAuthorize}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        {/* Desktop: side panel */}
        {selected && (
          <div className="card" style={{ position: "sticky", top: 0, alignSelf: "start" }}
            data-desktop-detail>
            <IncidentDetail
              incident={selected}
              feedback={feedback?.id === selected._id ? feedback : null}
              authorizing={authorizing}
              onClose={() => setSelected(null)}
              onAuthorize={handleAuthorize}
            />
          </div>
        )}
      </div>

      {/* Mobile: slide-up detail panel */}
      {selected && (
        <>
          <div className="incident-detail-overlay" onClick={() => setSelected(null)} data-mobile-overlay />
          <div className="incident-detail-panel" data-mobile-detail>
            <IncidentDetail
              incident={selected}
              feedback={feedback?.id === selected._id ? feedback : null}
              authorizing={authorizing}
              onClose={() => setSelected(null)}
              onAuthorize={handleAuthorize}
            />
          </div>
        </>
      )}
    </div>
  );
}

/* ── Incident row (desktop table) ────────────────────────────────────────── */
function IncidentRow({ incident: i, selected, feedback, authorizing, onSelect, onAuthorize }: {
  incident: Incident; selected: boolean;
  feedback: { msg: string; ok: boolean } | null;
  authorizing: string | null;
  onSelect: () => void;
  onAuthorize: (id: string, cmd: "FIX" | "IGNORE" | "ESCALATE") => void;
}) {
  const isActionable = i.status === "open" || i.status === "investigating";
  return (
    <tr
      onClick={onSelect}
      style={{ cursor: "pointer", background: selected ? "var(--bg-elevated)" : undefined }}
    >
      <td><SeverityBadge severity={i.severity} /></td>
      <td style={{ color: "var(--text-primary)", fontFamily: "var(--font-mono)", fontSize: "0.75rem", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {i.trigger?.signal}
      </td>
      <td><StatusBadge status={i.status} /></td>
      <td style={{ fontSize: "0.75rem", color: "var(--text-muted)", whiteSpace: "nowrap" }}>
        {new Date(i.openedAt).toLocaleString("en-PK", { timeZone: "Asia/Karachi", hour12: false })}
      </td>
      <td style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem" }}>{mttrLabel(i.mttrSeconds)}</td>
      <td onClick={(e) => e.stopPropagation()}>
        {feedback ? (
          <span style={{ fontSize: "0.75rem", color: feedback.ok ? "var(--ok-color)" : "var(--p1-color)" }}>
            {feedback.ok ? "✓" : "✗"} {feedback.msg}
          </span>
        ) : isActionable ? (
          <div style={{ display: "flex", gap: 4 }}>
            <ActionPill label="FIX" color="var(--ok-color)" loading={authorizing === i._id + "FIX"} disabled={authorizing !== null} onClick={() => onAuthorize(i._id, "FIX")} />
            <ActionPill label="IGN" color="var(--text-muted)" loading={authorizing === i._id + "IGNORE"} disabled={authorizing !== null} onClick={() => onAuthorize(i._id, "IGNORE")} />
            <ActionPill label="ESC" color="var(--p1-color)" loading={authorizing === i._id + "ESCALATE"} disabled={authorizing !== null} onClick={() => onAuthorize(i._id, "ESCALATE")} />
          </div>
        ) : (
          <span style={{ fontSize: "0.75rem", color: "var(--text-dim)", textTransform: "capitalize" }}>
            {i.resolvedBy?.replace(/_/g, " ") ?? "—"}
          </span>
        )}
      </td>
    </tr>
  );
}

/* ── Incident card (mobile / compact list) ───────────────────────────────── */
function IncidentCardItem({ incident: i, selected, feedback, authorizing, onSelect, onAuthorize }: {
  incident: Incident; selected: boolean;
  feedback: { msg: string; ok: boolean } | null;
  authorizing: string | null;
  onSelect: () => void;
  onAuthorize: (id: string, cmd: "FIX" | "IGNORE" | "ESCALATE") => void;
}) {
  const isActionable = i.status === "open" || i.status === "investigating";
  return (
    <div className={`incident-card ${selected ? "selected" : ""}`} onClick={onSelect}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <SeverityBadge severity={i.severity} />
          <StatusBadge status={i.status} />
        </div>
        <span style={{ fontSize: "0.6875rem", color: "var(--text-muted)", flexShrink: 0 }}>
          {new Date(i.openedAt).toLocaleTimeString("en-PK", { hour12: false })}
        </span>
      </div>

      <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem", color: "var(--text-primary)", wordBreak: "break-word" }}>
        {i.trigger?.signal}
      </div>

      {i.aiAnalysis?.summary && (
        <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
          {i.aiAnalysis.summary}
        </div>
      )}

      {feedback ? (
        <div style={{ fontSize: "0.75rem", color: feedback.ok ? "var(--ok-color)" : "var(--p1-color)", fontWeight: 600 }}>
          {feedback.ok ? "✓" : "✗"} {feedback.msg}
        </div>
      ) : isActionable && (
        <div style={{ display: "flex", gap: 8 }} onClick={(e) => e.stopPropagation()}>
          <button className="btn btn-ghost" style={{ flex: 1, color: "var(--ok-color)", borderColor: "rgba(16,185,129,0.3)", fontSize: "0.75rem" }}
            disabled={authorizing !== null} onClick={() => onAuthorize(i._id, "FIX")}>
            {authorizing === i._id + "FIX" ? "…" : "✓ Fix"}
          </button>
          <button className="btn btn-ghost" style={{ flex: 1, fontSize: "0.75rem" }}
            disabled={authorizing !== null} onClick={() => onAuthorize(i._id, "IGNORE")}>
            {authorizing === i._id + "IGNORE" ? "…" : "Ignore"}
          </button>
          <button className="btn btn-ghost" style={{ flex: 1, color: "var(--p1-color)", borderColor: "rgba(239,68,68,0.3)", fontSize: "0.75rem" }}
            disabled={authorizing !== null} onClick={() => onAuthorize(i._id, "ESCALATE")}>
            {authorizing === i._id + "ESCALATE" ? "…" : "↑ Esc"}
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Incident detail panel ───────────────────────────────────────────────── */
function IncidentDetail({ incident: i, feedback, authorizing, onClose, onAuthorize }: {
  incident: Incident;
  feedback: { msg: string; ok: boolean } | null;
  authorizing: string | null;
  onClose: () => void;
  onAuthorize: (id: string, cmd: "FIX" | "IGNORE" | "ESCALATE") => void;
}) {
  const isActionable = i.status === "open" || i.status === "investigating";
  return (
    <>
      <div className="card-header">
        <div className="card-title">Incident Detail</div>
        <button className="btn btn-ghost" onClick={onClose} style={{ padding: "4px 10px", minHeight: 32 }}>✕</button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <SeverityBadge severity={i.severity} />
          <StatusBadge status={i.status} />
        </div>

        <Field label="Signal">
          <code style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem", color: "var(--text-primary)", wordBreak: "break-all" }}>
            {i.trigger?.signal}
          </code>
        </Field>

        <Field label="Source">{i.trigger?.source}</Field>
        <Field label="Description">{i.trigger?.description}</Field>

        {i.aiAnalysis && (
          <>
            <Field label="AI Summary"><span style={{ lineHeight: 1.5 }}>{i.aiAnalysis.summary}</span></Field>
            <Field label="Root Cause">{i.aiAnalysis.rootCause}</Field>
            <Field label="Confidence">
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ height: 6, flex: 1, background: "var(--bg-elevated)", borderRadius: 3, overflow: "hidden" }}>
                  <div style={{
                    height: "100%", width: `${(i.aiAnalysis.confidence * 100).toFixed(0)}%`,
                    background: i.aiAnalysis.confidence > 0.8 ? "var(--ok-color)"
                      : i.aiAnalysis.confidence > 0.6 ? "var(--p2-color)" : "var(--p1-color)",
                    borderRadius: 3, transition: "width 0.5s ease",
                  }} />
                </div>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem", flexShrink: 0 }}>
                  {(i.aiAnalysis.confidence * 100).toFixed(0)}%
                </span>
              </div>
            </Field>
          </>
        )}

        <Field label="MTTR"><span style={{ fontFamily: "var(--font-mono)" }}>{mttrLabel(i.mttrSeconds)}</span></Field>
        <Field label="Opened">{new Date(i.openedAt).toLocaleString("en-PK", { timeZone: "Asia/Karachi", hour12: false })}</Field>

        {feedback && (
          <div style={{ padding: "10px 14px", borderRadius: "var(--radius-sm)", fontWeight: 600,
            background: feedback.ok ? "rgba(16,185,129,0.1)" : "rgba(239,68,68,0.1)",
            border: `1px solid ${feedback.ok ? "rgba(16,185,129,0.2)" : "rgba(239,68,68,0.2)"}`,
            color: feedback.ok ? "var(--ok-color)" : "var(--p1-color)", fontSize: "0.8125rem",
          }}>
            {feedback.ok ? "✓" : "✗"} {feedback.msg}
          </div>
        )}

        {isActionable && !feedback && (
          <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: 14, display: "flex", gap: 8 }}>
            <ActionBtn label="Fix" color="var(--ok-color)" bg="rgba(16,185,129,0.1)"
              loading={authorizing === i._id + "FIX"} disabled={authorizing !== null}
              onClick={() => onAuthorize(i._id, "FIX")} />
            <ActionBtn label="Ignore" color="var(--text-secondary)" bg="var(--bg-elevated)"
              loading={authorizing === i._id + "IGNORE"} disabled={authorizing !== null}
              onClick={() => onAuthorize(i._id, "IGNORE")} />
            <ActionBtn label="Escalate" color="var(--p1-color)" bg="rgba(239,68,68,0.1)"
              loading={authorizing === i._id + "ESCALATE"} disabled={authorizing !== null}
              onClick={() => onAuthorize(i._id, "ESCALATE")} />
          </div>
        )}
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: "0.6875rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: "0.8125rem", color: "var(--text-secondary)" }}>{children}</div>
    </div>
  );
}

function ActionPill({ label, color, loading, disabled, onClick }: {
  label: string; color: string; loading: boolean; disabled: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick} disabled={disabled}
      style={{ fontSize: "0.625rem", padding: "3px 8px", borderRadius: "var(--radius-sm)",
        background: "none", border: `1px solid ${color}44`, color, cursor: "pointer",
        fontWeight: 600, fontFamily: "var(--font-sans)", minHeight: 26, opacity: disabled ? 0.4 : 1,
      }}
    >
      {loading ? "…" : label}
    </button>
  );
}

function ActionBtn({ label, color, bg, loading, disabled, onClick }: {
  label: string; color: string; bg: string; loading: boolean; disabled: boolean; onClick: () => void;
}) {
  return (
    <button className="btn" style={{ flex: 1, justifyContent: "center", background: bg, color, border: `1px solid ${color}33`, fontWeight: 600 }}
      disabled={disabled} onClick={onClick}>
      {loading ? "…" : label}
    </button>
  );
}
