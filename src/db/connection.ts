import mongoose from "mongoose";
import { cfg } from "../config.js";
import { logger } from "../utils/logger.js";

let isConnected = false;

export async function connectSREDatabase(): Promise<void> {
  if (isConnected) return;

  try {
    await mongoose.connect(cfg.MONGODB_SRE_URI, {
      dbName: "sre_agent",
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
    });
    isConnected = true;
    logger.info("[DB] SRE Agent database connected", { uri: cfg.MONGODB_SRE_URI.split("@").pop() });
  } catch (err: any) {
    logger.error("[DB] Failed to connect to SRE database", { error: err.message });
    throw err;
  }
}

export async function disconnectSREDatabase(): Promise<void> {
  if (!isConnected) return;
  await mongoose.connection.close();
  isConnected = false;
  logger.info("[DB] SRE Agent database disconnected");
}
