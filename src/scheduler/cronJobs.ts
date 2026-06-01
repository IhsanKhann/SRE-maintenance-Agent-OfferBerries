import cron from "node-cron";
import { executeScript } from "../executor/scriptExecutor.js";
import { buildAndSendWeeklyReport, aggregateDailyStats } from "../analytics/reportBuilder.js";
import { SystemBaseline } from "../db/models/SystemBaseline.js";
import { TelemetrySnapshot } from "../db/models/TelemetrySnapshot.js";
import { sendWhatsApp } from "../comms/whatsapp.js";
import { logger } from "../utils/logger.js";

const jobs: cron.ScheduledTask[] = [];

function computeStats(values: number[]): { mean: number; stddev: number; p99: number; min: number; max: number; sampleCount: number } {
  if (values.length === 0) return { mean: 0, stddev: 0, p99: 0, min: 0, max: 0, sampleCount: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const stddev = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
  const sorted = [...values].sort((a, b) => a - b);
  const p99idx = Math.floor(sorted.length * 0.99);
  return {
    mean,
    stddev,
    p99: sorted[p99idx] ?? sorted[sorted.length - 1] ?? 0,
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
    sampleCount: values.length,
  };
}

export function startCronJobs(): void {
  if (jobs.length > 0) return;

  // ── Daily MongoDB Backup (02:00 UTC) ──────────────────────────────────────
  jobs.push(cron.schedule("0 2 * * *", async () => {
    logger.info("[CRON] Starting daily MongoDB backup");
    const result = await executeScript("dailyMongoBackup", {});
    if (result.exitCode !== 0) {
      await sendWhatsApp(`❌ Backup failed!\n${result.stderr.slice(0, 200)}`);
    } else {
      logger.info("[CRON] Daily backup complete");
    }
  }, { timezone: "UTC" }));

  // ── Redis Backup (03:00 UTC) ──────────────────────────────────────────────
  jobs.push(cron.schedule("0 3 * * *", async () => {
    logger.info("[CRON] Starting Redis backup");
    await executeScript("redisBackup", {});
  }, { timezone: "UTC" }));

  // ── Docker log cleanup (01:00 UTC daily) ─────────────────────────────────
  jobs.push(cron.schedule("0 1 * * *", async () => {
    logger.info("[CRON] Docker log cleanup");
    await executeScript("dockerLogCleanup", {});
  }, { timezone: "UTC" }));

  // ── Disk space check (every 6 hours) ─────────────────────────────────────
  jobs.push(cron.schedule("0 */6 * * *", async () => {
    logger.info("[CRON] Disk space check");
    const result = await executeScript("diskSpaceCleanup", {});
    if (result.stdout.includes("DISK_ALERT")) {
      await sendWhatsApp(`⚠️ Disk space alert:\n${result.stdout.slice(0, 200)}`);
    }
  }));

  // ── Backup verification (Sunday 04:00 UTC) ────────────────────────────────
  jobs.push(cron.schedule("0 4 * * 0", async () => {
    logger.info("[CRON] Weekly backup verification");
    const result = await executeScript("verifyBackup", {});
    if (result.exitCode !== 0) {
      await sendWhatsApp(`🚨 Backup verification FAILED!\n${result.stderr.slice(0, 300)}`);
    } else {
      await sendWhatsApp(`✅ Backup verified: ${result.stdout.trim()}`);
    }
  }, { timezone: "UTC" }));

  // ── Weekly analytics report (Monday 08:00 PKT = 03:00 UTC) ──────────────
  jobs.push(cron.schedule("0 3 * * 1", async () => {
    logger.info("[CRON] Sending weekly analytics report");
    await buildAndSendWeeklyReport();
  }, { timezone: "UTC" }));

  // ── Daily stats aggregation (00:05 UTC — after midnight) ─────────────────
  jobs.push(cron.schedule("5 0 * * *", async () => {
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    await aggregateDailyStats(yesterday);
  }, { timezone: "UTC" }));

  // ── Hourly baseline recomputation ─────────────────────────────────────────
  jobs.push(cron.schedule("0 * * * *", async () => {
    await recomputeBaselines();
  }));

  logger.info("[CRON] All scheduled jobs started", { count: jobs.length });
}

async function recomputeBaselines(): Promise<void> {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const snapshots = await TelemetrySnapshot.find({ capturedAt: { $gte: since } }).lean();

    if (snapshots.length < 10) return; // not enough data yet

    await SystemBaseline.create({
      computedAt: new Date(),
      windowHours: 24,
      metrics: {
        httpErrorRate: computeStats(snapshots.map((s) => s.prometheus.httpErrorRate)),
        p95LatencyMs: computeStats(snapshots.map((s) => s.prometheus.p95LatencyMs)),
        outboxRelayFailed: computeStats(snapshots.map((s) => s.bullmq.outboxRelay.failed)),
        containerRestarts: computeStats(snapshots.map((s) => s.docker.totalRestarts)),
        errorLogCount5m: computeStats(snapshots.map((s) => s.loki.errorLogCount5m)),
        diskUsagePercent: computeStats(snapshots.map((s) => s.system.diskUsagePercent)),
        redisMemoryPercent: computeStats(snapshots.map((s) => s.system.redisMemoryPercent)),
      },
    });
  } catch (err: any) {
    logger.warn("[CRON] Baseline recomputation failed", { error: err.message });
  }
}

export function stopCronJobs(): void {
  jobs.forEach((j) => j.stop());
  jobs.length = 0;
  logger.info("[CRON] All scheduled jobs stopped");
}
