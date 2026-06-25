import { AllowedEmail, Workspace } from "../models/index.js";
import { getEmailDomain } from "./emailDomain.js";

export async function resolveWorkspaceIdBySlug(
  slug: string,
): Promise<string | null> {
  const normalized = slug.trim().toLowerCase();
  const workspace = await Workspace.findOne({
    slug: normalized,
    isActive: true,
  });
  return workspace ? workspace._id.toString() : null;
}

export type WorkspaceAuthResolution =
  | { kind: "resolved"; workspaceId: string }
  | { kind: "platform" }
  | { kind: "ambiguous" }
  | { kind: "slug_not_found" };

/**
 * Resolve which workspace context to use for login / password reset.
 * Slug takes precedence when provided; otherwise uses email domain or invite record.
 */
export async function resolveWorkspaceForAuth(
  email: string,
  slug?: string | null,
): Promise<WorkspaceAuthResolution> {
  const normalizedEmail = email.trim().toLowerCase();

  if (slug?.trim()) {
    const workspaceId = await resolveWorkspaceIdBySlug(slug);
    if (!workspaceId) return { kind: "slug_not_found" };
    return { kind: "resolved", workspaceId };
  }

  const domain = getEmailDomain(normalizedEmail);
  if (domain) {
    const workspaces = await Workspace.find({
      isActive: true,
      "settings.allowedEmailDomains": domain,
    }).select("_id");

    if (workspaces.length === 1) {
      return {
        kind: "resolved",
        workspaceId: workspaces[0]._id.toString(),
      };
    }

    if (workspaces.length > 1) {
      const allowed = await AllowedEmail.findOne({ email: normalizedEmail });
      if (allowed) {
        return {
          kind: "resolved",
          workspaceId: allowed.workspaceId.toString(),
        };
      }
      return { kind: "ambiguous" };
    }
  }

  const allowed = await AllowedEmail.findOne({ email: normalizedEmail });
  if (allowed) {
    return { kind: "resolved", workspaceId: allowed.workspaceId.toString() };
  }

  return { kind: "platform" };
}

export function workspaceIdForUserQuery(
  resolution: WorkspaceAuthResolution,
): string | null | undefined {
  if (resolution.kind === "resolved") {
    return resolution.workspaceId;
  }
  if (resolution.kind === "platform") {
    return null;
  }
  return undefined;
}
