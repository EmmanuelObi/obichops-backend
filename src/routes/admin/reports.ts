import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import {
  requireAdmin,
  requireAuth,
  type AuthenticatedRequest,
} from "../../middleware/auth.js";
import { requireWorkspaceContext } from "../../middleware/workspace.js";
import {
  buildFinanceReportCsv,
  financeReportFilename,
  loadFinanceReport,
} from "../../services/reports/financeReport.js";

const router = Router();

router.use(requireAuth, requireAdmin);

const financeQuerySchema = z.object({
  from: z.string().date(),
  to: z.string().date(),
  granularity: z.enum(["week", "month"]).default("week"),
});

router.get(
  "/finance",
  asyncHandler(async (req, res) => {
    const workspaceId = requireWorkspaceContext(req as AuthenticatedRequest, res);
    if (!workspaceId) return;

    const query = financeQuerySchema.parse(req.query);

    try {
      const report = await loadFinanceReport(
        workspaceId,
        query.from,
        query.to,
        query.granularity,
      );
      res.json({ report });
    } catch (err) {
      if (err instanceof Error && err.message.includes("Invalid date")) {
        res.status(400).json({ error: err.message });
        return;
      }
      if (err instanceof Error && err.message.includes("Start date")) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  }),
);

router.get(
  "/finance/export",
  asyncHandler(async (req, res) => {
    const workspaceId = requireWorkspaceContext(req as AuthenticatedRequest, res);
    if (!workspaceId) return;

    const query = financeQuerySchema.parse(req.query);
    const report = await loadFinanceReport(
      workspaceId,
      query.from,
      query.to,
      query.granularity,
    );

    const buffer = buildFinanceReportCsv(report);
    const filename = financeReportFilename(report);

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buffer);
  }),
);

export default router;
