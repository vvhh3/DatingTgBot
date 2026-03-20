import dotenv from "dotenv";

dotenv.config();

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }

  return value;
}

function optionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function parseChatId(name: string): number {
  const raw = requireEnv(name);
  const parsed = Number(raw);

  if (!Number.isInteger(parsed)) {
    throw new Error(`Env var ${name} must be an integer`);
  }

  return parsed;
}

function parseAdminIds(raw: string | undefined): Set<number> {
  if (!raw) {
    return new Set();
  }

  const ids = raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item));

  return new Set(ids);
}

function parseTimeZone(raw: string | undefined): string {
  const value = raw?.trim();
  return value || Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Moscow";
}

function parseCooldownSeconds(raw: string | undefined): number {
  const value = raw?.trim();

  if (!value) {
    return 15;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error("Env var SUBMISSION_COOLDOWN_SECONDS must be a non-negative integer");
  }

  return parsed;
}

function parseBoolean(raw: string | undefined, defaultValue = false): boolean {
  const value = raw?.trim().toLowerCase();

  if (!value) {
    return defaultValue;
  }

  if (["1", "true", "yes", "on"].includes(value)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(value)) {
    return false;
  }

  throw new Error("Env var DATABASE_SSL must be a boolean-like value");
}

export const config = {
  botToken: requireEnv("BOT_TOKEN"),
  databaseUrl: requireEnv("DATABASE_URL"),
  databaseSsl: parseBoolean(process.env.DATABASE_SSL, false),
  startPhoto: optionalEnv("START_PHOTO"),
  moderationChatId: parseChatId("MODERATION_CHAT_ID"),
  targetChatId: parseChatId("TARGET_CHAT_ID"),
  adminUserIds: parseAdminIds(process.env.ADMIN_USER_IDS),
  displayTimeZone: parseTimeZone(process.env.DISPLAY_TIMEZONE),
  submissionCooldownSeconds: parseCooldownSeconds(process.env.SUBMISSION_COOLDOWN_SECONDS)
};
