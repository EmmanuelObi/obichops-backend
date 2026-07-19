import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { REMINDER_TYPES } from "../types/reminders.js";

const reminderLogSchema = new Schema(
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
    type: { type: String, enum: REMINDER_TYPES, required: true },
    sentAt: { type: Date, required: true, default: Date.now },
    recipientCount: { type: Number, required: true, min: 0 },
  },
  { timestamps: false },
);

reminderLogSchema.index({ menuWeekId: 1, type: 1 }, { unique: true });

export type ReminderLogDocument = InferSchemaType<typeof reminderLogSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const ReminderLog: Model<ReminderLogDocument> =
  mongoose.models.ReminderLog ??
  mongoose.model<ReminderLogDocument>("ReminderLog", reminderLogSchema);
