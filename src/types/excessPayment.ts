export const EXCESS_PAYMENT_ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;

export type ExcessPaymentMimeType = (typeof EXCESS_PAYMENT_ALLOWED_MIME_TYPES)[number];

export const EXCESS_PAYMENT_MAX_BYTES = 5 * 1024 * 1024;

export type ExcessPaymentStatus =
  | "NONE"
  | "OUTSTANDING"
  | "PROOF_UPLOADED"
  | "PAID";

export function getExcessPaymentStatus(order: {
  excessCents: number;
  excessPaymentProofUploadedAt?: Date | null;
  excessPaidAt?: Date | null;
}): ExcessPaymentStatus {
  if (order.excessCents <= 0) {
    return "NONE";
  }
  if (order.excessPaidAt) {
    return "PAID";
  }
  if (order.excessPaymentProofUploadedAt) {
    return "PROOF_UPLOADED";
  }
  return "OUTSTANDING";
}

export function isExcessOutstanding(order: {
  excessCents: number;
  excessPaidAt?: Date | null;
}): boolean {
  return order.excessCents > 0 && !order.excessPaidAt;
}
