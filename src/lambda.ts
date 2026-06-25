import { configure } from "@codegenie/serverless-express";
import type { Handler } from "aws-lambda";
import { createApp } from "./app.js";
import { loadSecretsIntoEnv } from "./config/loadSecrets.js";

const app = createApp();
const baseHandler = configure({ app });

let ready = false;

async function ensureReady(): Promise<void> {
  if (ready) return;
  await loadSecretsIntoEnv();
  ready = true;
}

export const lambdaHandler: Handler = async (event, context, callback) => {
  await ensureReady();
  return baseHandler(event, context, callback);
};
