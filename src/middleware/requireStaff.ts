import type { NextFunction, Response } from "express";
import type { AuthenticatedRequest } from "./auth.js";

export function requireStaff(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void {
  if (!req.auth) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (req.auth.role !== "STAFF") {
    res.status(403).json({ error: "Staff access only" });
    return;
  }
  if (!req.auth.workspaceId) {
    res.status(403).json({ error: "Chopspace context required" });
    return;
  }
  next();
}
