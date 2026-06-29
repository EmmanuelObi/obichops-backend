import type mongoose from "mongoose";
import { getUserDisplayName, userNeedsProfileCompletion } from "./userDisplay.js";

export type TeamMemberStatus = "active" | "pending" | "inactive";

export function getTeamMemberStatus(
  allowed: { isActive?: boolean },
  user?: {
    mustChangePassword?: boolean;
    firstName?: string | null;
    lastName?: string | null;
  } | null,
): TeamMemberStatus {
  if (!allowed.isActive) return "inactive";
  if (!user || userNeedsProfileCompletion(user)) return "pending";
  return "active";
}

export function serializeTeamMember(
  allowed: {
    _id: mongoose.Types.ObjectId;
    workspaceId: mongoose.Types.ObjectId;
    email: string;
    role: string;
    isActive?: boolean;
    createdAt?: Date;
  },
  user?: {
    firstName?: string | null;
    lastName?: string | null;
    name?: string | null;
    email: string;
    mustChangePassword?: boolean;
  } | null,
) {
  const status = getTeamMemberStatus(allowed, user);
  const displayName = user ? getUserDisplayName(user) : null;

  return {
    id: allowed._id.toString(),
    workspaceId: allowed.workspaceId.toString(),
    email: allowed.email,
    role: allowed.role,
    isActive: allowed.isActive ?? true,
    createdAt: allowed.createdAt?.toISOString(),
    firstName: user?.firstName ?? null,
    lastName: user?.lastName ?? null,
    displayName,
    status,
  };
}
