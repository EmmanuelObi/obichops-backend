import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const vendorReviewSchema = new Schema(
  {
    workspaceId: {
      type: Schema.Types.ObjectId,
      ref: "Chopspace",
      required: true,
      index: true,
    },
    menuWeekId: {
      type: Schema.Types.ObjectId,
      ref: "MenuWeek",
      required: true,
    },
    vendorId: {
      type: Schema.Types.ObjectId,
      ref: "Vendor",
      required: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, trim: true, maxlength: 500 },
  },
  { timestamps: true },
);

vendorReviewSchema.index({ userId: 1, menuWeekId: 1 }, { unique: true });
vendorReviewSchema.index({ vendorId: 1, workspaceId: 1 });

export type VendorReviewDocument = InferSchemaType<typeof vendorReviewSchema> & {
  _id: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const VendorReview: Model<VendorReviewDocument> =
  mongoose.models.VendorReview ??
  mongoose.model<VendorReviewDocument>("VendorReview", vendorReviewSchema);
