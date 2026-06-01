import winston from "winston";
import { cfg } from "../config.js";

export const logger = winston.createLogger({
  level: cfg.NODE_ENV === "production" ? "info" : "debug",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    cfg.NODE_ENV === "production"
      ? winston.format.json()
      : winston.format.combine(
          winston.format.colorize(),
          winston.format.printf(({ timestamp, level, message, ...meta }) => {
            const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
            return `${timestamp} [${level}] ${message}${metaStr}`;
          })
        )
  ),
  transports: [new winston.transports.Console()],
});
