import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { DAYS_OF_WEEK } from "../types/days.js";

export const ORDER_STATUSES = ["DRAFT", "SUBMITTED"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

const lineItemSchema = new Schema(
  {
    menuItemId: {
      type: Schema.Types.ObjectId,
      ref: "MenuItem",
      required: true,
    },
    dayOfWeek: { type: String, enum: DAYS_OF_WEEK, required: true },
    quantity: { type: Number, required: true, min: 0.5 },
    unitPriceCentsSnapshot: { type: Number, min: 0 },
  },
  { _id: false },
);

const dayNoteSchema = new Schema(
  {
    dayOfWeek: { type: String, enum: DAYS_OF_WEEK, required: true },
    note: { type: String, trim: true, required: true },
  },
  { _id: false },
);

const orderSchema = new Schema(
  {
    workspaceId: {
      type: Schema.Types.ObjectId,
      ref: "Chopspace",
      required: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    placedForName: { type: String, trim: true },
    placedForNameKey: { type: String, trim: true, lowercase: true },
    placedByUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    menuWeekId: {
      type: Schema.Types.ObjectId,
      ref: "MenuWeek",
      required: true,
    },
    status: {
      type: String,
      enum: ORDER_STATUSES,
      default: "DRAFT",
    },
    lineItems: { type: [lineItemSchema], default: [] },
    dayNotes: { type: [dayNoteSchema], default: [] },
    totalCents: { type: Number, default: 0, min: 0 },
    companyCoveredCents: { type: Number, default: 0, min: 0 },
    excessCents: { type: Number, default: 0, min: 0 },
    excessAcknowledged: { type: Boolean, default: false },
    excessAcknowledgedAt: { type: Date },
    excessPaymentProofS3Key: { type: String },
    excessPaymentProofFilename: { type: String },
    excessPaymentProofMimeType: { type: String },
    excessPaymentProofUploadedAt: { type: Date },
    excessPaidAt: { type: Date },
    excessPaidByUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    submittedAt: { type: Date },
  },
  { timestamps: true },
);

orderSchema.index(
  { userId: 1, menuWeekId: 1 },
  { unique: true, partialFilterExpression: { userId: { $type: "objectId" } } },
);
orderSchema.index(
  { menuWeekId: 1, placedForNameKey: 1 },
  { unique: true, partialFilterExpression: { placedForNameKey: { $type: "string" } } },
);
orderSchema.index({ menuWeekId: 1, excessCents: 1 });

export type LineItemSubdocument = InferSchemaType<typeof lineItemSchema>;
export type OrderDocument = InferSchemaType<typeof orderSchema> & {
  _id: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const Order: Model<OrderDocument> =
  mongoose.models.Order ?? mongoose.model<OrderDocument>("Order", orderSchema);
