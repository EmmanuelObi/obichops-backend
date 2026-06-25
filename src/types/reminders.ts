export const REMINDER_TYPES = [
  "WINDOW_OPEN",
  "PENDING_NUDGE",
  "FINAL_NUDGE",
] as const;

export type ReminderType = (typeof REMINDER_TYPES)[number];
