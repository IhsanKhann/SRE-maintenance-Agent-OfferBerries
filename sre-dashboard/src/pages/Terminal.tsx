import React, { useRef, useEffect, useState, useCallback } from "react";
import type { AgentLogEntry, ContainerLogEntry } from "../hooks/useSocket";

interface Props {
  logs: AgentLogEntry[];
  codePatch: unknown | null;
  containerList: string[];
  containerLogs: Record<string, ContainerLogEntry[]>;
  onRequestContainerLogs: (container: string, lines?: number) => void;
}

type Tab = "agent" | "containers";

const CONTAINER_COLORS: Record<string, string> = {
  backend:    "var(--ok-color)",
  nginx:      "var(--info-text)",
  redis:      "var(--p1-color)",
  loki:       "var(--p2-color)",
  prometheus: "var(--p2-color)",
  promtail:   "var(--text-muted)",
  grafana:    "var(--p3-color)",
};

export function Terminal({ logs, codePatch, containerList, containerLogs, onRequestContainerLogs }: Props) {
  const termRef        = useRef<HTMLDivElement>(null);
  const containerRef   = useRef<HTMLDivElement>(null);
  const [tab, setTab]  = useState<Tab>("agent");
  const [autoScroll, setAutoScroll]   = useState(true);
  const [filter, setFilter]           = useState<string>("all");
  const [selectedContainer, setSelectedContainer] = useState<string>("");
  const [showPatch, setShowPatch]     = useState(false);

  // Auto-scroll agent terminal
  useEffect(() => {
    if (tab === "agent" && autoScroll && termRef.current) {
      termRef.current.scrollTop = termRef.current.scrollHeight;
    }
  }, [logs, autoScroll, tab]);

  // Auto-scroll container logs
  useEffect(() => {
    if (tab === "containers" && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [containerLogs, selectedContainer, tab]);

  // Pick first container when list arrives
  useEffect(() => {
    if (containerList.length > 0 && !selectedContainer) {
      const preferred = containerList.find(c => c.includes("backend")) ?? containerList[0];
      setSelectedContainer(preferred);
      onRequestContainerLogs(preferred, 200);
    }
  }, [containerList]);

  const handleContainerSelect = useCallback((name: string) => {
    setSelectedContainer(name);
    onRequestContainerLogs(name, 200);
  }, [onRequestContainerLogs]);

  const filtered = filter === "all" ? logs : logs.filter((l) => l.level === filter);
  const patch = codePatch as { patch?: string; explanation?: string } | null;
  const currentLogs = selectedContainer ? (containerLogs[selectedContainer] ?? []) : [];

  const termHeight = "calc(100dvh - 300px)";

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">
            {tab === "agent" ? "Agent Terminal" : "Container Logs"}
          </div>
          <div className="page-subtitle" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--dot-green)", display: "inline-block" }} />
            {tab === "agent" ? `${filtered.length} lines` : selectedContainer ? `${currentLogs.length} lines — ${selectedContainer}` : "Select a container"}
          </div>
        </div>
        {tab === "agent" && (
          <button className="btn btn-ghost" onClick={() => setAutoScroll(v => !v)} style={{ fontSize: "0.75rem", flexShrink: 0 }}>
            {autoScroll ? "⏸ Pause" : "▶ Follow"}
          </button>
        )}
        {tab === "containers" && selectedContainer && (
          <button className="btn btn-ghost" onClick={() => onRequestContainerLogs(selectedContainer, 200)} style={{ fontSize: "0.75rem", flexShrink: 0 }}>
            ↻ Refresh
          </button>
        )}
      </div>

      {/* Tab switcher */}
      <div style={{ display: "flex", gap: 8, marginBottom: "var(--space-3)" }}>
        <button
          className={`btn ${tab === "agent" ? "btn-primary" : "btn-ghost"}`}
          onClick={() => setTab("agent")}
          style={{ fontSize: "0.75rem" }}
        >
          ▸ Agent
        </button>
        <button
          className={`btn ${tab === "containers" ? "btn-primary" : "btn-ghost"}`}
          onClick={() => setTab("containers")}
          style={{ fontSize: "0.75rem" }}
        >
          🐳 Containers
          {containerList.length > 0 && (
            <span style={{ opacity: 0.7, marginLeft: 4 }}>{containerList.length}</span>
          )}
        </button>
      </div>

      {/* ── Agent Terminal ──────────────────────────────────────────────── */}
      {tab === "agent" && (
        <>
          <div className="filter-pills" style={{ marginBottom: "var(--space-3)" }}>
            {["all", "error", "warn", "info", "debug"].map((f) => {
              const count = f === "all" ? logs.length : logs.filter(l => l.level === f).length;
              const color = f === "error" ? "var(--p1-color)" : f === "warn" ? "var(--p2-color)"
                : f === "info" ? "var(--ok-color)" : undefined;
              return (
                <button
                  key={f}
                  className={`btn ${filter === f ? "btn-primary" : "btn-ghost"}`}
                  onClick={() => setFilter(f)}
                  style={{ textTransform: "uppercase", fontSize: "0.6875rem", flexShrink: 0,
                    ...(filter !== f && color ? { color, borderColor: `${color}44` } : {}) }}
                >
                  {f} {count > 0 && <span style={{ opacity: 0.7 }}>{count}</span>}
                </button>
              );
            })}
          </div>

          <div
            className="terminal"
            ref={termRef}
            style={{ height: termHeight, minHeight: 200 }}
            onScroll={(e) => {
              const el = e.currentTarget;
              setAutoScroll(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
            }}
          >
            {filtered.length === 0 ? (
              <div style={{ color: "var(--text-muted)", textAlign: "center", paddingTop: 40, fontSize: "0.8125rem" }}>
                {logs.length === 0 ? "Waiting for agent activity…" : `No ${filter} logs`}
              </div>
            ) : filtered.map((entry, i) => (
              <div key={i} className={`terminal-line ${
                entry.level === "error" ? "error" : entry.level === "warn" ? "warn" :
                entry.level === "debug" ? "debug" : "info"
              }`}>
                <span className="terminal-ts">
                  {new Date(entry.timestamp).toLocaleTimeString("en-PK", { hour12: false })}
                </span>
                <span style={{ color: "var(--text-muted)", marginRight: 6, fontSize: "0.5625rem", textTransform: "uppercase" }}>
                  [{entry.level}]
                </span>
                {entry.message}
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── Container Logs ──────────────────────────────────────────────── */}
      {tab === "containers" && (
        <>
          {containerList.length === 0 ? (
            <div className="card">
              <div className="empty-state">
                <span className="empty-state-icon">🐳</span>
                <span>No containers visible</span>
                <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
                  Set PROD_SSH_KEY in Railway to enable Docker log access
                </span>
              </div>
            </div>
          ) : (
            <>
              {/* Container selector */}
              <div className="filter-pills" style={{ marginBottom: "var(--space-3)" }}>
                {containerList.map((name) => {
                  const color = CONTAINER_COLORS[name.split(/[-_]/)[0]] ?? "var(--text-muted)";
                  const hasLogs = (containerLogs[name]?.length ?? 0) > 0;
                  return (
                    <button
                      key={name}
                      className={`btn ${selectedContainer === name ? "btn-primary" : "btn-ghost"}`}
                      onClick={() => handleContainerSelect(name)}
                      style={{
                        fontSize: "0.6875rem", flexShrink: 0,
                        ...(selectedContainer !== name ? { color, borderColor: `${color}44` } : {}),
                      }}
                    >
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: color, display: "inline-block", marginRight: 4 }} />
                      {name}
                      {hasLogs && <span style={{ opacity: 0.6, marginLeft: 4 }}>{containerLogs[name].length}</span>}
                    </button>
                  );
                })}
              </div>

              {/* Log output */}
              <div
                className="terminal"
                ref={containerRef}
                style={{ height: termHeight, minHeight: 200 }}
              >
                {currentLogs.length === 0 ? (
                  <div style={{ color: "var(--text-muted)", textAlign: "center", paddingTop: 40, fontSize: "0.8125rem" }}>
                    {selectedContainer ? "Fetching logs…" : "Select a container above"}
                  </div>
                ) : currentLogs.map((entry, i) => {
                  const isError = entry.stream === "stderr" || entry.message.toLowerCase().includes("error");
                  return (
                    <div key={i} className={`terminal-line ${isError ? "error" : "info"}`}>
                      <span className="terminal-ts">
                        {new Date(entry.timestamp).toLocaleTimeString("en-PK", { hour12: false })}
                      </span>
                      <span style={{ color: CONTAINER_COLORS[entry.container.split(/[-_]/)[0]] ?? "var(--text-muted)", marginRight: 6, fontSize: "0.625rem", fontWeight: 600 }}>
                        [{entry.container}]
                      </span>
                      {entry.message}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}

      {/* Code patch */}
      {patch?.patch && tab === "agent" && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-header">
            <div className="card-title">Claude Code Patch</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-ghost" onClick={() => setShowPatch(v => !v)} style={{ fontSize: "0.75rem" }}>
                {showPatch ? "Hide" : "Show"} Diff
              </button>
              <button className="btn btn-primary" onClick={() => navigator.clipboard.writeText(patch.patch ?? "")} style={{ fontSize: "0.75rem" }}>
                Copy
              </button>
            </div>
          </div>
          <div style={{ padding: "8px 12px", background: "rgba(245,158,11,0.08)", borderRadius: "var(--radius-sm)", fontSize: "0.75rem", color: "var(--p2-color)", marginBottom: 12, border: "1px solid rgba(245,158,11,0.2)" }}>
            ⚠️ Display-only — review before applying manually.
          </div>
          {patch.explanation && <p style={{ fontSize: "0.8125rem", color: "var(--text-secondary)", marginBottom: 12, lineHeight: 1.5 }}>{patch.explanation}</p>}
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
