/** Max 3 reminder emails per staff per menu week (only if they have not ordered). */
export const REMINDER_TYPES = [
  "FRIDAY_REMINDER_1",
  "FRIDAY_REMINDER_2",
  "SATURDAY_REMINDER",
] as const;

export type ReminderType = (typeof REMINDER_TYPES)[number];

/** Friday evening nudge + Saturday morning (workspace-local). */
export const REMINDER_FRIDAY_EVENING_HOUR = 20;
export const REMINDER_FRIDAY_EVENING_MINUTE = 0;
export const REMINDER_SATURDAY_MORNING_HOUR = 8;
export const REMINDER_SATURDAY_MORNING_MINUTE = 0;
