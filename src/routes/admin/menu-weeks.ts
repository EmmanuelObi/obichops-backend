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
import { MenuWeek, Order, ReminderLog, User, Vendor, VendorDispatch, Chopspace } from "../../models/index.js";
import { MENU_WEEK_STATUSES } from "../../models/MenuWeek.js";
import { DAYS_OF_WEEK } from "../../types/days.js";
import {
  getWorkspaceTimezone,
  getFilteredMenuForWeek,
  getPackMenuForWeek,
  serializeMenuWeek,
  serializeOrder,
} from "../../services/menuWeekService.js";
import {
  findProxyOrder,
  listProxyStaffRecipients,
  resolveProxyRecipient,
  submitProxyOrder,
  upsertProxyOrder,
  type ProxyRecipientInput,
} from "../../services/adminProxyOrder.js";
import { getOrderRecipientDisplay } from "../../services/orderRecipient.js";
import { serializeVendorPaymentFields } from "../../services/vendor.js";
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
import {
  buildDocxExport,
  buildVendorDocxExport,
} from "../../services/export/docxExport.js";
import { getOrderRecipientDisplay } from "../../services/orderRecipient.js";
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

    if (orderWindowClosesAt <= orderWindowOpensAt) {
      res.status(400).json({ error: "Ordering close time must be after open time" });
      return;
    }

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

    if (week.orderWindowClosesAt <= week.orderWindowOpensAt) {
      res.status(400).json({ error: "Ordering close time must be after open time" });
      return;
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
      const chopspace = await Chopspace.findById(workspaceId);
      try {
        const result = await sendOrderingOpenIfNeeded({
          workspaceId,
          week,
          timezone,
          settings: {
            reminderWindowOpen: chopspace?.settings?.reminderWindowOpen,
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
    const format =
      req.query.format === "pdf"
        ? "pdf"
        : req.query.format === "docx"
          ? "docx"
          : "csv";

    const data = await loadWeekExportData(workspaceId, String(id));
    const filename = exportFilename(data, format);

    if (format === "docx") {
      const buffer = await buildDocxExport(data);
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`,
      );
      res.setHeader("Content-Length", String(buffer.length));
      res.end(buffer);
      return;
    }

    if (format === "pdf") {
      const buffer = await buildPdfExport(data);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Length", String(buffer.length));
      res.end(buffer);
      return;
    }

    const buffer = buildCsvExport(data);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", String(buffer.length));
    res.end(buffer);
  }),
);

const sendVendorSchema = z.object({
  format: z.enum(["csv", "pdf", "docx"]),
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
        : body.format === "docx"
          ? await buildVendorDocxExport(data)
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
          contentType:
            body.format === "pdf"
              ? "application/pdf"
              : body.format === "docx"
                ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                : "text/csv",
        },
      ],
    });

    await VendorDispatch.create({
      workspaceId,
      menuWeekId: data.week._id,
      vendorId: data.week.activeVendorId,
      format: body.format.toUpperCase() as "PDF" | "CSV" | "DOCX",
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
    const userIds = [
      ...new Set(
        orders
          .map((o) => o.userId?.toString())
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const users = await User.find({ _id: { $in: userIds } });
    const userMap = new Map(users.map((u) => [u._id.toString(), u]));

    res.json({
      orders: orders.map((order) => {
        const user = order.userId ? userMap.get(order.userId.toString()) : null;
        const recipient = getOrderRecipientDisplay(order, user ?? undefined);
        return {
          id: order._id.toString(),
          userId: order.userId?.toString() ?? null,
          placedForName: order.placedForName?.trim() ?? null,
          isCustomRecipient: recipient.isCustom,
          placedByUserId: order.placedByUserId?.toString() ?? null,
          staffName: recipient.staffName,
          staffEmail: recipient.staffEmail,
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

const proxyLineItemSchema = z.object({
  menuItemId: z.string().min(1),
  dayOfWeek: z.enum(DAYS_OF_WEEK),
  quantity: z.number().multipleOf(0.5).min(0.5),
});

const proxyRecipientBodySchema = z.discriminatedUnion("recipientType", [
  z.object({
    recipientType: z.literal("STAFF"),
    userId: z.string().min(1),
  }),
  z.object({
    recipientType: z.literal("CUSTOM"),
    placedForName: z.string().trim().min(1).max(120),
  }),
]);

const proxyDayNoteSchema = z.object({
  dayOfWeek: z.enum(DAYS_OF_WEEK),
  note: z.string().max(300),
});

const upsertProxyOrderSchema = z.object({
  recipient: proxyRecipientBodySchema,
  lineItems: z.array(proxyLineItemSchema),
  dayNotes: z.array(proxyDayNoteSchema).optional(),
});

const submitProxyOrderSchema = z.object({
  orderId: z.string().min(1),
});

async function getWeekOr404(
  workspaceId: string,
  weekId: string,
  res: { status: (code: number) => { json: (body: unknown) => void } },
) {
  if (!mongoose.isValidObjectId(weekId)) {
    res.status(400).json({ error: "Invalid id" });
    return null;
  }
  const week = await MenuWeek.findOne({ _id: weekId, workspaceId });
  if (!week) {
    res.status(404).json({ error: "Menu week not found" });
    return null;
  }
  return week;
}

router.get(
  "/:id/ordering-context",
  asyncHandler(async (req, res) => {
    const workspaceId = requireWorkspaceContext(req as AuthenticatedRequest, res);
    if (!workspaceId) return;

    const week = await getWeekOr404(workspaceId, req.params.id, res);
    if (!week) return;

    const timezone = await getWorkspaceTimezone(workspaceId);
    const vendor = await Vendor.findOne({
      _id: week.activeVendorId,
      workspaceId,
    });
    const vendorId = week.activeVendorId.toString();
    const [menu, packMenu] = await Promise.all([
      getFilteredMenuForWeek(workspaceId, vendorId, week.orderableDays),
      getPackMenuForWeek(workspaceId, vendorId, week.orderableDays),
    ]);

    res.json({
      menuWeek: serializeMenuWeek(week, timezone),
      vendor: vendor
        ? {
            id: vendor._id.toString(),
            name: vendor.name,
            email: vendor.email,
            ...serializeVendorPaymentFields(vendor),
          }
        : null,
      menu,
      packMenu,
    });
  }),
);

router.get(
  "/:id/proxy-recipients",
  asyncHandler(async (req, res) => {
    const workspaceId = requireWorkspaceContext(req as AuthenticatedRequest, res);
    if (!workspaceId) return;

    const week = await getWeekOr404(workspaceId, req.params.id, res);
    if (!week) return;

    const staff = await listProxyStaffRecipients(workspaceId, week._id);
    res.json({ staff });
  }),
);

router.get(
  "/:id/proxy-order",
  asyncHandler(async (req, res) => {
    const workspaceId = requireWorkspaceContext(req as AuthenticatedRequest, res);
    if (!workspaceId) return;

    const week = await getWeekOr404(workspaceId, req.params.id, res);
    if (!week) return;

    const orderId =
      typeof req.query.orderId === "string" ? req.query.orderId : null;
    if (orderId) {
      if (!mongoose.isValidObjectId(orderId)) {
        res.status(400).json({ error: "Invalid order id" });
        return;
      }
      const order = await Order.findOne({
        _id: orderId,
        workspaceId,
        menuWeekId: week._id,
      });
      if (!order) {
        res.json({ order: null, recipient: null });
        return;
      }
      const recipient =
        order.userId != null
          ? {
              recipientType: "STAFF" as const,
              userId: order.userId.toString(),
              placedForName: null,
              displayName:
                (
                  await User.findById(order.userId)
                )?.email ?? "Staff member",
            }
          : {
              recipientType: "CUSTOM" as const,
              userId: null,
              placedForName: order.placedForName ?? "",
              displayName: order.placedForName?.trim() || "Custom recipient",
            };
      if (recipient.recipientType === "STAFF") {
        const user = await User.findById(order.userId);
        if (user) {
          recipient.displayName =
            [user.firstName?.trim(), user.lastName?.trim()]
              .filter(Boolean)
              .join(" ") ||
            user.name?.trim() ||
            user.email;
        }
      }
      res.json({ order: serializeOrder(order), recipient });
      return;
    }

    const userId = typeof req.query.userId === "string" ? req.query.userId : null;
    const placedForName =
      typeof req.query.placedForName === "string" ? req.query.placedForName : null;

    let recipientInput: ProxyRecipientInput | null = null;
    if (userId) {
      recipientInput = { recipientType: "STAFF", userId };
    } else if (placedForName?.trim()) {
      recipientInput = { recipientType: "CUSTOM", placedForName };
    } else {
      res.status(400).json({ error: "Provide orderId, userId, or placedForName" });
      return;
    }

    try {
      const recipient = await resolveProxyRecipient(workspaceId, recipientInput);
      const order = await findProxyOrder(workspaceId, week._id, recipient);
      res.json({
        order: order ? serializeOrder(order) : null,
        recipient: {
          recipientType: recipient.type,
          userId: recipient.userId?.toString() ?? null,
          placedForName: recipient.placedForName ?? null,
          displayName: recipient.displayName,
        },
      });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : "Invalid recipient",
      });
    }
  }),
);

router.put(
  "/:id/proxy-order",
  asyncHandler(async (req, res) => {
    const auth = (req as AuthenticatedRequest).auth!;
    const workspaceId = requireWorkspaceContext(req as AuthenticatedRequest, res);
    if (!workspaceId) return;

    const week = await getWeekOr404(workspaceId, req.params.id, res);
    if (!week) return;

    const body = upsertProxyOrderSchema.parse(req.body);

    try {
      const recipient = await resolveProxyRecipient(workspaceId, body.recipient);
      const order = await upsertProxyOrder({
        workspaceId,
        menuWeek: week,
        adminUserId: auth.sub,
        recipient,
        lineItems: body.lineItems,
        dayNotes: body.dayNotes,
      });
      res.json({ order });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : "Could not save order",
      });
    }
  }),
);

router.post(
  "/:id/proxy-order/submit",
  asyncHandler(async (req, res) => {
    const auth = (req as AuthenticatedRequest).auth!;
    const workspaceId = requireWorkspaceContext(req as AuthenticatedRequest, res);
    if (!workspaceId) return;

    const week = await getWeekOr404(workspaceId, req.params.id, res);
    if (!week) return;

    const body = submitProxyOrderSchema.parse(req.body);

    try {
      const order = await submitProxyOrder({
        workspaceId,
        menuWeek: week,
        adminUserId: auth.sub,
        orderId: body.orderId,
      });
      res.json({ order });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not submit order";
      const excessCents =
        err instanceof Error && "excessCents" in err
          ? (err as Error & { excessCents?: number }).excessCents
          : undefined;
      res.status(400).json({
        error: message,
        ...(excessCents !== undefined ? { excessCents } : {}),
      });
    }
  }),
);

export default router;
