import axios from "axios";
import { cfg } from "../config.js";
import { logger } from "../utils/logger.js";

interface PrometheusMetrics {
  httpRequestsTotal: number;
  httpErrorRate: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  hrEventsTotal: number;
  financialEventsTotal: number;
  rawMetrics: Record<string, number>;
}

function parsePrometheusText(text: string): Record<string, number> {
  const metrics: Record<string, number> = {};
  for (const line of text.split("\n")) {
    if (line.startsWith("#") || !line.trim()) continue;
    const spaceIdx = line.lastIndexOf(" ");
    if (spaceIdx === -1) continue;
    const key = line.substring(0, spaceIdx).replace(/\{[^}]*\}/g, "").trim();
    const val = parseFloat(line.substring(spaceIdx).trim());
    if (!isNaN(val)) {
      metrics[key] = (metrics[key] ?? 0) + val;
    }
  }
  return metrics;
}

function computeErrorRate(raw: Record<string, number>): number {
  const total = raw["http_requests_total"] ?? 0;
  if (total === 0) return 0;

  // Sum all 5xx status codes
  let errors = 0;
  for (const [key, val] of Object.entries(raw)) {
    if (key.includes("http_requests_total") && key.includes("status_code")) {
      const statusMatch = key.match(/status_code="(\d+)"/);
      if (statusMatch && parseInt(statusMatch[1]) >= 500) errors += val;
    }
  }
  return total > 0 ? errors / total : 0;
}

export async function collectPrometheus(): Promise<PrometheusMetrics> {
  try {
    const { data: text } = await axios.get<string>(cfg.PROD_BACKEND_METRICS_URL, {
      timeout: 5000,
      headers: { Accept: "text/plain" },
    });

    const raw = parsePrometheusText(text);

    const httpRequestsTotal = raw["http_requests_total"] ?? 0;
    const httpErrorRate = computeErrorRate(raw);

    // BullMQ histogram quantiles
    const p95LatencyMs = (raw["http_request_duration_seconds{quantile=\"0.95\"}"] ??
                          raw["http_request_duration_seconds"] ?? 0) * 1000;
    const p99LatencyMs = (raw["http_request_duration_seconds{quantile=\"0.99\"}"] ??
                          raw["http_request_duration_seconds"] ?? 0) * 1000;

    const hrEventsTotal = raw["hr_events_total"] ?? 0;
    const financialEventsTotal = raw["financial_events_total"] ?? 0;

    return {
      httpRequestsTotal,
      httpErrorRate,
      p95LatencyMs,
      p99LatencyMs,
      hrEventsTotal,
      financialEventsTotal,
      rawMetrics: raw,
    };
  } catch (err: any) {
    logger.warn("[Collector:Prometheus] Failed to scrape metrics", { error: err.message });
    return {
      httpRequestsTotal: 0,
      httpErrorRate: 0,
      p95LatencyMs: 0,
      p99LatencyMs: 0,
      hrEventsTotal: 0,
      financialEventsTotal: 0,
      rawMetrics: {},
    };
  }
}
