import { configure } from "@codegenie/serverless-express";
import type { APIGatewayProxyEventV2, Context, Handler } from "aws-lambda";
import { createApp } from "./app.js";
import { loadSecretsIntoEnv } from "./config/loadSecrets.js";
import { connectDb } from "./db/connect.js";

const app = createApp();
const baseHandler = configure({
  app,
  // API Gateway HTTP API requires base64 for non-text bodies. The library only
  // treats image/* as binary by default; PDF/DOCX streams are corrupted without this.
  binarySettings: {
    contentTypes: [
      "image/*",
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/octet-stream",
    ],
  },
});

let ready = false;

function isHealthCheck(event: APIGatewayProxyEventV2): boolean {
  const path = event.rawPath ?? event.requestContext?.http?.path ?? "";
  return path === "/health" || path === "/health/";
}

async function ensureReady(): Promise<void> {
  if (ready) return;
  await loadSecretsIntoEnv();
  await connectDb();
  ready = true;
}

export const lambdaHandler: Handler = async (event, context, callback) => {
  // Mongoose keeps the event loop open; without this Lambda waits until timeout.
  (context as Context).callbackWaitsForEmptyEventLoop = false;

  const apiEvent = event as APIGatewayProxyEventV2;

  if (!isHealthCheck(apiEvent)) {
    try {
      await ensureReady();
    } catch (err) {
      console.error("Lambda init failed:", err);
      return {
        statusCode: 503,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: "Service unavailable",
          message: err instanceof Error ? err.message : "Initialization failed",
        }),
      };
    }
  }

  return baseHandler(event, context, callback);
};
