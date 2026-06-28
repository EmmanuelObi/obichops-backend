import { DateTime } from "luxon";
import mongoose from "mongoose";
import {
  MenuItem,
  MenuWeek,
  Order,
  User,
  Vendor,
  Workspace,
} from "../../models/index.js";
import type { MenuWeekDocument } from "../../models/MenuWeek.js";
import type { OrderDocument } from "../../models/Order.js";
import { DAY_LABELS, type DayOfWeek } from "../../types/days.js";
import { getOrderRecipientDisplay } from "../orderRecipient.js";

export interface ExportLineRow {
  staffName: string;
  staffEmail: string;
  day: string;
  item: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
  vendorName: string;
}

export interface ExportSummaryRow {
  staffName: string;
  staffEmail: string;
  totalCents: number;
  companyCoveredCents: number;
  excessCents: number;
  excessAcknowledged: boolean;
}

export interface WeekExportData {
  workspaceName: string;
  week: MenuWeekDocument;
  vendorName: string;
  vendorEmail: string;
  timezone: string;
  lineRows: ExportLineRow[];
  summaryRows: ExportSummaryRow[];
  itemQuantityTotals: Array<{ day: string; item: string; quantity: number }>;
  excessRows: ExportSummaryRow[];
}

function formatNaira(cents: number): string {
  return `₦${(cents / 100).toLocaleString("en-NG", { maximumFractionDigits: 0 })}`;
}

/** PDF-safe currency (Helvetica lacks the naira glyph). */
export function formatNairaPdf(cents: number): string {
  return `NGN ${(cents / 100).toLocaleString("en-NG", { maximumFractionDigits: 0 })}`;
}

export function formatOrderableDayLabels(days: string[]): string {
  return days.map((d) => DAY_LABELS[d as DayOfWeek] ?? d).join(", ");
}

export { formatNaira };

export async function loadWeekExportData(
  workspaceId: string,
  menuWeekId: string,
  _options?: { vendorOnly?: boolean },
): Promise<WeekExportData> {
  const workspace = await Workspace.findById(workspaceId);
  if (!workspace) throw new Error("Workspace not found");

  const week = await MenuWeek.findOne({ _id: menuWeekId, workspaceId });
  if (!week) throw new Error("Menu week not found");

  const vendor = await Vendor.findOne({ _id: week.activeVendorId, workspaceId });
  if (!vendor) throw new Error("Vendor not found");

  const timezone = workspace.settings?.timezone ?? "Africa/Lagos";
  const orderableSet = new Set(week.orderableDays);
  const orderFilter: Record<string, unknown> = {
    workspaceId,
    menuWeekId: week._id,
    status: "SUBMITTED",
  };

  const orders = await Order.find(orderFilter);
  const userIds = [
    ...new Set(
      orders
        .map((o) => o.userId?.toString())
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const users = await User.find({ _id: { $in: userIds } });
  const userMap = new Map(users.map((u) => [u._id.toString(), u]));

  const menuItemIds = [
    ...new Set(
      orders.flatMap((o) => o.lineItems.map((li) => li.menuItemId.toString())),
    ),
  ];
  const menuItems = await MenuItem.find({ _id: { $in: menuItemIds } });
  const menuItemMap = new Map(menuItems.map((m) => [m._id.toString(), m]));

  const lineRows: ExportLineRow[] = [];
  const summaryRows: ExportSummaryRow[] = [];
  const quantityMap = new Map<string, number>();

  for (const order of orders) {
    const user = order.userId ? userMap.get(order.userId.toString()) : null;
    const { staffName, staffEmail } = getOrderRecipientDisplay(order, user ?? undefined);

    if (order.status === "SUBMITTED") {
      summaryRows.push({
        staffName,
        staffEmail,
        totalCents: order.totalCents,
        companyCoveredCents: order.companyCoveredCents,
        excessCents: order.excessCents,
        excessAcknowledged: order.excessAcknowledged,
      });
    }

    for (const line of order.lineItems) {
      if (!orderableSet.has(line.dayOfWeek)) continue;

      const menuItem = menuItemMap.get(line.menuItemId.toString());
      const unitPrice =
        line.unitPriceCentsSnapshot ?? menuItem?.priceCents ?? 0;
      const itemName = menuItem?.name ?? "Unknown item";
      const dayLabel = DAY_LABELS[line.dayOfWeek as DayOfWeek] ?? line.dayOfWeek;

      if (order.status !== "SUBMITTED") continue;

      lineRows.push({
        staffName,
        staffEmail,
        day: dayLabel,
        item: itemName,
        quantity: line.quantity,
        unitPriceCents: unitPrice,
        lineTotalCents: unitPrice * line.quantity,
        vendorName: vendor.name,
      });

      const key = `${dayLabel}::${itemName}`;
      quantityMap.set(key, (quantityMap.get(key) ?? 0) + line.quantity);
    }
  }

  const itemQuantityTotals = [...quantityMap.entries()]
    .map(([key, quantity]) => {
      const [day, item] = key.split("::");
      return { day: day!, item: item!, quantity };
    })
    .sort((a, b) => a.day.localeCompare(b.day) || a.item.localeCompare(b.item));

  const excessRows = summaryRows.filter((row) => row.excessCents > 0);

  return {
    workspaceName: workspace.name,
    week,
    vendorName: vendor.name,
    vendorEmail: vendor.email,
    timezone,
    lineRows,
    summaryRows,
    itemQuantityTotals,
    excessRows,
  };
}

export function weekDateRangeLabel(weekStart: Date, timezone: string): string {
  const start = DateTime.fromJSDate(weekStart, { zone: "utc" }).setZone(timezone);
  const end = start.plus({ days: 4 });
  return `${start.toFormat("d LLL")} – ${end.toFormat("d LLL yyyy")}`;
}

export async function getMenuWeekOrThrow(
  workspaceId: string,
  menuWeekId: string,
) {
  if (!mongoose.isValidObjectId(menuWeekId)) {
    throw new Error("Invalid menu week id");
  }
  const week = await MenuWeek.findOne({ _id: menuWeekId, workspaceId });
  if (!week) throw new Error("Menu week not found");
  return week;
}

export type { OrderDocument };
