import React, { useRef, useEffect, useState } from "react";
import type { AgentLogEntry } from "../hooks/useSocket";

interface Props {
  logs: AgentLogEntry[];
  codePatch: unknown | null;
}

export function Terminal({ logs, codePatch }: Props) {
  const termRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [filter, setFilter] = useState<string>("all");
  const [showPatch, setShowPatch] = useState(false);

  useEffect(() => {
    if (autoScroll && termRef.current) {
      termRef.current.scrollTop = termRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const filtered = filter === "all" ? logs : logs.filter((l) => l.level === filter);

  const levelClass = (level: string) => {
    if (level === "error") return "error";
    if (level === "warn") return "warn";
    if (level === "debug") return "debug";
    return "info";
  };

  const patch = codePatch as { patch?: string; explanation?: string } | null;

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Agent Terminal</div>
          <div className="page-subtitle">Live reasoning log from the SRE daemon</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {["all", "error", "warn", "info", "debug"].map((f) => (
            <button
              key={f}
              className={`btn ${filter === f ? "btn-primary" : "btn-ghost"}`}
              onClick={() => setFilter(f)}
              style={{ textTransform: "uppercase", fontSize: "0.6875rem" }}
            >
              {f}
            </button>
          ))}
          <button
            className="btn btn-ghost"
            onClick={() => setAutoScroll((v) => !v)}
          >
            {autoScroll ? "⏸ Pause" : "▶ Follow"}
          </button>
        </div>
      </div>

      <div
        className="terminal"
        ref={termRef}
        style={{ height: "calc(100vh - 280px)" }}
        onScroll={(e) => {
          const el = e.currentTarget;
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
          setAutoScroll(atBottom);
        }}
      >
        {filtered.length === 0 ? (
          <div style={{ color: "var(--text-muted)", textAlign: "center", paddingTop: 40 }}>
            Waiting for agent activity...
          </div>
        ) : (
          filtered.map((entry, i) => (
            <div key={i} className={`terminal-line ${levelClass(entry.level)}`}>
              <span className="terminal-ts">
                {new Date(entry.timestamp).toLocaleTimeString("en-PK", { hour12: false })}
              </span>
              <span style={{ color: "var(--text-muted)", marginRight: 6, fontSize: "0.625rem", textTransform: "uppercase" }}>
                [{entry.level.toUpperCase()}]
              </span>
              {entry.message}
            </div>
          ))
        )}
      </div>

      {patch?.patch && (
        <div className="card" style={{ marginTop: 20 }}>
          <div className="card-header">
            <div className="card-title">Claude Code Patch</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                className="btn btn-ghost"
                onClick={() => setShowPatch((v) => !v)}
              >
                {showPatch ? "Hide" : "Show"} Diff
              </button>
              <button
                className="btn btn-primary"
                onClick={() => navigator.clipboard.writeText(patch.patch ?? "")}
              >
                Copy Patch
              </button>
            </div>
          </div>
          <div style={{
            padding: "8px 12px",
            background: "rgba(239,68,68,0.05)",
            borderRadius: "var(--radius-sm)",
            fontSize: "0.75rem",
            color: "var(--p2-color)",
            marginBottom: 12,
            border: "1px solid rgba(245,158,11,0.2)",
          }}>
            ⚠️ This patch is display-only. Review before applying manually.
          </div>
          {patch.explanation && (
            <div style={{ fontSize: "0.8125rem", color: "var(--text-secondary)", marginBottom: 12 }}>
              {patch.explanation}
            </div>
          )}
          {showPatch && (
            <div className="code-diff">
              {(patch.patch ?? "").split("\n").map((line, i) => (
                <div
                  key={i}
                  className={
                    line.startsWith("+") && !line.startsWith("+++") ? "diff-add" :
                    line.startsWith("-") && !line.startsWith("---") ? "diff-remove" :
                    line.startsWith("@@") ? "diff-meta" : ""
                  }
                >
                  {line}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
