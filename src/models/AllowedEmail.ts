import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const allowedEmailSchema = new Schema(
  {
    workspaceId: {
      type: Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
      index: true,
    },
    email: { type: String, required: true, lowercase: true, trim: true },
    role: {
      type: String,
      enum: ["ADMIN", "STAFF"],
      default: "STAFF",
    },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

allowedEmailSchema.index({ workspaceId: 1, email: 1 }, { unique: true });

export type AllowedEmailDocument = InferSchemaType<typeof allowedEmailSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const AllowedEmail: Model<AllowedEmailDocument> =
  mongoose.models.AllowedEmail ??
  mongoose.model<AllowedEmailDocument>("AllowedEmail", allowedEmailSchema);
