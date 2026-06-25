import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test", "staging"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  MONGODB_URI: z.string().min(1),
  JWT_SECRET: z.string().min(16),
  JWT_EXPIRES_IN: z.string().default("7d"),
  EMAIL_PROVIDER: z.enum(["stub", "brevo"]).default("stub"),
  BREVO_API_KEY: z.string().optional(),
  BREVO_SENDER_EMAIL: z.string().email().optional(),
  BREVO_SENDER_NAME: z.string().optional(),
  APP_BASE_URL: z.string().url().default("http://localhost:3000"),
  AWS_REGION: z.string().default("eu-west-1"),
  S3_UPLOADS_BUCKET: z.string().min(1).optional(),
});

type ParsedEnv = z.infer<typeof envSchema>;

export type Env = ParsedEnv & {
  effectiveEmailProvider: "stub" | "brevo";
};

let cached: Env | null = null;

function resolveEmailProvider(data: ParsedEnv): "stub" | "brevo" {
  if (data.EMAIL_PROVIDER === "brevo") return "brevo";
  if (data.BREVO_API_KEY) return "brevo";
  return "stub";
}

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const message = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid environment: ${message}`);
  }

  const effectiveEmailProvider = resolveEmailProvider(parsed.data);
  if (effectiveEmailProvider === "brevo") {
    if (!parsed.data.BREVO_API_KEY || !parsed.data.BREVO_SENDER_EMAIL) {
      throw new Error(
        "BREVO_API_KEY and BREVO_SENDER_EMAIL are required when using Brevo (set EMAIL_PROVIDER=brevo or provide BREVO_API_KEY)",
      );
    }
  }

  cached = { ...parsed.data, effectiveEmailProvider };
  return cached;
}
