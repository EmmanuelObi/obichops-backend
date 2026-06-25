import type { NextFunction, Request, Response } from "express";
import { verifyAccessToken } from "../services/token.js";
import type { JwtPayload } from "../types/jwt.js";

export interface AuthenticatedRequest extends Request {
  auth?: JwtPayload;
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const token = header.slice("Bearer ".length);
  try {
    req.auth = verifyAccessToken(token);
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function requireSuperAdmin(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void {
  if (!req.auth) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (req.auth.role !== "SUPER_ADMIN" || req.auth.workspaceId !== null) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}

export function requireAdmin(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void {
  if (!req.auth) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (req.auth.role !== "ADMIN" && req.auth.role !== "SUPER_ADMIN") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  if (req.auth.role === "ADMIN" && !req.auth.workspaceId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}

export function getTenantWorkspaceId(auth: JwtPayload): string | null {
  if (auth.role === "SUPER_ADMIN") return null;
  return auth.workspaceId;
}
