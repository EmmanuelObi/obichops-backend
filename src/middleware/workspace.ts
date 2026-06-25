import type { Response } from "express";
import type { AuthenticatedRequest } from "./auth.js";

export function requireWorkspaceContext(
  req: AuthenticatedRequest,
  res: Response,
): string | null {
  const workspaceId = req.auth?.workspaceId ?? null;
  if (!workspaceId) {
    res.status(400).json({ error: "Workspace context required" });
    return null;
  }
  return workspaceId;
}
