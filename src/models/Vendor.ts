import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const vendorSchema = new Schema(
  {
    workspaceId: {
      type: Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

vendorSchema.index({ workspaceId: 1, name: 1 });

export type VendorDocument = InferSchemaType<typeof vendorSchema> & {
  _id: mongoose.Types.ObjectId;
  createdAt: Date;
};

export const Vendor: Model<VendorDocument> =
  mongoose.models.Vendor ??
  mongoose.model<VendorDocument>("Vendor", vendorSchema);
