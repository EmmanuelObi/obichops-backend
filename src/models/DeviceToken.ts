import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const deviceTokenSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    workspaceId: {
      type: Schema.Types.ObjectId,
      ref: "Chopspace",
      required: true,
      index: true,
    },
    token: { type: String, required: true, trim: true },
    platform: {
      type: String,
      enum: ["ios", "android", "unknown"],
      default: "unknown",
    },
  },
  { timestamps: true },
);

deviceTokenSchema.index({ token: 1 }, { unique: true });
deviceTokenSchema.index({ userId: 1, workspaceId: 1 });

export type DeviceTokenDocument = InferSchemaType<typeof deviceTokenSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const DeviceToken: Model<DeviceTokenDocument> =
  mongoose.models.DeviceToken ??
  mongoose.model<DeviceTokenDocument>("DeviceToken", deviceTokenSchema);
