import mongoose from "mongoose";
import {
  AllowedEmail,
  MenuWeek,
  Order,
  User,
  Vendor,
  Workspace,
  type WorkspaceDocument,
} from "../models/index.js";
import {
  DEFAULT_MAX_ORDER_AMOUNT_CENTS,
  DEFAULT_TIMEZONE,
} from "./menuWeekWindow.js";
import { getWorkspaceTimezone, serializeMenuWeek, serializeOrder } from "./menuWeekService.js";
import { getOrderRecipientDisplay } from "./orderRecipient.js";
import { listPlatformAuditLog } from "./platformAudit.js";

export interface WorkspaceListStats {
  activeTeamCount: number;
  vendorCount: number;
  currentMenuWeekStatus: string | null;
  submittedOrdersCount: number;
  lastActivityAt: string | null;
}

export interface WorkspaceSettingsView {
  timezone: string;
  allowedEmailDomains: string[];
  defaultMaxOrderAmountCents: number;
}

export interface PlatformAttentionItem {
  workspaceId: string;
  name: string;
  slug: string;
  reason: "suspended" | "no_admin" | "no_activity" | "no_orders";
  details: string;
}

export interface PlatformDashboard {
  totals: {
    workspaces: number;
    activeWorkspaces: number;
    suspendedWorkspaces: number;
    activeTeamMembers: number;
    openMenuWeeks: number;
    submittedOrdersThisWeek: number;
  };
  attention: PlatformAttentionItem[];
  recentActivity: Awaited<ReturnType<typeof listPlatformAuditLog>>;
}

function serializeWorkspaceSettings(
  settings: WorkspaceDocument["settings"] | undefined,
): WorkspaceSettingsView {
  return {
    timezone: settings?.timezone ?? DEFAULT_TIMEZONE,
    allowedEmailDomains:
      (settings?.allowedEmailDomains as string[] | undefined) ?? [],
    defaultMaxOrderAmountCents:
      settings?.defaultMaxOrderAmountCents ?? DEFAULT_MAX_ORDER_AMOUNT_CENTS,
  };
}

function serializeWorkspace(doc: WorkspaceDocument) {
  return {
    id: doc._id.toString(),
    name: doc.name,
    slug: doc.slug,
    isActive: doc.isActive,
    settings: serializeWorkspaceSettings(doc.settings),
    createdAt: doc.createdAt?.toISOString(),
    updatedAt: doc.updatedAt?.toISOString(),
  };
}

export async function getWorkspaceListStats(
  workspaceId: string,
): Promise<WorkspaceListStats> {
  const workspaceObjectId = new mongoose.Types.ObjectId(workspaceId);

  const [activeTeamCount, vendorCount, openWeek, latestWeek, latestOrder] =
    await Promise.all([
      AllowedEmail.countDocuments({ workspaceId, isActive: true }),
      Vendor.countDocuments({ workspaceId, isActive: true }),
      MenuWeek.findOne({ workspaceId, status: "OPEN" }).sort({ weekStart: -1 }),
      MenuWeek.findOne({ workspaceId }).sort({ weekStart: -1 }),
      Order.findOne({ workspaceId, status: "SUBMITTED" }).sort({
        submittedAt: -1,
      }),
    ]);

  const focusWeek = openWeek ?? latestWeek;
  const submittedOrdersCount = focusWeek
    ? await Order.countDocuments({
        workspaceId,
        menuWeekId: focusWeek._id,
        status: "SUBMITTED",
      })
    : 0;

  const activityCandidates = [
    latestOrder?.submittedAt,
    focusWeek?.updatedAt,
    focusWeek?.createdAt,
  ].filter((value): value is Date => value instanceof Date);

  const lastActivityAt =
    activityCandidates.length > 0
      ? new Date(
          Math.max(...activityCandidates.map((value) => value.getTime())),
        ).toISOString()
      : null;

  return {
    activeTeamCount,
    vendorCount,
    currentMenuWeekStatus: focusWeek?.status ?? null,
    submittedOrdersCount,
    lastActivityAt,
  };
}

export async function listWorkspacesWithStats() {
  const workspaces = await Workspace.find().sort({ createdAt: -1 });
  const stats = await Promise.all(
    workspaces.map((workspace) => getWorkspaceListStats(workspace._id.toString())),
  );

  return workspaces.map((workspace, index) => ({
    ...serializeWorkspace(workspace),
    stats: stats[index],
  }));
}

export async function getWorkspaceOverview(workspaceId: string) {
  if (!mongoose.isValidObjectId(workspaceId)) {
    return null;
  }

  const workspace = await Workspace.findById(workspaceId);
  if (!workspace) {
    return null;
  }

  const timezone = await getWorkspaceTimezone(workspaceId);
  const stats = await getWorkspaceListStats(workspaceId);

  const [recentWeeks, activeStaffCount, adminCount, recentOrders, vendors] =
    await Promise.all([
      MenuWeek.find({ workspaceId }).sort({ weekStart: -1 }).limit(6),
      User.countDocuments({ workspaceId, role: "STAFF", isActive: true }),
      User.countDocuments({ workspaceId, role: "ADMIN", isActive: true }),
      Order.find({ workspaceId, status: "SUBMITTED" })
        .sort({ submittedAt: -1 })
        .limit(10),
      Vendor.find({ workspaceId }).sort({ name: 1 }),
    ]);

  const weekIds = recentWeeks.map((week) => week._id);
  const orderCounts = await Order.aggregate<{ _id: mongoose.Types.ObjectId; count: number }>([
    {
      $match: {
        workspaceId: workspaceObjectId(workspaceId),
        menuWeekId: { $in: weekIds },
        status: "SUBMITTED",
      },
    },
    { $group: { _id: "$menuWeekId", count: { $sum: 1 } } },
  ]);
  const orderCountByWeek = new Map(
    orderCounts.map((row) => [row._id.toString(), row.count]),
  );

  const userIds = [
    ...new Set(
      recentOrders
        .map((order) => order.userId?.toString())
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const users = await User.find({ _id: { $in: userIds }, workspaceId });
  const userMap = new Map(users.map((user) => [user._id.toString(), user]));

  return {
    workspace: serializeWorkspace(workspace),
    stats: {
      ...stats,
      activeStaffCount,
      adminCount,
      totalVendors: vendors.length,
      activeVendors: vendors.filter((vendor) => vendor.isActive).length,
    },
    recentMenuWeeks: recentWeeks.map((week) => ({
      ...serializeMenuWeek(week, timezone),
      submittedOrderCount: orderCountByWeek.get(week._id.toString()) ?? 0,
    })),
    vendors: vendors.map((vendor) => ({
      id: vendor._id.toString(),
      name: vendor.name,
      email: vendor.email,
      isActive: vendor.isActive,
    })),
    recentOrders: recentOrders.map((order) => {
      const user = order.userId
        ? userMap.get(order.userId.toString()) ?? null
        : null;
      const recipient = getOrderRecipientDisplay(order, user);
      return {
        ...serializeOrder(order),
        recipientName: recipient.staffName,
        recipientEmail: recipient.staffEmail || null,
        isCustomRecipient: recipient.isCustom,
      };
    }),
  };
}

function workspaceObjectId(workspaceId: string) {
  return new mongoose.Types.ObjectId(workspaceId);
}

export async function getPlatformDashboard(): Promise<PlatformDashboard> {
  const workspaces = await Workspace.find().sort({ createdAt: -1 });
  const workspaceStats = await Promise.all(
    workspaces.map((workspace) => getWorkspaceListStats(workspace._id.toString())),
  );

  const adminCounts = await Promise.all(
    workspaces.map((workspace) =>
      User.countDocuments({
        workspaceId: workspace._id,
        role: "ADMIN",
        isActive: true,
      }),
    ),
  );

  const openMenuWeeks = await MenuWeek.countDocuments({ status: "OPEN" });
  const openWeeks = await MenuWeek.find({ status: "OPEN" }).select("_id workspaceId");
  const submittedOrdersThisWeek = openWeeks.length
    ? await Order.countDocuments({
        menuWeekId: { $in: openWeeks.map((week) => week._id) },
        status: "SUBMITTED",
      })
    : 0;

  const activeTeamMembers = workspaceStats.reduce(
    (sum, stats) => sum + stats.activeTeamCount,
    0,
  );

  const attention: PlatformAttentionItem[] = [];
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

  workspaces.forEach((workspace, index) => {
    const stats = workspaceStats[index];
    const adminCount = adminCounts[index];

    if (!workspace.isActive) {
      attention.push({
        workspaceId: workspace._id.toString(),
        name: workspace.name,
        slug: workspace.slug,
        reason: "suspended",
        details: "Workspace is suspended",
      });
      return;
    }

    if (adminCount === 0) {
      attention.push({
        workspaceId: workspace._id.toString(),
        name: workspace.name,
        slug: workspace.slug,
        reason: "no_admin",
        details: "No active workspace admin",
      });
    }

    if (
      stats.activeTeamCount > 0 &&
      stats.submittedOrdersCount === 0 &&
      stats.currentMenuWeekStatus === "OPEN"
    ) {
      attention.push({
        workspaceId: workspace._id.toString(),
        name: workspace.name,
        slug: workspace.slug,
        reason: "no_orders",
        details: "Open ordering week with no submitted orders",
      });
    }

    if (
      !stats.lastActivityAt ||
      new Date(stats.lastActivityAt).getTime() < thirtyDaysAgo
    ) {
      attention.push({
        workspaceId: workspace._id.toString(),
        name: workspace.name,
        slug: workspace.slug,
        reason: "no_activity",
        details: stats.lastActivityAt
          ? "No activity in the last 30 days"
          : "No recorded activity yet",
      });
    }
  });

  const recentActivity = await listPlatformAuditLog({ limit: 15 });

  return {
    totals: {
      workspaces: workspaces.length,
      activeWorkspaces: workspaces.filter((workspace) => workspace.isActive).length,
      suspendedWorkspaces: workspaces.filter((workspace) => !workspace.isActive).length,
      activeTeamMembers,
      openMenuWeeks,
      submittedOrdersThisWeek,
    },
    attention,
    recentActivity,
  };
}
