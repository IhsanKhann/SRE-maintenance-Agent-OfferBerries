import mongoose, { Schema, type Document } from "mongoose";

export interface IEmailSession extends Document {
  incidentId: mongoose.Types.ObjectId | null;
  token: string;
  sentAt: Date;
  expiresAt: Date;
  awaitingReply: boolean;
  reply: string | null;
  repliedAt: Date | null;
  proposedAction: string;
  proposedParams: Record<string, unknown>;
  toEmail: string;
}

const EmailSessionSchema = new Schema<IEmailSession>(
  {
    incidentId:     { type: Schema.Types.ObjectId, ref: "Incident", default: null },
    token:          { type: String, required: true, unique: true, index: true },
    sentAt:         { type: Date, required: true },
    expiresAt:      { type: Date, required: true },
    awaitingReply:  { type: Boolean, default: true },
    reply:          { type: String, default: null },
    repliedAt:      { type: Date, default: null },
    proposedAction: { type: String, required: true },
    proposedParams: { type: Schema.Types.Mixed, default: {} },
    toEmail:        { type: String, required: true },
  },
  { collection: "email_sessions", timestamps: false }
);

EmailSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const EmailSession = mongoose.model<IEmailSession>("EmailSession", EmailSessionSchema);
