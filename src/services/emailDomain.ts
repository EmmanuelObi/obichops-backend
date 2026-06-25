export function getEmailDomain(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 0) return "";
  return email.slice(at + 1).toLowerCase();
}

export function isEmailDomainAllowed(
  email: string,
  allowedDomains: string[] | undefined | null,
): boolean {
  if (!allowedDomains?.length) return true;
  const domain = getEmailDomain(email);
  const normalized = allowedDomains.map((d) => d.toLowerCase().trim());
  return normalized.includes(domain);
}

export function formatAllowedDomains(allowedDomains: string[]): string {
  return allowedDomains.map((d) => `@${d}`).join(", ");
}
