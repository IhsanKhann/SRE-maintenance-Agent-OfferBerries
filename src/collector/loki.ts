import axios from "axios";
import { cfg } from "../config.js";
import { logger } from "../utils/logger.js";
import { runRemoteCommand, sshConfigured } from "../utils/sshClient.js";

interface LokiMetrics {
  errorLogCount5m: number;
  warnLogCount5m: number;
  oomKillDetected: boolean;
  panicDetected: boolean;
  recentErrors: string[];
}

const OOM_PATTERNS = [
  "out of memory",
  "JavaScript heap out of memory",
  "OOMKilled",
  "Cannot allocate memory",
  "killed process",
];

const PANIC_PATTERNS = [
  "panic:",
  "FATAL:",
  "process exited with code",
  "Unhandled promise rejection",
  "UnhandledPromiseRejection",
];

async function queryLoki(
  logql: string,
  start: string,
  end: string,
  limit = 100
): Promise<string[]> {
  const params = new URLSearchParams({ query: logql, start, end, limit: String(limit) });
  const url = `${cfg.PROD_LOKI_URL}/loki/api/v1/query_range?${params}`;

  // Try direct HTTP first (works in dev or if Loki is publicly reachable)
  try {
    const { data } = await axios.get(url, { timeout: 8000 });
    return parseLokiResponse(data);
  } catch {
    // Fall back to SSH: curl Loki from inside the Hetzner network
    if (!sshConfigured()) return [];
    try {
      const internalUrl = `http://localhost:3100/loki/api/v1/query_range?${params}`;
      const raw = await runRemoteCommand(`curl -s '${internalUrl}'`);
      if (!raw.trim()) return [];
      return parseLokiResponse(JSON.parse(raw));
    } catch (err: any) {
      logger.warn("[Collector:Loki] Query failed", { logql, error: err.message });
      return [];
    }
  }
}

function parseLokiResponse(data: any): string[] {
  const lines: string[] = [];
  for (const stream of data?.data?.result ?? []) {
    for (const [, line] of stream.values ?? []) {
      lines.push(line as string);
    }
  }
  return lines;
}

export async function collectLoki(): Promise<LokiMetrics> {
  const now = Date.now();
  const fiveMinAgo = now - 5 * 60 * 1000;
  const endNs = String(now * 1_000_000);
  const startNs = String(fiveMinAgo * 1_000_000);

  try {
    const [errorLines, warnLines] = await Promise.all([
      queryLoki(`{job="backend"} |= "error" | json`, startNs, endNs, 50),
      queryLoki(`{job="backend"} |= "warn" | json`, startNs, endNs, 20),
    ]);

    const allLines = [...errorLines, ...warnLines];

    const oomKillDetected = OOM_PATTERNS.some((p) =>
      allLines.some((l) => l.toLowerCase().includes(p.toLowerCase()))
    );
    const panicDetected = PANIC_PATTERNS.some((p) =>
      allLines.some((l) => l.includes(p))
    );

    return {
      errorLogCount5m: errorLines.length,
      warnLogCount5m: warnLines.length,
      oomKillDetected,
      panicDetected,
      recentErrors: errorLines.slice(0, 5),
    };
  } catch (err: any) {
    logger.warn("[Collector:Loki] Collection failed", { error: err.message });
    return {
      errorLogCount5m: 0,
      warnLogCount5m: 0,
      oomKillDetected: false,
      panicDetected: false,
      recentErrors: [],
    };
  }
}

// Exported for use by Groq tool handler
export async function queryLokiLogs(params: {
  service: string;
  lastMinutes: number;
  level?: string;
  grep?: string;
}): Promise<{ lines: string[]; count: number }> {
  const now = Date.now();
  const startMs = now - params.lastMinutes * 60 * 1000;
  const endNs = String(now * 1_000_000);
  const startNs = String(startMs * 1_000_000);

  let logql = `{job="${params.service}"}`;
  if (params.level) logql += ` |= "${params.level}"`;
  if (params.grep) logql += ` |= "${params.grep}"`;

  const lines = await queryLoki(logql, startNs, endNs, 30);
  return { lines, count: lines.length };
}
