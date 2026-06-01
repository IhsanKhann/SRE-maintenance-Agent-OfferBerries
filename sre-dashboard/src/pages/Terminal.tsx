import React, { useRef, useEffect, useState } from "react";
import type { AgentLogEntry } from "../hooks/useSocket";

interface Props { logs: AgentLogEntry[]; codePatch: unknown | null }

export function Terminal({ logs, codePatch }: Props) {
  const termRef   = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [filter, setFilter]         = useState<string>("all");
  const [showPatch, setShowPatch]   = useState(false);

  useEffect(() => {
    if (autoScroll && termRef.current) {
      termRef.current.scrollTop = termRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const filtered = filter === "all" ? logs : logs.filter((l) => l.level === filter);

  const patch = codePatch as { patch?: string; explanation?: string } | null;

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Agent Terminal</div>
          <div className="page-subtitle" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--dot-green)", display: "inline-block" }} />
            {filtered.length} lines
          </div>
        </div>
        <button className="btn btn-ghost" onClick={() => setAutoScroll((v) => !v)}
          style={{ fontSize: "0.75rem", flexShrink: 0 }}>
          {autoScroll ? "⏸ Pause" : "▶ Follow"}
        </button>
      </div>

      {/* Filter pills */}
      <div className="filter-pills" style={{ marginBottom: "var(--space-3)" }}>
        {["all", "error", "warn", "info", "debug"].map((f) => {
          const count = f === "all" ? logs.length : logs.filter((l) => l.level === f).length;
          const color = f === "error" ? "var(--p1-color)" : f === "warn" ? "var(--p2-color)"
            : f === "info" ? "var(--ok-color)" : f === "debug" ? "var(--text-muted)" : undefined;
          return (
            <button
              key={f}
              className={`btn ${filter === f ? "btn-primary" : "btn-ghost"}`}
              onClick={() => setFilter(f)}
              style={{ textTransform: "uppercase", fontSize: "0.6875rem", gap: 5, flexShrink: 0,
                ...(filter !== f && color ? { color, borderColor: `${color}44` } : {}) }}
            >
              {f} {count > 0 && <span style={{ opacity: 0.7 }}>{count}</span>}
            </button>
          );
        })}
      </div>

      {/* Terminal */}
      <div
        className="terminal"
        ref={termRef}
        style={{ height: "calc(100dvh - 340px)", minHeight: 200 }}
        onScroll={(e) => {
          const el = e.currentTarget;
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
          setAutoScroll(atBottom);
        }}
      >
        {filtered.length === 0 ? (
          <div style={{ color: "var(--text-muted)", textAlign: "center", paddingTop: 40, fontSize: "0.8125rem" }}>
            {logs.length === 0 ? "Waiting for agent activity…" : `No ${filter} logs`}
          </div>
        ) : (
          filtered.map((entry, i) => (
            <div key={i} className={`terminal-line ${entry.level === "error" ? "error" : entry.level === "warn" ? "warn" : entry.level === "debug" ? "debug" : "info"}`}>
              <span className="terminal-ts">
                {new Date(entry.timestamp).toLocaleTimeString("en-PK", { hour12: false })}
              </span>
              <span style={{ color: "var(--text-muted)", marginRight: 6, fontSize: "0.5625rem", textTransform: "uppercase" }}>
                [{entry.level}]
              </span>
              {entry.message}
            </div>
          ))
        )}
      </div>

      {/* Code patch */}
      {patch?.patch && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-header">
            <div className="card-title">Claude Code Patch</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-ghost" onClick={() => setShowPatch((v) => !v)} style={{ fontSize: "0.75rem" }}>
                {showPatch ? "Hide" : "Show"} Diff
              </button>
              <button className="btn btn-primary" onClick={() => navigator.clipboard.writeText(patch.patch ?? "")} style={{ fontSize: "0.75rem" }}>
                Copy
              </button>
            </div>
          </div>
          <div style={{
            padding: "8px 12px", background: "rgba(245,158,11,0.08)",
            borderRadius: "var(--radius-sm)", fontSize: "0.75rem",
            color: "var(--p2-color)", marginBottom: 12,
            border: "1px solid rgba(245,158,11,0.2)",
          }}>
            ⚠️ Display-only — review before applying manually.
          </div>
          {patch.explanation && (
            <p style={{ fontSize: "0.8125rem", color: "var(--text-secondary)", marginBottom: 12, lineHeight: 1.5 }}>
              {patch.explanation}
            </p>
          )}
          {showPatch && (
            <div className="code-diff">
              {(patch.patch ?? "").split("\n").map((line, i) => (
                <div key={i} className={
                  line.startsWith("+") && !line.startsWith("+++") ? "diff-add" :
                  line.startsWith("-") && !line.startsWith("---") ? "diff-remove" :
                  line.startsWith("@@") ? "diff-meta" : ""
                }>{line}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
