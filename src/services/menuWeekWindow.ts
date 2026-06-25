import { DateTime } from "luxon";
import type { DayOfWeek } from "../types/days.js";

export type WindowUiStatus = "UPCOMING" | "OPEN" | "CLOSED";

export interface DefaultWindowTimes {
  orderWindowOpensAt: Date;
  orderWindowClosesAt: Date;
}

export function getNextMonday(
  timezone: string,
  from: DateTime = DateTime.now().setZone(timezone),
): DateTime {
  const daysUntilMonday = (8 - from.weekday) % 7 || 7;
  return from.startOf("day").plus({ days: daysUntilMonday });
}

export function computeDefaultOrderWindow(
  weekStart: Date,
  timezone: string,
): DefaultWindowTimes {
  const monday = DateTime.fromJSDate(weekStart, { zone: timezone }).startOf("day");
  const fridayBefore = monday.minus({ days: 3 }).set({
    hour: 14,
    minute: 0,
    second: 0,
    millisecond: 0,
  });
  const saturdayBefore = monday.minus({ days: 2 }).set({
    hour: 10,
    minute: 0,
    second: 0,
    millisecond: 0,
  });

  return {
    orderWindowOpensAt: fridayBefore.toUTC().toJSDate(),
    orderWindowClosesAt: saturdayBefore.toUTC().toJSDate(),
  };
}

export function getWindowUiStatus(input: {
  status: string;
  orderWindowOpensAt: Date;
  orderWindowClosesAt: Date;
  timezone: string;
  now?: Date;
}): WindowUiStatus {
  const now = DateTime.fromJSDate(input.now ?? new Date(), { zone: "utc" });
  const opens = DateTime.fromJSDate(input.orderWindowOpensAt, { zone: "utc" });
  const closes = DateTime.fromJSDate(input.orderWindowClosesAt, { zone: "utc" });

  if (input.status === "CLOSED" || now >= closes) {
    return "CLOSED";
  }

  if (input.status === "OPEN" && now < closes) {
    return "OPEN";
  }

  if (now < opens) {
    return "UPCOMING";
  }

  return "CLOSED";
}

export function isOrderingAllowed(input: {
  status: string;
  orderWindowOpensAt: Date;
  orderWindowClosesAt: Date;
  now?: Date;
}): boolean {
  const now = DateTime.fromJSDate(input.now ?? new Date(), { zone: "utc" });
  const closes = DateTime.fromJSDate(input.orderWindowClosesAt, { zone: "utc" });

  return input.status === "OPEN" && now < closes;
}

export function formatWindowDateTime(date: Date, timezone: string): string {
  return DateTime.fromJSDate(date, { zone: "utc" })
    .setZone(timezone)
    .toFormat("ccc d LLL, h:mm a");
}

export const DEFAULT_ORDERABLE_DAYS: DayOfWeek[] = [
  "MON",
  "TUE",
  "WED",
  "THU",
  "FRI",
];

export const DEFAULT_TIMEZONE = "Africa/Lagos";
export const DEFAULT_MAX_ORDER_AMOUNT_CENTS = 500_000;
export const DEFAULT_MAX_ORDER_DAYS_PER_STAFF = 2;
