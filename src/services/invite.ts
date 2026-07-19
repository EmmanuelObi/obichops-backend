import { getEnv } from "../config/env.js";
import { getEmailAdapter } from "../email/factory.js";
import { Chopspace } from "../models/Workspace.js";

export async function sendStaffInviteEmail(input: {
  to: string;
  workspaceId: string;
  temporaryPassword: string;
  role: "STAFF" | "ADMIN";
}): Promise<void> {
  const chopspace = await Chopspace.findById(input.workspaceId);
  if (!chopspace) {
    throw new Error("Chopspace not found");
  }

  const { APP_BASE_URL } = getEnv();
  const loginUrl = `${APP_BASE_URL}/login`;
  const roleLabel = input.role === "ADMIN" ? "admin" : "staff";

  const email = getEmailAdapter();
  await email.send({
    to: input.to,
    subject: `You're invited to ${chopspace.name} on Obi's Chops`,
    html: `
      <p>You've been added as <strong>${roleLabel}</strong> for <strong>${chopspace.name}</strong>.</p>
      <p><strong>Chopspace:</strong> ${chopspace.slug}</p>
      <p><strong>Email:</strong> ${input.to}</p>
      <p><strong>Temporary password:</strong> <code>${input.temporaryPassword}</code></p>
      <p><a href="${loginUrl}">Sign in here</a> — you will be asked to enter your name and set a new password on first login.</p>
      <p>If you did not expect this invitation, you can ignore this email.</p>
    `,
    text: [
      `You've been added to ${chopspace.name} (${chopspace.slug}) on Obi's Chops.`,
      `Email: ${input.to}`,
      `Temporary password: ${input.temporaryPassword}`,
      `Sign in: ${loginUrl}`,
      "You will be asked to enter your name and set a new password on first login.",
    ].join("\n"),
  });
}
