import mongoose, { Document, Schema } from "mongoose";

export interface IAnalyticsDaily extends Document {
  date: Date;
  uptime: {
    totalMinutes: number;
    downtimeMinutes: number;
    uptimePercent: number;
    incidents: number;
    mttrMinutes: number;
  };
  traffic: {
    totalRequests: number;
    errorCount: number;
    errorRate: number;
    p50LatencyMs: number;
    p95LatencyMs: number;
    p99LatencyMs: number;
  };
  business: {
    hrEvents: number;
    financialEvents: number;
    outboxDelivered: number;
    outboxFailed: number;
    syncReceived: number;
    syncFailed: number;
  };
  infrastructure: {
    autoRecoveries: number;
    actionsExecuted: number;
    groqTokens: number;
    claudeTokens: number;
    backupsOk: number;
    backupsFailed: number;
    avgDiskPercent: number;
    peakMemPercent: number;
  };
  cost: {
    groqUsd: number;
    claudeUsd: number;
    totalUsd: number;
  };
}

const AnalyticsDailySchema = new Schema<IAnalyticsDaily>(
  {
    date: { type: Date, required: true, unique: true, index: true },
    uptime: {
      totalMinutes: { type: Number, default: 0 },
      downtimeMinutes: { type: Number, default: 0 },
      uptimePercent: { type: Number, default: 100 },
      incidents: { type: Number, default: 0 },
      mttrMinutes: { type: Number, default: 0 },
    },
    traffic: {
      totalRequests: { type: Number, default: 0 },
      errorCount: { type: Number, default: 0 },
      errorRate: { type: Number, default: 0 },
      p50LatencyMs: { type: Number, default: 0 },
      p95LatencyMs: { type: Number, default: 0 },
      p99LatencyMs: { type: Number, default: 0 },
    },
    business: {
      hrEvents: { type: Number, default: 0 },
      financialEvents: { type: Number, default: 0 },
      outboxDelivered: { type: Number, default: 0 },
      outboxFailed: { type: Number, default: 0 },
      syncReceived: { type: Number, default: 0 },
      syncFailed: { type: Number, default: 0 },
    },
    infrastructure: {
      autoRecoveries: { type: Number, default: 0 },
      actionsExecuted: { type: Number, default: 0 },
      groqTokens: { type: Number, default: 0 },
      claudeTokens: { type: Number, default: 0 },
      backupsOk: { type: Number, default: 0 },
      backupsFailed: { type: Number, default: 0 },
      avgDiskPercent: { type: Number, default: 0 },
      peakMemPercent: { type: Number, default: 0 },
    },
    cost: {
      groqUsd: { type: Number, default: 0 },
      claudeUsd: { type: Number, default: 0 },
      totalUsd: { type: Number, default: 0 },
    },
  },
  { collection: "analytics_daily", timestamps: false }
);

export const AnalyticsDaily = mongoose.model<IAnalyticsDaily>("AnalyticsDaily", AnalyticsDailySchema);
