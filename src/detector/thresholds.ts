import { cfg } from "../config.js";

export const STATIC_THRESHOLDS = {
  // HTTP
  httpErrorRate: cfg.THRESHOLD_HTTP_ERROR_RATE,         // 3%
  p95LatencyMs: cfg.THRESHOLD_P95_LATENCY_MS,           // 2000ms

  // BullMQ
  bullmqRelayFailed: cfg.THRESHOLD_BULLMQ_FAILED,       // 20 jobs
  bullmqDocFailed: 10,                                   // document worker is more sensitive
  outboxPending: cfg.THRESHOLD_OUTBOX_PENDING,           // 50 items

  // Docker
  containerRestartDelta: 2,   // if restartCount increased by 2 in one cycle → alert
  memoryPercent: cfg.THRESHOLD_MEMORY_PERCENT,           // 85%

  // System
  diskPercent: cfg.THRESHOLD_DISK_PERCENT,               // 85%
  redisMemoryPercent: 80,

  // Loki
  errorLogsPerMinute: 10,   // if > 10 errors in 5min window = concern
  oomKill: true,            // any OOM = immediate P1
  panic: true,              // any panic = P1

  // Backend-B sync
  syncDown: true,           // if sync endpoint is down = P1
  syncFailures: 5,          // 5 sync failures in recent window = P2
};

export type ThresholdKey = keyof typeof STATIC_THRESHOLDS;
