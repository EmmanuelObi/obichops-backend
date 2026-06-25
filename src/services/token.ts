import jwt, { type SignOptions } from "jsonwebtoken";
import { getEnv } from "../config/env.js";
import type { JwtPayload } from "../types/jwt.js";
import type { Role } from "../types/roles.js";

export function signAccessToken(params: {
  userId: string;
  workspaceId: string | null;
  role: Role;
  email: string;
}): string {
  const { JWT_SECRET, JWT_EXPIRES_IN } = getEnv();
  const payload: JwtPayload = {
    sub: params.userId,
    workspaceId: params.workspaceId,
    role: params.role,
    email: params.email,
  };
  const options: SignOptions = { expiresIn: JWT_EXPIRES_IN as SignOptions["expiresIn"] };
  return jwt.sign(payload, JWT_SECRET, options);
}

export function verifyAccessToken(token: string): JwtPayload {
  const { JWT_SECRET } = getEnv();
  const decoded = jwt.verify(token, JWT_SECRET);
  if (typeof decoded !== "object" || decoded === null) {
    throw new Error("Invalid token");
  }
  const p = decoded as Record<string, unknown>;
  if (
    typeof p.sub !== "string" ||
    typeof p.email !== "string" ||
    typeof p.role !== "string" ||
    (p.workspaceId !== null && typeof p.workspaceId !== "string")
  ) {
    throw new Error("Invalid token payload");
  }
  return {
    sub: p.sub,
    workspaceId: p.workspaceId as string | null,
    role: p.role as JwtPayload["role"],
    email: p.email,
  };
}
