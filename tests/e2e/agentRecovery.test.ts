/**
 * E2E Tests: Agent Recovery Simulation
 *
 * These tests simulate production incidents and verify the agent detects them,
 * creates incidents, and (in mock mode) calls the right tools.
 *
 * Run against a real local stack: npm run test:e2e
 * Requires: MongoDB running at MONGODB_SRE_URI, Redis at PROD_REDIS_URL
 */

import { jest } from "@jest/globals";
import mongoose from "mongoose";

const MONGO_URI = process.env.MONGODB_SRE_URI ?? "mongodb://localhost:27017/sre_agent_test";

jest.setTimeout(30000);

// Mock AI and comms to prevent real API calls in E2E
jest.mock("../src/comms/socketServer.js", () => ({
  emitTelemetryUpdate: jest.fn(),
  emitIncidentAlert: jest.fn(),
  emitIncidentClosed: jest.fn(),
  emitAgentLog: jest.fn(),
  emitActionResult: jest.fn(),
  getConnectedCount: jest.fn(() => 0),
}));

jest.mock("../src/comms/whatsapp.js", () => ({
  sendWhatsApp: jest.fn().mockResolvedValue(undefined),
  requestAuthorization: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../src/ai/groqClient.js", () => ({
  triageIncident: jest.fn().mockResolvedValue({
    diagnosis: "Mock: OOM kill detected in backend container",
    rootCause: "JavaScript heap out of memory — memory limit exceeded",
    confidence: 0.95,
    actionTaken: "gracefulRestartContainer",
    tokensUsed: 500,
    latencyMs: 250,
    executionResult: { stdout: "Container restarted", stderr: "", exitCode: 0 },
  }),
}));

jest.mock("../src/executor/scriptExecutor.js", () => ({
  executeScript: jest.fn().mockResolvedValue({
    stdout: "Mock: Container restarted successfully",
    stderr: "",
    exitCode: 0,
    durationMs: 1200,
  }),
}));

describe("E2E: Agent Recovery Pipeline", () => {
  let Incident: any;
  let ActionHistory: any;

  beforeAll(async () => {
    await mongoose.connect(MONGO_URI, { dbName: "sre_agent_test" });
    const mod = await import("../src/db/models/Incident.js");
    Incident = mod.Incident;
    const modA = await import("../src/db/models/ActionHistory.js");
    ActionHistory = modA.ActionHistory;
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.connection.close();
  });

  beforeEach(async () => {
    await Incident.deleteMany({});
    await ActionHistory.deleteMany({});
  });

  describe("OOM Kill Detection + Auto-Recovery", () => {
    it("should open P1 incident when OOM is detected", async () => {
      const { detectAnomalies } = await import("../src/detector/anomalyDetector.js");
      const { processSignals } = await import("../src/incident/incidentManager.js");

      const oomSnapshot = {
        capturedAt: new Date(),
        prometheus: { httpRequestsTotal: 5000, httpErrorRate: 0.01, p95LatencyMs: 200, p99LatencyMs: 400, hrEventsTotal: 50, financialEventsTotal: 20, rawMetrics: {} },
        bullmq: { outboxRelay: { waiting: 2, active: 1, failed: 0 }, documentWorker: { waiting: 0, active: 0, failed: 0 } },
        docker: { containers: [{ name: "backend", status: "exited", restartCount: 3, cpuPercent: 0, memUsageMb: 0, memLimitMb: 512 }], totalRestarts: 3 },
        loki: { errorLogCount5m: 5, warnLogCount5m: 2, oomKillDetected: true, panicDetected: false, recentErrors: ["JavaScript heap out of memory"] },
        backendBSync: { syncEndpointUp: false, recentSyncFailures: 0, outboxPendingCount: 5, outboxFailedCount: 0 },
        system: { diskUsagePercent: 40, redisMemoryPercent: 20, redisConnectedClients: 3 },
        collectionErrors: [],
      } as any;

      const signals = detectAnomalies(oomSnapshot);

      // Should detect both OOM and container down
      const oomSignal = signals.find((s) => s.signal === "loki.oomKillDetected");
      expect(oomSignal).toBeDefined();
      expect(oomSignal?.severity).toBe("p1");

      const downSignal = signals.find((s) => s.signal.includes("backend.down") || s.signal.includes("backendBSync.down"));
      expect(downSignal).toBeDefined();

      await processSignals(signals, oomSnapshot);

      // Wait for async incident creation
      await new Promise((r) => setTimeout(r, 500));

      const incidents = await Incident.find({});
      expect(incidents.length).toBeGreaterThan(0);

      const p1Incident = incidents.find((i: any) => i.severity === "p1");
      expect(p1Incident).toBeDefined();
    });
  });

  describe("BullMQ Dead Letter Detection", () => {
    it("should detect BullMQ overflow above threshold", async () => {
      const { detectAnomalies } = await import("../src/detector/anomalyDetector.js");

      const bullmqSnapshot = {
        capturedAt: new Date(),
        prometheus: { httpRequestsTotal: 1000, httpErrorRate: 0.001, p95LatencyMs: 150, p99LatencyMs: 300, hrEventsTotal: 10, financialEventsTotal: 5, rawMetrics: {} },
        bullmq: { outboxRelay: { waiting: 5, active: 1, failed: 55 }, documentWorker: { waiting: 0, active: 0, failed: 0 } },
        docker: { containers: [{ name: "backend", status: "running", restartCount: 0, cpuPercent: 45, memUsageMb: 350, memLimitMb: 512 }], totalRestarts: 0 },
        loki: { errorLogCount5m: 2, warnLogCount5m: 1, oomKillDetected: false, panicDetected: false, recentErrors: [] },
        backendBSync: { syncEndpointUp: true, recentSyncFailures: 0, outboxPendingCount: 10, outboxFailedCount: 0 },
        system: { diskUsagePercent: 40, redisMemoryPercent: 20, redisConnectedClients: 3 },
        collectionErrors: [],
      } as any;

      const signals = detectAnomalies(bullmqSnapshot);
      const bullmqSignal = signals.find((s) => s.signal === "bullmq.outboxRelay.failed");
      expect(bullmqSignal).toBeDefined();
      expect(bullmqSignal?.severity).toBe("p1"); // > 50 = P1
    });
  });

  describe("Healthy System — No False Positives", () => {
    it("should generate zero signals for nominal production state", () => {
      const { detectAnomalies } = require("../src/detector/anomalyDetector.js");

      const healthySnapshot = {
        capturedAt: new Date(),
        prometheus: { httpRequestsTotal: 50000, httpErrorRate: 0.001, p95LatencyMs: 180, p99LatencyMs: 320, hrEventsTotal: 500, financialEventsTotal: 200, rawMetrics: {} },
        bullmq: { outboxRelay: { waiting: 3, active: 2, failed: 0 }, documentWorker: { waiting: 1, active: 1, failed: 0 } },
        docker: { containers: [
          { name: "backend", status: "running", restartCount: 0, cpuPercent: 35, memUsageMb: 280, memLimitMb: 512 },
          { name: "OfferBerries_nginx", status: "running", restartCount: 0, cpuPercent: 2, memUsageMb: 30, memLimitMb: 128 },
          { name: "OfferBerries_redis", status: "running", restartCount: 0, cpuPercent: 5, memUsageMb: 50, memLimitMb: 256 },
        ], totalRestarts: 0 },
        loki: { errorLogCount5m: 0, warnLogCount5m: 2, oomKillDetected: false, panicDetected: false, recentErrors: [] },
        backendBSync: { syncEndpointUp: true, recentSyncFailures: 0, outboxPendingCount: 3, outboxFailedCount: 0 },
        system: { diskUsagePercent: 42, redisMemoryPercent: 22, redisConnectedClients: 8 },
        collectionErrors: [],
      } as any;

      const signals = detectAnomalies(healthySnapshot);
      expect(signals).toHaveLength(0);
    });
  });

  describe("Backend-B Sync Monitoring", () => {
    it("should detect sync endpoint down as P1", () => {
      const { detectAnomalies } = require("../src/detector/anomalyDetector.js");

      const syncDownSnapshot = {
        capturedAt: new Date(),
        prometheus: { httpRequestsTotal: 0, httpErrorRate: 0, p95LatencyMs: 0, p99LatencyMs: 0, hrEventsTotal: 0, financialEventsTotal: 0, rawMetrics: {} },
        bullmq: { outboxRelay: { waiting: 0, active: 0, failed: 0 }, documentWorker: { waiting: 0, active: 0, failed: 0 } },
        docker: { containers: [], totalRestarts: 0 },
        loki: { errorLogCount5m: 0, warnLogCount5m: 0, oomKillDetected: false, panicDetected: false, recentErrors: [] },
        backendBSync: { syncEndpointUp: false, recentSyncFailures: 10, outboxPendingCount: 0, outboxFailedCount: 5 },
        system: { diskUsagePercent: 40, redisMemoryPercent: 20, redisConnectedClients: 0 },
        collectionErrors: [],
      } as any;

      const signals = detectAnomalies(syncDownSnapshot);
      expect(signals.some((s) => s.severity === "p1" && s.source === "sync")).toBe(true);
    });
  });
});
