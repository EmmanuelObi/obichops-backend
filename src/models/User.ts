import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { ROLES } from "../types/roles.js";

const userSchema = new Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    firstName: { type: String, trim: true },
    lastName: { type: String, trim: true },
    name: { type: String, trim: true },
    role: { type: String, enum: ROLES, required: true },
    isActive: { type: Boolean, default: true },
    mustChangePassword: { type: Boolean, default: false },
    workspaceId: {
      type: Schema.Types.ObjectId,
      ref: "Workspace",
      default: null,
      index: true,
    },
  },
  { timestamps: true },
);

userSchema.index(
  { email: 1, workspaceId: 1 },
  {
    unique: true,
    partialFilterExpression: { workspaceId: { $type: "objectId" } },
  },
);

userSchema.index(
  { email: 1 },
  {
    unique: true,
    partialFilterExpression: { workspaceId: null },
  },
);

export type UserDocument = InferSchemaType<typeof userSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const User: Model<UserDocument> =
  mongoose.models.User ?? mongoose.model<UserDocument>("User", userSchema);
