import { DeviceToken } from "../../models/index.js";
import { User } from "../../models/index.js";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const CHUNK_SIZE = 100;

export type ExpoPushMessage = {
  to: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  sound?: "default" | null;
};

type ExpoTicket = {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
};

function isExpoPushToken(token: string): boolean {
  return (
    token.startsWith("ExponentPushToken[") || token.startsWith("ExpoPushToken[")
  );
}

export async function getPushTokensForEmails(
  workspaceId: string,
  emails: string[],
): Promise<string[]> {
  if (emails.length === 0) return [];

  const normalized = emails.map((e) => e.toLowerCase());
  const users = await User.find({
    workspaceId,
    email: { $in: normalized },
    isActive: true,
  }).select("_id");

  if (users.length === 0) return [];

  const tokens = await DeviceToken.find({
    workspaceId,
    userId: { $in: users.map((u) => u._id) },
  }).select("token");

  return [
    ...new Set(
      tokens.map((t) => t.token).filter((token) => isExpoPushToken(token)),
    ),
  ];
}

async function removeInvalidTokens(tokens: string[]): Promise<void> {
  if (tokens.length === 0) return;
  await DeviceToken.deleteMany({ token: { $in: tokens } });
}

export async function sendExpoPush(
  messages: ExpoPushMessage[],
): Promise<{ sent: number; failed: number }> {
  const valid = messages.filter((m) => isExpoPushToken(m.to));
  if (valid.length === 0) return { sent: 0, failed: 0 };

  let sent = 0;
  let failed = 0;
  const invalidTokens: string[] = [];

  for (let i = 0; i < valid.length; i += CHUNK_SIZE) {
    const chunk = valid.slice(i, i + CHUNK_SIZE).map((m) => ({
      to: m.to,
      title: m.title,
      body: m.body,
      data: m.data ?? {},
      sound: m.sound ?? "default",
    }));

    try {
      const response = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip, deflate",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(chunk),
      });

      if (!response.ok) {
        failed += chunk.length;
        continue;
      }

      const payload = (await response.json()) as { data?: ExpoTicket[] };
      const tickets = payload.data ?? [];

      for (let j = 0; j < tickets.length; j += 1) {
        const ticket = tickets[j];
        const token = chunk[j]?.to;
        if (ticket?.status === "ok") {
          sent += 1;
          continue;
        }
        failed += 1;
        const errorCode = ticket?.details?.error;
        if (
          token &&
          (errorCode === "DeviceNotRegistered" ||
            errorCode === "InvalidCredentials")
        ) {
          invalidTokens.push(token);
        }
      }
    } catch {
      failed += chunk.length;
    }
  }

  await removeInvalidTokens(invalidTokens);
  return { sent, failed };
}

export async function sendReminderPushes(input: {
  workspaceId: string;
  recipientEmails: string[];
  title: string;
  body: string;
  type: string;
}): Promise<number> {
  const tokens = await getPushTokensForEmails(
    input.workspaceId,
    input.recipientEmails,
  );
  if (tokens.length === 0) return 0;

  const result = await sendExpoPush(
    tokens.map((to) => ({
      to,
      title: input.title,
      body: input.body,
      data: {
        type: input.type,
        screen: "order",
      },
    })),
  );

  return result.sent;
}
