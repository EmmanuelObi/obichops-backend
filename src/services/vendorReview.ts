import mongoose from "mongoose";
import {
  MenuWeek,
  Order,
  User,
  VendorReview,
  type VendorReviewDocument,
} from "../models/index.js";
import { getUserDisplayName } from "./userDisplay.js";

export class ReviewNotAllowedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReviewNotAllowedError";
  }
}

function serializeReview(doc: VendorReviewDocument) {
  return {
    rating: doc.rating,
    comment: doc.comment?.trim() || null,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export async function assertCanReview(
  workspaceId: string,
  userId: string,
  menuWeekId: string,
): Promise<{ menuWeek: NonNullable<Awaited<ReturnType<typeof MenuWeek.findOne>>> }> {
  if (!mongoose.isValidObjectId(menuWeekId)) {
    throw new ReviewNotAllowedError("Invalid menu week");
  }

  const menuWeek = await MenuWeek.findOne({ _id: menuWeekId, workspaceId });
  if (!menuWeek) {
    throw new ReviewNotAllowedError("Menu week not found");
  }
  if (menuWeek.status !== "CLOSED") {
    throw new ReviewNotAllowedError("Reviews are only allowed after the week is closed");
  }

  const order = await Order.findOne({
    workspaceId,
    userId,
    menuWeekId: menuWeek._id,
    status: "SUBMITTED",
  });
  if (!order) {
    throw new ReviewNotAllowedError("You must have a submitted order for this week to leave a review");
  }

  return { menuWeek };
}

export async function getReviewForUserWeek(
  userId: string,
  menuWeekId: string,
) {
  if (!mongoose.isValidObjectId(menuWeekId)) return null;
  const review = await VendorReview.findOne({ userId, menuWeekId });
  return review ? serializeReview(review) : null;
}

export async function upsertReview(input: {
  workspaceId: string;
  userId: string;
  menuWeekId: string;
  rating: number;
  comment?: string;
}) {
  const { menuWeek } = await assertCanReview(
    input.workspaceId,
    input.userId,
    input.menuWeekId,
  );

  const comment = input.comment?.trim() || undefined;

  const review = await VendorReview.findOneAndUpdate(
    {
      userId: input.userId,
      menuWeekId: menuWeek._id,
    },
    {
      workspaceId: input.workspaceId,
      menuWeekId: menuWeek._id,
      vendorId: menuWeek.activeVendorId,
      userId: input.userId,
      rating: input.rating,
      comment,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  return serializeReview(review!);
}

export async function getReviewsForUserWeeks(
  userId: string,
  menuWeekIds: string[],
): Promise<Map<string, ReturnType<typeof serializeReview>>> {
  if (menuWeekIds.length === 0) return new Map();

  const reviews = await VendorReview.find({
    userId,
    menuWeekId: { $in: menuWeekIds },
  });

  return new Map(
    reviews.map((review) => [
      review.menuWeekId.toString(),
      serializeReview(review),
    ]),
  );
}

export async function getVendorRatingSummaries(workspaceId: string) {
  const results = await VendorReview.aggregate<{
    _id: mongoose.Types.ObjectId;
    averageRating: number;
    reviewCount: number;
  }>([
    { $match: { workspaceId: new mongoose.Types.ObjectId(workspaceId) } },
    {
      $group: {
        _id: "$vendorId",
        averageRating: { $avg: "$rating" },
        reviewCount: { $sum: 1 },
      },
    },
  ]);

  return new Map(
    results.map((row) => [
      row._id.toString(),
      {
        averageRating: Math.round(row.averageRating * 10) / 10,
        reviewCount: row.reviewCount,
      },
    ]),
  );
}

export async function listReviewsByVendor(
  workspaceId: string,
  vendorId: string,
  limit = 50,
) {
  if (!mongoose.isValidObjectId(vendorId)) {
    return [];
  }

  const reviews = await VendorReview.find({ workspaceId, vendorId })
    .sort({ createdAt: -1 })
    .limit(limit);

  if (reviews.length === 0) return [];

  const userIds = [...new Set(reviews.map((review) => review.userId.toString()))];
  const weekIds = [...new Set(reviews.map((review) => review.menuWeekId.toString()))];

  const [users, weeks] = await Promise.all([
    User.find({ _id: { $in: userIds }, workspaceId }),
    MenuWeek.find({ _id: { $in: weekIds }, workspaceId }),
  ]);

  const userMap = new Map(users.map((user) => [user._id.toString(), user]));
  const weekMap = new Map(weeks.map((week) => [week._id.toString(), week]));

  return reviews.map((review) => {
    const user = userMap.get(review.userId.toString());
    const week = weekMap.get(review.menuWeekId.toString());
    return {
      id: review._id.toString(),
      rating: review.rating,
      comment: review.comment?.trim() || null,
      staffName: user ? getUserDisplayName(user) : "Unknown",
      weekStart: week?.weekStart.toISOString() ?? null,
      createdAt: review.createdAt.toISOString(),
    };
  });
}
