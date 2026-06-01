import axios from "axios";
import { cfg } from "../config.js";
import { logger } from "../utils/logger.js";

interface BackendBSyncMetrics {
  syncEndpointUp: boolean;
  recentSyncFailures: number;
  outboxPendingCount: number;
  outboxFailedCount: number;
}

export async function collectBackendBSync(): Promise<BackendBSyncMetrics> {
  let syncEndpointUp = false;
  let outboxPendingCount = 0;
  let outboxFailedCount = 0;

  // 1. Health check on Backend-A
  try {
    const { data } = await axios.get(cfg.PROD_BACKEND_HEALTH_URL, { timeout: 3000 });
    syncEndpointUp = data?.status === "ok";
  } catch {
    syncEndpointUp = false;
  }

  // 2. Check outbox via metrics (if prometheus has outbox gauges)
  // Falls back to 0 when metrics unavailable — anomaly detector handles persistent zeros
  try {
    const { data: metricsText } = await axios.get<string>(cfg.PROD_BACKEND_METRICS_URL, {
      timeout: 4000,
      headers: { Accept: "text/plain" },
    });

    // Parse outbox-specific metrics if exposed
    const pendingMatch = metricsText.match(/outbox_pending_total\s+(\d+)/);
    const failedMatch = metricsText.match(/outbox_failed_total\s+(\d+)/);
    if (pendingMatch) outboxPendingCount = parseInt(pendingMatch[1]);
    if (failedMatch) outboxFailedCount = parseInt(failedMatch[1]);
  } catch { /* metrics not available — ok */ }

  return {
    syncEndpointUp,
    recentSyncFailures: outboxFailedCount,
    outboxPendingCount,
    outboxFailedCount,
  };
}
