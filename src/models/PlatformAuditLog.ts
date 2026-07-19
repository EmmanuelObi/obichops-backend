import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

export const PLATFORM_AUDIT_ACTIONS = [
  "WORKSPACE_CREATED",
  "WORKSPACE_SUSPENDED",
  "WORKSPACE_REACTIVATED",
  "WORKSPACE_UPDATED",
  "WORKSPACE_ADMIN_INVITED",
  "WORKSPACE_ENTERED",
  "ONBOARDING_APPROVED",
  "ONBOARDING_REJECTED",
] as const;

export type PlatformAuditAction = (typeof PLATFORM_AUDIT_ACTIONS)[number];

const platformAuditLogSchema = new Schema(
  {
    workspaceId: {
      type: Schema.Types.ObjectId,
      ref: "Chopspace",
      default: null,
      index: true,
    },
    actorUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    actorEmail: { type: String, required: true, lowercase: true, trim: true },
    action: {
      type: String,
      enum: PLATFORM_AUDIT_ACTIONS,
      required: true,
      index: true,
    },
    summary: { type: String, required: true, trim: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

platformAuditLogSchema.index({ createdAt: -1 });

export type PlatformAuditLogDocument = InferSchemaType<
  typeof platformAuditLogSchema
> & {
  _id: mongoose.Types.ObjectId;
  createdAt: Date;
};

export const PlatformAuditLog: Model<PlatformAuditLogDocument> =
  mongoose.models.PlatformAuditLog ??
  mongoose.model<PlatformAuditLogDocument>(
    "PlatformAuditLog",
    platformAuditLogSchema,
  );
