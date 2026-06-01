import mongoose, { Document, Schema } from "mongoose";

interface MetricStats {
  mean: number;
  stddev: number;
  p99: number;
  min: number;
  max: number;
  sampleCount: number;
}

export interface ISystemBaseline extends Document {
  computedAt: Date;
  windowHours: number;
  metrics: {
    httpErrorRate: MetricStats;
    p95LatencyMs: MetricStats;
    outboxRelayFailed: MetricStats;
    containerRestarts: MetricStats;
    errorLogCount5m: MetricStats;
    diskUsagePercent: MetricStats;
    redisMemoryPercent: MetricStats;
  };
}

const MetricStatsSchema = {
  mean: { type: Number, default: 0 },
  stddev: { type: Number, default: 0 },
  p99: { type: Number, default: 0 },
  min: { type: Number, default: 0 },
  max: { type: Number, default: 0 },
  sampleCount: { type: Number, default: 0 },
};

const SystemBaselineSchema = new Schema<ISystemBaseline>(
  {
    computedAt: { type: Date, default: Date.now, index: true },
    windowHours: { type: Number, default: 24 },
    metrics: {
      httpErrorRate: MetricStatsSchema,
      p95LatencyMs: MetricStatsSchema,
      outboxRelayFailed: MetricStatsSchema,
      containerRestarts: MetricStatsSchema,
      errorLogCount5m: MetricStatsSchema,
      diskUsagePercent: MetricStatsSchema,
      redisMemoryPercent: MetricStatsSchema,
    },
  },
  { collection: "system_baselines", timestamps: false }
);

export const SystemBaseline = mongoose.model<ISystemBaseline>("SystemBaseline", SystemBaselineSchema);
