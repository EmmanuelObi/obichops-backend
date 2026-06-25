import { Router } from "express";
import { z } from "zod";
import mongoose from "mongoose";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireAuth, requireSuperAdmin } from "../middleware/auth.js";
import { AllowedEmail, User, Workspace } from "../models/index.js";
import { hashPassword } from "../services/password.js";

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

const patchWorkspaceSchema = z.object({
  name: z.string().min(1).trim().optional(),
  slug: z
    .string()
    .min(1)
    .trim()
    .regex(/^[a-z0-9-]+$/)
    .optional(),
  isActive: z.boolean().optional(),
});

const createAdminSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().trim().optional(),
});

function serializeWorkspace(doc: {
  _id: mongoose.Types.ObjectId;
  name: string;
  slug: string;
  isActive: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}) {
  return {
    id: doc._id.toString(),
    name: doc.name,
    slug: doc.slug,
    isActive: doc.isActive,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

router.get(
  "/workspaces",
  asyncHandler(async (_req, res) => {
    const workspaces = await Workspace.find().sort({ createdAt: -1 });
    res.json({ workspaces: workspaces.map(serializeWorkspace) });
  }),
);

router.post(
  "/workspaces",
  asyncHandler(async (req, res) => {
    const body = createWorkspaceSchema.parse(req.body);
    const workspace = await Workspace.create({
      name: body.name,
      slug: body.slug.toLowerCase(),
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
    const workspace = await Workspace.findByIdAndUpdate(
      id,
      {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.slug !== undefined ? { slug: body.slug.toLowerCase() } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      },
      { new: true, runValidators: true },
    );
    if (!workspace) {
      res.status(404).json({ error: "Workspace not found" });
      return;
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

    await AllowedEmail.findOneAndUpdate(
      { workspaceId: id, email },
      { workspaceId: id, email, role: "ADMIN" },
      { upsert: true, new: true },
    );

    const existing = await User.findOne({ email, workspaceId: id });
    if (existing) {
      res.status(409).json({ error: "Admin user already exists" });
      return;
    }

    const passwordHash = await hashPassword(body.password);
    const user = await User.create({
      email,
      passwordHash,
      name: body.name,
      role: "ADMIN",
      workspaceId: id,
    });

    res.status(201).json({
      user: {
        id: user._id.toString(),
        email: user.email,
        name: user.name ?? null,
        role: user.role,
        workspaceId: id,
      },
    });
  }),
);

export default router;
