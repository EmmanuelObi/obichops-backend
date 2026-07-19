import mongoose from "mongoose";
import { AllowedEmail, User, Chopspace } from "../models/index.js";
import { generateTemporaryPassword, hashPassword } from "./password.js";
import { sendStaffInviteEmail } from "./invite.js";
import { isEmailDomainAllowed } from "./emailDomain.js";

export interface InviteMemberResult {
  allowedEmailId: string;
  userId: string;
  email: string;
  role: "STAFF" | "ADMIN";
  isActive: boolean;
  invited: boolean;
}

export async function inviteWorkspaceMember(input: {
  workspaceId: string;
  email: string;
  role: "STAFF" | "ADMIN";
  skipDomainCheck?: boolean;
}): Promise<InviteMemberResult> {
  const email = input.email.toLowerCase();
  const chopspace = await Chopspace.findById(input.workspaceId);
  if (!chopspace) {
    throw new Error("Chopspace not found");
  }

  if (
    !input.skipDomainCheck &&
    !isEmailDomainAllowed(
      email,
      chopspace.settings?.allowedEmailDomains as string[] | undefined,
    )
  ) {
    throw new Error("DOMAIN_NOT_ALLOWED");
  }

  let allowed = await AllowedEmail.findOne({
    workspaceId: input.workspaceId,
    email,
  });

  const existingUser = await User.findOne({
    workspaceId: input.workspaceId,
    email,
  });

  if (existingUser?.isActive && allowed?.isActive) {
    throw new Error("USER_EXISTS");
  }

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  if (!allowed) {
    allowed = await AllowedEmail.create({
      workspaceId: input.workspaceId,
      email,
      role: input.role,
      isActive: true,
    });
  } else {
    allowed.role = input.role;
    allowed.isActive = true;
    await allowed.save();
  }

  let user = existingUser;
  if (!user) {
    user = await User.create({
      email,
      passwordHash,
      role: input.role,
      workspaceId: new mongoose.Types.ObjectId(input.workspaceId),
      isActive: true,
      mustChangePassword: true,
    });
  } else {
    user.passwordHash = passwordHash;
    user.role = input.role;
    user.isActive = true;
    user.mustChangePassword = true;
    await user.save();
  }

  await sendStaffInviteEmail({
    to: email,
    workspaceId: input.workspaceId,
    temporaryPassword,
    role: input.role,
  });

  return {
    allowedEmailId: allowed._id.toString(),
    userId: user._id.toString(),
    email,
    role: input.role,
    isActive: true,
    invited: true,
  };
}

export async function setAllowedEmailActive(input: {
  workspaceId: string;
  allowedEmailId: string;
  isActive: boolean;
}): Promise<void> {
  const allowed = await AllowedEmail.findOne({
    _id: input.allowedEmailId,
    workspaceId: input.workspaceId,
  });
  if (!allowed) {
    throw new Error("NOT_FOUND");
  }

  allowed.isActive = input.isActive;
  await allowed.save();

  await User.updateOne(
    { workspaceId: input.workspaceId, email: allowed.email },
    { isActive: input.isActive },
  );
}
