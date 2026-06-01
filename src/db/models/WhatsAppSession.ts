import mongoose, { Document, Schema, Types } from "mongoose";

export interface IWhatsAppSession extends Document {
  incidentId: Types.ObjectId | null;
  messageSid: string;
  sentAt: Date;
  expiresAt: Date;
  awaitingReply: boolean;
  proposedAction: string;
  proposedParams: Record<string, unknown>;
  reply: string | null;
  repliedAt: Date | null;
}

const WhatsAppSessionSchema = new Schema<IWhatsAppSession>(
  {
    incidentId: { type: Schema.Types.ObjectId, ref: "Incident", default: null },
    messageSid: { type: String, required: true },
    sentAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
    awaitingReply: { type: Boolean, default: true },
    proposedAction: { type: String, required: true },
    proposedParams: { type: Schema.Types.Mixed, default: {} },
    reply: { type: String, default: null },
    repliedAt: { type: Date, default: null },
  },
  { collection: "whatsapp_sessions", timestamps: false }
);

WhatsAppSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
WhatsAppSessionSchema.index({ awaitingReply: 1, expiresAt: 1 });

export const WhatsAppSession = mongoose.model<IWhatsAppSession>(
  "WhatsAppSession",
  WhatsAppSessionSchema
);
