import mongoose from "mongoose";
import { MenuItem, MenuWeek, Vendor, Workspace } from "../models/index.js";
import type { MenuWeekDocument } from "../models/MenuWeek.js";
import type { DayOfWeek } from "../types/days.js";
import { calculateOrderTotals, countDistinctOrderDays, type LineItemInput } from "./orderTotals.js";
import {
  computePackLineItems,
  type FoodLineForPacks,
  type PackMenuItemForDay,
} from "./packLines.js";
import {
  DEFAULT_TIMEZONE,
  getWindowUiStatus,
  isOrderingAllowed,
} from "./menuWeekWindow.js";

export async function getWorkspaceTimezone(workspaceId: string): Promise<string> {
  const workspace = await Workspace.findById(workspaceId);
  return workspace?.settings?.timezone ?? DEFAULT_TIMEZONE;
}

export async function findCurrentMenuWeek(
  workspaceId: string,
): Promise<MenuWeekDocument | null> {
  const open = await MenuWeek.findOne({ workspaceId, status: "OPEN" }).sort({
    weekStart: 1,
  });
  if (open) return open;

  const now = new Date();
  const upcoming = await MenuWeek.findOne({
    workspaceId,
    status: "DRAFT",
    orderWindowOpensAt: { $gt: now },
  }).sort({ weekStart: 1 });
  if (upcoming) return upcoming;

  const draftInWindow = await MenuWeek.findOne({
    workspaceId,
    status: "DRAFT",
    orderWindowOpensAt: { $lte: now },
    orderWindowClosesAt: { $gt: now },
  }).sort({ weekStart: 1 });
  if (draftInWindow) return draftInWindow;

  return MenuWeek.findOne({ workspaceId, status: "CLOSED" }).sort({
    weekStart: -1,
  });
}

export function serializeMenuWeek(
  week: MenuWeekDocument,
  timezone: string,
) {
  return {
    id: week._id.toString(),
    workspaceId: week.workspaceId.toString(),
    weekStart: week.weekStart.toISOString(),
    activeVendorId: week.activeVendorId.toString(),
    orderableDays: week.orderableDays,
    maxOrderAmountCents: week.maxOrderAmountCents,
    maxOrderDaysPerStaff: week.maxOrderDaysPerStaff ?? 2,
    orderWindowOpensAt: week.orderWindowOpensAt.toISOString(),
    orderWindowClosesAt: week.orderWindowClosesAt.toISOString(),
    status: week.status,
    windowStatus: getWindowUiStatus({
      status: week.status,
      orderWindowOpensAt: week.orderWindowOpensAt,
      orderWindowClosesAt: week.orderWindowClosesAt,
      timezone,
    }),
    orderingAllowed: isOrderingAllowed({
      status: week.status,
      orderWindowOpensAt: week.orderWindowOpensAt,
      orderWindowClosesAt: week.orderWindowClosesAt,
    }),
    timezone,
  };
}

export async function getFilteredMenuForWeek(
  workspaceId: string,
  vendorId: string,
  orderableDays: string[],
) {
  const items = await MenuItem.find({
    workspaceId,
    vendorId,
    dayOfWeek: { $in: orderableDays },
    isAvailable: true,
    itemKind: { $ne: "PACK" },
  }).sort({ dayOfWeek: 1, name: 1 });

  return items.map((item) => ({
    id: item._id.toString(),
    vendorId: item.vendorId.toString(),
    dayOfWeek: item.dayOfWeek,
    name: item.name,
    description: item.description ?? "",
    priceCents: item.priceCents,
    itemKind: item.itemKind ?? "FOOD",
    packsRequired: item.packsRequired ?? 0,
    isAvailable: item.isAvailable,
  }));
}

export async function getPackMenuForWeek(
  workspaceId: string,
  vendorId: string,
  orderableDays: string[],
) {
  const items = await MenuItem.find({
    workspaceId,
    vendorId,
    dayOfWeek: { $in: orderableDays },
    itemKind: "PACK",
    isAvailable: true,
  }).sort({ dayOfWeek: 1 });

  return items.map((item) => ({
    id: item._id.toString(),
    dayOfWeek: item.dayOfWeek,
    priceCents: item.priceCents,
  }));
}

export interface ValidatedLineItem {
  menuItemId: string;
  dayOfWeek: DayOfWeek;
  quantity: number;
  unitPriceCents: number;
}

export async function validateAndPriceLineItems(input: {
  workspaceId: string;
  menuWeek: MenuWeekDocument;
  lineItems: Array<{ menuItemId: string; dayOfWeek: DayOfWeek; quantity: number }>;
  snapshotPrices: boolean;
}): Promise<ValidatedLineItem[]> {
  const vendor = await Vendor.findOne({
    _id: input.menuWeek.activeVendorId,
    workspaceId: input.workspaceId,
    isActive: true,
  });
  if (!vendor) {
    throw new Error("Active vendor is not available");
  }

  const orderableSet = new Set(input.menuWeek.orderableDays);
  const validated: ValidatedLineItem[] = [];
  const foodForPacks: FoodLineForPacks[] = [];

  for (const line of input.lineItems) {
    if (!orderableSet.has(line.dayOfWeek)) {
      throw new Error(`Day ${line.dayOfWeek} is not orderable this week`);
    }
    if (!mongoose.isValidObjectId(line.menuItemId)) {
      throw new Error("Invalid menu item id");
    }
    if (line.quantity < 0.5 || !Number.isInteger(line.quantity * 2)) {
      throw new Error("Quantity must be at least 0.5, in steps of 0.5");
    }

    const menuItem = await MenuItem.findOne({
      _id: line.menuItemId,
      workspaceId: input.workspaceId,
      vendorId: input.menuWeek.activeVendorId,
      dayOfWeek: line.dayOfWeek,
      isAvailable: true,
    });
    if (!menuItem) {
      throw new Error(`Menu item ${line.menuItemId} is not available`);
    }

    const itemKind = menuItem.itemKind ?? "FOOD";
    if (itemKind === "PACK") {
      continue;
    }

    validated.push({
      menuItemId: menuItem._id.toString(),
      dayOfWeek: line.dayOfWeek,
      quantity: line.quantity,
      unitPriceCents: menuItem.priceCents,
    });
    foodForPacks.push({
      dayOfWeek: line.dayOfWeek,
      quantity: line.quantity,
      packsRequired: menuItem.packsRequired ?? 0,
    });
  }

  const orderDayCount = countDistinctOrderDays(validated);
  const maxDays = input.menuWeek.maxOrderDaysPerStaff ?? 2;
  if (orderDayCount > maxDays) {
    throw new Error(
      `You can order on at most ${maxDays} ${maxDays === 1 ? "day" : "days"} this week`,
    );
  }

  if (foodForPacks.length === 0) {
    return validated;
  }

  const packItems = await MenuItem.find({
    workspaceId: input.workspaceId,
    vendorId: input.menuWeek.activeVendorId,
    dayOfWeek: { $in: input.menuWeek.orderableDays },
    itemKind: "PACK",
    isAvailable: true,
  });

  const packMenuItemsByDay = new Map(
    packItems.map(
      (item) =>
        [
          item.dayOfWeek as DayOfWeek,
          {
            menuItemId: item._id.toString(),
            dayOfWeek: item.dayOfWeek as DayOfWeek,
            priceCents: item.priceCents,
          } satisfies PackMenuItemForDay,
        ] as const,
    ),
  );

  const packLines = computePackLineItems({ foodLineItems: foodForPacks, packMenuItemsByDay });

  return [...validated, ...packLines];
}

export function serializeOrder(order: {
  _id: mongoose.Types.ObjectId;
  menuWeekId: mongoose.Types.ObjectId;
  userId?: mongoose.Types.ObjectId | null;
  placedForName?: string | null;
  placedByUserId?: mongoose.Types.ObjectId | null;
  status: string;
  lineItems: Array<{
    menuItemId: mongoose.Types.ObjectId;
    dayOfWeek: string;
    quantity: number;
    unitPriceCentsSnapshot?: number | null;
  }>;
  dayNotes?: Array<{ dayOfWeek: string; note: string }> | null;
  totalCents: number;
  companyCoveredCents: number;
  excessCents: number;
  excessAcknowledged: boolean;
  excessAcknowledgedAt?: Date | null;
  submittedAt?: Date | null;
  excessPaymentProofS3Key?: string | null;
  excessPaymentProofFilename?: string | null;
  excessPaymentProofMimeType?: string | null;
  excessPaymentProofUploadedAt?: Date | null;
  excessPaidAt?: Date | null;
}) {
  return {
    id: order._id.toString(),
    menuWeekId: order.menuWeekId.toString(),
    userId: order.userId?.toString() ?? null,
    placedForName: order.placedForName?.trim() ?? null,
    placedByUserId: order.placedByUserId?.toString() ?? null,
    status: order.status,
    lineItems: order.lineItems.map((item) => ({
      menuItemId: item.menuItemId.toString(),
      dayOfWeek: item.dayOfWeek,
      quantity: item.quantity,
      unitPriceCentsSnapshot: item.unitPriceCentsSnapshot ?? null,
    })),
    dayNotes: (order.dayNotes ?? [])
      .filter((entry) => entry?.note?.trim())
      .map((entry) => ({
        dayOfWeek: entry.dayOfWeek,
        note: entry.note.trim(),
      })),
    totalCents: order.totalCents,
    companyCoveredCents: order.companyCoveredCents,
    excessCents: order.excessCents,
    excessAcknowledged: order.excessAcknowledged,
    excessAcknowledgedAt: order.excessAcknowledgedAt ?? null,
    submittedAt: order.submittedAt ?? null,
    excessPaymentProofFilename: order.excessPaymentProofFilename ?? null,
    excessPaymentProofUploadedAt:
      order.excessPaymentProofUploadedAt?.toISOString() ?? null,
    excessPaidAt: order.excessPaidAt?.toISOString() ?? null,
    hasExcessPaymentProof: Boolean(order.excessPaymentProofS3Key),
  };
}

export function applyTotalsToLineItems(
  lineItems: ValidatedLineItem[],
  maxOrderAmountCents: number,
) {
  const priced: LineItemInput[] = lineItems.map((item) => ({
    menuItemId: item.menuItemId,
    dayOfWeek: item.dayOfWeek,
    quantity: item.quantity,
    unitPriceCents: item.unitPriceCents,
  }));
  return calculateOrderTotals(priced, maxOrderAmountCents);
}
