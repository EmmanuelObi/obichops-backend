import { stringify } from "csv-stringify/sync";
import {
  formatNaira,
  formatOrderableDayLabels,
  type WeekExportData,
  weekDateRangeLabel,
} from "./loadExportData.js";
import { DateTime } from "luxon";

export function buildCsvExport(data: WeekExportData, includeExcessSummary = true): Buffer {
  const sections: string[] = [];

  const lineHeader = [
    "Staff Name",
    "Email",
    "Day",
    "Item",
    "Quantity",
    "Unit Price",
    "Line Total",
    "Vendor",
  ];
  const lineRecords = data.lineRows.map((row) => [
    row.staffName,
    row.staffEmail,
    row.day,
    row.item,
    row.quantity,
    formatNaira(row.unitPriceCents),
    formatNaira(row.lineTotalCents),
    row.vendorName,
  ]);

  sections.push(
    stringify([lineHeader, ...lineRecords], { quoted: true }),
  );

  if (data.noteRows.length > 0) {
    sections.push("");
    const noteHeader = ["Day", "Staff Name", "Note for kitchen"];
    const noteRecords = data.noteRows.map((row) => [
      row.day,
      row.staffName,
      row.note,
    ]);
    sections.push(
      stringify([noteHeader, ...noteRecords], { quoted: true }),
    );
  }

  if (includeExcessSummary) {
    sections.push("");
    const summaryHeader = [
      "Staff Name",
      "Email",
      "Total",
      "Company Covered",
      "Excess",
      "Excess Acknowledged",
    ];
    const summaryRecords = data.summaryRows.map((row) => [
      row.staffName,
      row.staffEmail,
      formatNaira(row.totalCents),
      formatNaira(row.companyCoveredCents),
      formatNaira(row.excessCents),
      row.excessAcknowledged ? "Yes" : "No",
    ]);
    sections.push(
      stringify([summaryHeader, ...summaryRecords], { quoted: true }),
    );
  }

  return Buffer.from(sections.join("\n"), "utf-8");
}

export function buildVendorCsvExport(data: WeekExportData): Buffer {
  return buildCsvExport(
    { ...data, lineRows: data.lineRows, summaryRows: [] },
    false,
  );
}

export function exportFilename(
  data: WeekExportData,
  format: "csv" | "pdf",
): string {
  const range = weekDateRangeLabel(data.week.weekStart, data.timezone)
    .replace(/\s+/g, "-")
    .replace(/[^\w\-]/g, "");
  return `obichops-${range}.${format}`;
}

export function formatExportMeta(
  data: WeekExportData,
  options?: { includeWorkspace?: boolean },
): string {
  const includeWorkspace = options?.includeWorkspace ?? true;
  const weekRange = weekDateRangeLabel(data.week.weekStart, data.timezone);
  const opens = DateTime.fromJSDate(data.week.orderWindowOpensAt, { zone: "utc" })
    .setZone(data.timezone)
    .toFormat("ccc d LLL, h:mm a");
  const closes = DateTime.fromJSDate(data.week.orderWindowClosesAt, { zone: "utc" })
    .setZone(data.timezone)
    .toFormat("ccc d LLL, h:mm a");

  const lines = [
    includeWorkspace ? `Workspace: ${data.workspaceName}` : null,
    `Week: ${weekRange}`,
    `Vendor: ${data.vendorName}`,
    `Orderable days: ${formatOrderableDayLabels(data.week.orderableDays)}`,
    `Budget cap: ${formatNaira(data.week.maxOrderAmountCents)} per staff per day`,
    `Max order days per staff: ${data.week.maxOrderDaysPerStaff ?? 2}`,
    `Ordering window: ${opens} → ${closes}`,
  ].filter((line): line is string => line !== null);

  return lines.join("\n");
}
