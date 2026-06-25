import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { DAYS_OF_WEEK } from "../types/days.js";

export const MENU_WEEK_STATUSES = ["DRAFT", "OPEN", "CLOSED"] as const;
export type MenuWeekStatus = (typeof MENU_WEEK_STATUSES)[number];

const menuWeekSchema = new Schema(
  {
    workspaceId: {
      type: Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
      index: true,
    },
    weekStart: { type: Date, required: true },
    activeVendorId: {
      type: Schema.Types.ObjectId,
      ref: "Vendor",
      required: true,
    },
    orderableDays: {
      type: [{ type: String, enum: DAYS_OF_WEEK }],
      required: true,
    },
    maxOrderAmountCents: { type: Number, required: true, min: 0 },
    maxOrderDaysPerStaff: { type: Number, required: true, min: 1, default: 2 },
    orderWindowOpensAt: { type: Date, required: true },
    orderWindowClosesAt: { type: Date, required: true },
    status: {
      type: String,
      enum: MENU_WEEK_STATUSES,
      default: "DRAFT",
      index: true,
    },
  },
  { timestamps: true },
);

menuWeekSchema.index({ workspaceId: 1, weekStart: 1 }, { unique: true });
menuWeekSchema.index({ workspaceId: 1, status: 1 });

export type MenuWeekDocument = InferSchemaType<typeof menuWeekSchema> & {
  _id: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const MenuWeek: Model<MenuWeekDocument> =
  mongoose.models.MenuWeek ??
  mongoose.model<MenuWeekDocument>("MenuWeek", menuWeekSchema);
