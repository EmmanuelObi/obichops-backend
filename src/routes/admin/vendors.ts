import { Router } from "express";
import { z } from "zod";
import mongoose from "mongoose";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import {
  requireAdmin,
  requireAuth,
  type AuthenticatedRequest,
} from "../../middleware/auth.js";
import { requireWorkspaceContext } from "../../middleware/workspace.js";
import { Vendor } from "../../models/Vendor.js";
import { serializeVendorPaymentFields } from "../../services/vendor.js";
import {
  getVendorRatingSummaries,
  listReviewsByVendor,
} from "../../services/vendorReview.js";

const router = Router();

router.use(requireAuth, requireAdmin);

const bankFieldsSchema = {
  accountName: z.string().trim().min(1, "Account name is required"),
  bankName: z.string().trim().min(1, "Bank name is required"),
  accountNumber: z.string().trim().min(1, "Account number is required"),
};

const createVendorSchema = z.object({
  name: z.string().trim().min(1),
  email: z.string().email(),
  ...bankFieldsSchema,
  isActive: z.boolean().optional(),
});

const updateVendorSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    email: z.string().email().optional(),
    accountName: z.string().trim().min(1).optional(),
    bankName: z.string().trim().min(1).optional(),
    accountNumber: z.string().trim().min(1).optional(),
    isActive: z.boolean().optional(),
  })
  .refine(
    (data) => {
      const bankFields = [data.accountName, data.bankName, data.accountNumber];
      const anySet = bankFields.some((field) => field !== undefined);
      const allSet = bankFields.every((field) => field !== undefined);
      return !anySet || allSet;
    },
    { message: "Provide account name, bank name, and account number together" },
  );

function serializeVendor(doc: {
  _id: mongoose.Types.ObjectId;
  workspaceId: mongoose.Types.ObjectId;
  name: string;
  email: string;
  accountName?: string | null;
  bankName?: string | null;
  accountNumber?: string | null;
  isActive: boolean;
  createdAt?: Date;
}) {
  return {
    id: doc._id.toString(),
    workspaceId: doc.workspaceId.toString(),
    name: doc.name,
    email: doc.email,
    ...serializeVendorPaymentFields(doc),
    isActive: doc.isActive,
    createdAt: doc.createdAt,
  };
}

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const workspaceId = requireWorkspaceContext(req as AuthenticatedRequest, res);
    if (!workspaceId) return;

    const vendors = await Vendor.find({ workspaceId }).sort({ name: 1 });
    const ratingSummaries = await getVendorRatingSummaries(workspaceId);
    res.json({
      vendors: vendors.map((vendor) => {
        const summary = ratingSummaries.get(vendor._id.toString());
        return {
          ...serializeVendor(vendor),
          averageRating: summary?.averageRating ?? null,
          reviewCount: summary?.reviewCount ?? 0,
        };
      }),
    });
  }),
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const workspaceId = requireWorkspaceContext(req as AuthenticatedRequest, res);
    if (!workspaceId) return;

    const body = createVendorSchema.parse(req.body);
    const vendor = await Vendor.create({
      workspaceId,
      name: body.name,
      email: body.email.toLowerCase(),
      accountName: body.accountName,
      bankName: body.bankName,
      accountNumber: body.accountNumber,
      isActive: body.isActive ?? true,
    });

    res.status(201).json({ vendor: serializeVendor(vendor) });
  }),
);

router.get(
  "/:id/reviews",
  asyncHandler(async (req, res) => {
    const workspaceId = requireWorkspaceContext(req as AuthenticatedRequest, res);
    if (!workspaceId) return;

    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    const vendor = await Vendor.findOne({ _id: id, workspaceId });
    if (!vendor) {
      res.status(404).json({ error: "Vendor not found" });
      return;
    }

    const reviews = await listReviewsByVendor(workspaceId, id);
    res.json({ reviews });
  }),
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const workspaceId = requireWorkspaceContext(req as AuthenticatedRequest, res);
    if (!workspaceId) return;

    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    const vendor = await Vendor.findOne({ _id: id, workspaceId });
    if (!vendor) {
      res.status(404).json({ error: "Vendor not found" });
      return;
    }

    res.json({ vendor: serializeVendor(vendor) });
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

    const body = updateVendorSchema.parse(req.body);
    const vendor = await Vendor.findOneAndUpdate(
      { _id: id, workspaceId },
      {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.email !== undefined ? { email: body.email.toLowerCase() } : {}),
        ...(body.accountName !== undefined ? { accountName: body.accountName } : {}),
        ...(body.bankName !== undefined ? { bankName: body.bankName } : {}),
        ...(body.accountNumber !== undefined
          ? { accountNumber: body.accountNumber }
          : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      },
      { new: true },
    );

    if (!vendor) {
      res.status(404).json({ error: "Vendor not found" });
      return;
    }

    res.json({ vendor: serializeVendor(vendor) });
  }),
);

router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const workspaceId = requireWorkspaceContext(req as AuthenticatedRequest, res);
    if (!workspaceId) return;

    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    const vendor = await Vendor.findOneAndUpdate(
      { _id: id, workspaceId },
      { isActive: false },
      { new: true },
    );

    if (!vendor) {
      res.status(404).json({ error: "Vendor not found" });
      return;
    }

    res.json({ vendor: serializeVendor(vendor) });
  }),
);

export default router;
