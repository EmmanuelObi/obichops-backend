import { Router } from "express";
import { z } from "zod";
import mongoose from "mongoose";
import { asyncHandler } from "../middleware/asyncHandler.js";
import {
  requireAuth,
  type AuthenticatedRequest,
} from "../middleware/auth.js";
import { requireStaff } from "../middleware/requireStaff.js";
import {
  requireActiveWorkspace,
  requireWorkspaceContext,
} from "../middleware/workspace.js";
import { MenuWeek, Order, Vendor } from "../models/index.js";
import { DAYS_OF_WEEK } from "../types/days.js";
import {
  applyTotalsToLineItems,
  findCurrentMenuWeek,
  serializeOrder,
  validateAndPriceLineItems,
} from "../services/menuWeekService.js";
import {
  assertOrderHasUploadableExcess,
  assertOrderOwnedByUser,
  getOrderForUser,
  listStaffOrderHistory,
} from "../services/staffOrderHistory.js";
import {
  buildExcessPaymentS3Key,
  createExcessPaymentDownloadUrl,
  createExcessPaymentUploadUrl,
  deleteExcessPaymentObject,
  isExcessPaymentS3KeyForOrder,
  validateExcessPaymentUploadRequest,
  verifyExcessPaymentObject,
} from "../services/s3.js";
import { isOrderingAllowed as checkOrderingAllowed } from "../services/menuWeekWindow.js";
import { daysFromLineItems, sanitizeDayNotes } from "../services/orderNotes.js";
import { vendorHasPaymentDetails } from "../services/vendor.js";
import {
  ReviewNotAllowedError,
  upsertReview,
} from "../services/vendorReview.js";

const router = Router();

router.use(requireAuth, requireActiveWorkspace, requireStaff);

const lineItemSchema = z.object({
  menuItemId: z.string().min(1),
  dayOfWeek: z.enum(DAYS_OF_WEEK),
  quantity: z.number().multipleOf(0.5).min(0.5),
});

const dayNoteSchema = z.object({
  dayOfWeek: z.enum(DAYS_OF_WEEK),
  note: z.string().max(300),
});

const upsertOrderSchema = z.object({
  menuWeekId: z.string().min(1),
  lineItems: z.array(lineItemSchema),
  dayNotes: z.array(dayNoteSchema).optional(),
});

const submitOrderSchema = z.object({
  menuWeekId: z.string().min(1),
});

async function clearExcessPaymentProof(order: {
  excessPaymentProofS3Key?: string | null;
}): Promise<void> {
  if (!order.excessPaymentProofS3Key) return;
  try {
    await deleteExcessPaymentObject(order.excessPaymentProofS3Key);
  } catch {
    // Best effort cleanup.
  }
}

function excessProofClearFields() {
  return {
    excessPaymentProofS3Key: null,
    excessPaymentProofFilename: null,
    excessPaymentProofMimeType: null,
    excessPaymentProofUploadedAt: null,
  };
}

const excessProofUploadUrlSchema = z.object({
  filename: z.string().trim().min(1),
  mimeType: z.string().trim().min(1),
  sizeBytes: z.number().int().positive(),
});

const excessProofConfirmSchema = z.object({
  storageKey: z.string().trim().min(1),
  filename: z.string().trim().min(1),
  mimeType: z.string().trim().min(1),
  sizeBytes: z.number().int().positive(),
});

const vendorReviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(500).optional(),
});

async function getMenuWeekForOrder(
  workspaceId: string,
  menuWeekId: string,
) {
  if (!mongoose.isValidObjectId(menuWeekId)) return null;
  return MenuWeek.findOne({ _id: menuWeekId, workspaceId });
}

router.get(
  "/me",
  asyncHandler(async (req, res) => {
    const auth = (req as AuthenticatedRequest).auth!;
    const workspaceId = requireWorkspaceContext(req as AuthenticatedRequest, res);
    if (!workspaceId) return;

    const weekId = typeof req.query.weekId === "string" ? req.query.weekId : null;
    let menuWeekId = weekId;

    if (!menuWeekId) {
      const current = await findCurrentMenuWeek(workspaceId);
      menuWeekId = current?._id.toString() ?? null;
    }

    if (!menuWeekId) {
      res.json({ order: null });
      return;
    }

    const order = await Order.findOne({
      userId: auth.sub,
      menuWeekId,
      workspaceId,
    });

    res.json({ order: order ? serializeOrder(order) : null });
  }),
);

router.get(
  "/me/history",
  asyncHandler(async (req, res) => {
    const auth = (req as AuthenticatedRequest).auth!;
    const workspaceId = requireWorkspaceContext(req as AuthenticatedRequest, res);
    if (!workspaceId) return;

    const history = await listStaffOrderHistory(workspaceId, auth.sub);
    res.json(history);
  }),
);

router.put(
  "/me/history/:menuWeekId/review",
  asyncHandler(async (req, res) => {
    const auth = (req as AuthenticatedRequest).auth!;
    const workspaceId = requireWorkspaceContext(req as AuthenticatedRequest, res);
    if (!workspaceId) return;

    const menuWeekId = String(req.params.menuWeekId ?? "");
    const body = vendorReviewSchema.parse(req.body);

    try {
      const review = await upsertReview({
        workspaceId,
        userId: auth.sub,
        menuWeekId,
        rating: body.rating,
        comment: body.comment,
      });
      res.json({ review });
    } catch (err) {
      if (err instanceof ReviewNotAllowedError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  }),
);

router.post(
  "/me/:orderId/excess-payment-proof/upload-url",
  asyncHandler(async (req, res) => {
    const auth = (req as AuthenticatedRequest).auth!;
    const workspaceId = requireWorkspaceContext(req as AuthenticatedRequest, res);
    if (!workspaceId) return;

    const orderId = String(req.params.orderId ?? "");
    const body = excessProofUploadUrlSchema.parse(req.body);
    const order = await getOrderForUser(workspaceId, auth.sub, orderId);

    if (!assertOrderOwnedByUser(order, workspaceId, auth.sub)) {
      res.status(404).json({ error: "Order not found" });
      return;
    }

    try {
      assertOrderHasUploadableExcess(order);
      validateExcessPaymentUploadRequest(body);
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : "Invalid upload request",
      });
      return;
    }

    const storageKey = buildExcessPaymentS3Key(workspaceId, orderId, body.filename);
    const { uploadUrl, expiresInSeconds } = await createExcessPaymentUploadUrl({
      storageKey,
      mimeType: body.mimeType,
      sizeBytes: body.sizeBytes,
    });

    res.json({ storageKey, uploadUrl, expiresInSeconds });
  }),
);

router.post(
  "/me/:orderId/excess-payment-proof/confirm",
  asyncHandler(async (req, res) => {
    const auth = (req as AuthenticatedRequest).auth!;
    const workspaceId = requireWorkspaceContext(req as AuthenticatedRequest, res);
    if (!workspaceId) return;

    const orderId = String(req.params.orderId ?? "");
    const body = excessProofConfirmSchema.parse(req.body);
    const order = await getOrderForUser(workspaceId, auth.sub, orderId);

    if (!assertOrderOwnedByUser(order, workspaceId, auth.sub)) {
      res.status(404).json({ error: "Order not found" });
      return;
    }

    try {
      assertOrderHasUploadableExcess(order);
      validateExcessPaymentUploadRequest(body);
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : "Invalid upload request",
      });
      return;
    }

    if (!isExcessPaymentS3KeyForOrder(body.storageKey, workspaceId, orderId)) {
      res.status(400).json({ error: "Invalid storage key" });
      return;
    }

    try {
      await verifyExcessPaymentObject(body.storageKey);
    } catch {
      res.status(400).json({
        error: "Payment proof was not found in storage. Upload the file first.",
      });
      return;
    }

    if (
      order.excessPaymentProofS3Key &&
      order.excessPaymentProofS3Key !== body.storageKey
    ) {
      try {
        await deleteExcessPaymentObject(order.excessPaymentProofS3Key);
      } catch {
        // Best effort cleanup of replaced proof.
      }
    }

    const updated = await Order.findByIdAndUpdate(
      order._id,
      {
        excessPaymentProofS3Key: body.storageKey,
        excessPaymentProofFilename: body.filename,
        excessPaymentProofMimeType: body.mimeType,
        excessPaymentProofUploadedAt: new Date(),
      },
      { new: true },
    );

    res.json({ order: serializeOrder(updated!) });
  }),
);

router.get(
  "/me/:orderId/excess-payment-proof",
  asyncHandler(async (req, res) => {
    const auth = (req as AuthenticatedRequest).auth!;
    const workspaceId = requireWorkspaceContext(req as AuthenticatedRequest, res);
    if (!workspaceId) return;

    const orderId = String(req.params.orderId ?? "");
    const order = await getOrderForUser(workspaceId, auth.sub, orderId);

    if (!assertOrderOwnedByUser(order, workspaceId, auth.sub)) {
      res.status(404).json({ error: "Order not found" });
      return;
    }

    if (!order.excessPaymentProofS3Key) {
      res.status(404).json({ error: "No payment proof uploaded" });
      return;
    }

    const { downloadUrl, expiresInSeconds } = await createExcessPaymentDownloadUrl(
      order.excessPaymentProofS3Key,
    );

    res.json({
      downloadUrl,
      expiresInSeconds,
      filename: order.excessPaymentProofFilename ?? "payment-proof",
      mimeType: order.excessPaymentProofMimeType ?? null,
    });
  }),
);

router.put(
  "/me",
  asyncHandler(async (req, res) => {
    const auth = (req as AuthenticatedRequest).auth!;
    const workspaceId = requireWorkspaceContext(req as AuthenticatedRequest, res);
    if (!workspaceId) return;

    const body = upsertOrderSchema.parse(req.body);
    const menuWeek = await getMenuWeekForOrder(workspaceId, body.menuWeekId);
    if (!menuWeek) {
      res.status(404).json({ error: "Menu week not found" });
      return;
    }

    if (
      !checkOrderingAllowed({
        status: menuWeek.status,
        orderWindowOpensAt: menuWeek.orderWindowOpensAt,
        orderWindowClosesAt: menuWeek.orderWindowClosesAt,
      })
    ) {
      res.status(403).json({ error: "Ordering window is not open" });
      return;
    }

    const existing = await Order.findOne({
      userId: auth.sub,
      menuWeekId: menuWeek._id,
      workspaceId,
    });
    if (existing?.status === "SUBMITTED") {
      if (existing.excessCents > 0) {
        res.status(400).json({ error: "Submitted orders with excess cannot be edited" });
        return;
      }
    }

    const validated = await validateAndPriceLineItems({
      workspaceId,
      menuWeek,
      lineItems: body.lineItems,
      snapshotPrices: false,
    }).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : "Invalid order";
      res.status(400).json({ error: message });
      return null;
    });
    if (!validated) return;

    const totals = applyTotalsToLineItems(
      validated,
      menuWeek.maxOrderAmountCents,
    );

    const lineItemsPayload = validated.map((item) => ({
      menuItemId: new mongoose.Types.ObjectId(item.menuItemId),
      dayOfWeek: item.dayOfWeek,
      quantity: item.quantity,
    }));

    const dayNotes = sanitizeDayNotes(
      body.dayNotes,
      daysFromLineItems(lineItemsPayload),
    );

    const shouldClearProof =
      existing &&
      (totals.excessCents !== existing.excessCents || totals.excessCents <= 0) &&
      Boolean(existing.excessPaymentProofS3Key);

    if (shouldClearProof) {
      await clearExcessPaymentProof(existing);
    }

    const order = await Order.findOneAndUpdate(
      { userId: auth.sub, menuWeekId: menuWeek._id, workspaceId },
      {
        workspaceId,
        userId: auth.sub,
        menuWeekId: menuWeek._id,
        status: "DRAFT",
        lineItems: lineItemsPayload,
        dayNotes,
        totalCents: totals.totalCents,
        companyCoveredCents: totals.companyCoveredCents,
        excessCents: totals.excessCents,
        excessAcknowledged: false,
        excessAcknowledgedAt: null,
        submittedAt: null,
        ...(shouldClearProof ? excessProofClearFields() : {}),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    res.json({ order: serializeOrder(order!) });
  }),
);

router.post(
  "/me/submit",
  asyncHandler(async (req, res) => {
    const auth = (req as AuthenticatedRequest).auth!;
    const workspaceId = requireWorkspaceContext(req as AuthenticatedRequest, res);
    if (!workspaceId) return;

    const body = submitOrderSchema.parse(req.body);
    const menuWeek = await getMenuWeekForOrder(workspaceId, body.menuWeekId);
    if (!menuWeek) {
      res.status(404).json({ error: "Menu week not found" });
      return;
    }

    if (
      !checkOrderingAllowed({
        status: menuWeek.status,
        orderWindowOpensAt: menuWeek.orderWindowOpensAt,
        orderWindowClosesAt: menuWeek.orderWindowClosesAt,
      })
    ) {
      res.status(403).json({ error: "Ordering window is not open" });
      return;
    }

    const order = await Order.findOne({
      userId: auth.sub,
      menuWeekId: menuWeek._id,
      workspaceId,
    });
    if (!order || order.lineItems.length === 0) {
      res.status(400).json({ error: "No order to submit" });
      return;
    }
    if (order.status === "SUBMITTED") {
      res.status(400).json({ error: "Order already submitted" });
      return;
    }

    const validated = await validateAndPriceLineItems({
      workspaceId,
      menuWeek,
      lineItems: order.lineItems.map((item) => ({
        menuItemId: item.menuItemId.toString(),
        dayOfWeek: item.dayOfWeek as (typeof DAYS_OF_WEEK)[number],
        quantity: item.quantity,
      })),
      snapshotPrices: true,
    }).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : "Invalid order";
      res.status(400).json({ error: message });
      return null;
    });
    if (!validated) return;

    const totals = applyTotalsToLineItems(
      validated,
      menuWeek.maxOrderAmountCents,
    );

    if (totals.excessCents > 0) {
      const vendor = await Vendor.findOne({
        _id: menuWeek.activeVendorId,
        workspaceId,
      });
      if (!vendor || !vendorHasPaymentDetails(vendor)) {
        res.status(400).json({ error: "Vendor payment details are not configured" });
        return;
      }
      if (!order.excessPaymentProofUploadedAt) {
        res.status(400).json({
          error: "Payment proof required before submitting an order with excess",
          excessCents: totals.excessCents,
        });
        return;
      }
      if (order.excessCents !== totals.excessCents) {
        res.status(400).json({
          error: "Your order changed. Upload payment proof again before submitting.",
        });
        return;
      }
    }

    order.lineItems = validated.map((item) => ({
      menuItemId: new mongoose.Types.ObjectId(item.menuItemId),
      dayOfWeek: item.dayOfWeek,
      quantity: item.quantity,
      unitPriceCentsSnapshot: item.unitPriceCents,
    })) as typeof order.lineItems;
    order.totalCents = totals.totalCents;
    order.companyCoveredCents = totals.companyCoveredCents;
    order.excessCents = totals.excessCents;
    order.status = "SUBMITTED";
    order.submittedAt = new Date();
    if (totals.excessCents > 0) {
      order.excessAcknowledged = true;
      order.excessAcknowledgedAt = new Date();
    } else {
      if (order.excessPaymentProofS3Key) {
        await clearExcessPaymentProof(order);
      }
      order.excessAcknowledged = false;
      order.excessAcknowledgedAt = undefined;
      Object.assign(order, excessProofClearFields());
    }

    await order.save();
    res.json({ order: serializeOrder(order) });
  }),
);

export default router;
