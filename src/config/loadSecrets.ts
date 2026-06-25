import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";

let loaded = false;

/**
 * Loads JSON key/value pairs from AWS Secrets Manager into process.env.
 * Skipped when SECRETS_NAME is unset (local dev uses .env via dotenv).
 */
export async function loadSecretsIntoEnv(): Promise<void> {
  if (loaded) return;

  const secretName = process.env.SECRETS_NAME;
  if (!secretName) {
    loaded = true;
    return;
  }

  const region = process.env.AWS_REGION ?? "us-east-1";
  const client = new SecretsManagerClient({ region });
  const response = await client.send(
    new GetSecretValueCommand({ SecretId: secretName }),
  );

  if (response.SecretString) {
    const secrets = JSON.parse(response.SecretString) as Record<string, unknown>;
    for (const [key, value] of Object.entries(secrets)) {
      if (value !== undefined && value !== null && process.env[key] === undefined) {
        process.env[key] = String(value);
      }
    }
  }

  loaded = true;
}
