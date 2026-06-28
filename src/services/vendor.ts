export function vendorHasPaymentDetails(vendor: {
  accountName?: string | null;
  bankName?: string | null;
  accountNumber?: string | null;
}): boolean {
  return Boolean(
    vendor.accountName?.trim() &&
      vendor.bankName?.trim() &&
      vendor.accountNumber?.trim(),
  );
}

export function serializeVendorPaymentFields(vendor: {
  accountName?: string | null;
  bankName?: string | null;
  accountNumber?: string | null;
}) {
  return {
    accountName: vendor.accountName?.trim() ?? null,
    bankName: vendor.bankName?.trim() ?? null,
    accountNumber: vendor.accountNumber?.trim() ?? null,
  };
}
