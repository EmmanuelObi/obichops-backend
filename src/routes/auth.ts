import { Router } from "express";
import { z } from "zod";
import mongoose from "mongoose";
import { getEnv } from "../config/env.js";
import { getEmailAdapter } from "../email/factory.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import {
  requireAuth,
  type AuthenticatedRequest,
} from "../middleware/auth.js";
import { AllowedEmail, PasswordResetToken, User, Workspace } from "../models/index.js";
import { resolveWorkspaceForAuth, workspaceIdForUserQuery } from "../services/workspace.js";
import {
  generateResetToken,
  hashPassword,
  hashResetToken,
  verifyPassword,
} from "../services/password.js";
import { signAccessToken } from "../services/token.js";
import { getUserDisplayName, userNeedsProfileCompletion } from "../services/userDisplay.js";

const router = Router();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().trim().optional(),
  workspaceSlug: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  workspaceSlug: z.string().optional(),
});

const forgotSchema = z.object({
  email: z.string().email(),
  workspaceSlug: z.string().optional(),
});

const resetSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).optional(),
  newPassword: z.string().min(8),
  firstName: z.string().trim().min(1).optional(),
  lastName: z.string().trim().min(1).optional(),
});

async function serializeUser(user: {
  _id: mongoose.Types.ObjectId;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  name?: string | null;
  role: string;
  workspaceId?: mongoose.Types.ObjectId | null;
  isActive?: boolean;
  mustChangePassword?: boolean;
}) {
  let workspaceSlug: string | null = null;
  let workspaceName: string | null = null;
  if (user.workspaceId) {
    const workspace = await Workspace.findById(user.workspaceId).select("slug name");
    workspaceSlug = workspace?.slug ?? null;
    workspaceName = workspace?.name ?? null;
  }

  const displayName = getUserDisplayName(user);

  return {
    id: user._id.toString(),
    email: user.email,
    firstName: user.firstName ?? null,
    lastName: user.lastName ?? null,
    name: displayName,
    role: user.role,
    workspaceId: user.workspaceId ? user.workspaceId.toString() : null,
    workspaceSlug,
    workspaceName,
    isActive: user.isActive ?? true,
    mustChangePassword: user.mustChangePassword ?? false,
    needsProfileCompletion: userNeedsProfileCompletion(user),
  };
}

router.post(
  "/register",
  asyncHandler(async (req, res) => {
    const body = registerSchema.parse(req.body);
    const resolution = await resolveWorkspaceForAuth(
      body.email,
      body.workspaceSlug,
    );

    if (resolution.kind === "slug_not_found") {
      res.status(404).json({ error: "Workspace not found" });
      return;
    }
    if (resolution.kind === "ambiguous") {
      res.status(400).json({
        error: "Email domain is used by multiple workspaces. Contact your admin.",
      });
      return;
    }
    if (resolution.kind === "platform") {
      res.status(404).json({ error: "Workspace not found" });
      return;
    }

    const workspaceId = resolution.workspaceId;

    const allowed = await AllowedEmail.findOne({
      workspaceId,
      email: body.email.toLowerCase(),
    });
    if (!allowed) {
      res.status(403).json({ error: "Email is not allowed for this workspace" });
      return;
    }

    const existing = await User.findOne({
      email: body.email.toLowerCase(),
      workspaceId,
    });
    if (existing) {
      if (existing.mustChangePassword) {
        res.status(409).json({
          error: "Account already created. Check your invite email and sign in.",
        });
        return;
      }
      res.status(409).json({ error: "User already exists" });
      return;
    }

    const passwordHash = await hashPassword(body.password);
    const user = await User.create({
      email: body.email.toLowerCase(),
      passwordHash,
      name: body.name,
      role: allowed.role,
      workspaceId,
    });

    const token = signAccessToken({
      userId: user._id.toString(),
      workspaceId,
      role: user.role,
      email: user.email,
    });

    res.status(201).json({ user: await serializeUser(user), token });
  }),
);

router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const body = loginSchema.parse(req.body);
    const resolution = await resolveWorkspaceForAuth(
      body.email,
      body.workspaceSlug,
    );

    if (resolution.kind === "slug_not_found") {
      res.status(404).json({ error: "Workspace not found" });
      return;
    }
    if (resolution.kind === "ambiguous") {
      res.status(400).json({
        error: "Email domain is used by multiple workspaces. Contact your admin.",
      });
      return;
    }

    const workspaceFilter = workspaceIdForUserQuery(resolution);
    if (workspaceFilter === undefined) {
      res.status(400).json({ error: "Invalid credentials" });
      return;
    }

    const user = await User.findOne({
      email: body.email.toLowerCase(),
      workspaceId: workspaceFilter,
    });
    if (!user) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    if (!user.isActive) {
      res.status(403).json({ error: "Account is deactivated" });
      return;
    }

    const valid = await verifyPassword(body.password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    const token = signAccessToken({
      userId: user._id.toString(),
      workspaceId: user.workspaceId ? user.workspaceId.toString() : null,
      role: user.role,
      email: user.email,
    });

    res.json({ user: await serializeUser(user), token });
  }),
);

router.post(
  "/forgot-password",
  asyncHandler(async (req, res) => {
    const body = forgotSchema.parse(req.body);
    const resolution = await resolveWorkspaceForAuth(
      body.email,
      body.workspaceSlug,
    );

    if (resolution.kind === "slug_not_found") {
      res.json({ message: "If an account exists, a reset email has been sent" });
      return;
    }
    if (resolution.kind === "ambiguous") {
      res.json({ message: "If an account exists, a reset email has been sent" });
      return;
    }

    const workspaceId = workspaceIdForUserQuery(resolution);
    if (workspaceId === undefined) {
      res.json({ message: "If an account exists, a reset email has been sent" });
      return;
    }

    const user = await User.findOne({
      email: body.email.toLowerCase(),
      workspaceId,
    });

    res.json({ message: "If an account exists, a reset email has been sent" });

    if (!user) return;

    const { token, tokenHash } = generateResetToken();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await PasswordResetToken.create({
      userId: user._id,
      tokenHash,
      expiresAt,
    });

    const { APP_BASE_URL } = getEnv();
    const resetUrl = `${APP_BASE_URL}/reset-password?token=${token}`;
    const email = getEmailAdapter();
    await email.send({
      to: user.email,
      subject: "Reset your Obi's Chops password",
      html: `<p>Reset your password: <a href="${resetUrl}">${resetUrl}</a></p>`,
      text: `Reset your password: ${resetUrl}`,
    });
  }),
);

router.post(
  "/reset-password",
  asyncHandler(async (req, res) => {
    const body = resetSchema.parse(req.body);
    const tokenHash = hashResetToken(body.token);

    const record = await PasswordResetToken.findOne({
      tokenHash,
      usedAt: null,
      expiresAt: { $gt: new Date() },
    });
    if (!record) {
      res.status(400).json({ error: "Invalid or expired reset token" });
      return;
    }

    const passwordHash = await hashPassword(body.password);
    await User.findByIdAndUpdate(record.userId, {
      passwordHash,
      mustChangePassword: false,
    });
    record.usedAt = new Date();
    await record.save();

    res.json({ message: "Password updated" });
  }),
);

router.post(
  "/change-password",
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = changePasswordSchema.parse(req.body);
    const auth = (req as AuthenticatedRequest).auth!;
    const user = await User.findById(auth.sub);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const needsProfile = userNeedsProfileCompletion(user);

    if (needsProfile) {
      if (!body.firstName || !body.lastName) {
        res.status(400).json({ error: "First name and last name are required" });
        return;
      }
    } else {
      if (!body.currentPassword) {
        res.status(400).json({ error: "Current password is required" });
        return;
      }
      const valid = await verifyPassword(body.currentPassword, user.passwordHash);
      if (!valid) {
        res.status(401).json({ error: "Current password is incorrect" });
        return;
      }
    }

    user.passwordHash = await hashPassword(body.newPassword);
    user.mustChangePassword = false;

    if (body.firstName) user.firstName = body.firstName;
    if (body.lastName) user.lastName = body.lastName;
    if (user.firstName && user.lastName) {
      user.name = `${user.firstName} ${user.lastName}`;
    }

    await user.save();

    res.json({
      message: "Password updated",
      user: await serializeUser(user),
    });
  }),
);

router.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const auth = (req as AuthenticatedRequest).auth!;
    const user = await User.findById(auth.sub);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json({ user: await serializeUser(user) });
  }),
);

export default router;
