import type { Handler } from "aws-lambda";
import { loadSecretsIntoEnv } from "../config/loadSecrets.js";
import { connectDb } from "../db/connect.js";
import { runCronJob } from "../services/reminders/runCron.js";

let ready = false;

async function ensureReady(): Promise<void> {
  if (ready) return;
  await loadSecretsIntoEnv();
  ready = true;
}

export const cronHandler: Handler = async (event) => {
  await ensureReady();
  console.log("Cron handler invoked", JSON.stringify(event));
  await connectDb();
  const result = await runCronJob();
  console.log("Cron job complete", result);
  return { statusCode: 200, body: JSON.stringify({ ok: true, ...result }) };
};
