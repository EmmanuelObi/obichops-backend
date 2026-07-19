import { Router } from "express";
import { z } from "zod";
import mongoose from "mongoose";
import { asyncHandler } from "../middleware/asyncHandler.js";
import {
  requireAuth,
  requireSuperAdmin,
  type AuthenticatedRequest,
} from "../middleware/auth.js";
import { Chopspace, OnboardingRequest } from "../models/index.js";
import { inviteWorkspaceMember } from "../services/memberInvite.js";
import {
  approveOnboardingRequest,
  rejectOnboardingRequest,
  serializeOnboardingRequest,
} from "../services/onboarding.js";
import { listPlatformAuditLog, recordPlatformAudit } from "../services/platformAudit.js";
import {
  getPlatformDashboard,
  getWorkspaceOverview,
  listWorkspacesWithStats,
} from "../services/platformWorkspace.js";

const router = Router();

router.use(requireAuth, requireSuperAdmin);

const createWorkspaceSchema = z.object({
  name: z.string().min(1).trim(),
  slug: z
    .string()
    .min(1)
    .trim()
    .regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric with hyphens"),
});

const workspaceSettingsSchema = z.object({
  timezone: z.string().min(1).trim().optional(),
  allowedEmailDomains: z
    .array(z.string().trim().min(1).transform((value) => value.toLowerCase()))
    .optional(),
  defaultMaxOrderAmountCents: z.number().int().positive().optional(),
});

const patchWorkspaceSchema = z.object({
  name: z.string().min(1).trim().optional(),
  slug: z
    .string()
    .min(1)
    .trim()
    .regex(/^[a-z0-9-]+$/)
    .optional(),
  isActive: z.boolean().optional(),
  settings: workspaceSettingsSchema.optional(),
});

const createAdminSchema = z.object({
  email: z.string().email(),
});

function actorFromRequest(req: AuthenticatedRequest) {
  const auth = req.auth;
  if (!auth) {
    throw new Error("Unauthorized");
  }
  return {
    userId: auth.sub,
    email: auth.email,
  };
}

function serializeWorkspace(doc: {
  _id: mongoose.Types.ObjectId;
  name: string;
  slug: string;
  isActive: boolean;
  settings?: {
    timezone?: string;
    allowedEmailDomains?: string[];
    defaultMaxOrderAmountCents?: number;
  };
  createdAt?: Date;
  updatedAt?: Date;
}) {
  return {
    id: doc._id.toString(),
    name: doc.name,
    slug: doc.slug,
    isActive: doc.isActive,
    settings: {
      timezone: doc.settings?.timezone ?? "Africa/Lagos",
      allowedEmailDomains: doc.settings?.allowedEmailDomains ?? [],
      defaultMaxOrderAmountCents:
        doc.settings?.defaultMaxOrderAmountCents ?? 500_000,
    },
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

router.get(
  "/dashboard",
  asyncHandler(async (_req, res) => {
    const dashboard = await getPlatformDashboard();
    res.json(dashboard);
  }),
);

router.get(
  "/audit-log",
  asyncHandler(async (req, res) => {
    const workspaceId =
      typeof req.query.workspaceId === "string" ? req.query.workspaceId : undefined;
    const limit =
      typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;

    const entries = await listPlatformAuditLog({ workspaceId, limit });
    res.json({ entries });
  }),
);

router.get(
  "/workspaces",
  asyncHandler(async (_req, res) => {
    const workspaces = await listWorkspacesWithStats();
    res.json({ workspaces });
  }),
);

router.get(
  "/workspaces/:id",
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const overview = await getWorkspaceOverview(String(id ?? ""));
    if (!overview) {
      res.status(404).json({ error: "Chopspace not found" });
      return;
    }
    res.json(overview);
  }),
);

router.post(
  "/workspaces",
  asyncHandler(async (req, res) => {
    const body = createWorkspaceSchema.parse(req.body);
    const actor = actorFromRequest(req as AuthenticatedRequest);
    const chopspace = await Chopspace.create({
      name: body.name,
      slug: body.slug.toLowerCase(),
    });

    await recordPlatformAudit({
      workspaceId: chopspace._id.toString(),
      actorUserId: actor.userId,
      actorEmail: actor.email,
      action: "WORKSPACE_CREATED",
      summary: `Created chopspace "${chopspace.name}"`,
      metadata: { slug: chopspace.slug },
    });

    res.status(201).json({ chopspace: serializeWorkspace(chopspace) });
  }),
);

router.patch(
  "/workspaces/:id",
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      res.status(400).json({ error: "Invalid chopspace id" });
      return;
    }

    const body = patchWorkspaceSchema.parse(req.body);
    const actor = actorFromRequest(req as AuthenticatedRequest);
    const existing = await Chopspace.findById(id);
    if (!existing) {
      res.status(404).json({ error: "Chopspace not found" });
      return;
    }

    const update: Record<string, unknown> = {};
    if (body.name !== undefined) update.name = body.name;
    if (body.slug !== undefined) update.slug = body.slug.toLowerCase();
    if (body.isActive !== undefined) update.isActive = body.isActive;

    if (body.settings) {
      if (body.settings.timezone !== undefined) {
        update["settings.timezone"] = body.settings.timezone;
      }
      if (body.settings.allowedEmailDomains !== undefined) {
        update["settings.allowedEmailDomains"] = body.settings.allowedEmailDomains;
      }
      if (body.settings.defaultMaxOrderAmountCents !== undefined) {
        update["settings.defaultMaxOrderAmountCents"] =
          body.settings.defaultMaxOrderAmountCents;
      }
    }

    const chopspace = await Chopspace.findByIdAndUpdate(id, update, {
      new: true,
      runValidators: true,
    });
    if (!chopspace) {
      res.status(404).json({ error: "Chopspace not found" });
      return;
    }

    if (body.isActive !== undefined && body.isActive !== existing.isActive) {
      await recordPlatformAudit({
        workspaceId: String(id),
        actorUserId: actor.userId,
        actorEmail: actor.email,
        action: body.isActive ? "WORKSPACE_REACTIVATED" : "WORKSPACE_SUSPENDED",
        summary: body.isActive
          ? `Reactivated chopspace "${chopspace.name}"`
          : `Suspended chopspace "${chopspace.name}"`,
      });
    } else if (
      body.name !== undefined ||
      body.slug !== undefined ||
      body.settings !== undefined
    ) {
      await recordPlatformAudit({
        workspaceId: String(id),
        actorUserId: actor.userId,
        actorEmail: actor.email,
        action: "WORKSPACE_UPDATED",
        summary: `Updated chopspace "${chopspace.name}"`,
        metadata: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.slug !== undefined ? { slug: body.slug } : {}),
          ...(body.settings ? { settings: body.settings } : {}),
        },
      });
    }

    res.json({ chopspace: serializeWorkspace(chopspace) });
  }),
);

router.post(
  "/workspaces/:id/admins",
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      res.status(400).json({ error: "Invalid chopspace id" });
      return;
    }
    const chopspace = await Chopspace.findById(id);
    if (!chopspace) {
      res.status(404).json({ error: "Chopspace not found" });
      return;
    }

    const body = createAdminSchema.parse(req.body);
    const email = body.email.toLowerCase();
    const actor = actorFromRequest(req as AuthenticatedRequest);

    try {
      const result = await inviteWorkspaceMember({
        workspaceId: String(id),
        email,
        role: "ADMIN",
        skipDomainCheck: true,
      });

      await recordPlatformAudit({
        workspaceId: String(id),
        actorUserId: actor.userId,
        actorEmail: actor.email,
        action: "WORKSPACE_ADMIN_INVITED",
        summary: `Invited admin ${email} to "${chopspace.name}"`,
        metadata: { email },
      });

      res.status(201).json({
        user: {
          id: result.userId,
          email: result.email,
          role: result.role,
          workspaceId: id,
        },
      });
    } catch (err) {
      if (err instanceof Error) {
        if (err.message === "USER_EXISTS") {
          res.status(409).json({ error: "Admin user already exists" });
          return;
        }
        if (err.message === "DOMAIN_NOT_ALLOWED") {
          res.status(400).json({
            error: "Email domain is not allowed for this chopspace",
          });
          return;
        }
      }
      throw err;
    }
  }),
);

const onboardingStatusSchema = z.object({
  status: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional(),
});

const rejectOnboardingSchema = z.object({
  reason: z.string().max(1000).trim().optional(),
});

router.get(
  "/onboarding-requests",
  asyncHandler(async (req, res) => {
    const query = onboardingStatusSchema.parse(req.query);
    const filter = query.status ? { status: query.status } : {};
    const requests = await OnboardingRequest.find(filter)
      .sort({ createdAt: -1 })
      .limit(200);
    res.json({ requests: requests.map(serializeOnboardingRequest) });
  }),
);

router.post(
  "/onboarding-requests/:id/approve",
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      res.status(400).json({ error: "Invalid request id" });
      return;
    }
    const actor = actorFromRequest(req as AuthenticatedRequest);

    try {
      const result = await approveOnboardingRequest({
        requestId: String(id),
        reviewerEmail: actor.email,
      });

      await recordPlatformAudit({
        workspaceId: result.chopspace.id,
        actorUserId: actor.userId,
        actorEmail: actor.email,
        action: "ONBOARDING_APPROVED",
        summary: `Approved onboarding for "${result.chopspace.name}"`,
        metadata: { slug: result.chopspace.slug, email: result.request.email },
      });

      res.json(result);
    } catch (err) {
      if (err instanceof Error) {
        if (err.message === "NOT_FOUND") {
          res.status(404).json({ error: "Onboarding request not found" });
          return;
        }
        if (err.message === "ALREADY_REVIEWED") {
          res.status(409).json({ error: "This request has already been reviewed" });
          return;
        }
        if (err.message === "SLUG_TAKEN") {
          res.status(409).json({
            error: "A chopspace with this slug already exists. Reject the request or rename the existing chopspace.",
          });
          return;
        }
      }
      throw err;
    }
  }),
);

router.post(
  "/onboarding-requests/:id/reject",
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      res.status(400).json({ error: "Invalid request id" });
      return;
    }
    const body = rejectOnboardingSchema.parse(req.body ?? {});
    const actor = actorFromRequest(req as AuthenticatedRequest);

    try {
      const request = await rejectOnboardingRequest({
        requestId: String(id),
        reviewerEmail: actor.email,
        reason: body.reason,
      });

      await recordPlatformAudit({
        actorUserId: actor.userId,
        actorEmail: actor.email,
        action: "ONBOARDING_REJECTED",
        summary: `Rejected onboarding for "${request.businessName}"`,
        metadata: { slug: request.slug, email: request.email },
      });

      res.json({ request });
    } catch (err) {
      if (err instanceof Error) {
        if (err.message === "NOT_FOUND") {
          res.status(404).json({ error: "Onboarding request not found" });
          return;
        }
        if (err.message === "ALREADY_REVIEWED") {
          res.status(409).json({ error: "This request has already been reviewed" });
          return;
        }
      }
      throw err;
    }
  }),
);

router.post(
  "/workspaces/:id/enter",
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      res.status(400).json({ error: "Invalid chopspace id" });
      return;
    }

    const chopspace = await Chopspace.findById(id);
    if (!chopspace) {
      res.status(404).json({ error: "Chopspace not found" });
      return;
    }

    const actor = actorFromRequest(req as AuthenticatedRequest);
    const entry = await recordPlatformAudit({
      workspaceId: String(id),
      actorUserId: actor.userId,
      actorEmail: actor.email,
      action: "WORKSPACE_ENTERED",
      summary: `Entered manage mode for "${chopspace.name}"`,
    });

    res.status(201).json({ entry });
  }),
);

export default router;
