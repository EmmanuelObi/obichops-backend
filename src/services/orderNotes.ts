import { DAYS_OF_WEEK, type DayOfWeek } from "../types/days.js";

export interface DayNoteInput {
  dayOfWeek: string;
  note: string;
}

export interface DayNote {
  dayOfWeek: DayOfWeek;
  note: string;
}

export const DAY_NOTE_MAX_LENGTH = 300;

/**
 * Normalizes per-day vendor notes: trims, caps length, dedupes by day (last wins),
 * and drops notes for days the order isn't actually ordering on (no orphan notes).
 */
export function sanitizeDayNotes(
  dayNotes: DayNoteInput[] | undefined | null,
  daysWithItems: Iterable<string>,
): DayNote[] {
  if (!dayNotes?.length) return [];

  const allowed = new Set(daysWithItems);
  const byDay = new Map<DayOfWeek, string>();

  for (const entry of dayNotes) {
    const day = entry?.dayOfWeek as DayOfWeek;
    if (!DAYS_OF_WEEK.includes(day)) continue;
    if (!allowed.has(day)) continue;
    const note = (entry.note ?? "").trim().slice(0, DAY_NOTE_MAX_LENGTH);
    if (!note) continue;
    byDay.set(day, note);
  }

  return DAYS_OF_WEEK.filter((day) => byDay.has(day)).map((day) => ({
    dayOfWeek: day,
    note: byDay.get(day)!,
  }));
}

export function daysFromLineItems(
  lineItems: Array<{ dayOfWeek: string }>,
): Set<string> {
  return new Set(lineItems.map((item) => item.dayOfWeek));
}
