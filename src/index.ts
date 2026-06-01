import "dotenv/config";
import http from "http";
import express from "express";
import cors from "cors";

import { cfg, corsOrigins } from "./config.js";
import { connectSREDatabase, disconnectSREDatabase } from "./db/connection.js";
import { logger } from "./utils/logger.js";
import { initSRESocket } from "./comms/socketServer.js";
import { whatsappRouter } from "./comms/whatsapp.js";
import { apiRouter } from "./api/router.js";
import { collectAll } from "./collector/index.js";
import { detectAnomalies } from "./detector/anomalyDetector.js";
import { processSignals } from "./incident/incidentManager.js";
import { startCronJobs, stopCronJobs } from "./scheduler/cronJobs.js";
import { disconnectBullMQRedis } from "./collector/bullmq.js";

// ── Express App ───────────────────────────────────────────────────────────────
const app = express();

app.use(cors({ origin: corsOrigins, credentials: true }));
app.use(express.json({ limit: "1mb" }));

// Health check (no auth — used by UptimeRobot)
app.get("/ping", (_req, res) => res.send("ok"));

// API routes
app.use("/api", apiRouter);

// Email action one-click approval endpoint
app.use("/api/email", whatsappRouter);

// 404 fallback
app.use((_req, res) => res.status(404).json({ error: "Not found" }));

// Global error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error("[App] Unhandled error", { error: err.message });
  res.status(500).json({ error: "Internal server error" });
});

// ── Telemetry Loop ────────────────────────────────────────────────────────────
let collectTimer: NodeJS.Timeout | null = null;

async function runCollectionCycle(): Promise<void> {
  if ((global as any).__SRE_PAUSED__) {
    logger.debug("[Main] Autonomous actions paused — skipping anomaly check");
    return;
  }

  try {
    const snapshot = await collectAll();
    const anomalies = detectAnomalies(snapshot);

    if (anomalies.length > 0) {
      await processSignals(anomalies, snapshot);
    }
  } catch (err: any) {
    logger.error("[Main] Collection cycle error", { error: err.message });
  }
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────
async function bootstrap(): Promise<void> {
  // Railway injects PORT; fall back to SRE_PORT for local/Hetzner deploys
  const bindPort = parseInt(process.env.PORT ?? String(cfg.SRE_PORT), 10);

  logger.info("[Main] Starting SRE Agent Daemon", {
    version: "1.0.0",
    env: cfg.NODE_ENV,
    port: bindPort,
  });

  // 1. Start HTTP server immediately so /ping is reachable before DB connects.
  //    Railway's healthcheck fires within 30s — DB + collectors must not block it.
  const httpServer = http.createServer(app);
  initSRESocket(httpServer);

  await new Promise<void>((resolve) => {
    httpServer.listen(bindPort, "0.0.0.0", () => {
      logger.info("[Main] SRE Agent listening", {
        port: bindPort,
        collecting: `every ${cfg.COLLECT_INTERVAL_MS / 1000}s`,
      });
      resolve();
    });
  });

  // 2. Connect to MongoDB — retry-safe: if this fails, log and keep retrying
  //    in the background; the HTTP server stays up so healthcheck passes.
  connectSREDatabase().catch((err) => {
    logger.error("[Main] DB connect failed — will retry on next operation", { error: err.message });
  });

  // 3. Start cron jobs
  startCronJobs();

  // 4. Start the collection loop (non-blocking — failures are caught inside)
  runCollectionCycle().catch(() => {});
  collectTimer = setInterval(runCollectionCycle, cfg.COLLECT_INTERVAL_MS);

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  const shutdown = async (signal: string) => {
    logger.info(`[Main] ${signal} received — shutting down`);
    if (collectTimer) clearInterval(collectTimer);
    stopCronJobs();
    await disconnectBullMQRedis();
    await disconnectSREDatabase();
    httpServer.close(() => {
      logger.info("[Main] HTTP server closed");
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

bootstrap().catch((err) => {
  logger.error("[Main] Bootstrap failed", { error: err.message });
  process.exit(1);
});
