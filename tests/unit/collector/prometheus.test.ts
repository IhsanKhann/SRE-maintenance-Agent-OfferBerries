// @ts-nocheck
// Unit tests: Prometheus collector
// Uses jest.unstable_mockModule (ESM-native) + dynamic imports for proper ESM mocking.
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

// ESM-native module mocking — must come before dynamic imports of the module under test
const mockAxiosGet = jest.fn();

await jest.unstable_mockModule("axios", () => ({
  default: { get: mockAxiosGet },
  get: mockAxiosGet,
}));

await jest.unstable_mockModule("../../../src/config.js", () => ({
  cfg: { PROD_BACKEND_METRICS_URL: "http://localhost:5000/metrics", NODE_ENV: "test" },
}));

await jest.unstable_mockModule("../../../src/utils/logger.js", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() },
}));

// Dynamic import AFTER mocks are established
const { collectPrometheus } = await import("../../../src/collector/prometheus.js");

const GOOD_METRICS = `
http_requests_total{method="GET",route="/api/health",status_code="200"} 1234
http_requests_total{method="POST",route="/api/transactions",status_code="500"} 10
hr_events_total{event_type="EMPLOYEE_CREATED",status="success"} 5
financial_events_total{event_type="SALARY_PAID",status="success"} 2
`;

describe("collectPrometheus", () => {
  beforeEach(() => mockAxiosGet.mockReset());

  it("parses HTTP request counts from valid metrics", async () => {
    mockAxiosGet.mockResolvedValue({ data: GOOD_METRICS });
    const result = await collectPrometheus();
    expect(result.httpRequestsTotal).toBeGreaterThan(0);
  });

  it("parses HR and financial event counters", async () => {
    mockAxiosGet.mockResolvedValue({ data: GOOD_METRICS });
    const result = await collectPrometheus();
    expect(result.hrEventsTotal).toBeGreaterThan(0);
    expect(result.financialEventsTotal).toBeGreaterThan(0);
  });

  it("result always contains all required keys", async () => {
    mockAxiosGet.mockResolvedValue({ data: GOOD_METRICS });
    const result = await collectPrometheus();
    for (const key of ["httpRequestsTotal", "httpErrorRate", "p95LatencyMs", "hrEventsTotal", "financialEventsTotal", "rawMetrics"]) {
      expect(result).toHaveProperty(key);
    }
  });

  it("returns all zeros on ECONNREFUSED (backend down)", async () => {
    mockAxiosGet.mockRejectedValue(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }));
    const result = await collectPrometheus();
    expect(result.httpRequestsTotal).toBe(0);
    expect(result.httpErrorRate).toBe(0);
    expect(result.hrEventsTotal).toBe(0);
  });

  it("returns all zeros on request timeout", async () => {
    mockAxiosGet.mockRejectedValue(Object.assign(new Error("timeout of 5000ms exceeded"), { code: "ETIMEDOUT" }));
    const result = await collectPrometheus();
    expect(result.httpRequestsTotal).toBe(0);
  });

  it("handles empty metrics body without throwing", async () => {
    mockAxiosGet.mockResolvedValue({ data: "" });
    const result = await collectPrometheus();
    expect(result.httpRequestsTotal).toBe(0);
    expect(result.rawMetrics).toEqual({});
  });

  it("returns zero errorRate when no 5xx status codes exist", async () => {
    const clean = `
http_requests_total{method="GET",route="/api/health",status_code="200"} 500
http_requests_total{method="GET",route="/api/employees",status_code="200"} 200
`;
    mockAxiosGet.mockResolvedValue({ data: clean });
    const result = await collectPrometheus();
    expect(result.httpErrorRate).toBe(0);
  });
});
