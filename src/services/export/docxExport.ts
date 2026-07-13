import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
  type IParagraphOptions,
} from "docx";
import { DateTime } from "luxon";
import {
  formatPdfAmount,
  type ExportLineRow,
  type WeekExportData,
} from "./loadExportData.js";
import { formatExportMeta } from "./csvExport.js";
import { DAY_LABELS, type DayOfWeek } from "../../types/days.js";

function orderableDayLabels(data: WeekExportData): string[] {
  return data.week.orderableDays.map((d) => DAY_LABELS[d as DayOfWeek] ?? d);
}

function daySortIndex(data: WeekExportData, dayLabel: string): number {
  const labels = orderableDayLabels(data);
  const fromWeek = labels.indexOf(dayLabel);
  if (fromWeek >= 0) return fromWeek;

  const fromCalendar = Object.values(DAY_LABELS).indexOf(dayLabel);
  return fromCalendar >= 0 ? fromCalendar : 999;
}

function groupByDayAndStaff(
  lineRows: ExportLineRow[],
): Map<string, Map<string, ExportLineRow[]>> {
  const grouped = new Map<string, Map<string, ExportLineRow[]>>();

  for (const row of lineRows) {
    if (!grouped.has(row.day)) grouped.set(row.day, new Map());
    const staffMap = grouped.get(row.day)!;
    const staffKey = row.staffEmail || row.staffName;
    if (!staffMap.has(staffKey)) staffMap.set(staffKey, []);
    staffMap.get(staffKey)!.push(row);
  }

  return grouped;
}

function staffDayTotal(rows: ExportLineRow[]): number {
  return rows.reduce((sum, row) => sum + row.lineTotalCents, 0);
}

function buildNoteLookup(
  data: WeekExportData,
): Map<string, Map<string, string>> {
  const lookup = new Map<string, Map<string, string>>();
  for (const row of data.noteRows) {
    if (!lookup.has(row.day)) lookup.set(row.day, new Map());
    const staffKey = row.staffEmail || row.staffName;
    lookup.get(row.day)!.set(staffKey, row.note);
  }
  return lookup;
}

/** Keep Word-safe ASCII/common punctuation — avoid ₦ and fancy dashes that render as junk. */
function para(
  text: string,
  options?: Partial<IParagraphOptions>,
): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text })],
    ...options,
  });
}

export async function buildDocxExport(
  data: WeekExportData,
  options?: { includeExcessSummary?: boolean },
): Promise<Buffer> {
  const includeExcess = options?.includeExcessSummary ?? true;
  const orderableLabels = new Set(orderableDayLabels(data));
  const grouped = groupByDayAndStaff(data.lineRows);
  const noteLookup = buildNoteLookup(data);
  const sortedDays = [...grouped.keys()]
    .filter((day) => orderableLabels.has(day))
    .sort((a, b) => daySortIndex(data, a) - daySortIndex(data, b));

  const children: Paragraph[] = [
    para(data.workspaceName, { heading: HeadingLevel.TITLE }),
    para("Weekly meal orders"),
  ];

  for (const line of formatExportMeta(data, { includeWorkspace: false }).split("\n")) {
    children.push(para(line));
  }

  children.push(para(""));
  children.push(para("Orders by day", { heading: HeadingLevel.HEADING_1 }));

  if (sortedDays.length === 0) {
    children.push(para("No submitted orders for this week."));
  }

  for (const day of sortedDays) {
    const staffMap = grouped.get(day)!;
    children.push(para(day, { heading: HeadingLevel.HEADING_2 }));

    const sortedStaff = [...staffMap.entries()].sort(([, a], [, b]) =>
      (a[0]?.staffName ?? "").localeCompare(b[0]?.staffName ?? "", undefined, {
        sensitivity: "base",
      }),
    );

    for (const [staffKey, rows] of sortedStaff) {
      const displayName = rows[0]?.staffName ?? "Unknown";
      children.push(
        new Paragraph({
          children: [new TextRun({ text: displayName, bold: true })],
        }),
      );

      const sortedRows = [...rows].sort((a, b) => a.item.localeCompare(b.item));
      for (const row of sortedRows) {
        children.push(
          para(
            `- ${row.item} x ${row.quantity} @ ${formatPdfAmount(row.unitPriceCents)} = ${formatPdfAmount(row.lineTotalCents)}`,
          ),
        );
      }

      const note = noteLookup.get(day)?.get(staffKey);
      if (note) {
        children.push(
          new Paragraph({
            children: [new TextRun({ text: `Note: ${note}`, italics: true })],
          }),
        );
      }

      children.push(para(`Day total: ${formatPdfAmount(staffDayTotal(rows))}`));
      children.push(para(""));
    }
  }

  if (includeExcess && data.excessRows.length > 0) {
    children.push(para("Excess payment report (admin)", { heading: HeadingLevel.HEADING_1 }));
    for (const row of data.excessRows) {
      children.push(
        para(
          `${row.staffName} (${row.staffEmail}): excess ${formatPdfAmount(row.excessCents)} - acknowledged: ${row.excessAcknowledged ? "Yes" : "No"}`,
        ),
      );
    }
  }

  children.push(para(""));
  children.push(
    para(`Generated ${DateTime.now().setZone(data.timezone).toFormat("ff")}`),
  );

  const doc = new Document({
    sections: [{ properties: {}, children }],
  });

  const uint8 = await Packer.toBuffer(doc);
  return Buffer.from(uint8);
}

export async function buildVendorDocxExport(
  data: WeekExportData,
): Promise<Buffer> {
  return buildDocxExport(data, { includeExcessSummary: false });
}
