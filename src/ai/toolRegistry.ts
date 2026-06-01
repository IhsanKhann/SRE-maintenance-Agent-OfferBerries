export const TOOL_DEFINITIONS = [
  // ── Diagnostic (read-only, always safe) ──────────────────────────────────
  {
    name: "queryLokiLogs",
    description: "Fetch recent log lines from Loki for a service. ALWAYS call this first before any action to gather context.",
    parameters: {
      type: "object",
      properties: {
        service: { type: "string", enum: ["backend", "nginx", "frontend"], description: "Service to query logs for" },
        lastMinutes: { type: "number", minimum: 1, maximum: 60, description: "How many minutes back to look" },
        level: { type: "string", enum: ["error", "warn", "info"], description: "Log level filter" },
        grep: { type: "string", description: "Optional keyword to filter log lines" },
      },
      required: ["service", "lastMinutes"],
    },
  },
  {
    name: "getContainerStats",
    description: "Get CPU, memory, status, and restart count for a Docker container.",
    parameters: {
      type: "object",
      properties: {
        containerName: {
          type: "string",
          enum: ["backend", "OfferBerries_backend", "OfferBerries_nginx", "OfferBerries_redis"],
          description: "Container to inspect",
        },
      },
      required: ["containerName"],
    },
  },
  {
    name: "getQueueState",
    description: "Get waiting, active, and failed job counts for a BullMQ queue.",
    parameters: {
      type: "object",
      properties: {
        queueName: {
          type: "string",
          enum: ["outboxRelay", "documentWorker"],
        },
      },
      required: ["queueName"],
    },
  },

  // ── Recovery Actions (state-changing) ────────────────────────────────────
  {
    name: "gracefulRestartContainer",
    description: "SIGTERM a Docker container and let Docker restart policy recover it. Use for OOM kills, crash loops, or frozen containers. NEVER use on redis, loki, prometheus, or grafana.",
    parameters: {
      type: "object",
      properties: {
        containerName: {
          type: "string",
          // Hard constraint: data/infra containers excluded from this enum
          enum: ["backend", "OfferBerries_backend", "OfferBerries_nginx"],
          description: "Container to restart",
        },
      },
      required: ["containerName"],
    },
  },
  {
    name: "clearBullMQDeadLetters",
    description: "Drain all failed jobs from a BullMQ queue. Irreversible — those job payloads are removed. Use only when jobs are clearly non-recoverable.",
    parameters: {
      type: "object",
      properties: {
        queueName: { type: "string", enum: ["outboxRelay", "documentWorker"] },
      },
      required: ["queueName"],
    },
  },
  {
    name: "flushRedisRateLimitKeys",
    description: "Delete Redis rate-limit keys for a specific IP or all 'rl:*' pattern keys. Use when a valid user is incorrectly blocked.",
    parameters: {
      type: "object",
      properties: {
        targetIp: { type: "string", description: "IP address to flush, or '*' for all rate-limit keys" },
      },
      required: ["targetIp"],
    },
  },
  {
    name: "scaleDocumentWorker",
    description: "Adjust BullMQ document worker concurrency in Redis. Use when document generation backs up beyond 50 waiting jobs.",
    parameters: {
      type: "object",
      properties: {
        concurrency: { type: "number", minimum: 1, maximum: 10 },
      },
      required: ["concurrency"],
    },
  },
  {
    name: "reloadNginx",
    description: "Run nginx -t (config test) then nginx -s reload on the production Nginx container. Zero-downtime — does not kill existing connections.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "triggerBackup",
    description: "Trigger an immediate MongoDB backup outside of the daily schedule. Use before risky operations.",
    parameters: { type: "object", properties: {} },
  },

  // ── Human Escalation (always safe — sends WhatsApp) ──────────────────────
  {
    name: "sendHumanAlert",
    description: "Send a WhatsApp alert to the admin. Use when confidence is below 0.75, action is irreversible, or the root cause involves application code changes.",
    parameters: {
      type: "object",
      properties: {
        summary: { type: "string", description: "One paragraph summary of the incident and diagnosis" },
        proposedAction: { type: "string", description: "What action you would take if authorized, or 'monitor' if unsure" },
        severity: { type: "string", enum: ["p1", "p2", "p3"] },
        requiresAuthorization: {
          type: "boolean",
          description: "True if you need the admin to approve an action. False if just informing.",
        },
      },
      required: ["summary", "severity", "requiresAuthorization"],
    },
  },
] as const;

export type ToolName = typeof TOOL_DEFINITIONS[number]["name"];
