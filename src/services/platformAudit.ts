import mongoose from "mongoose";
import {
  PlatformAuditLog,
  type PlatformAuditAction,
  type PlatformAuditLogDocument,
} from "../models/PlatformAuditLog.js";

export interface RecordPlatformAuditInput {
  workspaceId?: string | null;
  actorUserId: string;
  actorEmail: string;
  action: PlatformAuditAction;
  summary: string;
  metadata?: Record<string, unknown>;
}

export function serializePlatformAuditEntry(doc: PlatformAuditLogDocument) {
  return {
    id: doc._id.toString(),
    workspaceId: doc.workspaceId ? doc.workspaceId.toString() : null,
    actorUserId: doc.actorUserId.toString(),
    actorEmail: doc.actorEmail,
    action: doc.action,
    summary: doc.summary,
    metadata: doc.metadata ?? {},
    createdAt: doc.createdAt.toISOString(),
  };
}

export async function recordPlatformAudit(input: RecordPlatformAuditInput) {
  const entry = await PlatformAuditLog.create({
    workspaceId: input.workspaceId
      ? new mongoose.Types.ObjectId(input.workspaceId)
      : null,
    actorUserId: new mongoose.Types.ObjectId(input.actorUserId),
    actorEmail: input.actorEmail.toLowerCase(),
    action: input.action,
    summary: input.summary,
    metadata: input.metadata ?? {},
  });

  return serializePlatformAuditEntry(entry);
}

export async function listPlatformAuditLog(input?: {
  workspaceId?: string;
  limit?: number;
}) {
  const limit = Math.min(Math.max(input?.limit ?? 25, 1), 100);
  const filter: Record<string, unknown> = {};

  if (input?.workspaceId) {
    if (!mongoose.isValidObjectId(input.workspaceId)) {
      return [];
    }
    filter.workspaceId = new mongoose.Types.ObjectId(input.workspaceId);
  }

  const entries = await PlatformAuditLog.find(filter)
    .sort({ createdAt: -1 })
    .limit(limit);

  return entries.map(serializePlatformAuditEntry);
}
