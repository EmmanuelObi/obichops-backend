import { Router } from "express";
import { z } from "zod";
import mongoose from "mongoose";
import { asyncHandler } from "../middleware/asyncHandler.js";
import {
  requireAdmin,
  requireAuth,
  type AuthenticatedRequest,
} from "../middleware/auth.js";
import {
  requireActiveWorkspace,
  requireWorkspaceContext,
} from "../middleware/workspace.js";
import { AllowedEmail, Order, User, Chopspace } from "../models/index.js";
import {
  inviteWorkspaceMember,
  setAllowedEmailActive,
} from "../services/memberInvite.js";
import { formatAllowedDomains } from "../services/emailDomain.js";
import {
  buildExcessPaymentS3Key,
  createExcessPaymentDownloadUrl,
  createExcessPaymentUploadUrl,
  deleteExcessPaymentObject,
  isExcessPaymentS3KeyForOrder,
  validateExcessPaymentUploadRequest,
  verifyExcessPaymentObject,
} from "../services/s3.js";
import { serializeOrder } from "../services/menuWeekService.js";
import { serializeTeamMember } from "../services/teamMember.js";
import { assertOrderHasUploadableExcess } from "../services/staffOrderHistory.js";
import { menuItemRouter, vendorMenuRouter } from "./admin/menu-items.js";
import menuWeeksRouter from "./admin/menu-weeks.js";
import reportsRouter from "./admin/reports.js";
import vendorsRouter from "./admin/vendors.js";

const router = Router();

router.use(requireAuth, requireActiveWorkspace, requireAdmin);

const createAllowedEmailSchema = z.object({
  email: z.string().email(),
  role: z.enum(["ADMIN", "STAFF"]).default("STAFF"),
});

const patchAllowedEmailSchema = z.object({
  isActive: z.boolean(),
});

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

async function loadTeamMembers(workspaceId: string) {
  const items = await AllowedEmail.find({ workspaceId }).sort({ createdAt: -1 });
  const emails = items.map((item) => item.email);
  const users = await User.find({ workspaceId, email: { $in: emails } });
  const userByEmail = new Map(users.map((user) => [user.email, user]));

  return items.map((item) =>
    serializeTeamMember(item, userByEmail.get(item.email) ?? null),
  );
}

router.get(
  "/workspace",
  asyncHandler(async (req, res) => {
    const workspaceId = requireWorkspaceContext(req as AuthenticatedRequest, res);
    if (!workspaceId) return;

    const chopspace = await Chopspace.findById(workspaceId);
    if (!chopspace) {
      res.status(404).json({ error: "Chopspace not found" });
      return;
    }

    const allowedEmailDomains =
      (chopspace.settings?.allowedEmailDomains as string[] | undefined) ?? [];

    res.json({
      chopspace: {
        id: chopspace._id.toString(),
        name: chopspace.name,
        slug: chopspace.slug,
        allowedEmailDomains,
      },
    });
  }),
);

router.get(
  "/allowed-emails",
  asyncHandler(async (req, res) => {
    const workspaceId = requireWorkspaceContext(req as AuthenticatedRequest, res);
    if (!workspaceId) return;

    res.json({ allowedEmails: await loadTeamMembers(workspaceId) });
  }),
);

router.post(
  "/allowed-emails",
  asyncHandler(async (req, res) => {
    const workspaceId = requireWorkspaceContext(req as AuthenticatedRequest, res);
    if (!workspaceId) return;

    const body = createAllowedEmailSchema.parse(req.body);

    try {
      const result = await inviteWorkspaceMember({
        workspaceId,
        email: body.email.toLowerCase(),
        role: body.role,
      });
      const allowed = await AllowedEmail.findById(result.allowedEmailId);
      if (!allowed) {
        res.status(500).json({ error: "Failed to load invited member" });
        return;
      }
      const user = await User.findOne({ workspaceId, email: allowed.email });
      res.status(201).json({
        allowedEmail: serializeTeamMember(allowed, user),
        message: "Invitation sent with a temporary password",
      });
    } catch (err) {
      if (err instanceof Error && err.message === "USER_EXISTS") {
        res.status(409).json({ error: "This email is already an active member" });
        return;
      }
      if (err instanceof Error && err.message === "DOMAIN_NOT_ALLOWED") {
        const chopspace = await Chopspace.findById(workspaceId);
        const domains =
          (chopspace?.settings?.allowedEmailDomains as string[] | undefined) ??
          [];
        res.status(400).json({
          error:
            domains.length > 0
              ? `Email must use an allowed domain: ${formatAllowedDomains(domains)}`
              : "Email domain is not allowed for this chopspace",
        });
        return;
      }
      throw err;
    }
  }),
);

router.patch(
  "/allowed-emails/:id",
  asyncHandler(async (req, res) => {
    const workspaceId = requireWorkspaceContext(req as AuthenticatedRequest, res);
    if (!workspaceId) return;

    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    const body = patchAllowedEmailSchema.parse(req.body);

    try {
      await setAllowedEmailActive({
        workspaceId,
        allowedEmailId: id,
        isActive: body.isActive,
      });
    } catch (err) {
      if (err instanceof Error && err.message === "NOT_FOUND") {
        res.status(404).json({ error: "Not found" });
        return;
      }
      throw err;
    }

    const updated = await AllowedEmail.findOne({ _id: id, workspaceId });
    if (!updated) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const user = await User.findOne({ workspaceId, email: updated.email });
    res.json({ allowedEmail: serializeTeamMember(updated, user) });
  }),
);

router.delete(
  "/allowed-emails/:id",
  asyncHandler(async (req, res) => {
    const workspaceId = requireWorkspaceContext(req as AuthenticatedRequest, res);
    if (!workspaceId) return;

    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const deleted = await AllowedEmail.findOneAndDelete({
      _id: id,
      workspaceId,
    });
    if (!deleted) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    await User.updateOne(
      { workspaceId, email: deleted.email },
      { isActive: false },
    );
    res.status(204).send();
  }),
);

router.get(
  "/orders/:orderId/excess-payment-proof",
  asyncHandler(async (req, res) => {
    const workspaceId = requireWorkspaceContext(req as AuthenticatedRequest, res);
    if (!workspaceId) return;

    const { orderId: rawOrderId } = req.params;
    const orderId = String(rawOrderId ?? "");
    if (!mongoose.isValidObjectId(orderId)) {
      res.status(400).json({ error: "Invalid order id" });
      return;
    }

    const order = await Order.findOne({ _id: orderId, workspaceId });
    if (!order?.excessPaymentProofS3Key) {
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

router.post(
  "/orders/:orderId/excess-payment-proof/upload-url",
  asyncHandler(async (req, res) => {
    const workspaceId = requireWorkspaceContext(req as AuthenticatedRequest, res);
    if (!workspaceId) return;

    const orderId = String(req.params.orderId ?? "");
    const body = excessProofUploadUrlSchema.parse(req.body);
    const order = await Order.findOne({ _id: orderId, workspaceId });
    if (!order) {
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
  "/orders/:orderId/excess-payment-proof/confirm",
  asyncHandler(async (req, res) => {
    const workspaceId = requireWorkspaceContext(req as AuthenticatedRequest, res);
    if (!workspaceId) return;

    const orderId = String(req.params.orderId ?? "");
    const body = excessProofConfirmSchema.parse(req.body);
    const order = await Order.findOne({ _id: orderId, workspaceId });
    if (!order) {
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

router.post(
  "/orders/:orderId/mark-excess-paid",
  asyncHandler(async (req, res) => {
    const auth = (req as AuthenticatedRequest).auth!;
    const workspaceId = requireWorkspaceContext(req as AuthenticatedRequest, res);
    if (!workspaceId) return;

    const orderId = String(req.params.orderId ?? "");
    if (!mongoose.isValidObjectId(orderId)) {
      res.status(400).json({ error: "Invalid order id" });
      return;
    }

    const order = await Order.findOne({ _id: orderId, workspaceId });
    if (!order) {
      res.status(404).json({ error: "Order not found" });
      return;
    }
    if (order.excessCents <= 0) {
      res.status(400).json({ error: "This order has no excess payment" });
      return;
    }
    if (!order.excessPaymentProofUploadedAt) {
      res.status(400).json({ error: "Upload payment proof before marking as paid" });
      return;
    }
    if (order.excessPaidAt) {
      res.status(400).json({ error: "Excess is already marked as paid" });
      return;
    }

    const updated = await Order.findByIdAndUpdate(
      order._id,
      {
        excessPaidAt: new Date(),
        excessPaidByUserId: auth.sub,
      },
      { new: true },
    );

    res.json({ order: serializeOrder(updated!) });
  }),
);

router.use("/vendors", vendorsRouter);
router.use("/vendors/:vendorId/menu-items", vendorMenuRouter);
router.use("/menu-items", menuItemRouter);
router.use("/menu-weeks", menuWeeksRouter);
router.use("/reports", reportsRouter);

export default router;
