import { getEnv } from "../config/env.js";
import { BrevoEmailAdapter } from "./BrevoEmailAdapter.js";
import { StubEmailAdapter } from "./StubEmailAdapter.js";
import type { EmailAdapter } from "./types.js";

let adapter: EmailAdapter | null = null;

export function getEmailAdapter(): EmailAdapter {
  if (adapter) return adapter;
  const { effectiveEmailProvider } = getEnv();
  adapter =
    effectiveEmailProvider === "brevo"
      ? new BrevoEmailAdapter()
      : new StubEmailAdapter();
  return adapter;
}
