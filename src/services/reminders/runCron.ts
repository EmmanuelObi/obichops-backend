import { DateTime } from "luxon";
import { MenuWeek, ReminderLog, Chopspace, type WorkspaceDocument } from "../../models/index.js";
import type { MenuWeekDocument } from "../../models/MenuWeek.js";
import {
  REMINDER_SATURDAY_MORNING_HOUR,
  REMINDER_SATURDAY_MORNING_MINUTE,
} from "../../types/reminders.js";
import { weekDateRangeLabel } from "../export/loadExportData.js";
import { getWorkspaceTimezone } from "../menuWeekService.js";
import {
  fridayAfternoonNudgeAt,
  fridayEveningNudgeAt,
  getPendingStaffEmails,
  isDueWithinWindow,
  localTimeOnCloseDay,
  logReminder,
  orderingCtaHtml,
  orderingCtaText,
  sendReminders,
} from "./reminderUtils.js";
import { sendOrderingOpenIfNeeded } from "./sendOrderingOpen.js";

export interface WorkspaceReminderSettings {
  reminderWindowOpen?: boolean;
  reminderPendingNudge?: boolean;
  reminderFridayEvening?: boolean;
  reminderFinalNudge?: boolean;
}

async function processNudges(
  week: MenuWeekDocument,
  workspaceId: string,
  timezone: string,
  settings: WorkspaceReminderSettings,
  now: Date,
): Promise<void> {
  if (week.status !== "OPEN" || now >= week.orderWindowClosesAt) {
    return;
  }

  const weekLabel = weekDateRangeLabel(week.weekStart, timezone);
  const closesLabel = DateTime.fromJSDate(week.orderWindowClosesAt, { zone: "utc" })
    .setZone(timezone)
    .toFormat("ccc d LLL, h:mm a");
  const menuWeekId = week._id.toString();

  const fridayAfternoonAt = fridayAfternoonNudgeAt(week.orderWindowClosesAt, timezone);
  if (
    settings.reminderPendingNudge !== false &&
    isDueWithinWindow(fridayAfternoonAt, now)
  ) {
    const logged = await logReminder(workspaceId, menuWeekId, "FRIDAY_NUDGE_1", 0);
    if (logged) {
      const recipients = await getPendingStaffEmails(workspaceId, menuWeekId);
      await sendReminders({
        workspaceId,
        recipients,
        type: "FRIDAY_NUDGE_1",
        subject: `Reminder: order for week of ${weekLabel}`,
        html:
          `<p>You haven't placed your meal order yet. Ordering closes <strong>${closesLabel}</strong>.</p>` +
          orderingCtaHtml(),
        text: [
          `You haven't ordered yet. Closes ${closesLabel}.`,
          orderingCtaText(),
        ].join("\n"),
        pushTitle: "Reminder: place your order",
        pushBody: `Ordering closes ${closesLabel}.`,
      });
      await ReminderLog.updateOne(
        { menuWeekId: week._id, type: "FRIDAY_NUDGE_1" },
        { recipientCount: recipients.length },
      );
    }
  }

  const fridayEveningAt = fridayEveningNudgeAt(week.orderWindowClosesAt, timezone);
  if (
    settings.reminderFridayEvening !== false &&
    isDueWithinWindow(fridayEveningAt, now)
  ) {
    const logged = await logReminder(workspaceId, menuWeekId, "FRIDAY_NUDGE_2", 0);
    if (logged) {
      const recipients = await getPendingStaffEmails(workspaceId, menuWeekId);
      await sendReminders({
        workspaceId,
        recipients,
        type: "FRIDAY_NUDGE_2",
        subject: `Reminder: order for week of ${weekLabel}`,
        html:
          `<p>You haven't placed your meal order yet. Ordering closes <strong>${closesLabel}</strong>.</p>` +
          orderingCtaHtml(),
        text: [
          `You haven't ordered yet. Closes ${closesLabel}.`,
          orderingCtaText(),
        ].join("\n"),
        pushTitle: "Reminder: place your order",
        pushBody: `Ordering closes ${closesLabel}.`,
      });
      await ReminderLog.updateOne(
        { menuWeekId: week._id, type: "FRIDAY_NUDGE_2" },
        { recipientCount: recipients.length },
      );
    }
  }

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
    const logged = await logReminder(workspaceId, menuWeekId, "SATURDAY_NUDGE", 0);
    if (logged) {
      const recipients = await getPendingStaffEmails(workspaceId, menuWeekId);
      await sendReminders({
        workspaceId,
        recipients,
        type: "SATURDAY_NUDGE",
        subject: `Final reminder: order by ${closesLabel}`,
        html:
          `<p>Final reminder — please place your order for the week of <strong>${weekLabel}</strong> before ordering closes at <strong>${closesLabel}</strong>.</p>` +
          orderingCtaHtml(),
        text: [
          `Final reminder: order before ${closesLabel}.`,
          orderingCtaText(),
        ].join("\n"),
        pushTitle: "Final reminder",
        pushBody: `Order before ${closesLabel}.`,
      });
      await ReminderLog.updateOne(
        { menuWeekId: week._id, type: "SATURDAY_NUDGE" },
        { recipientCount: recipients.length },
      );
    }
  }
}

async function processScheduledOrderingOpen(
  week: MenuWeekDocument,
  workspaceId: string,
  timezone: string,
  settings: WorkspaceReminderSettings,
  now: Date,
): Promise<void> {
  if (week.status !== "OPEN" || now >= week.orderWindowClosesAt) {
    return;
  }

  if (isDueWithinWindow(week.orderWindowOpensAt, now)) {
    await sendOrderingOpenIfNeeded({
      workspaceId,
      week,
      timezone,
      settings,
    });
  }
}

async function transitionMenuWeekStatuses(now: Date): Promise<MenuWeekDocument[]> {
  const opened: MenuWeekDocument[] = [];

  const toOpen = await MenuWeek.find({
    status: "DRAFT",
    orderWindowOpensAt: { $lte: now },
    orderWindowClosesAt: { $gt: now },
  });
  for (const week of toOpen) {
    week.status = "OPEN";
    await week.save();
    opened.push(week);
  }

  const toClose = await MenuWeek.find({
    status: "OPEN",
    orderWindowClosesAt: { $lte: now },
  });
  for (const week of toClose) {
    week.status = "CLOSED";
    await week.save();
  }

  return opened;
}

function workspaceReminderSettings(
  chopspace: WorkspaceDocument,
): WorkspaceReminderSettings {
  return {
    reminderWindowOpen: chopspace.settings?.reminderWindowOpen,
    reminderPendingNudge: chopspace.settings?.reminderPendingNudge,
    reminderFridayEvening: chopspace.settings?.reminderFridayEvening,
    reminderFinalNudge: chopspace.settings?.reminderFinalNudge,
  };
}

export async function runCronJob(now = new Date()): Promise<{
  transitions: number;
  workspacesProcessed: number;
}> {
  const autoOpened = await transitionMenuWeekStatuses(now);
  const workspaces = await Chopspace.find({ isActive: true });
  let workspacesProcessed = 0;

  for (const chopspace of workspaces) {
    const workspaceId = chopspace._id.toString();
    const timezone = await getWorkspaceTimezone(workspaceId);
    const settings = workspaceReminderSettings(chopspace);

    for (const week of autoOpened) {
      if (week.workspaceId.toString() !== workspaceId) continue;
      await sendOrderingOpenIfNeeded({ workspaceId, week, timezone, settings });
    }

    const weeks = await MenuWeek.find({
      workspaceId,
      status: { $in: ["DRAFT", "OPEN"] },
    });

    for (const week of weeks) {
      await processScheduledOrderingOpen(week, workspaceId, timezone, settings, now);
      await processNudges(week, workspaceId, timezone, settings, now);
    }

    workspacesProcessed += 1;
  }

  return { transitions: autoOpened.length, workspacesProcessed };
}
