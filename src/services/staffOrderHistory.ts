import mongoose from "mongoose";
import { MenuItem, MenuWeek, Order, Vendor } from "../models/index.js";
import type { OrderDocument } from "../models/Order.js";
import { getWorkspaceTimezone, serializeOrder } from "./menuWeekService.js";
import { getExcessPaymentStatus, isExcessOutstanding } from "../types/excessPayment.js";
import { getReviewsForUserWeeks } from "./vendorReview.js";

export interface StaffOrderHistoryReview {
  rating: number;
  comment: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StaffOrderHistoryEntry {
  order: ReturnType<typeof serializeOrder> & {
    excessPaymentStatus: ReturnType<typeof getExcessPaymentStatus>;
    excessPaymentProofFilename: string | null;
    excessPaymentProofUploadedAt: string | null;
  };
  menuWeek: {
    id: string;
    weekStart: string;
    status: string;
    timezone: string;
  };
  vendor: {
    id: string;
    name: string;
  } | null;
  lineItems: Array<{
    menuItemId: string;
    dayOfWeek: string;
    quantity: number;
    unitPriceCentsSnapshot: number | null;
    name: string;
  }>;
  canReview: boolean;
  review: StaffOrderHistoryReview | null;
}

function serializeHistoryOrder(order: OrderDocument) {
  const base = serializeOrder(order);
  return {
    ...base,
    excessPaymentStatus: getExcessPaymentStatus(order),
    excessPaymentProofFilename: order.excessPaymentProofFilename ?? null,
    excessPaymentProofUploadedAt:
      order.excessPaymentProofUploadedAt?.toISOString() ?? null,
  };
}

export async function listStaffOrderHistory(
  workspaceId: string,
  userId: string,
): Promise<{
  outstandingExcessCents: number;
  outstandingOrderCount: number;
  orders: StaffOrderHistoryEntry[];
}> {
  const orders = await Order.find({
    workspaceId,
    userId,
    status: "SUBMITTED",
  }).sort({ submittedAt: -1, updatedAt: -1 });

  if (orders.length === 0) {
    return {
      outstandingExcessCents: 0,
      outstandingOrderCount: 0,
      orders: [],
    };
  }

  const weekIds = [...new Set(orders.map((o) => o.menuWeekId.toString()))];
  const weeks = await MenuWeek.find({ _id: { $in: weekIds }, workspaceId });
  const weekMap = new Map(weeks.map((week) => [week._id.toString(), week]));
  const timezone = await getWorkspaceTimezone(workspaceId);

  const vendorIds = [
    ...new Set(weeks.map((week) => week.activeVendorId.toString())),
  ];
  const vendors = await Vendor.find({ _id: { $in: vendorIds }, workspaceId });
  const vendorMap = new Map(vendors.map((vendor) => [vendor._id.toString(), vendor]));

  const menuItemIds = [
    ...new Set(
      orders.flatMap((order) =>
        order.lineItems.map((line) => line.menuItemId.toString()),
      ),
    ),
  ];
  const menuItems = await MenuItem.find({
    _id: { $in: menuItemIds },
    workspaceId,
  });
  const menuItemMap = new Map(
    menuItems.map((item) => [item._id.toString(), item]),
  );

  const reviewMap = await getReviewsForUserWeeks(userId, weekIds);

  let outstandingExcessCents = 0;
  let outstandingOrderCount = 0;

  const history = orders.map((order) => {
    const week = weekMap.get(order.menuWeekId.toString());
    const vendor = week
      ? vendorMap.get(week.activeVendorId.toString()) ?? null
      : null;

    if (isExcessOutstanding(order)) {
      outstandingExcessCents += order.excessCents;
      outstandingOrderCount += 1;
    }

    return {
      order: serializeHistoryOrder(order),
      menuWeek: week
        ? {
            id: week._id.toString(),
            weekStart: week.weekStart.toISOString(),
            status: week.status,
            timezone,
          }
        : {
            id: order.menuWeekId.toString(),
            weekStart: new Date(0).toISOString(),
            status: "CLOSED",
            timezone,
          },
      vendor: vendor
        ? { id: vendor._id.toString(), name: vendor.name }
        : null,
      lineItems: order.lineItems.map((line) => ({
        menuItemId: line.menuItemId.toString(),
        dayOfWeek: line.dayOfWeek,
        quantity: line.quantity,
        unitPriceCentsSnapshot: line.unitPriceCentsSnapshot ?? null,
        name:
          menuItemMap.get(line.menuItemId.toString())?.name ?? "Unknown item",
      })),
      canReview: week?.status === "CLOSED",
      review: week
        ? reviewMap.get(week._id.toString()) ?? null
        : null,
    };
  });

  return {
    outstandingExcessCents,
    outstandingOrderCount,
    orders: history,
  };
}

export function assertOrderOwnedByUser(
  order: OrderDocument | null,
  workspaceId: string,
  userId: string,
): order is OrderDocument {
  if (!order) return false;
  return (
    order.workspaceId.toString() === workspaceId &&
    order.userId.toString() === userId
  );
}

export function assertOrderHasUploadableExcess(order: OrderDocument): void {
  if (order.status !== "DRAFT" && order.status !== "SUBMITTED") {
    throw new Error("Only draft or submitted orders can include payment proof");
  }
  if (order.excessCents <= 0) {
    throw new Error("This order has no excess payment");
  }
  if (order.excessPaidAt) {
    throw new Error("This excess has already been marked as paid");
  }
}

export async function getOrderForUser(
  workspaceId: string,
  userId: string,
  orderId: string,
): Promise<OrderDocument | null> {
  if (!mongoose.isValidObjectId(orderId)) {
    return null;
  }
  return Order.findOne({
    _id: orderId,
    workspaceId,
    userId,
  });
}
