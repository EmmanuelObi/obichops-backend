import { DateTime } from "luxon";
import { getEmailAdapter } from "../../email/factory.js";
import { AllowedEmail, Order, ReminderLog, User } from "../../models/index.js";
import {
  CRON_WINDOW_MINUTES,
  REMINDER_FRIDAY_AFTERNOON_HOUR,
  REMINDER_FRIDAY_AFTERNOON_MINUTE,
  REMINDER_FRIDAY_EVENING_HOUR,
  REMINDER_FRIDAY_EVENING_MINUTE,
  type ReminderType,
} from "../../types/reminders.js";

export function isDueWithinWindow(
  target: Date,
  now: Date,
  windowMinutes = CRON_WINDOW_MINUTES,
): boolean {
  const targetMs = target.getTime();
  const nowMs = now.getTime();
  return nowMs >= targetMs && nowMs < targetMs + windowMinutes * 60 * 1000;
}

export function localTimeOnCloseDay(
  closesAt: Date,
  timezone: string,
  hour: number,
  minute: number,
): Date {
  const closeDay = DateTime.fromJSDate(closesAt, { zone: "utc" }).setZone(timezone);
  return closeDay
    .set({ hour, minute, second: 0, millisecond: 0 })
    .toUTC()
    .toJSDate();
}

/** Friday before the Saturday close day (ordering window's Friday). */
function fridayBeforeCloseDay(closesAt: Date, timezone: string): DateTime {
  const closeDay = DateTime.fromJSDate(closesAt, { zone: "utc" }).setZone(timezone);
  return closeDay.minus({ days: 1 });
}

export function fridayAfternoonNudgeAt(closesAt: Date, timezone: string): Date {
  return fridayBeforeCloseDay(closesAt, timezone)
    .set({
      hour: REMINDER_FRIDAY_AFTERNOON_HOUR,
      minute: REMINDER_FRIDAY_AFTERNOON_MINUTE,
      second: 0,
      millisecond: 0,
    })
    .toUTC()
    .toJSDate();
}

export function fridayEveningNudgeAt(closesAt: Date, timezone: string): Date {
  return fridayBeforeCloseDay(closesAt, timezone)
    .set({
      hour: REMINDER_FRIDAY_EVENING_HOUR,
      minute: REMINDER_FRIDAY_EVENING_MINUTE,
      second: 0,
      millisecond: 0,
    })
    .toUTC()
    .toJSDate();
}

export async function getStaffEmails(workspaceId: string): Promise<string[]> {
  const users = await User.find({ workspaceId, role: "STAFF", isActive: true });
  if (users.length > 0) {
    return users.map((u) => u.email);
  }
  const allowed = await AllowedEmail.find({
    workspaceId,
    role: "STAFF",
    isActive: true,
  });
  return allowed.map((a) => a.email);
}

export async function getPendingStaffEmails(
  workspaceId: string,
  menuWeekId: string,
): Promise<string[]> {
  const staffUsers = await User.find({ workspaceId, role: "STAFF", isActive: true });
  const submittedUserIds = new Set(
    (
      await Order.find({
        workspaceId,
        menuWeekId,
        status: "SUBMITTED",
      })
    ).map((o) => o.userId?.toString()).filter((id): id is string => Boolean(id)),
  );

  return staffUsers
    .filter((user) => !submittedUserIds.has(user._id.toString()))
    .map((user) => user.email);
}

export async function logReminder(
  workspaceId: string,
  menuWeekId: string,
  type: ReminderType,
  recipientCount: number,
): Promise<boolean> {
  try {
    await ReminderLog.create({
      workspaceId,
      menuWeekId,
      type,
      sentAt: new Date(),
      recipientCount,
    });
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === 11000) {
      return false;
    }
    throw error;
  }
}

export async function sendReminderEmails(
  recipients: string[],
  subject: string,
  html: string,
  text: string,
): Promise<void> {
  if (recipients.length === 0) return;
  const email = getEmailAdapter();
  for (const to of recipients) {
    await email.send({ to, subject, html, text });
  }
}
