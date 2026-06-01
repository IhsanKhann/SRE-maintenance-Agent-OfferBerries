import mongoose, { Document, Schema, Types } from "mongoose";

export type IncidentSeverity = "p1" | "p2" | "p3";
export type IncidentStatus = "open" | "investigating" | "resolved" | "escalated";
export type IncidentSource = "prometheus" | "loki" | "docker" | "bullmq" | "sync" | "manual" | "health";

export interface IIncident extends Document {
  openedAt: Date;
  closedAt: Date | null;
  status: IncidentStatus;
  severity: IncidentSeverity;
  trigger: {
    source: IncidentSource;
    signal: string;
    rawValue: unknown;
    threshold: unknown;
  };
  aiAnalysis: {
    model: string;
    summary: string;
    rootCause: string;
    confidence: number;
    suggestedAction: string;
    tokensUsed: number;
    latencyMs: number;
  } | null;
  actionsExecuted: Types.ObjectId[];
  resolvedBy: "autonomous" | "manual_whatsapp" | "manual_email" | "manual_ui" | "timeout" | null;
  mttrSeconds: number | null;
  tags: string[];
}

const IncidentSchema = new Schema<IIncident>(
  {
    openedAt: { type: Date, default: Date.now, index: true },
    closedAt: { type: Date, default: null },
    status: {
      type: String,
      enum: ["open", "investigating", "resolved", "escalated"],
      default: "open",
      index: true,
    },
    severity: { type: String, enum: ["p1", "p2", "p3"], required: true, index: true },
    trigger: {
      source: { type: String, enum: ["prometheus", "loki", "docker", "bullmq", "sync", "manual", "health"], required: true },
      signal: { type: String, required: true },
      rawValue: { type: Schema.Types.Mixed },
      threshold: { type: Schema.Types.Mixed },
    },
    aiAnalysis: {
      model: String,
      summary: String,
      rootCause: String,
      confidence: Number,
      suggestedAction: String,
      tokensUsed: Number,
      latencyMs: Number,
    },
    actionsExecuted: [{ type: Schema.Types.ObjectId, ref: "ActionHistory" }],
    resolvedBy: { type: String, enum: ["autonomous", "manual_whatsapp", "manual_email", "manual_ui", "timeout", null], default: null },
    mttrSeconds: { type: Number, default: null },
    tags: [String],
  },
  { collection: "incidents", timestamps: false }
);

// Compound index for deduplication queries
IncidentSchema.index({ "trigger.signal": 1, status: 1 });

export const Incident = mongoose.model<IIncident>("Incident", IncidentSchema);
