import { DateTime } from "luxon";
import { stringify } from "csv-stringify/sync";
import { MenuWeek, Order, User, Vendor, Chopspace } from "../../models/index.js";
import type { MenuWeekDocument } from "../../models/MenuWeek.js";
import type { OrderDocument } from "../../models/Order.js";
import { formatNaira, weekDateRangeLabel } from "../export/loadExportData.js";
import { getOrderRecipientDisplay, getOrderRecipientKey } from "../orderRecipient.js";

export type FinanceReportGranularity = "week" | "month";

export interface FinanceReportSummary {
  menuWeekCount: number;
  submittedOrderCount: number;
  participatingStaffCount: number;
  totalCents: number;
  companyCoveredCents: number;
  excessCents: number;
  excessCollectedCents: number;
  excessOutstandingCents: number;
}

export interface FinanceReportBucket {
  key: string;
  label: string;
  menuWeekIds: string[];
  weekStart: string | null;
  status: string | null;
  vendor: { id: string; name: string } | null;
  orderCount: number;
  participatingStaffCount: number;
  totalCents: number;
  companyCoveredCents: number;
  excessCents: number;
  excessCollectedCents: number;
  excessOutstandingCents: number;
}

export interface FinanceReportVendorRow {
  vendorId: string;
  vendorName: string;
  weekCount: number;
  orderCount: number;
  totalCents: number;
  companyCoveredCents: number;
  excessCents: number;
}

export interface FinanceReportStaffRow {
  staffName: string;
  staffEmail: string;
  orderCount: number;
  totalCents: number;
  companyCoveredCents: number;
  excessCents: number;
  excessCollectedCents: number;
  excessOutstandingCents: number;
}

export interface FinanceReportResponse {
  chopspace: { id: string; name: string; timezone: string };
  period: {
    from: string;
    to: string;
    granularity: FinanceReportGranularity;
  };
  summary: FinanceReportSummary;
  buckets: FinanceReportBucket[];
  byVendor: FinanceReportVendorRow[];
  byStaff: FinanceReportStaffRow[];
}

interface WeekAggregate {
  menuWeek: MenuWeekDocument;
  vendor: { id: string; name: string };
  orders: OrderDocument[];
}

interface OrderTotals {
  orderCount: number;
  staffIds: Set<string>;
  totalCents: number;
  companyCoveredCents: number;
  excessCents: number;
  excessCollectedCents: number;
  excessOutstandingCents: number;
}

function emptyTotals(): OrderTotals {
  return {
    orderCount: 0,
    staffIds: new Set(),
    totalCents: 0,
    companyCoveredCents: 0,
    excessCents: 0,
    excessCollectedCents: 0,
    excessOutstandingCents: 0,
  };
}

function accumulateOrder(totals: OrderTotals, order: OrderDocument): void {
  totals.orderCount += 1;
  totals.staffIds.add(getOrderRecipientKey(order));
  totals.totalCents += order.totalCents;
  totals.companyCoveredCents += order.companyCoveredCents;
  totals.excessCents += order.excessCents;
  if (order.excessCents > 0 && order.excessPaidAt) {
    totals.excessCollectedCents += order.excessCents;
  }
  if (order.excessCents > 0 && !order.excessPaidAt) {
    totals.excessOutstandingCents += order.excessCents;
  }
}

function totalsFromOrders(orders: OrderDocument[]): OrderTotals {
  const totals = emptyTotals();
  for (const order of orders) {
    accumulateOrder(totals, order);
  }
  return totals;
}

function bucketFromWeekAggregate(
  aggregate: WeekAggregate,
  timezone: string,
): FinanceReportBucket {
  const totals = totalsFromOrders(aggregate.orders);
  const { menuWeek, vendor } = aggregate;

  return {
    key: menuWeek._id.toString(),
    label: weekDateRangeLabel(menuWeek.weekStart, timezone),
    menuWeekIds: [menuWeek._id.toString()],
    weekStart: menuWeek.weekStart.toISOString(),
    status: menuWeek.status,
    vendor,
    orderCount: totals.orderCount,
    participatingStaffCount: totals.staffIds.size,
    totalCents: totals.totalCents,
    companyCoveredCents: totals.companyCoveredCents,
    excessCents: totals.excessCents,
    excessCollectedCents: totals.excessCollectedCents,
    excessOutstandingCents: totals.excessOutstandingCents,
  };
}

function monthBucketLabel(monthStart: DateTime): string {
  return monthStart.toFormat("LLLL yyyy");
}

function monthBucketKey(monthStart: DateTime): string {
  return monthStart.toFormat("yyyy-MM");
}

function summaryFromWeekAggregates(
  aggregates: WeekAggregate[],
): FinanceReportSummary {
  const staffIds = new Set<string>();
  let submittedOrderCount = 0;
  let totalCents = 0;
  let companyCoveredCents = 0;
  let excessCents = 0;
  let excessCollectedCents = 0;
  let excessOutstandingCents = 0;

  for (const aggregate of aggregates) {
    for (const order of aggregate.orders) {
      staffIds.add(getOrderRecipientKey(order));
      submittedOrderCount += 1;
      totalCents += order.totalCents;
      companyCoveredCents += order.companyCoveredCents;
      excessCents += order.excessCents;
      if (order.excessCents > 0 && order.excessPaidAt) {
        excessCollectedCents += order.excessCents;
      }
      if (order.excessCents > 0 && !order.excessPaidAt) {
        excessOutstandingCents += order.excessCents;
      }
    }
  }

  return {
    menuWeekCount: aggregates.length,
    submittedOrderCount,
    participatingStaffCount: staffIds.size,
    totalCents,
    companyCoveredCents,
    excessCents,
    excessCollectedCents,
    excessOutstandingCents,
  };
}

function buildStaffRows(
  aggregates: WeekAggregate[],
  userMap: Map<string, { email: string; firstName?: string; lastName?: string; name?: string }>,
): FinanceReportStaffRow[] {
  const byUser = new Map<string, FinanceReportStaffRow>();

  for (const aggregate of aggregates) {
    for (const order of aggregate.orders) {
      const recipientKey = getOrderRecipientKey(order);
      const user = order.userId ? userMap.get(order.userId.toString()) : null;
      const { staffName, staffEmail } = getOrderRecipientDisplay(
        order,
        user ?? undefined,
      );

      const existing = byUser.get(recipientKey) ?? {
        staffName,
        staffEmail,
        orderCount: 0,
        totalCents: 0,
        companyCoveredCents: 0,
        excessCents: 0,
        excessCollectedCents: 0,
        excessOutstandingCents: 0,
      };

      existing.orderCount += 1;
      existing.totalCents += order.totalCents;
      existing.companyCoveredCents += order.companyCoveredCents;
      existing.excessCents += order.excessCents;
      if (order.excessCents > 0 && order.excessPaidAt) {
        existing.excessCollectedCents += order.excessCents;
      }
      if (order.excessCents > 0 && !order.excessPaidAt) {
        existing.excessOutstandingCents += order.excessCents;
      }

      byUser.set(recipientKey, existing);
    }
  }

  return [...byUser.values()].sort((a, b) =>
    a.staffName.localeCompare(b.staffName, undefined, { sensitivity: "base" }),
  );
}

function buildVendorRows(aggregates: WeekAggregate[]): FinanceReportVendorRow[] {
  const byVendor = new Map<string, FinanceReportVendorRow & { weekIds: Set<string> }>();

  for (const aggregate of aggregates) {
    const vendorId = aggregate.vendor.id;
    const existing = byVendor.get(vendorId) ?? {
      vendorId,
      vendorName: aggregate.vendor.name,
      weekCount: 0,
      orderCount: 0,
      totalCents: 0,
      companyCoveredCents: 0,
      excessCents: 0,
      weekIds: new Set<string>(),
    };

    existing.weekIds.add(aggregate.menuWeek._id.toString());
    for (const order of aggregate.orders) {
      existing.orderCount += 1;
      existing.totalCents += order.totalCents;
      existing.companyCoveredCents += order.companyCoveredCents;
      existing.excessCents += order.excessCents;
    }

    byVendor.set(vendorId, existing);
  }

  return [...byVendor.values()]
    .map(({ weekIds, ...row }) => ({
      ...row,
      weekCount: weekIds.size,
    }))
    .sort((a, b) => a.vendorName.localeCompare(b.vendorName));
}

function groupIntoMonthlyBuckets(
  weekBuckets: FinanceReportBucket[],
  aggregates: WeekAggregate[],
  timezone: string,
): FinanceReportBucket[] {
  const byMonth = new Map<string, FinanceReportBucket>();
  const ordersByMonth = new Map<string, Set<string>>();

  for (const week of weekBuckets) {
    if (!week.weekStart) continue;

    const monthStart = DateTime.fromISO(week.weekStart, { zone: "utc" })
      .setZone(timezone)
      .startOf("month");
    const key = monthBucketKey(monthStart);

    const existing = byMonth.get(key) ?? {
      key,
      label: monthBucketLabel(monthStart),
      menuWeekIds: [],
      weekStart: null,
      status: null,
      vendor: null,
      orderCount: 0,
      participatingStaffCount: 0,
      totalCents: 0,
      companyCoveredCents: 0,
      excessCents: 0,
      excessCollectedCents: 0,
      excessOutstandingCents: 0,
    };

    existing.menuWeekIds.push(...week.menuWeekIds);
    existing.orderCount += week.orderCount;
    existing.totalCents += week.totalCents;
    existing.companyCoveredCents += week.companyCoveredCents;
    existing.excessCents += week.excessCents;
    existing.excessCollectedCents += week.excessCollectedCents;
    existing.excessOutstandingCents += week.excessOutstandingCents;

    byMonth.set(key, existing);
  }

  for (const aggregate of aggregates) {
    if (aggregate.orders.length === 0) continue;

    const monthStart = DateTime.fromJSDate(aggregate.menuWeek.weekStart, {
      zone: "utc",
    })
      .setZone(timezone)
      .startOf("month");
    const key = monthBucketKey(monthStart);
    const staffSet = ordersByMonth.get(key) ?? new Set<string>();

    for (const order of aggregate.orders) {
      staffSet.add(getOrderRecipientKey(order));
    }
    ordersByMonth.set(key, staffSet);
  }

  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, bucket]) => ({
      ...bucket,
      participatingStaffCount: ordersByMonth.get(key)?.size ?? 0,
    }));
}

export async function loadFinanceReport(
  workspaceId: string,
  fromInput: string,
  toInput: string,
  granularity: FinanceReportGranularity,
): Promise<FinanceReportResponse> {
  const chopspace = await Chopspace.findById(workspaceId);
  if (!chopspace) throw new Error("Chopspace not found");

  const timezone = chopspace.settings?.timezone ?? "Africa/Lagos";
  const from = DateTime.fromISO(fromInput, { zone: timezone }).startOf("day");
  const to = DateTime.fromISO(toInput, { zone: timezone }).endOf("day");

  if (!from.isValid || !to.isValid) {
    throw new Error("Invalid date range");
  }
  if (from > to) {
    throw new Error("Start date must be before end date");
  }

  const menuWeeks = await MenuWeek.find({
    workspaceId,
    weekStart: {
      $gte: from.toUTC().toJSDate(),
      $lte: to.toUTC().toJSDate(),
    },
  }).sort({ weekStart: 1 });

  const vendorIds = [...new Set(menuWeeks.map((w) => w.activeVendorId.toString()))];
  const vendors = await Vendor.find({ _id: { $in: vendorIds }, workspaceId });
  const vendorMap = new Map(vendors.map((v) => [v._id.toString(), v]));

  const menuWeekIds = menuWeeks.map((w) => w._id);
  const orders = await Order.find({
    workspaceId,
    menuWeekId: { $in: menuWeekIds },
    status: "SUBMITTED",
  });

  const ordersByWeek = new Map<string, OrderDocument[]>();
  for (const order of orders) {
    const weekId = order.menuWeekId.toString();
    const list = ordersByWeek.get(weekId) ?? [];
    list.push(order);
    ordersByWeek.set(weekId, list);
  }

  const userIds = [
    ...new Set(
      orders
        .map((o) => o.userId?.toString())
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const users = await User.find({ _id: { $in: userIds } });
  const userMap = new Map(
    users.map((u) => [
      u._id.toString(),
      {
        email: u.email,
        firstName: u.firstName,
        lastName: u.lastName,
        name: u.name,
      },
    ]),
  );

  const aggregates: WeekAggregate[] = menuWeeks.map((menuWeek) => {
    const vendor = vendorMap.get(menuWeek.activeVendorId.toString());
    return {
      menuWeek,
      vendor: {
        id: menuWeek.activeVendorId.toString(),
        name: vendor?.name ?? "Unknown vendor",
      },
      orders: ordersByWeek.get(menuWeek._id.toString()) ?? [],
    };
  });

  const weekBuckets = aggregates.map((a) => bucketFromWeekAggregate(a, timezone));
  const buckets =
    granularity === "month"
      ? groupIntoMonthlyBuckets(weekBuckets, aggregates, timezone)
      : weekBuckets;

  return {
    chopspace: {
      id: chopspace._id.toString(),
      name: chopspace.name,
      timezone,
    },
    period: {
      from: from.toISODate()!,
      to: to.toISODate()!,
      granularity,
    },
    summary: summaryFromWeekAggregates(aggregates),
    buckets,
    byVendor: buildVendorRows(aggregates),
    byStaff: buildStaffRows(aggregates, userMap),
  };
}

export function buildFinanceReportCsv(report: FinanceReportResponse): Buffer {
  const sections: string[] = [];

  sections.push(`Finance report — ${report.chopspace.name}`);
  sections.push(
    `Period: ${report.period.from} to ${report.period.to} (${report.period.granularity})`,
  );
  sections.push("");

  const summaryHeader = ["Metric", "Value"];
  const summaryRows = [
    ["Menu weeks", report.summary.menuWeekCount],
    ["Submitted orders", report.summary.submittedOrderCount],
    ["Participating staff", report.summary.participatingStaffCount],
    ["Total spend", formatNaira(report.summary.totalCents)],
    ["Company covered", formatNaira(report.summary.companyCoveredCents)],
    ["Staff excess", formatNaira(report.summary.excessCents)],
    ["Excess collected", formatNaira(report.summary.excessCollectedCents)],
    ["Excess outstanding", formatNaira(report.summary.excessOutstandingCents)],
  ];
  sections.push(stringify([summaryHeader, ...summaryRows], { quoted: true }));

  sections.push("");
  const bucketHeader = [
    report.period.granularity === "week" ? "Week" : "Month",
    "Vendor",
    "Orders",
    "Staff",
    "Total",
    "Company covered",
    "Excess",
    "Excess collected",
    "Excess outstanding",
  ];
  const bucketRows = report.buckets.map((bucket) => [
    bucket.label,
    bucket.vendor?.name ?? "—",
    bucket.orderCount,
    bucket.participatingStaffCount,
    formatNaira(bucket.totalCents),
    formatNaira(bucket.companyCoveredCents),
    formatNaira(bucket.excessCents),
    formatNaira(bucket.excessCollectedCents),
    formatNaira(bucket.excessOutstandingCents),
  ]);
  sections.push(stringify([bucketHeader, ...bucketRows], { quoted: true }));

  if (report.byVendor.length > 0) {
    sections.push("");
    const vendorHeader = [
      "Vendor",
      "Weeks",
      "Orders",
      "Total",
      "Company covered",
      "Excess",
    ];
    const vendorRows = report.byVendor.map((row) => [
      row.vendorName,
      row.weekCount,
      row.orderCount,
      formatNaira(row.totalCents),
      formatNaira(row.companyCoveredCents),
      formatNaira(row.excessCents),
    ]);
    sections.push(stringify([vendorHeader, ...vendorRows], { quoted: true }));
  }

  if (report.byStaff.length > 0) {
    sections.push("");
    const staffHeader = [
      "Staff",
      "Email",
      "Orders",
      "Total",
      "Company covered",
      "Excess",
      "Excess collected",
      "Excess outstanding",
    ];
    const staffRows = report.byStaff.map((row) => [
      row.staffName,
      row.staffEmail,
      row.orderCount,
      formatNaira(row.totalCents),
      formatNaira(row.companyCoveredCents),
      formatNaira(row.excessCents),
      formatNaira(row.excessCollectedCents),
      formatNaira(row.excessOutstandingCents),
    ]);
    sections.push(stringify([staffHeader, ...staffRows], { quoted: true }));
  }

  return Buffer.from(sections.join("\n"), "utf-8");
}

export function financeReportFilename(report: FinanceReportResponse): string {
  const range = `${report.period.from}_to_${report.period.to}`;
  return `obichops-finance-${range}.csv`;
}
