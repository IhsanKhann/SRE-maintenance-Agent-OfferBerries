import mongoose, { Document, Schema } from "mongoose";

export interface ContainerStat {
  name: string;
  status: string;
  restartCount: number;
  cpuPercent: number;
  memUsageMb: number;
  memLimitMb: number;
}

export interface ITelemetrySnapshot extends Document {
  capturedAt: Date;
  prometheus: {
    httpRequestsTotal: number;
    httpErrorRate: number;
    p95LatencyMs: number;
    p99LatencyMs: number;
    hrEventsTotal: number;
    financialEventsTotal: number;
    rawMetrics: Record<string, number>;
  };
  bullmq: {
    outboxRelay: { waiting: number; active: number; failed: number };
    documentWorker: { waiting: number; active: number; failed: number };
  };
  docker: {
    containers: ContainerStat[];
    totalRestarts: number;
  };
  loki: {
    errorLogCount5m: number;
    warnLogCount5m: number;
    oomKillDetected: boolean;
    panicDetected: boolean;
    recentErrors: string[];
  };
  backendBSync: {
    syncEndpointUp: boolean;
    recentSyncFailures: number;
    outboxPendingCount: number;
    outboxFailedCount: number;
  };
  system: {
    diskUsagePercent: number;
    redisMemoryPercent: number;
    redisConnectedClients: number;
  };
  collectionErrors: string[];
}

const TelemetrySnapshotSchema = new Schema<ITelemetrySnapshot>(
  {
    capturedAt: { type: Date, default: Date.now, expires: 172800 }, // TTL: 48h
    prometheus: {
      httpRequestsTotal: { type: Number, default: 0 },
      httpErrorRate: { type: Number, default: 0 },
      p95LatencyMs: { type: Number, default: 0 },
      p99LatencyMs: { type: Number, default: 0 },
      hrEventsTotal: { type: Number, default: 0 },
      financialEventsTotal: { type: Number, default: 0 },
      rawMetrics: { type: Schema.Types.Mixed, default: {} },
    },
    bullmq: {
      outboxRelay: { waiting: Number, active: Number, failed: Number },
      documentWorker: { waiting: Number, active: Number, failed: Number },
    },
    docker: {
      containers: [
        {
          name: String,
          status: String,
          restartCount: Number,
          cpuPercent: Number,
          memUsageMb: Number,
          memLimitMb: Number,
        },
      ],
      totalRestarts: { type: Number, default: 0 },
    },
    loki: {
      errorLogCount5m: { type: Number, default: 0 },
      warnLogCount5m: { type: Number, default: 0 },
      oomKillDetected: { type: Boolean, default: false },
      panicDetected: { type: Boolean, default: false },
      recentErrors: [String],
    },
    backendBSync: {
      syncEndpointUp: { type: Boolean, default: true },
      recentSyncFailures: { type: Number, default: 0 },
      outboxPendingCount: { type: Number, default: 0 },
      outboxFailedCount: { type: Number, default: 0 },
    },
    system: {
      diskUsagePercent: { type: Number, default: 0 },
      redisMemoryPercent: { type: Number, default: 0 },
      redisConnectedClients: { type: Number, default: 0 },
    },
    collectionErrors: [String],
  },
  { collection: "telemetry_snapshots", timestamps: false }
);

TelemetrySnapshotSchema.index({ capturedAt: 1 });

export const TelemetrySnapshot = mongoose.model<ITelemetrySnapshot>(
  "TelemetrySnapshot",
  TelemetrySnapshotSchema
);
