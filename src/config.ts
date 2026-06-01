import { z } from "zod";

// Load .env file only outside test environment
if (process.env.NODE_ENV !== "test") {
  const { config } = await import("dotenv");
  config();
}

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  SRE_PORT: z.coerce.number().default(3500),
  SRE_PUBLIC_URL: z.string().url().default("http://localhost:3500"),

  // Backend-A connection
  PROD_BACKEND_METRICS_URL: z.string().url().default("http://localhost:5000/metrics"),
  PROD_BACKEND_HEALTH_URL: z.string().url().default("http://localhost:5000/api/health"),
  PROD_LOKI_URL: z.string().url().default("http://localhost:3100"),
  PROD_REDIS_URL: z.string().default("redis://localhost:6379"),
  PROD_SSH_HOST: z.string().default("localhost"),
  PROD_SSH_USER: z.string().default("deploy"),
  PROD_SSH_KEY_PATH: z.string().default("./ssh_deploy_key"),

  // SRE MongoDB
  MONGODB_SRE_URI: z.string().default("mongodb://localhost:27017/sre_agent"),

  // AI APIs — at least one patch model should be set
  GROQ_API_KEY: z.string().optional(),        // Fast triage — free tier covers this workload
  GOOGLE_AI_KEY: z.string().optional(),       // Gemini 2.0 Flash — recommended for patches (free tier)
  ANTHROPIC_API_KEY: z.string().optional(),   // Claude — fallback if PATCH_MODEL=claude
  PATCH_MODEL: z.enum(["gemini", "claude"]).default("gemini"),

  // Email / SMTP
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_SECURE: z.coerce.boolean().default(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  ADMIN_EMAIL: z.string().email().optional(),
  SMTP_FROM: z.string().optional(),

  // Auth (shared with Backend-A)
  JWT_SECRET: z.string().min(10).default("dev-secret-change-in-production"),

  // S3 / Object Storage
  HETZNER_S3_ENDPOINT: z.string().optional(),
  HETZNER_S3_ACCESS_KEY: z.string().optional(),
  HETZNER_S3_SECRET_KEY: z.string().optional(),
  BACKUP_S3_BUCKET: z.string().default("offerberries-backups"),

  // Intervals
  COLLECT_INTERVAL_MS: z.coerce.number().default(15000),
  HEALTH_CHECK_INTERVAL_MS: z.coerce.number().default(10000),

  // Thresholds
  THRESHOLD_HTTP_ERROR_RATE: z.coerce.number().default(0.03),
  THRESHOLD_P95_LATENCY_MS: z.coerce.number().default(2000),
  THRESHOLD_BULLMQ_FAILED: z.coerce.number().default(20),
  THRESHOLD_OUTBOX_PENDING: z.coerce.number().default(50),
  THRESHOLD_DISK_PERCENT: z.coerce.number().default(85),
  THRESHOLD_MEMORY_PERCENT: z.coerce.number().default(85),

  // CORS
  SRE_CORS_ORIGINS: z.string().default("http://localhost:5174"),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("[Config] Environment validation failed:");
  console.error(parsed.error.format());
  process.exit(1);
}

export const cfg = parsed.data;

export const isProduction = cfg.NODE_ENV === "production";
export const isDev = cfg.NODE_ENV === "development";
export const isTest = cfg.NODE_ENV === "test";

export const corsOrigins = cfg.SRE_CORS_ORIGINS.split(",").map((s) => s.trim());

export const hasAI = Boolean(cfg.GROQ_API_KEY);
export const hasPatchModel = Boolean(cfg.GOOGLE_AI_KEY ?? cfg.ANTHROPIC_API_KEY);
export const hasClaude = Boolean(cfg.ANTHROPIC_API_KEY);
export const hasGemini = Boolean(cfg.GOOGLE_AI_KEY);
export const hasEmail = Boolean(
  cfg.SMTP_HOST && cfg.SMTP_USER && cfg.SMTP_PASS && cfg.ADMIN_EMAIL
);
// Legacy alias
export const hasWhatsApp = hasEmail;
