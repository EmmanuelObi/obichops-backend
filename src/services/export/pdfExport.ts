import PDFDocument from "pdfkit";
import { DateTime } from "luxon";
import {
  formatNairaPdf,
  formatPdfAmount,
  type ExportLineRow,
  type WeekExportData,
} from "./loadExportData.js";
import { formatExportMeta } from "./csvExport.js";
import { DAY_LABELS, type DayOfWeek } from "../../types/days.js";

function collectPdfBuffer(doc: InstanceType<typeof PDFDocument>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

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

/** Look up notes keyed by day label then staff key (email || name). */
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

export async function buildPdfExport(
  data: WeekExportData,
  options?: { includeExcessSummary?: boolean },
): Promise<Buffer> {
  const includeExcess = options?.includeExcessSummary ?? true;
  const doc = new PDFDocument({ margin: 50, size: "A4" });
  const orderableLabels = new Set(orderableDayLabels(data));

  doc.fontSize(22).text(data.workspaceName, { align: "center" });
  doc.moveDown(0.3);
  doc.fontSize(11).fillColor("#444").text("Weekly meal orders", { align: "center" });
  doc.moveDown();
  doc.fontSize(10).fillColor("#333").text(formatExportMeta(data, { includeWorkspace: false }));
  doc.moveDown();

  const grouped = groupByDayAndStaff(data.lineRows);
  const noteLookup = buildNoteLookup(data);
  const sortedDays = [...grouped.keys()]
    .filter((day) => orderableLabels.has(day))
    .sort((a, b) => daySortIndex(data, a) - daySortIndex(data, b));

  doc.fontSize(14).fillColor("#111").text("Orders by day", { underline: true });
  doc.moveDown(0.5);

  if (sortedDays.length === 0) {
    doc.fontSize(10).fillColor("#555").text("No submitted orders for this week.");
  }

  for (const day of sortedDays) {
    const staffMap = grouped.get(day)!;
    doc.fontSize(13).fillColor("#111").text(day, { underline: true });
    doc.moveDown(0.4);

    const sortedStaff = [...staffMap.entries()].sort(([, a], [, b]) =>
      (a[0]?.staffName ?? "").localeCompare(b[0]?.staffName ?? "", undefined, {
        sensitivity: "base",
      }),
    );

    for (const [staffKey, rows] of sortedStaff) {
      const displayName = rows[0]?.staffName ?? "Unknown";
      doc.fontSize(11).fillColor("#222").text(displayName);

      const sortedRows = [...rows].sort((a, b) => a.item.localeCompare(b.item));
      for (const row of sortedRows) {
        doc
          .fontSize(10)
          .fillColor("#444")
          .text(
            `  - ${row.item} x ${row.quantity} @ ${formatPdfAmount(row.unitPriceCents)} = ${formatPdfAmount(row.lineTotalCents)}`,
          );
      }

      const note = noteLookup.get(day)?.get(staffKey);
      if (note) {
        doc
          .fontSize(10)
          .fillColor("#b45309")
          .text(`  Note: ${note}`, { indent: 8 });
      }

      doc
        .fontSize(10)
        .fillColor("#333")
        .text(`  Day total: ${formatPdfAmount(staffDayTotal(rows))}`, { indent: 8 });
      doc.moveDown(0.5);
    }

    doc.moveDown(0.3);
  }

  if (includeExcess && data.excessRows.length > 0) {
    doc.moveDown();
    doc.fontSize(14).text("Excess payment report (admin)");
    doc.moveDown();
    for (const row of data.excessRows) {
      doc
        .fontSize(10)
        .text(
          `${row.staffName} (${row.staffEmail}): excess ${formatNairaPdf(row.excessCents)} - acknowledged: ${row.excessAcknowledged ? "Yes" : "No"}`,
        );
    }
  }

  doc.moveDown();
  doc
    .fontSize(8)
    .fillColor("#888")
    .text(
      `Generated ${DateTime.now().setZone(data.timezone).toFormat("ff")}`,
      { align: "right" },
    );

  return collectPdfBuffer(doc);
}

export async function buildVendorPdfExport(data: WeekExportData): Promise<Buffer> {
  return buildPdfExport(data, { includeExcessSummary: false });
}
