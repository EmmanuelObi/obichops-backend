import { DateTime } from "luxon";
import { ReminderLog } from "../../models/index.js";
import type { MenuWeekDocument } from "../../models/MenuWeek.js";
import { weekDateRangeLabel } from "../export/loadExportData.js";
import {
  getStaffEmails,
  logReminder,
  sendReminderEmails,
} from "./reminderUtils.js";

export interface OrderingOpenSettings {
  reminderWindowOpen?: boolean;
}

export async function sendOrderingOpenIfNeeded(input: {
  workspaceId: string;
  week: MenuWeekDocument;
  timezone: string;
  settings: OrderingOpenSettings;
}): Promise<{ sent: boolean; recipientCount: number }> {
  if (input.settings.reminderWindowOpen === false) {
    return { sent: false, recipientCount: 0 };
  }

  if (input.week.status !== "OPEN") {
    return { sent: false, recipientCount: 0 };
  }

  const menuWeekId = input.week._id.toString();
  const weekLabel = weekDateRangeLabel(input.week.weekStart, input.timezone);
  const closesLabel = DateTime.fromJSDate(input.week.orderWindowClosesAt, {
    zone: "utc",
  })
    .setZone(input.timezone)
    .toFormat("ccc d LLL, h:mm a");

  const logged = await logReminder(input.workspaceId, menuWeekId, "ORDERING_OPEN", 0);
  if (!logged) {
    return { sent: false, recipientCount: 0 };
  }

  const recipients = await getStaffEmails(input.workspaceId);
  await sendReminderEmails(
    recipients,
    `Ordering open — week of ${weekLabel}`,
    `<p>Ordering for the week of <strong>${weekLabel}</strong> is now open.</p><p>Closes ${closesLabel}.</p>`,
    `Ordering for week of ${weekLabel} is now open. Closes ${closesLabel}.`,
  );
  await ReminderLog.updateOne(
    { menuWeekId: input.week._id, type: "ORDERING_OPEN" },
    { recipientCount: recipients.length },
  );

  return { sent: true, recipientCount: recipients.length };
}
