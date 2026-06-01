/**
 * E2E Tests: B2B Authentication — SRE Agent ↔ Backend-A
 *
 * Tests the ingest router that Backend-A uses to push events to the SRE agent,
 * and verifies the shared-key auth model works correctly.
 *
 * Run: npm run test:e2e
 * Requires: MongoDB at MONGODB_SRE_URI
 */

import { jest } from "@jest/globals";
import mongoose from "mongoose";
import express from "express";
import http from "http";
import request from "supertest";

const MONGO_URI =
  process.env.MONGODB_SRE_URI ?? "mongodb://localhost:27017/sre_agent_test";

const TEST_KEY = "test_sre_internal_key_32bytes_ok";

jest.setTimeout(20000);

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock("#comms/socketServer", () => ({
  emitTelemetryUpdate: jest.fn(),
  emitIncidentAlert: jest.fn(),
  emitIncidentClosed: jest.fn(),
  emitAgentLog: jest.fn(),
  emitActionResult: jest.fn(),
  emitCodePatch: jest.fn(),
  getConnectedCount: jest.fn(() => 0),
}));

// ── Test App Setup ────────────────────────────────────────────────────────────

let app: express.Application;

beforeAll(async () => {
  // Set the key before importing config-dependent modules
  process.env.SRE_INTERNAL_KEY = TEST_KEY;
  process.env.SRE_AUTH_REQUIRED = "false";
  process.env.MONGODB_SRE_URI = MONGO_URI;
  process.env.NODE_ENV = "test";

  await mongoose.connect(MONGO_URI, { dbName: "sre_agent_test" });

  // Import and wire up only the API router (not the full daemon)
  const { apiRouter } = await import("#api/router");
  app = express();
  app.use(express.json());
  app.use("/api", apiRouter);
});

afterAll(async () => {
  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
});

afterEach(async () => {
  // Clean up incidents between tests
  const { Incident } = await import("#models/Incident");
  await Incident.deleteMany({});
});

// ── Ping Endpoint ─────────────────────────────────────────────────────────────

describe("GET /api/ingest/ping", () => {
  it("returns 200 with valid B2B key (Bearer)", async () => {
    const res = await request(app)
      .get("/api/ingest/ping")
      .set("Authorization", `Bearer ${TEST_KEY}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.agent).toBe("sre-agent");
    expect(typeof res.body.uptime).toBe("number");
  });

  it("returns 200 with valid B2B key (x-internal-token)", async () => {
    const res = await request(app)
      .get("/api/ingest/ping")
      .set("x-internal-token", TEST_KEY);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("returns 401 with no key", async () => {
    const res = await request(app).get("/api/ingest/ping");
    expect(res.status).toBe(401);
  });

  it("returns 401 with wrong key", async () => {
    const res = await request(app)
      .get("/api/ingest/ping")
      .set("Authorization", "Bearer wrong_key_value");
    expect(res.status).toBe(401);
  });
});

// ── Event Ingest ──────────────────────────────────────────────────────────────

describe("POST /api/ingest/event", () => {
  it("creates a P1 incident from a critical Backend-A event", async () => {
    const res = await request(app)
      .post("/api/ingest/event")
      .set("Authorization", `Bearer ${TEST_KEY}`)
      .send({
        eventType: "HIGH_ERROR_RATE",
        severity: "p1",
        payload: { errorRate: 0.15, endpoint: "/api/transactions" },
        source: "backend-a",
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.incidentId).toBeDefined();

    // Verify incident was persisted
    const { Incident } = await import("#models/Incident");
    const incident = await Incident.findById(res.body.incidentId);
    expect(incident).not.toBeNull();
    expect(incident!.severity).toBe("p1");
    expect(incident!.status).toBe("open");
    expect(incident!.trigger.signal).toBe("HIGH_ERROR_RATE");
    expect(incident!.trigger.source).toBe("backend-a");
  });

  it("creates a P2 incident from a P2 event", async () => {
    const res = await request(app)
      .post("/api/ingest/event")
      .set("Authorization", `Bearer ${TEST_KEY}`)
      .send({
        eventType: "SALARY_TX_FAILED",
        severity: "p2",
        payload: { employeeId: "emp_001", reason: "insufficient funds" },
      });

    expect(res.status).toBe(200);
    expect(res.body.incidentId).toBeDefined();

    const { Incident } = await import("#models/Incident");
    const incident = await Incident.findById(res.body.incidentId);
    expect(incident!.severity).toBe("p2");
  });

  it("logs P3 events without creating an incident", async () => {
    const { emitAgentLog } = await import("#comms/socketServer");
    const { Incident } = await import("#models/Incident");

    const res = await request(app)
      .post("/api/ingest/event")
      .set("Authorization", `Bearer ${TEST_KEY}`)
      .send({
        eventType: "SLOW_QUERY_DETECTED",
        severity: "p3",
        payload: { queryMs: 850 },
      });

    expect(res.status).toBe(200);
    expect(res.body.logged).toBe(true);
    expect(res.body.incidentId).toBeUndefined();

    const count = await Incident.countDocuments();
    expect(count).toBe(0);
    expect(emitAgentLog).toHaveBeenCalled();
  });

  it("returns 400 when eventType is missing", async () => {
    const res = await request(app)
      .post("/api/ingest/event")
      .set("Authorization", `Bearer ${TEST_KEY}`)
      .send({ severity: "p1" });

    expect(res.status).toBe(400);
  });

  it("returns 401 with no auth", async () => {
    const res = await request(app)
      .post("/api/ingest/event")
      .send({ eventType: "TEST", severity: "p1" });

    expect(res.status).toBe(401);
  });
});

// ── Heartbeat ─────────────────────────────────────────────────────────────────

describe("POST /api/ingest/heartbeat", () => {
  it("accepts heartbeat from Backend-A", async () => {
    const res = await request(app)
      .post("/api/ingest/heartbeat")
      .set("Authorization", `Bearer ${TEST_KEY}`)
      .send({ version: "2.1.0", env: "production" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ── Timing-Safe Key Comparison ────────────────────────────────────────────────

describe("B2B key security", () => {
  it("rejects a key that is correct prefix but longer", async () => {
    const res = await request(app)
      .get("/api/ingest/ping")
      .set("Authorization", `Bearer ${TEST_KEY}extra_padding`);
    expect(res.status).toBe(401);
  });

  it("rejects a key that is a prefix of the correct key", async () => {
    const res = await request(app)
      .get("/api/ingest/ping")
      .set("Authorization", `Bearer ${TEST_KEY.slice(0, 10)}`);
    expect(res.status).toBe(401);
  });
});
