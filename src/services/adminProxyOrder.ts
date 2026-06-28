import mongoose from "mongoose";
import { MenuWeek, Order, User, Vendor } from "../models/index.js";
import type { MenuWeekDocument } from "../models/MenuWeek.js";
import type { OrderDocument } from "../models/Order.js";
import type { DayOfWeek } from "../types/days.js";
import {
  applyTotalsToLineItems,
  serializeOrder,
  validateAndPriceLineItems,
} from "./menuWeekService.js";
import { isOrderingAllowed as checkOrderingAllowed } from "./menuWeekWindow.js";
import { normalizePlacedForNameKey } from "./orderRecipient.js";
import { vendorHasPaymentDetails } from "./vendor.js";

export type ProxyRecipientInput =
  | { recipientType: "STAFF"; userId: string }
  | { recipientType: "CUSTOM"; placedForName: string };

export interface ResolvedProxyRecipient {
  type: "STAFF" | "CUSTOM";
  userId?: mongoose.Types.ObjectId;
  placedForName?: string;
  placedForNameKey?: string;
  displayName: string;
}

export async function resolveProxyRecipient(
  workspaceId: string,
  input: ProxyRecipientInput,
): Promise<ResolvedProxyRecipient> {
  if (input.recipientType === "STAFF") {
    if (!mongoose.isValidObjectId(input.userId)) {
      throw new Error("Invalid staff member");
    }
    const user = await User.findOne({
      _id: input.userId,
      workspaceId,
      role: "STAFF",
      isActive: true,
    });
    if (!user) {
      throw new Error("Staff member not found");
    }
    const displayName =
      [user.firstName?.trim(), user.lastName?.trim()].filter(Boolean).join(" ") ||
      user.name?.trim() ||
      user.email;
    return {
      type: "STAFF",
      userId: user._id,
      displayName,
    };
  }

  const placedForName = input.placedForName.trim();
  if (!placedForName) {
    throw new Error("Enter a name for this order");
  }
  const placedForNameKey = normalizePlacedForNameKey(placedForName);
  return {
    type: "CUSTOM",
    placedForName,
    placedForNameKey,
    displayName: placedForName,
  };
}

export function buildRecipientOrderFilter(
  workspaceId: string,
  menuWeekId: mongoose.Types.ObjectId,
  recipient: ResolvedProxyRecipient,
): Record<string, unknown> {
  if (recipient.type === "STAFF" && recipient.userId) {
    return { workspaceId, menuWeekId, userId: recipient.userId };
  }
  return {
    workspaceId,
    menuWeekId,
    placedForNameKey: recipient.placedForNameKey,
  };
}

export async function findProxyOrder(
  workspaceId: string,
  menuWeekId: mongoose.Types.ObjectId,
  recipient: ResolvedProxyRecipient,
): Promise<OrderDocument | null> {
  return Order.findOne(buildRecipientOrderFilter(workspaceId, menuWeekId, recipient));
}

export async function getMenuWeekForProxyOrder(
  workspaceId: string,
  menuWeekId: string,
): Promise<MenuWeekDocument | null> {
  if (!mongoose.isValidObjectId(menuWeekId)) return null;
  return MenuWeek.findOne({ _id: menuWeekId, workspaceId });
}

function assertOrderingWindowOpen(menuWeek: MenuWeekDocument): void {
  if (
    !checkOrderingAllowed({
      status: menuWeek.status,
      orderWindowOpensAt: menuWeek.orderWindowOpensAt,
      orderWindowClosesAt: menuWeek.orderWindowClosesAt,
    })
  ) {
    throw new Error("Ordering window is not open");
  }
}

async function clearExcessPaymentProof(order: {
  excessPaymentProofS3Key?: string | null;
}): Promise<void> {
  if (!order.excessPaymentProofS3Key) return;
  const { deleteExcessPaymentObject } = await import("./s3.js");
  try {
    await deleteExcessPaymentObject(order.excessPaymentProofS3Key);
  } catch {
    // Best effort cleanup.
  }
}

function excessProofClearFields() {
  return {
    excessPaymentProofS3Key: null,
    excessPaymentProofFilename: null,
    excessPaymentProofMimeType: null,
    excessPaymentProofUploadedAt: null,
  };
}

export async function upsertProxyOrder(input: {
  workspaceId: string;
  menuWeek: MenuWeekDocument;
  adminUserId: string;
  recipient: ResolvedProxyRecipient;
  lineItems: Array<{ menuItemId: string; dayOfWeek: DayOfWeek; quantity: number }>;
}) {
  assertOrderingWindowOpen(input.menuWeek);

  const existing = await findProxyOrder(
    input.workspaceId,
    input.menuWeek._id,
    input.recipient,
  );
  if (existing?.status === "SUBMITTED" && existing.excessCents > 0) {
    throw new Error("Submitted orders with excess cannot be edited");
  }

  const validated = await validateAndPriceLineItems({
    workspaceId: input.workspaceId,
    menuWeek: input.menuWeek,
    lineItems: input.lineItems,
    snapshotPrices: false,
  });

  const totals = applyTotalsToLineItems(
    validated,
    input.menuWeek.maxOrderAmountCents,
  );

  const lineItemsPayload = validated.map((item) => ({
    menuItemId: new mongoose.Types.ObjectId(item.menuItemId),
    dayOfWeek: item.dayOfWeek,
    quantity: item.quantity,
  }));

  const shouldClearProof =
    existing &&
    (totals.excessCents !== existing.excessCents || totals.excessCents <= 0) &&
    Boolean(existing.excessPaymentProofS3Key);

  if (shouldClearProof) {
    await clearExcessPaymentProof(existing);
  }

  const filter = buildRecipientOrderFilter(
    input.workspaceId,
    input.menuWeek._id,
    input.recipient,
  );

  const order = await Order.findOneAndUpdate(
    filter,
    {
      workspaceId: input.workspaceId,
      menuWeekId: input.menuWeek._id,
      userId: input.recipient.userId ?? null,
      placedForName: input.recipient.placedForName ?? null,
      placedForNameKey: input.recipient.placedForNameKey ?? null,
      placedByUserId: new mongoose.Types.ObjectId(input.adminUserId),
      status: "DRAFT",
      lineItems: lineItemsPayload,
      totalCents: totals.totalCents,
      companyCoveredCents: totals.companyCoveredCents,
      excessCents: totals.excessCents,
      excessAcknowledged: false,
      excessAcknowledgedAt: null,
      submittedAt: null,
      ...(shouldClearProof ? excessProofClearFields() : {}),
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  return serializeOrder(order!);
}

export async function submitProxyOrder(input: {
  workspaceId: string;
  menuWeek: MenuWeekDocument;
  adminUserId: string;
  orderId: string;
}) {
  assertOrderingWindowOpen(input.menuWeek);

  if (!mongoose.isValidObjectId(input.orderId)) {
    throw new Error("Invalid order id");
  }

  const order = await Order.findOne({
    _id: input.orderId,
    workspaceId: input.workspaceId,
    menuWeekId: input.menuWeek._id,
  });
  if (!order || order.lineItems.length === 0) {
    throw new Error("No order to submit");
  }
  if (order.status === "SUBMITTED") {
    throw new Error("Order already submitted");
  }

  const validated = await validateAndPriceLineItems({
    workspaceId: input.workspaceId,
    menuWeek: input.menuWeek,
    lineItems: order.lineItems.map((item) => ({
      menuItemId: item.menuItemId.toString(),
      dayOfWeek: item.dayOfWeek as DayOfWeek,
      quantity: item.quantity,
    })),
    snapshotPrices: true,
  });

  const totals = applyTotalsToLineItems(
    validated,
    input.menuWeek.maxOrderAmountCents,
  );

  if (totals.excessCents > 0) {
    const vendor = await Vendor.findOne({
      _id: input.menuWeek.activeVendorId,
      workspaceId: input.workspaceId,
    });
    if (!vendor || !vendorHasPaymentDetails(vendor)) {
      throw new Error("Vendor payment details are not configured");
    }
    if (!order.excessPaymentProofUploadedAt) {
      const err = new Error(
        "Payment proof required before submitting an order with excess",
      ) as Error & { excessCents?: number };
      err.excessCents = totals.excessCents;
      throw err;
    }
    if (order.excessCents !== totals.excessCents) {
      throw new Error(
        "The order changed. Upload payment proof again before submitting.",
      );
    }
  }

  order.lineItems = validated.map((item) => ({
    menuItemId: new mongoose.Types.ObjectId(item.menuItemId),
    dayOfWeek: item.dayOfWeek,
    quantity: item.quantity,
    unitPriceCentsSnapshot: item.unitPriceCents,
  })) as typeof order.lineItems;
  order.totalCents = totals.totalCents;
  order.companyCoveredCents = totals.companyCoveredCents;
  order.excessCents = totals.excessCents;
  order.status = "SUBMITTED";
  order.submittedAt = new Date();
  order.placedByUserId = new mongoose.Types.ObjectId(input.adminUserId);

  if (totals.excessCents > 0) {
    order.excessAcknowledged = true;
    order.excessAcknowledgedAt = new Date();
  } else {
    if (order.excessPaymentProofS3Key) {
      await clearExcessPaymentProof(order);
    }
    order.excessAcknowledged = false;
    order.excessAcknowledgedAt = undefined;
    Object.assign(order, excessProofClearFields());
  }

  await order.save();
  return serializeOrder(order);
}

export async function listProxyStaffRecipients(
  workspaceId: string,
  menuWeekId: mongoose.Types.ObjectId,
) {
  const staff = await User.find({
    workspaceId,
    role: "STAFF",
    isActive: true,
  }).sort({ firstName: 1, lastName: 1, email: 1 });

  const orders = await Order.find({ workspaceId, menuWeekId, userId: { $ne: null } });
  const orderByUserId = new Map(
    orders.map((order) => [order.userId!.toString(), order]),
  );

  return staff.map((user) => {
    const order = orderByUserId.get(user._id.toString());
    const displayName =
      [user.firstName?.trim(), user.lastName?.trim()].filter(Boolean).join(" ") ||
      user.name?.trim() ||
      user.email;
    return {
      userId: user._id.toString(),
      name: displayName,
      email: user.email,
      hasOrder: Boolean(order),
      orderId: order?._id.toString() ?? null,
      orderStatus: order?.status ?? null,
    };
  });
}

export { serializeOrder };
