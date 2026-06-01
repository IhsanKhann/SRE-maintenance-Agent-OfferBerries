import IORedis from "ioredis";
import { cfg } from "../config.js";
import { logger } from "../utils/logger.js";

interface QueueState {
  waiting: number;
  active: number;
  failed: number;
  completed: number;
  delayed: number;
}

interface BullMQMetrics {
  outboxRelay: QueueState;
  documentWorker: QueueState;
}

let _redis: IORedis | null = null;

function getRedis(): IORedis {
  if (!_redis) {
    _redis = new IORedis(cfg.PROD_REDIS_URL, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: false,
      lazyConnect: true,
      connectTimeout: 5000,
    });
    _redis.on("error", (err) => {
      logger.warn("[Collector:BullMQ] Redis error", { error: err.message });
    });
  }
  return _redis;
}

const QUEUE_NAMES = {
  outboxRelay: "outboxRelay",
  documentWorker: "documentWorker",
} as const;

async function getQueueState(redis: IORedis, queueName: string): Promise<QueueState> {
  try {
    const prefix = `bull:${queueName}`;
    const [waiting, active, failed, completed, delayed] = await Promise.all([
      redis.llen(`${prefix}:wait`),
      redis.llen(`${prefix}:active`),
      redis.zcard(`${prefix}:failed`),
      redis.zcard(`${prefix}:completed`),
      redis.zcard(`${prefix}:delayed`),
    ]);
    return { waiting, active, failed, completed, delayed };
  } catch (err: any) {
    logger.warn("[Collector:BullMQ] Queue state fetch failed", { queueName, error: err.message });
    return { waiting: 0, active: 0, failed: 0, completed: 0, delayed: 0 };
  }
}

export async function collectBullMQ(): Promise<BullMQMetrics> {
  const redis = getRedis();
  if (redis.status !== "ready") {
    try { await redis.connect(); } catch { /* will retry next cycle */ }
  }

  const [outboxRelay, documentWorker] = await Promise.all([
    getQueueState(redis, QUEUE_NAMES.outboxRelay),
    getQueueState(redis, QUEUE_NAMES.documentWorker),
  ]);

  return { outboxRelay, documentWorker };
}

// Exported for Groq tool handler
export async function getQueueStats(queueName: keyof typeof QUEUE_NAMES): Promise<QueueState> {
  const redis = getRedis();
  return getQueueState(redis, QUEUE_NAMES[queueName]);
}

// For Redis system stats
export async function collectRedisStats(): Promise<{
  memoryPercent: number;
  connectedClients: number;
}> {
  const redis = getRedis();
  try {
    const info = await redis.info("memory");
    const usedMatch = info.match(/used_memory:(\d+)/);
    const maxMatch = info.match(/maxmemory:(\d+)/);
    const usedMem = usedMatch ? parseInt(usedMatch[1]) : 0;
    const maxMem = maxMatch ? parseInt(maxMatch[1]) : 0;
    const memoryPercent = maxMem > 0 ? (usedMem / maxMem) * 100 : 0;

    const clientInfo = await redis.info("clients");
    const clientMatch = clientInfo.match(/connected_clients:(\d+)/);
    const connectedClients = clientMatch ? parseInt(clientMatch[1]) : 0;

    return { memoryPercent, connectedClients };
  } catch {
    return { memoryPercent: 0, connectedClients: 0 };
  }
}

export async function disconnectBullMQRedis(): Promise<void> {
  if (_redis) {
    await _redis.quit();
    _redis = null;
  }
}
