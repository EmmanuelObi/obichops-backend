/** Informational email when ordering opens (not a nudge). */
export const OPEN_REMINDER_TYPES = ["ORDERING_OPEN"] as const;

/** Follow-up emails for staff who have not ordered. */
export const NUDGE_REMINDER_TYPES = [
  "OPENING_DAY_NUDGE",
  "FRIDAY_NUDGE_1",
  "FRIDAY_NUDGE_2",
  "SATURDAY_NUDGE",
  "CLOSING_SOON",
] as const;

/** @deprecated Legacy types still present in older ReminderLog rows. */
export const LEGACY_REMINDER_TYPES = [
  "WINDOW_OPEN",
  "PENDING_NUDGE",
  "FINAL_NUDGE",
  "FRIDAY_REMINDER_1",
  "FRIDAY_REMINDER_2",
  "SATURDAY_REMINDER",
] as const;

export const REMINDER_TYPES = [
  ...OPEN_REMINDER_TYPES,
  ...NUDGE_REMINDER_TYPES,
  ...LEGACY_REMINDER_TYPES,
] as const;

export type ReminderType = (typeof REMINDER_TYPES)[number];
export type OpenReminderType = (typeof OPEN_REMINDER_TYPES)[number];
export type NudgeReminderType = (typeof NUDGE_REMINDER_TYPES)[number];

export const REMINDER_OPENING_DAY_HOUR = 17;
export const REMINDER_OPENING_DAY_MINUTE = 0;
export const REMINDER_FRIDAY_AFTERNOON_HOUR = 17;
export const REMINDER_FRIDAY_AFTERNOON_MINUTE = 0;
export const REMINDER_FRIDAY_EVENING_HOUR = 20;
export const REMINDER_FRIDAY_EVENING_MINUTE = 0;
export const REMINDER_SATURDAY_MORNING_HOUR = 8;
export const REMINDER_SATURDAY_MORNING_MINUTE = 0;
/** Hours before orderWindowClosesAt for CLOSING_SOON. */
export const REMINDER_CLOSING_SOON_HOURS_BEFORE = 1;

export const CRON_WINDOW_MINUTES = 15;
