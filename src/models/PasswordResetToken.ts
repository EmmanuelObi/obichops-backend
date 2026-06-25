import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const passwordResetTokenSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true, index: true },
    usedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export type PasswordResetTokenDocument = InferSchemaType<
  typeof passwordResetTokenSchema
> & {
  _id: mongoose.Types.ObjectId;
};

export const PasswordResetToken: Model<PasswordResetTokenDocument> =
  mongoose.models.PasswordResetToken ??
  mongoose.model<PasswordResetTokenDocument>(
    "PasswordResetToken",
    passwordResetTokenSchema,
  );
