import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { getEnv } from "../config/env.js";
import {
  EXCESS_PAYMENT_ALLOWED_MIME_TYPES,
  EXCESS_PAYMENT_MAX_BYTES,
  type ExcessPaymentMimeType,
} from "../types/excessPayment.js";

let client: S3Client | null = null;

function getS3Client(): S3Client {
  if (!client) {
    const env = getEnv();
    client = new S3Client({ region: env.AWS_REGION });
  }
  return client;
}

function getBucket(): string {
  const bucket = getEnv().S3_UPLOADS_BUCKET;
  if (!bucket) {
    throw new Error("S3 uploads are not configured (S3_UPLOADS_BUCKET)");
  }
  return bucket;
}

function sanitizeFilename(filename: string): string {
  const base = path.basename(filename).replace(/[^\w.\-()+ ]/g, "_").trim();
  return base.slice(0, 120) || "payment-proof";
}

export function buildExcessPaymentS3Key(
  workspaceId: string,
  orderId: string,
  filename: string,
): string {
  const safeName = sanitizeFilename(filename);
  return `excess-payments/${workspaceId}/${orderId}/${randomUUID()}-${safeName}`;
}

export function isExcessPaymentS3KeyForOrder(
  storageKey: string,
  workspaceId: string,
  orderId: string,
): boolean {
  const prefix = `excess-payments/${workspaceId}/${orderId}/`;
  return storageKey.startsWith(prefix) && !storageKey.includes("..");
}

export function validateExcessPaymentUploadRequest(input: {
  filename: string;
  mimeType: string;
  sizeBytes: number;
}): ExcessPaymentMimeType {
  if (!input.filename.trim()) {
    throw new Error("Filename is required");
  }
  if (input.sizeBytes <= 0) {
    throw new Error("File is empty");
  }
  if (input.sizeBytes > EXCESS_PAYMENT_MAX_BYTES) {
    throw new Error("File must be 5 MB or smaller");
  }
  if (
    !(EXCESS_PAYMENT_ALLOWED_MIME_TYPES as readonly string[]).includes(
      input.mimeType,
    )
  ) {
    throw new Error("File must be a JPEG, PNG, WebP image, or PDF");
  }
  return input.mimeType as ExcessPaymentMimeType;
}

export async function createExcessPaymentUploadUrl(input: {
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
}): Promise<{ uploadUrl: string; expiresInSeconds: number }> {
  const expiresInSeconds = 900;
  const command = new PutObjectCommand({
    Bucket: getBucket(),
    Key: input.storageKey,
    ContentType: input.mimeType,
    ContentLength: input.sizeBytes,
  });
  const uploadUrl = await getSignedUrl(getS3Client(), command, {
    expiresIn: expiresInSeconds,
  });
  return { uploadUrl, expiresInSeconds };
}

export async function verifyExcessPaymentObject(storageKey: string): Promise<void> {
  await getS3Client().send(
    new HeadObjectCommand({
      Bucket: getBucket(),
      Key: storageKey,
    }),
  );
}

export async function createExcessPaymentDownloadUrl(
  storageKey: string,
): Promise<{ downloadUrl: string; expiresInSeconds: number }> {
  const expiresInSeconds = 300;
  const command = new GetObjectCommand({
    Bucket: getBucket(),
    Key: storageKey,
  });
  const downloadUrl = await getSignedUrl(getS3Client(), command, {
    expiresIn: expiresInSeconds,
  });
  return { downloadUrl, expiresInSeconds };
}

export async function deleteExcessPaymentObject(storageKey: string): Promise<void> {
  await getS3Client().send(
    new DeleteObjectCommand({
      Bucket: getBucket(),
      Key: storageKey,
    }),
  );
}
