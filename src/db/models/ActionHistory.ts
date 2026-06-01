import mongoose, { Document, Schema, Types } from "mongoose";

export interface IActionHistory extends Document {
  incidentId: Types.ObjectId | null;
  executedAt: Date;
  toolName: string;
  parameters: Record<string, unknown>;
  authorizedBy: "autonomous" | "whatsapp_reply" | "email_reply" | "ui_button" | "schedule";
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  success: boolean;
  rollbackAvailable: boolean;
  rolledBackAt: Date | null;
}

const ActionHistorySchema = new Schema<IActionHistory>(
  {
    incidentId: { type: Schema.Types.ObjectId, ref: "Incident", default: null, index: true },
    executedAt: { type: Date, default: Date.now, index: true },
    toolName: { type: String, required: true, index: true },
    parameters: { type: Schema.Types.Mixed, default: {} },
    authorizedBy: {
      type: String,
      enum: ["autonomous", "whatsapp_reply", "email_reply", "ui_button", "schedule"],
      required: true,
    },
    stdout: { type: String, default: "" },
    stderr: { type: String, default: "" },
    exitCode: { type: Number, default: 0 },
    durationMs: { type: Number, default: 0 },
    success: { type: Boolean, default: false },
    rollbackAvailable: { type: Boolean, default: false },
    rolledBackAt: { type: Date, default: null },
  },
  { collection: "action_history", timestamps: false }
);

export const ActionHistory = mongoose.model<IActionHistory>("ActionHistory", ActionHistorySchema);
