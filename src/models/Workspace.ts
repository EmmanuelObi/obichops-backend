import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { DAYS_OF_WEEK } from "../types/days.js";
import {
  DEFAULT_MAX_ORDER_AMOUNT_CENTS,
  DEFAULT_ORDERABLE_DAYS,
  DEFAULT_TIMEZONE,
} from "../services/menuWeekWindow.js";

const workspaceSettingsSchema = new Schema(
  {
    timezone: { type: String, default: DEFAULT_TIMEZONE },
    defaultMaxOrderAmountCents: {
      type: Number,
      default: DEFAULT_MAX_ORDER_AMOUNT_CENTS,
    },
    defaultOrderableDays: {
      type: [{ type: String, enum: DAYS_OF_WEEK }],
      default: DEFAULT_ORDERABLE_DAYS,
    },
    reminderWindowOpen: { type: Boolean, default: true }, // ORDERING_OPEN email
    reminderPendingNudge: { type: Boolean, default: true }, // FRIDAY_NUDGE_1 — 5:00 PM
    reminderFridayEvening: { type: Boolean, default: true }, // FRIDAY_NUDGE_2 — 8:00 PM
    reminderFinalNudge: { type: Boolean, default: true }, // SATURDAY_NUDGE — 8:00 AM
    allowedEmailDomains: {
      type: [{ type: String, lowercase: true, trim: true }],
      default: [],
    },
  },
  { _id: false },
);

const workspaceSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    isActive: { type: Boolean, default: true },
    settings: { type: workspaceSettingsSchema, default: () => ({}) },
  },
  { timestamps: true },
);

workspaceSchema.index({ slug: 1 });

export type WorkspaceDocument = InferSchemaType<typeof workspaceSchema> & {
  _id: mongoose.Types.ObjectId;
};

// Keep Mongo collection `workspaces` (legacy name) while exposing Chopspace in code.
export const Chopspace: Model<WorkspaceDocument> =
  mongoose.models.Chopspace ??
  mongoose.model<WorkspaceDocument>("Chopspace", workspaceSchema, "workspaces");
