import type { Role } from "./roles.js";

export interface JwtPayload {
  sub: string;
  workspaceId: string | null;
  role: Role;
  email: string;
  needsProfileCompletion?: boolean;
}
