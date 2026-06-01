import { collectPrometheus } from "./prometheus.js";
import { collectLoki } from "./loki.js";
import { collectDocker } from "./docker.js";
import { collectBullMQ, collectRedisStats } from "./bullmq.js";
import { collectBackendBSync } from "./backendBSync.js";
import { TelemetrySnapshot, type ITelemetrySnapshot } from "../db/models/TelemetrySnapshot.js";
import { emitTelemetryUpdate } from "../comms/socketServer.js";
import { logger } from "../utils/logger.js";

export type SnapshotData = Omit<ITelemetrySnapshot, keyof Document | "__v">;

export async function collectAll(): Promise<SnapshotData> {
  const startMs = Date.now();
  const errors: string[] = [];

  // Run all collectors in parallel — a failure in one never blocks the others
  const [prometheus, loki, docker, bullmq, backendBSync, redisStats] = await Promise.allSettled([
    collectPrometheus(),
    collectLoki(),
    collectDocker(),
    collectBullMQ(),
    collectBackendBSync(),
    collectRedisStats(),
  ]);

  function unwrap<T>(result: PromiseSettledResult<T>, fallback: T, label: string): T {
    if (result.status === "fulfilled") return result.value;
    errors.push(`${label}: ${(result.reason as Error).message}`);
    return fallback;
  }

  const prom = unwrap(prometheus, {
    httpRequestsTotal: 0, httpErrorRate: 0, p95LatencyMs: 0,
    p99LatencyMs: 0, hrEventsTotal: 0, financialEventsTotal: 0, rawMetrics: {},
  }, "Prometheus");

  const lok = unwrap(loki, {
    errorLogCount5m: 0, warnLogCount5m: 0, oomKillDetected: false,
    panicDetected: false, recentErrors: [],
  }, "Loki");

  const dock = unwrap(docker, { containers: [], totalRestarts: 0 }, "Docker");

  const bull = unwrap(bullmq, {
    outboxRelay: { waiting: 0, active: 0, failed: 0, completed: 0, delayed: 0 },
    documentWorker: { waiting: 0, active: 0, failed: 0, completed: 0, delayed: 0 },
  }, "BullMQ");

  const sync = unwrap(backendBSync, {
    syncEndpointUp: false, recentSyncFailures: 0, outboxPendingCount: 0, outboxFailedCount: 0,
  }, "BackendBSync");

  const redis = unwrap(redisStats, { memoryPercent: 0, connectedClients: 0 }, "Redis");

  const snapshot: SnapshotData = {
    capturedAt: new Date(),
    prometheus: prom,
    bullmq: {
      outboxRelay: { waiting: bull.outboxRelay.waiting, active: bull.outboxRelay.active, failed: bull.outboxRelay.failed },
      documentWorker: { waiting: bull.documentWorker.waiting, active: bull.documentWorker.active, failed: bull.documentWorker.failed },
    },
    docker: dock,
    loki: lok,
    backendBSync: sync,
    system: {
      diskUsagePercent: 0, // populated by disk check script when available
      redisMemoryPercent: redis.memoryPercent,
      redisConnectedClients: redis.connectedClients,
    },
    collectionErrors: errors,
  };

  // Persist to MongoDB (fire-and-forget — never block the collection loop)
  TelemetrySnapshot.create(snapshot).catch((err) => {
    logger.warn("[Collector] Failed to persist snapshot", { error: err.message });
  });

  // Push to all connected dashboard clients
  emitTelemetryUpdate(snapshot);

  const elapsed = Date.now() - startMs;
  if (errors.length > 0) {
    logger.warn("[Collector] Collection completed with errors", { errors, elapsedMs: elapsed });
  } else {
    logger.debug("[Collector] Snapshot collected", { elapsedMs: elapsed });
  }

  return snapshot;
}
