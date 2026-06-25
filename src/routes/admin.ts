import { Router } from "express";
import { z } from "zod";
import mongoose from "mongoose";
import { asyncHandler } from "../middleware/asyncHandler.js";
import {
  requireAdmin,
  requireAuth,
  type AuthenticatedRequest,
} from "../middleware/auth.js";
import { requireWorkspaceContext } from "../middleware/workspace.js";
import { AllowedEmail, Order, User, Workspace } from "../models/index.js";
import {
  inviteWorkspaceMember,
  setAllowedEmailActive,
} from "../services/memberInvite.js";
import { formatAllowedDomains } from "../services/emailDomain.js";
import { createExcessPaymentDownloadUrl } from "../services/s3.js";
import { serializeOrder } from "../services/menuWeekService.js";
import { menuItemRouter, vendorMenuRouter } from "./admin/menu-items.js";
import menuWeeksRouter from "./admin/menu-weeks.js";
import vendorsRouter from "./admin/vendors.js";

const router = Router();

router.use(requireAuth, requireAdmin);

const createAllowedEmailSchema = z.object({
  email: z.string().email(),
  role: z.enum(["ADMIN", "STAFF"]).default("STAFF"),
});

const patchAllowedEmailSchema = z.object({
  isActive: z.boolean(),
});

function serializeAllowed(doc: {
  _id: mongoose.Types.ObjectId;
  workspaceId: mongoose.Types.ObjectId;
  email: string;
  role: string;
  isActive?: boolean;
  createdAt?: Date;
}) {
  return {
    id: doc._id.toString(),
    workspaceId: doc.workspaceId.toString(),
    email: doc.email,
    role: doc.role,
    isActive: doc.isActive ?? true,
    createdAt: doc.createdAt,
  };
}

router.get(
  "/workspace",
  asyncHandler(async (req, res) => {
    const workspaceId = requireWorkspaceContext(req as AuthenticatedRequest, res);
    if (!workspaceId) return;

    const workspace = await Workspace.findById(workspaceId);
    if (!workspace) {
      res.status(404).json({ error: "Workspace not found" });
      return;
    }

    const allowedEmailDomains =
      (workspace.settings?.allowedEmailDomains as string[] | undefined) ?? [];

    res.json({
      workspace: {
        id: workspace._id.toString(),
        name: workspace.name,
        slug: workspace.slug,
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

    const items = await AllowedEmail.find({ workspaceId }).sort({
      createdAt: -1,
    });
    res.json({ allowedEmails: items.map(serializeAllowed) });
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
      res.status(201).json({
        allowedEmail: serializeAllowed(allowed),
        message: "Invitation sent with a temporary password",
      });
    } catch (err) {
      if (err instanceof Error && err.message === "USER_EXISTS") {
        res.status(409).json({ error: "This email is already an active member" });
        return;
      }
      if (err instanceof Error && err.message === "DOMAIN_NOT_ALLOWED") {
        const workspace = await Workspace.findById(workspaceId);
        const domains =
          (workspace?.settings?.allowedEmailDomains as string[] | undefined) ??
          [];
        res.status(400).json({
          error:
            domains.length > 0
              ? `Email must use an allowed domain: ${formatAllowedDomains(domains)}`
              : "Email domain is not allowed for this workspace",
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
    res.json({ allowedEmail: serializeAllowed(updated) });
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

export default router;
