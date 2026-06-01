// @ts-nocheck
import { jest, describe, it, expect } from "@jest/globals";
import { detectAnomalies } from "../../../src/detector/anomalyDetector.js";

jest.mock("../../../src/config.js", () => ({
  cfg: {
    THRESHOLD_HTTP_ERROR_RATE: 0.03,
    THRESHOLD_P95_LATENCY_MS: 2000,
    THRESHOLD_BULLMQ_FAILED: 20,
    THRESHOLD_OUTBOX_PENDING: 50,
    THRESHOLD_DISK_PERCENT: 85,
    THRESHOLD_MEMORY_PERCENT: 85,
  },
}));

jest.mock("../../../src/utils/logger.js", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() },
}));

function makeSnapshot(overrides: Record<string, any> = {}): any {
  return {
    capturedAt: new Date(),
    prometheus: {
      httpRequestsTotal: 1000,
      httpErrorRate: 0,
      p95LatencyMs: 150,
      p99LatencyMs: 300,
      hrEventsTotal: 10,
      financialEventsTotal: 5,
      rawMetrics: {},
      ...(overrides.prometheus ?? {}),
    },
    bullmq: {
      outboxRelay: { waiting: 0, active: 1, failed: 0 },
      documentWorker: { waiting: 0, active: 0, failed: 0 },
      ...(overrides.bullmq ?? {}),
    },
    docker: {
      containers: [{ name: "backend", status: "running", restartCount: 0, cpuPercent: 20, memUsageMb: 200, memLimitMb: 512 }],
      totalRestarts: 0,
      ...(overrides.docker ?? {}),
    },
    loki: {
      errorLogCount5m: 0,
      warnLogCount5m: 0,
      oomKillDetected: false,
      panicDetected: false,
      recentErrors: [],
      ...(overrides.loki ?? {}),
    },
    backendBSync: {
      syncEndpointUp: true,
      recentSyncFailures: 0,
      outboxPendingCount: 0,
      outboxFailedCount: 0,
      ...(overrides.backendBSync ?? {}),
    },
    system: {
      diskUsagePercent: 40,
      redisMemoryPercent: 30,
      redisConnectedClients: 5,
      ...(overrides.system ?? {}),
    },
    collectionErrors: [],
  };
}

describe("detectAnomalies", () => {
  it("returns empty array for healthy snapshot", () => {
    const signals = detectAnomalies(makeSnapshot());
    expect(signals).toHaveLength(0);
  });

  it("detects OOM kill as P1", () => {
    const snap = makeSnapshot({ loki: { oomKillDetected: true, panicDetected: false, errorLogCount5m: 3, warnLogCount5m: 0, recentErrors: [] } });
    const signals = detectAnomalies(snap);
    const sig = signals.find((s: any) => s.signal === "loki.oomKillDetected");
    expect(sig).toBeDefined();
    expect(sig.severity).toBe("p1");
  });

  it("detects sync endpoint down as P1", () => {
    const snap = makeSnapshot({ backendBSync: { syncEndpointUp: false, recentSyncFailures: 0, outboxPendingCount: 0, outboxFailedCount: 0 } });
    const signals = detectAnomalies(snap);
    const sig = signals.find((s: any) => s.signal === "backendBSync.down");
    expect(sig).toBeDefined();
    expect(sig.severity).toBe("p1");
  });

  it("detects BullMQ failed buildup as P2 when between 20 and 50", () => {
    const snap = makeSnapshot({ bullmq: { outboxRelay: { waiting: 0, active: 0, failed: 25 }, documentWorker: { waiting: 0, active: 0, failed: 0 } } });
    const signals = detectAnomalies(snap);
    const sig = signals.find((s: any) => s.signal === "bullmq.outboxRelay.failed");
    expect(sig).toBeDefined();
    expect(sig.severity).toBe("p2");
  });

  it("detects BullMQ > 50 failed as P1", () => {
    const snap = makeSnapshot({ bullmq: { outboxRelay: { waiting: 0, active: 0, failed: 60 }, documentWorker: { waiting: 0, active: 0, failed: 0 } } });
    const signals = detectAnomalies(snap);
    const sig = signals.find((s: any) => s.signal === "bullmq.outboxRelay.failed");
    expect(sig).toBeDefined();
    expect(sig.severity).toBe("p1");
  });

  it("detects container not running as P1", () => {
    const snap = makeSnapshot({
      docker: {
        containers: [{ name: "backend", status: "exited", restartCount: 1, cpuPercent: 0, memUsageMb: 0, memLimitMb: 512 }],
        totalRestarts: 1,
      },
    });
    const signals = detectAnomalies(snap);
    const sig = signals.find((s: any) => s.signal === "docker.backend.down");
    expect(sig).toBeDefined();
    expect(sig.severity).toBe("p1");
  });

  it("detects HTTP error rate above threshold as P2", () => {
    const snap = makeSnapshot({
      prometheus: { httpRequestsTotal: 1000, httpErrorRate: 0.05, p95LatencyMs: 150, p99LatencyMs: 300, hrEventsTotal: 0, financialEventsTotal: 0, rawMetrics: {} },
    });
    const signals = detectAnomalies(snap);
    const sig = signals.find((s: any) => s.signal === "prometheus.httpErrorRate");
    expect(sig).toBeDefined();
    expect(sig.severity).toBe("p2");
  });

  it("detects high p95 latency as P3", () => {
    const snap = makeSnapshot({
      prometheus: { httpRequestsTotal: 1000, httpErrorRate: 0, p95LatencyMs: 2500, p99LatencyMs: 4000, hrEventsTotal: 0, financialEventsTotal: 0, rawMetrics: {} },
    });
    const signals = detectAnomalies(snap);
    const sig = signals.find((s: any) => s.signal === "prometheus.p95Latency");
    expect(sig).toBeDefined();
    expect(sig.severity).toBe("p3");
  });

  it("detects panic as P1", () => {
    const snap = makeSnapshot({ loki: { oomKillDetected: false, panicDetected: true, errorLogCount5m: 1, warnLogCount5m: 0, recentErrors: [] } });
    const signals = detectAnomalies(snap);
    const sig = signals.find((s: any) => s.signal === "loki.panicDetected");
    expect(sig).toBeDefined();
    expect(sig.severity).toBe("p1");
  });

  it("does not alert on normal high-volume healthy traffic", () => {
    const snap = makeSnapshot({
      prometheus: { httpRequestsTotal: 50000, httpErrorRate: 0.001, p95LatencyMs: 180, p99LatencyMs: 350, hrEventsTotal: 500, financialEventsTotal: 200, rawMetrics: {} },
    });
    const signals = detectAnomalies(snap);
    expect(signals).toHaveLength(0);
  });

  it("detects document worker failed jobs as P2", () => {
    const snap = makeSnapshot({
      bullmq: { outboxRelay: { waiting: 0, active: 1, failed: 0 }, documentWorker: { waiting: 0, active: 0, failed: 15 } },
    });
    const signals = detectAnomalies(snap);
    const sig = signals.find((s: any) => s.signal === "bullmq.documentWorker.failed");
    expect(sig).toBeDefined();
    expect(sig.severity).toBe("p2");
  });

  it("detects disk usage above threshold as P2", () => {
    const snap = makeSnapshot({ system: { diskUsagePercent: 90, redisMemoryPercent: 20, redisConnectedClients: 3 } });
    const signals = detectAnomalies(snap);
    const sig = signals.find((s: any) => s.signal === "system.disk");
    expect(sig).toBeDefined();
    expect(sig.severity).toBe("p2");
  });

  it("does not create false P1 for outbox within normal range", () => {
    const snap = makeSnapshot({
      bullmq: { outboxRelay: { waiting: 5, active: 2, failed: 5 }, documentWorker: { waiting: 0, active: 0, failed: 0 } },
    });
    const signals = detectAnomalies(snap);
    const p1 = signals.filter((s: any) => s.severity === "p1");
    expect(p1).toHaveLength(0);
  });
});
