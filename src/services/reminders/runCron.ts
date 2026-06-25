import { DateTime } from "luxon";
import { getEmailAdapter } from "../../email/factory.js";
import {
  MenuWeek,
  Order,
  ReminderLog,
  User,
  Workspace,
} from "../../models/index.js";
import type { MenuWeekDocument } from "../../models/MenuWeek.js";
import {
  REMINDER_FRIDAY_EVENING_HOUR,
  REMINDER_FRIDAY_EVENING_MINUTE,
  REMINDER_SATURDAY_MORNING_HOUR,
  REMINDER_SATURDAY_MORNING_MINUTE,
  type ReminderType,
} from "../../types/reminders.js";
import { weekDateRangeLabel } from "../export/loadExportData.js";
import { getWorkspaceTimezone } from "../menuWeekService.js";

const CRON_WINDOW_MINUTES = 15;

function isDueWithinWindow(
  target: Date,
  now: Date,
  windowMinutes = CRON_WINDOW_MINUTES,
): boolean {
  const targetMs = target.getTime();
  const nowMs = now.getTime();
  return nowMs >= targetMs && nowMs < targetMs + windowMinutes * 60 * 1000;
}

function localTimeOnCloseDay(
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
function fridayEveningNudgeAt(closesAt: Date, timezone: string): Date {
  const closeDay = DateTime.fromJSDate(closesAt, { zone: "utc" }).setZone(timezone);
  const friday = closeDay.minus({ days: 1 });
  return friday
    .set({
      hour: REMINDER_FRIDAY_EVENING_HOUR,
      minute: REMINDER_FRIDAY_EVENING_MINUTE,
      second: 0,
      millisecond: 0,
    })
    .toUTC()
    .toJSDate();
}

async function getPendingStaffEmails(
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
    ).map((o) => o.userId.toString()),
  );

  return staffUsers
    .filter((user) => !submittedUserIds.has(user._id.toString()))
    .map((user) => user.email);
}

async function logReminder(
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

async function sendReminderEmails(
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

async function processWeekReminders(
  week: MenuWeekDocument,
  workspaceId: string,
  timezone: string,
  settings: {
    reminderWindowOpen?: boolean;
    reminderPendingNudge?: boolean;
    reminderFinalNudge?: boolean;
  },
  now: Date,
): Promise<void> {
  if (week.status !== "OPEN" || now >= week.orderWindowClosesAt) {
    return;
  }

  const weekLabel = weekDateRangeLabel(week.weekStart, timezone);
  const closesLabel = DateTime.fromJSDate(week.orderWindowClosesAt, { zone: "utc" })
    .setZone(timezone)
    .toFormat("ccc d LLL, h:mm a");

  // Friday #1 — when the order window opens (default Fri 2:00 PM). Staff who have not ordered only.
  if (
    settings.reminderWindowOpen !== false &&
    isDueWithinWindow(week.orderWindowOpensAt, now)
  ) {
    const logged = await logReminder(workspaceId, week._id.toString(), "FRIDAY_REMINDER_1", 0);
    if (logged) {
      const recipients = await getPendingStaffEmails(workspaceId, week._id.toString());
      await sendReminderEmails(
        recipients,
        `Ordering open — week of ${weekLabel}`,
        `<p>Ordering for the week of <strong>${weekLabel}</strong> is now open.</p><p>Closes ${closesLabel}.</p>`,
        `Ordering for week of ${weekLabel} is now open. Closes ${closesLabel}.`,
      );
      await ReminderLog.updateOne(
        { menuWeekId: week._id, type: "FRIDAY_REMINDER_1" },
        { recipientCount: recipients.length },
      );
    }
  }

  // Friday #2 — evening nudge (default 8:00 PM). Staff who have not ordered only.
  const fridayEveningAt = fridayEveningNudgeAt(week.orderWindowClosesAt, timezone);
  if (
    settings.reminderPendingNudge !== false &&
    isDueWithinWindow(fridayEveningAt, now)
  ) {
    const logged = await logReminder(workspaceId, week._id.toString(), "FRIDAY_REMINDER_2", 0);
    if (logged) {
      const recipients = await getPendingStaffEmails(workspaceId, week._id.toString());
      await sendReminderEmails(
        recipients,
        `Reminder: order for week of ${weekLabel}`,
        `<p>You haven't placed your meal order yet. Ordering closes <strong>${closesLabel}</strong>.</p>`,
        `You haven't ordered yet. Closes ${closesLabel}.`,
      );
      await ReminderLog.updateOne(
        { menuWeekId: week._id, type: "FRIDAY_REMINDER_2" },
        { recipientCount: recipients.length },
      );
    }
  }

  // Saturday morning — final nudge (default 8:00 AM, before typical 10:00 AM close).
  const saturdayMorningAt = localTimeOnCloseDay(
    week.orderWindowClosesAt,
    timezone,
    REMINDER_SATURDAY_MORNING_HOUR,
    REMINDER_SATURDAY_MORNING_MINUTE,
  );
  if (
    settings.reminderFinalNudge !== false &&
    isDueWithinWindow(saturdayMorningAt, now)
  ) {
    const logged = await logReminder(workspaceId, week._id.toString(), "SATURDAY_REMINDER", 0);
    if (logged) {
      const recipients = await getPendingStaffEmails(workspaceId, week._id.toString());
      await sendReminderEmails(
        recipients,
        `Final reminder: order by ${closesLabel}`,
        `<p>Final reminder — please place your order for the week of <strong>${weekLabel}</strong> before ordering closes at <strong>${closesLabel}</strong>.</p>`,
        `Final reminder: order before ${closesLabel}.`,
      );
      await ReminderLog.updateOne(
        { menuWeekId: week._id, type: "SATURDAY_REMINDER" },
        { recipientCount: recipients.length },
      );
    }
  }
}

async function transitionMenuWeekStatuses(now: Date): Promise<number> {
  let transitions = 0;

  const toOpen = await MenuWeek.find({
    status: "DRAFT",
    orderWindowOpensAt: { $lte: now },
    orderWindowClosesAt: { $gt: now },
  });
  for (const week of toOpen) {
    week.status = "OPEN";
    await week.save();
    transitions += 1;
  }

  const toClose = await MenuWeek.find({
    status: "OPEN",
    orderWindowClosesAt: { $lte: now },
  });
  for (const week of toClose) {
    week.status = "CLOSED";
    await week.save();
    transitions += 1;
  }

  return transitions;
}

export async function runCronJob(now = new Date()): Promise<{
  transitions: number;
  workspacesProcessed: number;
}> {
  const transitions = await transitionMenuWeekStatuses(now);
  const workspaces = await Workspace.find({ isActive: true });
  let workspacesProcessed = 0;

  for (const workspace of workspaces) {
    const workspaceId = workspace._id.toString();
    const timezone = await getWorkspaceTimezone(workspaceId);
    const weeks = await MenuWeek.find({
      workspaceId,
      status: { $in: ["DRAFT", "OPEN"] },
    });

    for (const week of weeks) {
      await processWeekReminders(
        week,
        workspaceId,
        timezone,
        {
          reminderWindowOpen: workspace.settings?.reminderWindowOpen,
          reminderPendingNudge: workspace.settings?.reminderPendingNudge,
          reminderFinalNudge: workspace.settings?.reminderFinalNudge,
        },
        now,
      );
    }

    const recentWeeks = await MenuWeek.find({
      workspaceId,
      orderWindowOpensAt: {
        $gte: new Date(now.getTime() - CRON_WINDOW_MINUTES * 60 * 1000),
        $lte: now,
      },
    });
    for (const week of recentWeeks) {
      if (week.status === "OPEN") {
        await processWeekReminders(
          week,
          workspaceId,
          timezone,
          {
            reminderWindowOpen: workspace.settings?.reminderWindowOpen,
            reminderPendingNudge: workspace.settings?.reminderPendingNudge,
            reminderFinalNudge: workspace.settings?.reminderFinalNudge,
          },
          now,
        );
      }
    }

    workspacesProcessed += 1;
  }

  return { transitions, workspacesProcessed };
}
