import React, { useState } from "react";
import axios from "axios";
import type { Incident } from "../hooks/useSocket";

const SRE_URL = import.meta.env.VITE_SRE_URL ?? "http://localhost:3500";

interface Props { incidents: Incident[]; onRefresh?: () => void }

function SeverityBadge({ severity }: { severity: string }) {
  return <span className={`badge badge-${severity}`}>{severity.toUpperCase()}</span>;
}

function StatusBadge({ status }: { status: string }) {
  if (status === "resolved")    return <span className="badge badge-ok">Resolved</span>;
  if (status === "escalated")   return <span className="badge badge-p2">Escalated</span>;
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
      setFeedback({ id: incidentId, msg: cmd === "FIX" ? "Action executed" : cmd === "IGNORE" ? "Incident closed" : "Incident escalated", ok: true });
      setTimeout(() => onRefresh?.(), 1500);
    } catch (err: any) {
      setFeedback({ id: incidentId, msg: err.response?.data?.error ?? "Request failed", ok: false });
    } finally {
      setAuthorizing(null);
      setTimeout(() => setFeedback(null), 4000);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Incidents</div>
          <div className="page-subtitle">{filtered.length} incidents</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {["all", "open", "investigating", "resolved", "escalated"].map((s) => (
            <button
              key={s}
              className={`btn ${statusFilter === s ? "btn-primary" : "btn-ghost"}`}
              onClick={() => setStatusFilter(s)}
              style={{ textTransform: "capitalize", fontSize: "0.75rem" }}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: selected ? "1fr 400px" : "1fr", gap: 20 }}>
        <div className="card" style={{ padding: 0 }}>
          {filtered.length === 0 ? (
            <div className="empty-state">
              <span className="empty-state-icon">🎉</span>
              No incidents match this filter
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Severity</th>
                  <th>Signal</th>
                  <th>Status</th>
                  <th>Opened</th>
                  <th>MTTR</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((i) => (
                  <tr
                    key={i._id}
                    onClick={() => setSelected(selected?._id === i._id ? null : i)}
                    style={{ cursor: "pointer", background: selected?._id === i._id ? "var(--bg-elevated)" : undefined }}
                  >
                    <td><SeverityBadge severity={i.severity} /></td>
                    <td style={{
                      color: "var(--text-primary)", fontFamily: "var(--font-mono)", fontSize: "0.75rem",
                      maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {i.trigger?.signal}
                    </td>
                    <td><StatusBadge status={i.status} /></td>
                    <td style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                      {new Date(i.openedAt).toLocaleString("en-PK", { timeZone: "Asia/Karachi", hour12: false })}
                    </td>
                    <td style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem" }}>{mttrLabel(i.mttrSeconds)}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {feedback?.id === i._id ? (
                        <span style={{ fontSize: "0.75rem", color: feedback.ok ? "var(--ok-color)" : "var(--p1-color)" }}>
                          {feedback.ok ? "✓" : "✗"} {feedback.msg}
                        </span>
                      ) : isActionable(i) ? (
                        <div style={{ display: "flex", gap: 4 }}>
                          <button
                            className="btn btn-ghost"
                            style={{ fontSize: "0.6875rem", padding: "3px 8px", color: "var(--ok-color)", borderColor: "rgba(16,185,129,0.3)" }}
                            disabled={authorizing !== null}
                            onClick={() => handleAuthorize(i._id, "FIX")}
                          >
                            {authorizing === i._id + "FIX" ? "..." : "FIX"}
                          </button>
                          <button
                            className="btn btn-ghost"
                            style={{ fontSize: "0.6875rem", padding: "3px 8px" }}
                            disabled={authorizing !== null}
                            onClick={() => handleAuthorize(i._id, "IGNORE")}
                          >
                            {authorizing === i._id + "IGNORE" ? "..." : "IGNORE"}
                          </button>
                          <button
                            className="btn btn-ghost"
                            style={{ fontSize: "0.6875rem", padding: "3px 8px", color: "var(--p1-color)", borderColor: "rgba(239,68,68,0.3)" }}
                            disabled={authorizing !== null}
                            onClick={() => handleAuthorize(i._id, "ESCALATE")}
                          >
                            {authorizing === i._id + "ESCALATE" ? "..." : "ESC"}
                          </button>
                        </div>
                      ) : (
                        <span style={{ fontSize: "0.75rem", color: "var(--text-dim)", textTransform: "capitalize" }}>
                          {i.resolvedBy?.replace(/_/g, " ") ?? "—"}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {selected && (
          <div className="card">
            <div className="card-header">
              <div className="card-title">Incident Detail</div>
              <button className="btn btn-ghost" onClick={() => setSelected(null)} style={{ padding: "2px 8px" }}>×</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ display: "flex", gap: 8 }}>
                <SeverityBadge severity={selected.severity} />
                <StatusBadge status={selected.status} />
              </div>

              <Field label="Signal">
                <code style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem", color: "var(--text-primary)", wordBreak: "break-all" }}>
                  {selected.trigger?.signal}
                </code>
              </Field>

              <Field label="Source">{selected.trigger?.source}</Field>
              <Field label="Description">{selected.trigger?.description}</Field>

              {selected.aiAnalysis && (
                <>
                  <Field label="AI Summary">
                    <span style={{ lineHeight: 1.5 }}>{selected.aiAnalysis.summary}</span>
                  </Field>
                  <Field label="Root Cause">{selected.aiAnalysis.rootCause}</Field>
                  <Field label="Confidence">
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ height: 6, flex: 1, background: "var(--bg-elevated)", borderRadius: 3, overflow: "hidden" }}>
                        <div style={{
                          height: "100%",
                          width: `${(selected.aiAnalysis.confidence * 100).toFixed(0)}%`,
                          background: selected.aiAnalysis.confidence > 0.8 ? "var(--ok-color)"
                            : selected.aiAnalysis.confidence > 0.6 ? "var(--p2-color)" : "var(--p1-color)",
                          borderRadius: 3,
                        }} />
                      </div>
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem" }}>
                        {(selected.aiAnalysis.confidence * 100).toFixed(0)}%
                      </span>
                    </div>
                  </Field>
                </>
              )}

              <Field label="MTTR">
                <span style={{ fontFamily: "var(--font-mono)" }}>{mttrLabel(selected.mttrSeconds)}</span>
              </Field>

              {isActionable(selected) && (
                <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: 14, display: "flex", gap: 8 }}>
                  <ActionBtn
                    label="Fix"
                    color="var(--ok-color)"
                    bg="rgba(16,185,129,0.1)"
                    loading={authorizing === selected._id + "FIX"}
                    disabled={authorizing !== null}
                    onClick={() => handleAuthorize(selected._id, "FIX")}
                  />
                  <ActionBtn
                    label="Ignore"
                    color="var(--text-secondary)"
                    bg="var(--bg-elevated)"
                    loading={authorizing === selected._id + "IGNORE"}
                    disabled={authorizing !== null}
                    onClick={() => handleAuthorize(selected._id, "IGNORE")}
                  />
                  <ActionBtn
                    label="Escalate"
                    color="var(--p1-color)"
                    bg="rgba(239,68,68,0.1)"
                    loading={authorizing === selected._id + "ESCALATE"}
                    disabled={authorizing !== null}
                    onClick={() => handleAuthorize(selected._id, "ESCALATE")}
                  />
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
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

function ActionBtn({ label, color, bg, loading, disabled, onClick }: {
  label: string; color: string; bg: string;
  loading: boolean; disabled: boolean; onClick: () => void;
}) {
  return (
    <button
      className="btn"
      style={{ flex: 1, justifyContent: "center", background: bg, color, border: `1px solid ${color}22`, fontWeight: 600 }}
      disabled={disabled}
      onClick={onClick}
    >
      {loading ? "..." : label}
    </button>
  );
}
