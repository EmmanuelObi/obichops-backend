import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler.js";
import {
  requireAuth,
  type AuthenticatedRequest,
} from "../middleware/auth.js";
import { requireWorkspaceContext } from "../middleware/workspace.js";
import { Vendor } from "../models/index.js";
import {
  findCurrentMenuWeek,
  getFilteredMenuForWeek,
  getWorkspaceTimezone,
  serializeMenuWeek,
} from "../services/menuWeekService.js";

const router = Router();

router.use(requireAuth);

router.get(
  "/current",
  asyncHandler(async (req, res) => {
    const workspaceId = requireWorkspaceContext(req as AuthenticatedRequest, res);
    if (!workspaceId) return;

    const week = await findCurrentMenuWeek(workspaceId);
    if (!week) {
      res.json({ menuWeek: null, menu: [], vendor: null });
      return;
    }

    const timezone = await getWorkspaceTimezone(workspaceId);
    const vendor = await Vendor.findOne({
      _id: week.activeVendorId,
      workspaceId,
    });
    const menu = await getFilteredMenuForWeek(
      workspaceId,
      week.activeVendorId.toString(),
      week.orderableDays,
    );

    res.json({
      menuWeek: serializeMenuWeek(week, timezone),
      vendor: vendor
        ? { id: vendor._id.toString(), name: vendor.name, email: vendor.email }
        : null,
      menu,
    });
  }),
);

export default router;
