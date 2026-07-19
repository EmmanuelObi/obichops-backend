import mongoose from "mongoose";
import type { NextFunction, Response } from "express";
import { Chopspace } from "../models/index.js";
import type { AuthenticatedRequest } from "./auth.js";

export function resolveWorkspaceId(req: AuthenticatedRequest): string | null {
  const auth = req.auth;
  if (!auth) return null;
  if (auth.workspaceId) return auth.workspaceId;

  if (auth.role === "SUPER_ADMIN") {
    const header =
      req.headers["x-chopspace-id"] ?? req.headers["x-workspace-id"];
    const value = Array.isArray(header) ? header[0] : header;
    if (value && mongoose.isValidObjectId(value)) {
      return value;
    }
  }

  return null;
}

export function requireWorkspaceContext(
  req: AuthenticatedRequest,
  res: Response,
): string | null {
  const workspaceId = resolveWorkspaceId(req);
  if (!workspaceId) {
    res.status(400).json({ error: "Chopspace context required" });
    return null;
  }
  return workspaceId;
}

export function requireActiveWorkspace(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void {
  void (async () => {
    const auth = req.auth;
    if (!auth || auth.role === "SUPER_ADMIN") {
      next();
      return;
    }

    const workspaceId = auth.workspaceId;
    if (!workspaceId) {
      next();
      return;
    }

    const chopspace = await Chopspace.findById(workspaceId).select("isActive");
    if (!chopspace?.isActive) {
      res.status(403).json({ error: "This chopspace has been suspended" });
      return;
    }

    next();
  })().catch(next);
}
