import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { DAYS_OF_WEEK } from "../types/days.js";
import { MENU_ITEM_KINDS } from "../types/menuItem.js";

const menuItemSchema = new Schema(
  {
    workspaceId: {
      type: Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
      index: true,
    },
    vendorId: {
      type: Schema.Types.ObjectId,
      ref: "Vendor",
      required: true,
      index: true,
    },
    dayOfWeek: {
      type: String,
      enum: DAYS_OF_WEEK,
      required: true,
    },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: "" },
    priceCents: { type: Number, required: true, min: 0 },
    itemKind: {
      type: String,
      enum: MENU_ITEM_KINDS,
      default: "FOOD",
    },
    packsRequired: { type: Number, min: 0, default: 0 },
    isAvailable: { type: Boolean, default: true },
  },
  { timestamps: { createdAt: false, updatedAt: true } },
);

menuItemSchema.index({ vendorId: 1, dayOfWeek: 1, isAvailable: 1 });

export type MenuItemDocument = InferSchemaType<typeof menuItemSchema> & {
  _id: mongoose.Types.ObjectId;
  updatedAt: Date;
};

export const MenuItem: Model<MenuItemDocument> =
  mongoose.models.MenuItem ??
  mongoose.model<MenuItemDocument>("MenuItem", menuItemSchema);
