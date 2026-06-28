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
import { MenuItem } from "../../models/MenuItem.js";
import { Vendor } from "../../models/Vendor.js";
import { DAYS_OF_WEEK } from "../../types/days.js";
import { MENU_ITEM_KINDS } from "../../types/menuItem.js";

const vendorMenuRouter = Router({ mergeParams: true });
const menuItemRouter = Router();

const createMenuItemSchema = z.object({
  dayOfWeek: z.enum(DAYS_OF_WEEK),
  name: z.string().trim().min(1),
  description: z.string().trim().optional(),
  priceCents: z.number().int().min(0),
  itemKind: z.enum(MENU_ITEM_KINDS).optional(),
  packsRequired: z.number().int().min(0).optional(),
  isAvailable: z.boolean().optional(),
});

const updateMenuItemSchema = z.object({
  dayOfWeek: z.enum(DAYS_OF_WEEK).optional(),
  name: z.string().trim().min(1).optional(),
  description: z.string().trim().optional(),
  priceCents: z.number().int().min(0).optional(),
  itemKind: z.enum(MENU_ITEM_KINDS).optional(),
  packsRequired: z.number().int().min(0).optional(),
  isAvailable: z.boolean().optional(),
});

function serializeMenuItem(doc: {
  _id: mongoose.Types.ObjectId;
  workspaceId: mongoose.Types.ObjectId;
  vendorId: mongoose.Types.ObjectId;
  dayOfWeek: string;
  name: string;
  description?: string | null;
  priceCents: number;
  itemKind?: string;
  packsRequired?: number | null;
  isAvailable: boolean;
  updatedAt?: Date;
}) {
  const itemKind = doc.itemKind ?? "FOOD";
  return {
    id: doc._id.toString(),
    workspaceId: doc.workspaceId.toString(),
    vendorId: doc.vendorId.toString(),
    dayOfWeek: doc.dayOfWeek,
    name: doc.name,
    description: doc.description ?? "",
    priceCents: doc.priceCents,
    itemKind,
    packsRequired: itemKind === "FOOD" ? (doc.packsRequired ?? 0) : 0,
    isAvailable: doc.isAvailable,
    updatedAt: doc.updatedAt,
  };
}

async function getVendorInWorkspace(
  vendorId: string,
  workspaceId: string,
): Promise<InstanceType<typeof Vendor> | null> {
  if (!mongoose.isValidObjectId(vendorId)) return null;
  return Vendor.findOne({ _id: vendorId, workspaceId });
}

vendorMenuRouter.use(requireAuth, requireAdmin);

vendorMenuRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const workspaceId = requireWorkspaceContext(req as AuthenticatedRequest, res);
    if (!workspaceId) return;

    const vendorId = String(req.params.vendorId ?? "");
    if (!vendorId) {
      res.status(400).json({ error: "Vendor id required" });
      return;
    }

    const vendor = await getVendorInWorkspace(vendorId, workspaceId);
    if (!vendor) {
      res.status(404).json({ error: "Vendor not found" });
      return;
    }

    const menuItems = await MenuItem.find({ vendorId, workspaceId }).sort({
      dayOfWeek: 1,
      name: 1,
    });

    res.json({ menuItems: menuItems.map(serializeMenuItem) });
  }),
);

vendorMenuRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const workspaceId = requireWorkspaceContext(req as AuthenticatedRequest, res);
    if (!workspaceId) return;

    const vendorId = String(req.params.vendorId ?? "");
    if (!vendorId) {
      res.status(400).json({ error: "Vendor id required" });
      return;
    }

    const vendor = await getVendorInWorkspace(vendorId, workspaceId);
    if (!vendor) {
      res.status(404).json({ error: "Vendor not found" });
      return;
    }

    const body = createMenuItemSchema.parse(req.body);
    const itemKind = body.itemKind ?? "FOOD";
    const menuItem = await MenuItem.create({
      workspaceId,
      vendorId,
      dayOfWeek: body.dayOfWeek,
      name: body.name,
      description: body.description ?? "",
      priceCents: body.priceCents,
      itemKind,
      packsRequired: itemKind === "FOOD" ? (body.packsRequired ?? 0) : 0,
      isAvailable: body.isAvailable ?? true,
    });

    res.status(201).json({ menuItem: serializeMenuItem(menuItem) });
  }),
);

menuItemRouter.use(requireAuth, requireAdmin);

menuItemRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const workspaceId = requireWorkspaceContext(req as AuthenticatedRequest, res);
    if (!workspaceId) return;

    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    const body = updateMenuItemSchema.parse(req.body);
    const existing = await MenuItem.findOne({ _id: id, workspaceId });
    if (!existing) {
      res.status(404).json({ error: "Menu item not found" });
      return;
    }

    const nextKind = body.itemKind ?? existing.itemKind ?? "FOOD";
    const menuItem = await MenuItem.findOneAndUpdate(
      { _id: id, workspaceId },
      {
        ...(body.dayOfWeek !== undefined ? { dayOfWeek: body.dayOfWeek } : {}),
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.priceCents !== undefined ? { priceCents: body.priceCents } : {}),
        ...(body.itemKind !== undefined ? { itemKind: body.itemKind } : {}),
        ...(body.packsRequired !== undefined && nextKind === "FOOD"
          ? { packsRequired: body.packsRequired }
          : {}),
        ...(body.itemKind === "PACK" ? { packsRequired: 0 } : {}),
        ...(body.isAvailable !== undefined ? { isAvailable: body.isAvailable } : {}),
      },
      { new: true },
    );

    if (!menuItem) {
      res.status(404).json({ error: "Menu item not found" });
      return;
    }

    res.json({ menuItem: serializeMenuItem(menuItem) });
  }),
);

menuItemRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const workspaceId = requireWorkspaceContext(req as AuthenticatedRequest, res);
    if (!workspaceId) return;

    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    const menuItem = await MenuItem.findOneAndUpdate(
      { _id: id, workspaceId },
      { isAvailable: false },
      { new: true },
    );

    if (!menuItem) {
      res.status(404).json({ error: "Menu item not found" });
      return;
    }

    res.json({ menuItem: serializeMenuItem(menuItem) });
  }),
);

export { vendorMenuRouter, menuItemRouter };
