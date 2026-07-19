import { getEnv } from "../config/env.js";
import { getEmailAdapter } from "../email/factory.js";
import {
  Chopspace,
  OnboardingRequest,
  type OnboardingRequestDocument,
} from "../models/index.js";
import { inviteWorkspaceMember } from "./memberInvite.js";

export function serializeOnboardingRequest(doc: OnboardingRequestDocument) {
  return {
    id: doc._id.toString(),
    businessName: doc.businessName,
    slug: doc.slug,
    contactName: doc.contactName,
    email: doc.email,
    phone: doc.phone ?? null,
    teamSize: doc.teamSize ?? null,
    notes: doc.notes ?? null,
    status: doc.status,
    reviewedByEmail: doc.reviewedByEmail ?? null,
    reviewedAt: doc.reviewedAt ? doc.reviewedAt.toISOString() : null,
    rejectionReason: doc.rejectionReason ?? null,
    workspaceId: doc.workspaceId ? doc.workspaceId.toString() : null,
    createdAt: doc.createdAt.toISOString(),
  };
}

export async function submitOnboardingRequest(input: {
  businessName: string;
  slug: string;
  contactName: string;
  email: string;
  phone?: string;
  teamSize?: string;
  notes?: string;
}) {
  const email = input.email.toLowerCase();
  const slug = input.slug.toLowerCase();

  const slugTaken = await Chopspace.exists({ slug });
  if (slugTaken) {
    throw new Error("SLUG_TAKEN");
  }

  const duplicate = await OnboardingRequest.exists({
    status: "PENDING",
    $or: [{ email }, { slug }],
  });
  if (duplicate) {
    throw new Error("REQUEST_EXISTS");
  }

  const request = await OnboardingRequest.create({
    businessName: input.businessName,
    slug,
    contactName: input.contactName,
    email,
    phone: input.phone || null,
    teamSize: input.teamSize || null,
    notes: input.notes || null,
  });

  await sendSubmissionReceivedEmail(request);

  return serializeOnboardingRequest(request);
}

export async function approveOnboardingRequest(input: {
  requestId: string;
  reviewerEmail: string;
}) {
  const request = await OnboardingRequest.findById(input.requestId);
  if (!request) {
    throw new Error("NOT_FOUND");
  }
  if (request.status !== "PENDING") {
    throw new Error("ALREADY_REVIEWED");
  }

  const slugTaken = await Chopspace.exists({ slug: request.slug });
  if (slugTaken) {
    throw new Error("SLUG_TAKEN");
  }

  const chopspace = await Chopspace.create({
    name: request.businessName,
    slug: request.slug,
  });

  // Sends the invite email with a temporary password.
  await inviteWorkspaceMember({
    workspaceId: chopspace._id.toString(),
    email: request.email,
    role: "ADMIN",
    skipDomainCheck: true,
  });

  request.status = "APPROVED";
  request.reviewedByEmail = input.reviewerEmail.toLowerCase();
  request.reviewedAt = new Date();
  request.workspaceId = chopspace._id;
  await request.save();

  return {
    request: serializeOnboardingRequest(request),
    chopspace: {
      id: chopspace._id.toString(),
      name: chopspace.name,
      slug: chopspace.slug,
    },
  };
}

export async function rejectOnboardingRequest(input: {
  requestId: string;
  reviewerEmail: string;
  reason?: string;
}) {
  const request = await OnboardingRequest.findById(input.requestId);
  if (!request) {
    throw new Error("NOT_FOUND");
  }
  if (request.status !== "PENDING") {
    throw new Error("ALREADY_REVIEWED");
  }

  request.status = "REJECTED";
  request.reviewedByEmail = input.reviewerEmail.toLowerCase();
  request.reviewedAt = new Date();
  request.rejectionReason = input.reason?.trim() || null;
  await request.save();

  await sendRejectionEmail(request);

  return serializeOnboardingRequest(request);
}

async function sendSubmissionReceivedEmail(request: OnboardingRequestDocument) {
  const email = getEmailAdapter();
  try {
    await email.send({
      to: request.email,
      subject: "We received your request - Obi's Chops",
      html: `
        <p>Hi ${request.contactName},</p>
        <p>Thanks for your interest in Obi's Chops. We've received your request to set up a chopspace for <strong>${request.businessName}</strong>.</p>
        <p>Our team will review it shortly. Once approved, you'll get an email with your admin sign-in details.</p>
      `,
      text: [
        `Hi ${request.contactName},`,
        `Thanks for your interest in Obi's Chops. We've received your request to set up a chopspace for ${request.businessName}.`,
        "Our team will review it shortly. Once approved, you'll get an email with your admin sign-in details.",
      ].join("\n"),
    });
  } catch (err) {
    // The request is already saved; a failed confirmation email shouldn't fail the submission.
    console.error("Failed to send onboarding confirmation email", err);
  }
}

async function sendRejectionEmail(request: OnboardingRequestDocument) {
  const { APP_BASE_URL } = getEnv();
  const email = getEmailAdapter();
  const reasonBlock = request.rejectionReason
    ? `<p><strong>Note from our team:</strong> ${request.rejectionReason}</p>`
    : "";

  try {
    await email.send({
      to: request.email,
      subject: "Update on your Obi's Chops request",
      html: `
        <p>Hi ${request.contactName},</p>
        <p>Thanks for your interest in Obi's Chops. Unfortunately we can't set up a chopspace for <strong>${request.businessName}</strong> right now.</p>
        ${reasonBlock}
        <p>You're welcome to submit a new request at <a href="${APP_BASE_URL}/get-started">${APP_BASE_URL}/get-started</a>.</p>
      `,
      text: [
        `Hi ${request.contactName},`,
        `Thanks for your interest in Obi's Chops. Unfortunately we can't set up a chopspace for ${request.businessName} right now.`,
        ...(request.rejectionReason
          ? [`Note from our team: ${request.rejectionReason}`]
          : []),
        `You're welcome to submit a new request at ${APP_BASE_URL}/get-started.`,
      ].join("\n"),
    });
  } catch (err) {
    console.error("Failed to send onboarding rejection email", err);
  }
}
