import { Router } from "express";
import { z } from "zod";
import mongoose from "mongoose";
import { asyncHandler } from "../middleware/asyncHandler.js";
import {
  requireAuth,
  requireSuperAdmin,
  type AuthenticatedRequest,
} from "../middleware/auth.js";
import { Workspace } from "../models/index.js";
import { inviteWorkspaceMember } from "../services/memberInvite.js";
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
      res.status(404).json({ error: "Workspace not found" });
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
    const workspace = await Workspace.create({
      name: body.name,
      slug: body.slug.toLowerCase(),
    });

    await recordPlatformAudit({
      workspaceId: workspace._id.toString(),
      actorUserId: actor.userId,
      actorEmail: actor.email,
      action: "WORKSPACE_CREATED",
      summary: `Created workspace "${workspace.name}"`,
      metadata: { slug: workspace.slug },
    });

    res.status(201).json({ workspace: serializeWorkspace(workspace) });
  }),
);

router.patch(
  "/workspaces/:id",
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      res.status(400).json({ error: "Invalid workspace id" });
      return;
    }

    const body = patchWorkspaceSchema.parse(req.body);
    const actor = actorFromRequest(req as AuthenticatedRequest);
    const existing = await Workspace.findById(id);
    if (!existing) {
      res.status(404).json({ error: "Workspace not found" });
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

    const workspace = await Workspace.findByIdAndUpdate(id, update, {
      new: true,
      runValidators: true,
    });
    if (!workspace) {
      res.status(404).json({ error: "Workspace not found" });
      return;
    }

    if (body.isActive !== undefined && body.isActive !== existing.isActive) {
      await recordPlatformAudit({
        workspaceId: id,
        actorUserId: actor.userId,
        actorEmail: actor.email,
        action: body.isActive ? "WORKSPACE_REACTIVATED" : "WORKSPACE_SUSPENDED",
        summary: body.isActive
          ? `Reactivated workspace "${workspace.name}"`
          : `Suspended workspace "${workspace.name}"`,
      });
    } else if (
      body.name !== undefined ||
      body.slug !== undefined ||
      body.settings !== undefined
    ) {
      await recordPlatformAudit({
        workspaceId: id,
        actorUserId: actor.userId,
        actorEmail: actor.email,
        action: "WORKSPACE_UPDATED",
        summary: `Updated workspace "${workspace.name}"`,
        metadata: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.slug !== undefined ? { slug: body.slug } : {}),
          ...(body.settings ? { settings: body.settings } : {}),
        },
      });
    }

    res.json({ workspace: serializeWorkspace(workspace) });
  }),
);

router.post(
  "/workspaces/:id/admins",
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      res.status(400).json({ error: "Invalid workspace id" });
      return;
    }
    const workspace = await Workspace.findById(id);
    if (!workspace) {
      res.status(404).json({ error: "Workspace not found" });
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
        summary: `Invited admin ${email} to "${workspace.name}"`,
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
            error: "Email domain is not allowed for this workspace",
          });
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
      res.status(400).json({ error: "Invalid workspace id" });
      return;
    }

    const workspace = await Workspace.findById(id);
    if (!workspace) {
      res.status(404).json({ error: "Workspace not found" });
      return;
    }

    const actor = actorFromRequest(req as AuthenticatedRequest);
    const entry = await recordPlatformAudit({
      workspaceId: id,
      actorUserId: actor.userId,
      actorEmail: actor.email,
      action: "WORKSPACE_ENTERED",
      summary: `Entered manage mode for "${workspace.name}"`,
    });

    res.status(201).json({ entry });
  }),
);

export default router;
