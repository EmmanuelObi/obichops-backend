export interface UserNameFields {
  firstName?: string | null;
  lastName?: string | null;
  name?: string | null;
  email: string;
}

export function getUserDisplayName(user: UserNameFields): string {
  const fromParts = [user.firstName?.trim(), user.lastName?.trim()]
    .filter(Boolean)
    .join(" ");
  if (fromParts) return fromParts;
  if (user.name?.trim()) return user.name.trim();
  return user.email;
}

export function userNeedsProfileCompletion(user: {
  mustChangePassword?: boolean;
  firstName?: string | null;
  lastName?: string | null;
}): boolean {
  return (
    Boolean(user.mustChangePassword) ||
    !user.firstName?.trim() ||
    !user.lastName?.trim()
  );
}
