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

const router = Router();

router.use(requireAuth, requireAdmin);

const createVendorSchema = z.object({
  name: z.string().trim().min(1),
  email: z.string().email(),
  isActive: z.boolean().optional(),
});

const updateVendorSchema = z.object({
  name: z.string().trim().min(1).optional(),
  email: z.string().email().optional(),
  isActive: z.boolean().optional(),
});

function serializeVendor(doc: {
  _id: mongoose.Types.ObjectId;
  workspaceId: mongoose.Types.ObjectId;
  name: string;
  email: string;
  isActive: boolean;
  createdAt?: Date;
}) {
  return {
    id: doc._id.toString(),
    workspaceId: doc.workspaceId.toString(),
    name: doc.name,
    email: doc.email,
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
    res.json({ vendors: vendors.map(serializeVendor) });
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
      isActive: body.isActive ?? true,
    });

    res.status(201).json({ vendor: serializeVendor(vendor) });
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
