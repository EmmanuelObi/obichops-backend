import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

export const DISPATCH_FORMATS = ["PDF", "CSV", "DOCX"] as const;
export type DispatchFormat = (typeof DISPATCH_FORMATS)[number];

const vendorDispatchSchema = new Schema(
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
      index: true,
    },
    vendorId: {
      type: Schema.Types.ObjectId,
      ref: "Vendor",
      required: true,
    },
    format: { type: String, enum: DISPATCH_FORMATS, required: true },
    sentAt: { type: Date, required: true, default: Date.now },
    sentByUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: false },
);

export type VendorDispatchDocument = InferSchemaType<typeof vendorDispatchSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const VendorDispatch: Model<VendorDispatchDocument> =
  mongoose.models.VendorDispatch ??
  mongoose.model<VendorDispatchDocument>("VendorDispatch", vendorDispatchSchema);
