import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

export const ONBOARDING_STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;
export type OnboardingStatus = (typeof ONBOARDING_STATUSES)[number];

const onboardingRequestSchema = new Schema(
  {
    businessName: { type: String, required: true, trim: true },
    slug: { type: String, required: true, lowercase: true, trim: true },
    contactName: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    phone: { type: String, trim: true, default: null },
    teamSize: { type: String, trim: true, default: null },
    notes: { type: String, trim: true, default: null },
    status: {
      type: String,
      enum: ONBOARDING_STATUSES,
      default: "PENDING",
      index: true,
    },
    reviewedByEmail: { type: String, lowercase: true, trim: true, default: null },
    reviewedAt: { type: Date, default: null },
    rejectionReason: { type: String, trim: true, default: null },
    workspaceId: {
      type: Schema.Types.ObjectId,
      ref: "Chopspace",
      default: null,
    },
  },
  { timestamps: true },
);

onboardingRequestSchema.index({ createdAt: -1 });
onboardingRequestSchema.index({ email: 1, status: 1 });

export type OnboardingRequestDocument = InferSchemaType<
  typeof onboardingRequestSchema
> & {
  _id: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const OnboardingRequest: Model<OnboardingRequestDocument> =
  mongoose.models.OnboardingRequest ??
  mongoose.model<OnboardingRequestDocument>(
    "OnboardingRequest",
    onboardingRequestSchema,
  );
