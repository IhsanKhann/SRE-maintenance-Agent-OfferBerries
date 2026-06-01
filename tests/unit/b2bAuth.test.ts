/**
 * Unit Tests: B2B Auth Middleware
 * Tests timing-safe key comparison without any database or network.
 * Uses jest.resetModules() so config re-evaluates with the test env var.
 */

import { jest } from "@jest/globals";
import type { Express } from "express";

const TEST_KEY = "test_sre_internal_key_32bytes_ok";

jest.mock("#comms/socketServer", () => ({
  emitAgentLog: jest.fn(),
  emitIncidentAlert: jest.fn(),
}));

let app: Express;

beforeAll(async () => {
  // Reset modules so config.ts re-runs safeParse with our test env var
  jest.resetModules();
  process.env.SRE_INTERNAL_KEY = TEST_KEY;
  process.env.SRE_AUTH_REQUIRED = "false";
  process.env.NODE_ENV = "test";

  const express = (await import("express")).default;
  const { b2bAuthMiddleware } = await import("#comms/b2bAuth");

  app = express();
  app.use(express.json());
  app.get("/test/ping", b2bAuthMiddleware, (_req: any, res: any) => res.json({ success: true }));
  app.post("/test/echo", b2bAuthMiddleware, (req: any, res: any) => res.json({ success: true, body: req.body }));
});

afterAll(() => {
  delete process.env.SRE_INTERNAL_KEY;
});

describe("b2bAuthMiddleware — Bearer header", () => {
  it("passes with correct key", async () => {
    const { default: request } = await import("supertest");
    const res = await request(app).get("/test/ping").set("Authorization", `Bearer ${TEST_KEY}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("rejects with no auth header", async () => {
    const { default: request } = await import("supertest");
    const res = await request(app).get("/test/ping");
    expect(res.status).toBe(401);
  });

  it("rejects with wrong key", async () => {
    const { default: request } = await import("supertest");
    const res = await request(app).get("/test/ping").set("Authorization", "Bearer wrong_key");
    expect(res.status).toBe(401);
  });

  it("rejects with empty Bearer value", async () => {
    const { default: request } = await import("supertest");
    const res = await request(app).get("/test/ping").set("Authorization", "Bearer ");
    expect(res.status).toBe(401);
  });
});

describe("b2bAuthMiddleware — x-internal-token header", () => {
  it("passes with correct key via x-internal-token", async () => {
    const { default: request } = await import("supertest");
    const res = await request(app).get("/test/ping").set("x-internal-token", TEST_KEY);
    expect(res.status).toBe(200);
  });

  it("rejects with wrong x-internal-token", async () => {
    const { default: request } = await import("supertest");
    const res = await request(app).get("/test/ping").set("x-internal-token", "wrong");
    expect(res.status).toBe(401);
  });
});

describe("b2bAuthMiddleware — timing-safe edge cases", () => {
  it("rejects a key with correct prefix but extra chars", async () => {
    const { default: request } = await import("supertest");
    const res = await request(app).get("/test/ping").set("Authorization", `Bearer ${TEST_KEY}extra`);
    expect(res.status).toBe(401);
  });

  it("rejects a truncated prefix of the correct key", async () => {
    const { default: request } = await import("supertest");
    const res = await request(app).get("/test/ping").set("Authorization", `Bearer ${TEST_KEY.slice(0, 10)}`);
    expect(res.status).toBe(401);
  });
});
