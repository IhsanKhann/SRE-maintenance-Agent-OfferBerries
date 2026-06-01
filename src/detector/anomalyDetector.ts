import { STATIC_THRESHOLDS } from "./thresholds.js";
import type { SnapshotData } from "../collector/index.js";
import type { IncidentSeverity, IncidentSource } from "../db/models/Incident.js";
import { logger } from "../utils/logger.js";

export interface AnomalySignal {
  source: IncidentSource;
  signal: string;
  severity: IncidentSeverity;
  rawValue: unknown;
  threshold: unknown;
  description: string;
}

// Tracks previous snapshot to detect deltas (e.g. restart count increases)
let prevSnapshot: SnapshotData | null = null;

export function detectAnomalies(snapshot: SnapshotData): AnomalySignal[] {
  const signals: AnomalySignal[] = [];

  // ── Loki: OOM Kill (always P1) ────────────────────────────────────────────
  if (snapshot.loki.oomKillDetected) {
    signals.push({
      source: "loki",
      signal: "loki.oomKillDetected",
      severity: "p1",
      rawValue: true,
      threshold: false,
      description: "Out-of-memory kill detected in backend logs",
    });
  }

  // ── Loki: Panic / Fatal (P1) ──────────────────────────────────────────────
  if (snapshot.loki.panicDetected) {
    signals.push({
      source: "loki",
      signal: "loki.panicDetected",
      severity: "p1",
      rawValue: true,
      threshold: false,
      description: "Fatal error / process panic detected in logs",
    });
  }

  // ── Loki: High error log rate (P2) ────────────────────────────────────────
  const errPerMin = snapshot.loki.errorLogCount5m / 5;
  if (errPerMin > STATIC_THRESHOLDS.errorLogsPerMinute) {
    signals.push({
      source: "loki",
      signal: "loki.highErrorRate",
      severity: "p2",
      rawValue: errPerMin.toFixed(1),
      threshold: STATIC_THRESHOLDS.errorLogsPerMinute,
      description: `${errPerMin.toFixed(1)} error log lines/min (threshold: ${STATIC_THRESHOLDS.errorLogsPerMinute})`,
    });
  }

  // ── Backend-B Sync: endpoint down (P1) ────────────────────────────────────
  if (!snapshot.backendBSync.syncEndpointUp) {
    signals.push({
      source: "sync",
      signal: "backendBSync.down",
      severity: "p1",
      rawValue: false,
      threshold: true,
      description: "Backend-A health endpoint is DOWN — Backend-B sync is broken",
    });
  }

  // ── Backend-B Sync: failures accumulating (P2) ───────────────────────────
  if (snapshot.backendBSync.recentSyncFailures >= STATIC_THRESHOLDS.syncFailures) {
    signals.push({
      source: "sync",
      signal: "backendBSync.failures",
      severity: "p2",
      rawValue: snapshot.backendBSync.recentSyncFailures,
      threshold: STATIC_THRESHOLDS.syncFailures,
      description: `${snapshot.backendBSync.recentSyncFailures} sync failures accumulating`,
    });
  }

  // ── Outbox pending buildup (P2) ───────────────────────────────────────────
  if (snapshot.backendBSync.outboxPendingCount > STATIC_THRESHOLDS.outboxPending) {
    signals.push({
      source: "bullmq",
      signal: "outbox.pendingBuildup",
      severity: "p2",
      rawValue: snapshot.backendBSync.outboxPendingCount,
      threshold: STATIC_THRESHOLDS.outboxPending,
      description: `Outbox has ${snapshot.backendBSync.outboxPendingCount} pending events (threshold: ${STATIC_THRESHOLDS.outboxPending})`,
    });
  }

  // ── BullMQ: Outbox relay failed jobs (P2/P1) ─────────────────────────────
  if (snapshot.bullmq.outboxRelay.failed >= STATIC_THRESHOLDS.bullmqRelayFailed) {
    const severity: IncidentSeverity = snapshot.bullmq.outboxRelay.failed > 50 ? "p1" : "p2";
    signals.push({
      source: "bullmq",
      signal: "bullmq.outboxRelay.failed",
      severity,
      rawValue: snapshot.bullmq.outboxRelay.failed,
      threshold: STATIC_THRESHOLDS.bullmqRelayFailed,
      description: `BullMQ outboxRelay has ${snapshot.bullmq.outboxRelay.failed} failed jobs`,
    });
  }

  // ── BullMQ: Document worker failed jobs (P2) ─────────────────────────────
  if (snapshot.bullmq.documentWorker.failed >= STATIC_THRESHOLDS.bullmqDocFailed) {
    signals.push({
      source: "bullmq",
      signal: "bullmq.documentWorker.failed",
      severity: "p2",
      rawValue: snapshot.bullmq.documentWorker.failed,
      threshold: STATIC_THRESHOLDS.bullmqDocFailed,
      description: `BullMQ documentWorker has ${snapshot.bullmq.documentWorker.failed} failed jobs`,
    });
  }

  // ── Docker: Container not running (P1) ───────────────────────────────────
  for (const container of snapshot.docker.containers) {
    if (container.status !== "running") {
      signals.push({
        source: "docker",
        signal: `docker.${container.name}.down`,
        severity: "p1",
        rawValue: container.status,
        threshold: "running",
        description: `Container "${container.name}" is ${container.status} (expected: running)`,
      });
    }

    // Memory pressure check
    if (container.memLimitMb > 0) {
      const memPercent = (container.memUsageMb / container.memLimitMb) * 100;
      if (memPercent > STATIC_THRESHOLDS.memoryPercent) {
        signals.push({
          source: "docker",
          signal: `docker.${container.name}.highMemory`,
          severity: "p2",
          rawValue: `${memPercent.toFixed(1)}%`,
          threshold: `${STATIC_THRESHOLDS.memoryPercent}%`,
          description: `Container "${container.name}" memory at ${memPercent.toFixed(1)}% — OOM risk`,
        });
      }
    }
  }

  // ── Docker: Restart count increased (P2) — compare to prev snapshot ──────
  if (prevSnapshot) {
    for (const container of snapshot.docker.containers) {
      const prev = prevSnapshot.docker.containers.find((c) => c.name === container.name);
      if (prev && container.restartCount > prev.restartCount + STATIC_THRESHOLDS.containerRestartDelta) {
        signals.push({
          source: "docker",
          signal: `docker.${container.name}.restartLoop`,
          severity: "p2",
          rawValue: container.restartCount,
          threshold: prev.restartCount,
          description: `Container "${container.name}" has restarted ${container.restartCount - prev.restartCount} times since last check`,
        });
      }
    }
  }

  // ── Prometheus: HTTP Error Rate (P2) ─────────────────────────────────────
  if (snapshot.prometheus.httpErrorRate > STATIC_THRESHOLDS.httpErrorRate) {
    signals.push({
      source: "prometheus",
      signal: "prometheus.httpErrorRate",
      severity: "p2",
      rawValue: `${(snapshot.prometheus.httpErrorRate * 100).toFixed(2)}%`,
      threshold: `${(STATIC_THRESHOLDS.httpErrorRate * 100).toFixed(1)}%`,
      description: `HTTP error rate is ${(snapshot.prometheus.httpErrorRate * 100).toFixed(2)}%`,
    });
  }

  // ── Prometheus: P95 Latency (P3) ─────────────────────────────────────────
  if (snapshot.prometheus.p95LatencyMs > STATIC_THRESHOLDS.p95LatencyMs) {
    signals.push({
      source: "prometheus",
      signal: "prometheus.p95Latency",
      severity: "p3",
      rawValue: `${snapshot.prometheus.p95LatencyMs.toFixed(0)}ms`,
      threshold: `${STATIC_THRESHOLDS.p95LatencyMs}ms`,
      description: `HTTP p95 latency is ${snapshot.prometheus.p95LatencyMs.toFixed(0)}ms`,
    });
  }

  // ── System: Disk space (P2) ───────────────────────────────────────────────
  if (snapshot.system.diskUsagePercent > STATIC_THRESHOLDS.diskPercent) {
    signals.push({
      source: "prometheus",
      signal: "system.disk",
      severity: "p2",
      rawValue: `${snapshot.system.diskUsagePercent}%`,
      threshold: `${STATIC_THRESHOLDS.diskPercent}%`,
      description: `Disk usage at ${snapshot.system.diskUsagePercent}%`,
    });
  }

  // ── Redis memory (P2) ─────────────────────────────────────────────────────
  if (snapshot.system.redisMemoryPercent > STATIC_THRESHOLDS.redisMemoryPercent) {
    signals.push({
      source: "prometheus",
      signal: "system.redisMemory",
      severity: "p2",
      rawValue: `${snapshot.system.redisMemoryPercent.toFixed(1)}%`,
      threshold: `${STATIC_THRESHOLDS.redisMemoryPercent}%`,
      description: `Redis memory at ${snapshot.system.redisMemoryPercent.toFixed(1)}%`,
    });
  }

  prevSnapshot = snapshot;

  if (signals.length > 0) {
    logger.info("[Detector] Anomalies detected", {
      count: signals.length,
      signals: signals.map((s) => ({ signal: s.signal, severity: s.severity })),
    });
  }

  return signals;
}
