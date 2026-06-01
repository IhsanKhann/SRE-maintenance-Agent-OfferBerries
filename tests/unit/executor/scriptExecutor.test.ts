// @ts-nocheck
// Unit tests: Security allowlist enforcement only.
// Exec invocation (SRE_PARAMS passing, script selection) → integration tests.
// Rationale: promisify(exec) captures the function ref at import time; unit-level
// child_process mocking cannot intercept it reliably in ESM module mode.
import { jest, describe, it, expect } from "@jest/globals";

jest.mock("child_process", () => ({
  exec: jest.fn(),  // never called in these tests — allowlist blocks before exec
}));
jest.mock("../../../src/utils/logger.js", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() },
}));
jest.mock("../../../src/comms/socketServer.js", () => ({
  emitAgentLog: jest.fn(),
}));
jest.mock("../../../src/config.js", () => ({
  cfg: { NODE_ENV: "test" },
}));

import { executeScript } from "../../../src/executor/scriptExecutor.js";

describe("executeScript — security allowlist (critical invariants)", () => {
  // These 9 tests verify the structural security property:
  // The AI CANNOT execute arbitrary commands — only named tools from the allowlist.

  it("blocks unknown tool name", async () => {
    const r = await executeScript("unknownTool", {});
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("not in allowlist");
  });

  it("blocks tool with shell metacharacters ; (injection attempt)", async () => {
    const r = await executeScript("clearBullMQDeadLetters; rm -rf /", {});
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("not in allowlist");
  });

  it("blocks tool with shell metacharacters && (injection attempt)", async () => {
    const r = await executeScript("reloadNginx && cat /etc/passwd", {});
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("not in allowlist");
  });

  it("blocks path traversal with forward slashes", async () => {
    const r = await executeScript("../../etc/passwd", {});
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("not in allowlist");
  });

  it("blocks path traversal with backslashes", async () => {
    const r = await executeScript("..\\..\\etc\\passwd", {});
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("not in allowlist");
  });

  it("blocks empty string", async () => {
    const r = await executeScript("", {});
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("not in allowlist");
  });

  it("blocks whitespace-only string", async () => {
    const r = await executeScript("   ", {});
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("not in allowlist");
  });

  // ── In-process tools (exec never called, resolved immediately) ────────────
  it("queryLokiLogs handled in-process (no exec, returns immediately)", async () => {
    const r = await executeScript("queryLokiLogs", { service: "backend", lastMinutes: 5 });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("in-process");
  });

  it("getContainerStats handled in-process", async () => {
    const r = await executeScript("getContainerStats", { containerName: "backend" });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("in-process");
  });

  it("getQueueState handled in-process", async () => {
    const r = await executeScript("getQueueState", { queueName: "outboxRelay" });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("in-process");
  });

  it("sendHumanAlert handled in-process (routed to comms, no exec)", async () => {
    const r = await executeScript("sendHumanAlert", { summary: "test", severity: "p2" });
    expect(r.exitCode).toBe(0);
  });
});
