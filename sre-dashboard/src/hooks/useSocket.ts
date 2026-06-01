import { useEffect, useRef, useState, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import axios from "axios";

const SRE_URL = import.meta.env.VITE_SRE_URL ?? "http://localhost:3500";

export interface AgentLogEntry {
  timestamp: string;
  message: string;
  level: "info" | "warn" | "error" | "debug";
}

export interface TelemetrySnapshot {
  capturedAt: string;
  prometheus: {
    httpRequestsTotal: number;
    httpErrorRate: number;
    p95LatencyMs: number;
    p99LatencyMs: number;
    hrEventsTotal: number;
    financialEventsTotal: number;
  };
  bullmq: {
    outboxRelay: { waiting: number; active: number; failed: number };
    documentWorker: { waiting: number; active: number; failed: number };
  };
  docker: {
    containers: Array<{
      name: string;
      status: string;
      restartCount: number;
      cpuPercent: number;
      memUsageMb: number;
      memLimitMb: number;
    }>;
    totalRestarts: number;
  };
  loki: {
    errorLogCount5m: number;
    oomKillDetected: boolean;
    panicDetected: boolean;
    recentErrors: string[];
  };
  backendBSync: {
    syncEndpointUp: boolean;
    recentSyncFailures: number;
    outboxPendingCount: number;
  };
  system: {
    diskUsagePercent: number;
    redisMemoryPercent: number;
  };
}

export interface Incident {
  _id: string;
  openedAt: string;
  closedAt: string | null;
  status: "open" | "investigating" | "resolved" | "escalated";
  severity: "p1" | "p2" | "p3";
  trigger: { source: string; signal: string; description: string };
  aiAnalysis: { summary: string; rootCause: string; confidence: number } | null;
  resolvedBy: string | null;
  mttrSeconds: number | null;
}

export interface ContainerLogEntry {
  container: string;
  timestamp: string;
  message: string;
  stream: "stdout" | "stderr";
}

export function useSocket() {
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected]             = useState(false);
  const [telemetry, setTelemetry]             = useState<TelemetrySnapshot | null>(null);
  const [incidents, setIncidents]             = useState<Incident[]>([]);
  const [agentLogs, setAgentLogs]             = useState<AgentLogEntry[]>([]);
  const [actionResults, setActionResults]     = useState<unknown[]>([]);
  const [codePatch, setCodePatch]             = useState<unknown | null>(null);
  const [containerList, setContainerList]     = useState<string[]>([]);
  const [containerLogs, setContainerLogs]     = useState<Record<string, ContainerLogEntry[]>>({});

  // ── Hydrate existing data from REST on mount ──────────────────────────────
  useEffect(() => {
    Promise.all([
      axios.get<{ success: boolean; data: Incident[] }>(`${SRE_URL}/api/incidents`),
      axios.get<{ success: boolean; data: TelemetrySnapshot | null }>(`${SRE_URL}/api/telemetry/latest`),
    ]).then(([incRes, telRes]) => {
      if (incRes.data.success) setIncidents(incRes.data.data);
      if (telRes.data.success && telRes.data.data) setTelemetry(telRes.data.data);
    }).catch(() => {
      // Backend not yet running — socket will bring data when ready
    });
  }, []);

  // ── WebSocket connection ──────────────────────────────────────────────────
  useEffect(() => {
    const token = localStorage.getItem("sre_token");
    const socket = io(SRE_URL, {
      auth: token ? { token } : {},
      transports: ["websocket", "polling"],
      reconnectionAttempts: 10,
      reconnectionDelay: 2000,
    });

    socketRef.current = socket;

    socket.on("connect",    () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));

    socket.on("telemetry:update", (data: TelemetrySnapshot) => {
      setTelemetry(data);
    });

    socket.on("incident:new", (incident: Incident) => {
      setIncidents((prev) => [incident, ...prev.slice(0, 49)]);
    });

    socket.on("incident:closed", (data: { id: string; resolvedBy: string }) => {
      setIncidents((prev) =>
        prev.map((i) =>
          i._id === data.id ? { ...i, status: "resolved" as const, resolvedBy: data.resolvedBy } : i
        )
      );
    });

    socket.on("agent:log", (entry: AgentLogEntry) => {
      setAgentLogs((prev) => [entry, ...prev].slice(0, 500));
    });

    socket.on("action:result", (result: unknown) => {
      setActionResults((prev) => [result, ...prev].slice(0, 100));
    });

    socket.on("agent:codepatch", (patch: unknown) => {
      setCodePatch(patch);
    });

    socket.on("containers:list", (list: string[]) => {
      setContainerList(list);
    });

    socket.on("container:logs", (data: { container: string; logs: ContainerLogEntry[] }) => {
      setContainerLogs((prev) => ({ ...prev, [data.container]: data.logs }));
    });

    // Request container list on connect
    socket.on("connect", () => {
      setConnected(true);
      socket.emit("request:containers");
    });

    return () => { socket.disconnect(); };
  }, []);

  const requestTelemetry = useCallback(() => {
    socketRef.current?.emit("request:telemetry");
  }, []);

  const requestContainerLogs = useCallback((container: string, lines = 100) => {
    socketRef.current?.emit("request:containerlogs", { container, lines });
  }, []);

  // Optimistically refresh incidents from REST (e.g. after an action)
  const refreshIncidents = useCallback(async () => {
    try {
      const res = await axios.get<{ success: boolean; data: Incident[] }>(`${SRE_URL}/api/incidents`);
      if (res.data.success) setIncidents(res.data.data);
    } catch { /* ignore */ }
  }, []);

  return {
    connected, telemetry, incidents, agentLogs, actionResults, codePatch,
    containerList, containerLogs,
    requestTelemetry, refreshIncidents, requestContainerLogs,
  };
}
