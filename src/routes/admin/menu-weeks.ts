import { Router } from "express";
import { z } from "zod";
import mongoose from "mongoose";
import { DateTime } from "luxon";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import {
  requireAdmin,
  requireAuth,
  type AuthenticatedRequest,
} from "../../middleware/auth.js";
import { requireWorkspaceContext } from "../../middleware/workspace.js";
import { MenuWeek, Order, ReminderLog, User, Vendor, VendorDispatch, Workspace } from "../../models/index.js";
import { MENU_WEEK_STATUSES } from "../../models/MenuWeek.js";
import { DAYS_OF_WEEK } from "../../types/days.js";
import {
  getWorkspaceTimezone,
  serializeMenuWeek,
} from "../../services/menuWeekService.js";
import {
  computeDefaultOrderWindow,
  DEFAULT_MAX_ORDER_AMOUNT_CENTS,
  DEFAULT_MAX_ORDER_DAYS_PER_STAFF,
  DEFAULT_ORDERABLE_DAYS,
} from "../../services/menuWeekWindow.js";
import { loadWeekExportData, weekDateRangeLabel } from "../../services/export/loadExportData.js";
import {
  buildCsvExport,
  buildVendorCsvExport,
  exportFilename,
} from "../../services/export/csvExport.js";
import {
  buildPdfExport,
  buildVendorPdfExport,
} from "../../services/export/pdfExport.js";
import { getUserDisplayName } from "../../services/userDisplay.js";
import { getExcessPaymentStatus } from "../../types/excessPayment.js";
import { sendOrderingOpenIfNeeded } from "../../services/reminders/sendOrderingOpen.js";

const router = Router();

router.use(requireAuth, requireAdmin);

const createMenuWeekSchema = z.object({
  weekStart: z.string().datetime({ offset: true }).or(z.string().date()),
  activeVendorId: z.string().min(1),
  orderableDays: z.array(z.enum(DAYS_OF_WEEK)).min(1).optional(),
  maxOrderAmountCents: z.number().int().min(0).optional(),
  maxOrderDaysPerStaff: z.number().int().min(1).optional(),
  orderWindowOpensAt: z.string().datetime({ offset: true }).optional(),
  orderWindowClosesAt: z.string().datetime({ offset: true }).optional(),
});

const updateMenuWeekSchema = z.object({
  activeVendorId: z.string().min(1).optional(),
  orderableDays: z.array(z.enum(DAYS_OF_WEEK)).min(1).optional(),
  maxOrderAmountCents: z.number().int().min(0).optional(),
  maxOrderDaysPerStaff: z.number().int().min(1).optional(),
  orderWindowOpensAt: z.string().datetime({ offset: true }).optional(),
  orderWindowClosesAt: z.string().datetime({ offset: true }).optional(),
  status: z.enum(MENU_WEEK_STATUSES).optional(),
});

function parseWeekStart(value: string, timezone: string): Date {
  const dt = value.includes("T")
    ? DateTime.fromISO(value, { zone: timezone })
    : DateTime.fromISO(value, { zone: timezone }).startOf("day");
  return dt.toUTC().toJSDate();
}

function validateMaxOrderDays(
  maxOrderDaysPerStaff: number,
  orderableDays: string[],
): string | null {
  if (maxOrderDaysPerStaff > orderableDays.length) {
    return "Max order days per staff cannot exceed the number of orderable days";
  }
  return null;
}

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const workspaceId = requireWorkspaceContext(req as AuthenticatedRequest, res);
    if (!workspaceId) return;

    const timezone = await getWorkspaceTimezone(workspaceId);
    const weeks = await MenuWeek.find({ workspaceId }).sort({ weekStart: -1 });
    res.json({ menuWeeks: weeks.map((w) => serializeMenuWeek(w, timezone)) });
  }),
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const workspaceId = requireWorkspaceContext(req as AuthenticatedRequest, res);
    if (!workspaceId) return;

    const body = createMenuWeekSchema.parse(req.body);
    const timezone = await getWorkspaceTimezone(workspaceId);
    const weekStart = parseWeekStart(body.weekStart, timezone);

    const vendor = await Vendor.findOne({
      _id: body.activeVendorId,
      workspaceId,
      isActive: true,
    });
    if (!vendor) {
      res.status(400).json({ error: "Invalid or inactive vendor" });
      return;
    }

    const defaults = computeDefaultOrderWindow(weekStart, timezone);
    const orderWindowOpensAt = body.orderWindowOpensAt
      ? DateTime.fromISO(body.orderWindowOpensAt, { zone: timezone }).toUTC().toJSDate()
      : defaults.orderWindowOpensAt;
    const orderWindowClosesAt = body.orderWindowClosesAt
      ? DateTime.fromISO(body.orderWindowClosesAt, { zone: timezone }).toUTC().toJSDate()
      : defaults.orderWindowClosesAt;

    const orderableDays = body.orderableDays ?? DEFAULT_ORDERABLE_DAYS;
    const maxOrderDaysPerStaff =
      body.maxOrderDaysPerStaff ?? DEFAULT_MAX_ORDER_DAYS_PER_STAFF;
    const maxDaysError = validateMaxOrderDays(maxOrderDaysPerStaff, orderableDays);
    if (maxDaysError) {
      res.status(400).json({ error: maxDaysError });
      return;
    }

    const week = await MenuWeek.create({
      workspaceId,
      weekStart,
      activeVendorId: vendor._id,
      orderableDays,
      maxOrderAmountCents:
        body.maxOrderAmountCents ?? DEFAULT_MAX_ORDER_AMOUNT_CENTS,
      maxOrderDaysPerStaff,
      orderWindowOpensAt,
      orderWindowClosesAt,
      status: "DRAFT",
    });

    res.status(201).json({ menuWeek: serializeMenuWeek(week, timezone) });
  }),
);

router.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const workspaceId = requireWorkspaceContext(req as AuthenticatedRequest, res);
    if (!workspaceId) return;

    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    const week = await MenuWeek.findOne({ _id: id, workspaceId });
    if (!week) {
      res.status(404).json({ error: "Menu week not found" });
      return;
    }

    const body = updateMenuWeekSchema.parse(req.body);
    const timezone = await getWorkspaceTimezone(workspaceId);

    if (week.status !== "DRAFT") {
      const lockedFields = [
        "activeVendorId",
        "orderableDays",
        "maxOrderAmountCents",
        "maxOrderDaysPerStaff",
        "orderWindowOpensAt",
        "orderWindowClosesAt",
      ] as const;
      for (const field of lockedFields) {
        if (body[field] !== undefined) {
          res.status(400).json({
            error: `Cannot change ${field} while week is ${week.status}`,
          });
          return;
        }
      }
    }

    if (body.activeVendorId) {
      const vendor = await Vendor.findOne({
        _id: body.activeVendorId,
        workspaceId,
        isActive: true,
      });
      if (!vendor) {
        res.status(400).json({ error: "Invalid or inactive vendor" });
        return;
      }
      week.activeVendorId = vendor._id;
    }

    if (body.orderableDays) week.orderableDays = body.orderableDays;
    if (body.maxOrderAmountCents !== undefined) {
      week.maxOrderAmountCents = body.maxOrderAmountCents;
    }
    if (body.maxOrderDaysPerStaff !== undefined) {
      week.maxOrderDaysPerStaff = body.maxOrderDaysPerStaff;
    }

    const maxDaysError = validateMaxOrderDays(
      week.maxOrderDaysPerStaff,
      week.orderableDays,
    );
    if (maxDaysError) {
      res.status(400).json({ error: maxDaysError });
      return;
    }

    if (body.orderWindowOpensAt) {
      week.orderWindowOpensAt = DateTime.fromISO(body.orderWindowOpensAt, {
        zone: timezone,
      })
        .toUTC()
        .toJSDate();
    }
    if (body.orderWindowClosesAt) {
      week.orderWindowClosesAt = DateTime.fromISO(body.orderWindowClosesAt, {
        zone: timezone,
      })
        .toUTC()
        .toJSDate();
    }

    const openingWeek = body.status === "OPEN" && week.status === "DRAFT";
    let openNotificationSent = false;
    let openNotificationError: string | undefined;

    if (body.status) {
      if (openingWeek) {
        const now = new Date();
        if (now < week.orderWindowOpensAt) {
          week.orderWindowOpensAt = now;
        }
        week.status = "OPEN";
      } else if (body.status === "CLOSED") {
        week.status = "CLOSED";
      } else if (body.status === "DRAFT" && week.status === "DRAFT") {
        week.status = "DRAFT";
      } else if (body.status !== week.status) {
        res.status(400).json({ error: "Invalid status transition" });
        return;
      }
    }

    await week.save();

    if (openingWeek) {
      const workspace = await Workspace.findById(workspaceId);
      try {
        const result = await sendOrderingOpenIfNeeded({
          workspaceId,
          week,
          timezone,
          settings: {
            reminderWindowOpen: workspace?.settings?.reminderWindowOpen,
          },
        });
        openNotificationSent = result.sent;
      } catch (err) {
        openNotificationError =
          err instanceof Error ? err.message : "Failed to send open notification";
        console.error("Open notification failed:", err);
      }
    }

    res.json({
      menuWeek: serializeMenuWeek(week, timezone),
      ...(openingWeek
        ? { openNotificationSent, openNotificationError }
        : {}),
    });
  }),
);

router.get(
  "/:id/reminders",
  asyncHandler(async (req, res) => {
    const workspaceId = requireWorkspaceContext(req as AuthenticatedRequest, res);
    if (!workspaceId) return;

    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    const week = await MenuWeek.findOne({ _id: id, workspaceId });
    if (!week) {
      res.status(404).json({ error: "Menu week not found" });
      return;
    }

    const logs = await ReminderLog.find({ menuWeekId: week._id }).sort({ sentAt: -1 });
    res.json({
      reminders: logs.map((log) => ({
        id: log._id.toString(),
        type: log.type,
        sentAt: log.sentAt,
        recipientCount: log.recipientCount,
      })),
    });
  }),
);

router.get(
  "/:id/export",
  asyncHandler(async (req, res) => {
    const workspaceId = requireWorkspaceContext(req as AuthenticatedRequest, res);
    if (!workspaceId) return;

    const { id } = req.params;
    const format = req.query.format === "pdf" ? "pdf" : "csv";

    const data = await loadWeekExportData(workspaceId, String(id));
    const filename = exportFilename(data, format);

    if (format === "pdf") {
      const buffer = await buildPdfExport(data);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(buffer);
      return;
    }

    const buffer = buildCsvExport(data);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buffer);
  }),
);

const sendVendorSchema = z.object({
  format: z.enum(["csv", "pdf"]),
});

router.post(
  "/:id/send-vendor",
  asyncHandler(async (req, res) => {
    const auth = (req as AuthenticatedRequest).auth!;
    const workspaceId = requireWorkspaceContext(req as AuthenticatedRequest, res);
    if (!workspaceId) return;

    const { id } = req.params;
    const body = sendVendorSchema.parse(req.body);
    const data = await loadWeekExportData(workspaceId, String(id), { vendorOnly: true });

    const buffer =
      body.format === "pdf"
        ? await buildVendorPdfExport(data)
        : buildVendorCsvExport(data);
    const filename = exportFilename(data, body.format);
    const weekLabel = weekDateRangeLabel(data.week.weekStart, data.timezone);

    const email = getEmailAdapter();
    await email.send({
      to: data.vendorEmail,
      subject: `Weekly Meal Order — Week of ${weekLabel}`,
      html: `<p>Please find attached the consolidated meal order for the week of <strong>${weekLabel}</strong>.</p><p>— ${data.workspaceName}</p>`,
      text: `Weekly meal order for week of ${weekLabel} attached.`,
      attachments: [
        {
          filename,
          content: buffer,
          contentType: body.format === "pdf" ? "application/pdf" : "text/csv",
        },
      ],
    });

    await VendorDispatch.create({
      workspaceId,
      menuWeekId: data.week._id,
      vendorId: data.week.activeVendorId,
      format: body.format.toUpperCase() as "PDF" | "CSV",
      sentAt: new Date(),
      sentByUserId: auth.sub,
    });

    res.json({
      message: "Order sent to vendor",
      vendorEmail: data.vendorEmail,
      format: body.format,
    });
  }),
);

router.get(
  "/:id/orders",
  asyncHandler(async (req, res) => {
    const workspaceId = requireWorkspaceContext(req as AuthenticatedRequest, res);
    if (!workspaceId) return;

    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    const week = await MenuWeek.findOne({ _id: id, workspaceId });
    if (!week) {
      res.status(404).json({ error: "Menu week not found" });
      return;
    }

    const filter: Record<string, unknown> = { workspaceId, menuWeekId: week._id };
    if (req.query.hasExcess === "true") {
      filter.excessCents = { $gt: 0 };
    }

    const orders = await Order.find(filter).sort({ submittedAt: -1, updatedAt: -1 });
    const userIds = [...new Set(orders.map((o) => o.userId.toString()))];
    const users = await User.find({ _id: { $in: userIds } });
    const userMap = new Map(users.map((u) => [u._id.toString(), u]));

    res.json({
      orders: orders.map((order) => {
        const user = userMap.get(order.userId.toString());
        return {
          id: order._id.toString(),
          userId: order.userId.toString(),
          staffName: user
            ? getUserDisplayName({
                firstName: user.firstName,
                lastName: user.lastName,
                name: user.name,
                email: user.email,
              })
            : "Unknown",
          staffEmail: user?.email ?? "",
          status: order.status,
          totalCents: order.totalCents,
          companyCoveredCents: order.companyCoveredCents,
          excessCents: order.excessCents,
          excessAcknowledged: order.excessAcknowledged,
          excessPaymentStatus: getExcessPaymentStatus(order),
          excessPaymentProofUploadedAt:
            order.excessPaymentProofUploadedAt?.toISOString() ?? null,
          excessPaidAt: order.excessPaidAt?.toISOString() ?? null,
          submittedAt: order.submittedAt ?? null,
          lineItemCount: order.lineItems.length,
        };
      }),
    });
  }),
);

export default router;
