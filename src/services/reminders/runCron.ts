import { DateTime } from "luxon";
import { getEmailAdapter } from "../../email/factory.js";
import {
  AllowedEmail,
  MenuWeek,
  Order,
  ReminderLog,
  User,
  Workspace,
} from "../../models/index.js";
import type { MenuWeekDocument } from "../../models/MenuWeek.js";
import type { ReminderType } from "../../types/reminders.js";
import { weekDateRangeLabel } from "../export/loadExportData.js";
import { getWorkspaceTimezone } from "../menuWeekService.js";

const CRON_WINDOW_MINUTES = 15;

function isDueWithinWindow(target: Date, now: Date, windowMinutes = CRON_WINDOW_MINUTES): boolean {
  const targetMs = target.getTime();
  const nowMs = now.getTime();
  return nowMs >= targetMs && nowMs < targetMs + windowMinutes * 60 * 1000;
}

function nudgeTimeOnCloseDay(
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

async function getStaffEmails(workspaceId: string): Promise<string[]> {
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
  const weekLabel = weekDateRangeLabel(week.weekStart, timezone);
  const closesLabel = DateTime.fromJSDate(week.orderWindowClosesAt, { zone: "utc" })
    .setZone(timezone)
    .toFormat("ccc d LLL, h:mm a");

  if (
    settings.reminderWindowOpen !== false &&
    week.status === "OPEN" &&
    isDueWithinWindow(week.orderWindowOpensAt, now)
  ) {
    const logged = await logReminder(workspaceId, week._id.toString(), "WINDOW_OPEN", 0);
    if (logged) {
      const recipients = await getStaffEmails(workspaceId);
      await sendReminderEmails(
        recipients,
        `Ordering open — week of ${weekLabel}`,
        `<p>Ordering for the week of <strong>${weekLabel}</strong> is now open.</p><p>Closes ${closesLabel}.</p>`,
        `Ordering for week of ${weekLabel} is now open. Closes ${closesLabel}.`,
      );
      await ReminderLog.updateOne(
        { menuWeekId: week._id, type: "WINDOW_OPEN" },
        { recipientCount: recipients.length },
      );
    }
  }

  const pendingNudgeAt = nudgeTimeOnCloseDay(
    week.orderWindowClosesAt,
    timezone,
    8,
    0,
  );
  if (
    settings.reminderPendingNudge !== false &&
    (week.status === "OPEN" || week.status === "DRAFT") &&
    isDueWithinWindow(pendingNudgeAt, now)
  ) {
    const logged = await logReminder(workspaceId, week._id.toString(), "PENDING_NUDGE", 0);
    if (logged) {
      const recipients = await getPendingStaffEmails(workspaceId, week._id.toString());
      await sendReminderEmails(
        recipients,
        `Reminder: order for week of ${weekLabel}`,
        `<p>You haven't placed your meal order yet. Ordering closes at <strong>${closesLabel}</strong>.</p>`,
        `You haven't ordered yet. Closes ${closesLabel}.`,
      );
      await ReminderLog.updateOne(
        { menuWeekId: week._id, type: "PENDING_NUDGE" },
        { recipientCount: recipients.length },
      );
    }
  }

  const finalNudgeAt = nudgeTimeOnCloseDay(
    week.orderWindowClosesAt,
    timezone,
    9,
    30,
  );
  if (
    settings.reminderFinalNudge !== false &&
    (week.status === "OPEN" || week.status === "DRAFT") &&
    isDueWithinWindow(finalNudgeAt, now)
  ) {
    const logged = await logReminder(workspaceId, week._id.toString(), "FINAL_NUDGE", 0);
    if (logged) {
      const recipients = await getPendingStaffEmails(workspaceId, week._id.toString());
      await sendReminderEmails(
        recipients,
        `Final reminder: 30 minutes left`,
        `<p>Final reminder — you have <strong>30 minutes</strong> left to order for the week of ${weekLabel}. Closes ${closesLabel}.</p>`,
        `Final reminder: 30 minutes left. Closes ${closesLabel}.`,
      );
      await ReminderLog.updateOne(
        { menuWeekId: week._id, type: "FINAL_NUDGE" },
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
