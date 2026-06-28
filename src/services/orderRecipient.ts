import type { OrderDocument } from "../models/Order.js";
import { getUserDisplayName } from "./userDisplay.js";

export function normalizePlacedForNameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export interface OrderRecipientUser {
  firstName?: string | null;
  lastName?: string | null;
  name?: string | null;
  email: string;
}

export function getOrderRecipientDisplay(
  order: Pick<OrderDocument, "userId" | "placedForName">,
  user?: OrderRecipientUser | null,
): { staffName: string; staffEmail: string; isCustom: boolean } {
  if (order.userId && user) {
    return {
      staffName: getUserDisplayName(user),
      staffEmail: user.email,
      isCustom: false,
    };
  }
  if (order.placedForName?.trim()) {
    return {
      staffName: order.placedForName.trim(),
      staffEmail: "",
      isCustom: true,
    };
  }
  return {
    staffName: "Unknown",
    staffEmail: "",
    isCustom: Boolean(order.placedForName),
  };
}

export function getOrderRecipientKey(
  order: Pick<OrderDocument, "userId" | "placedForNameKey">,
): string {
  if (order.userId) return order.userId.toString();
  return `custom:${order.placedForNameKey ?? ""}`;
}
