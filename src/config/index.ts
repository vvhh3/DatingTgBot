import dotenv from "dotenv";

dotenv.config();

function requireEnv(name: string): string {
  // Обязательные переменные валидируем сразу при старте,
  // чтобы не получать трудноуловимые runtime-ошибки позже.
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
  // Telegram chat id должен быть целым числом.
  const raw = requireEnv(name);
  const parsed = Number(raw);

  if (!Number.isInteger(parsed)) {
    throw new Error(`Env var ${name} must be an integer`);
  }

  return parsed;
}

function parseOptionalChatId(name: string): number | undefined {
  const raw = optionalEnv(name);

  if (!raw) {
    return undefined;
  }

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

  // Ожидаем csv-строку вида "123,456,789".
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
  return value || "Europe/Astrakhan";
}

function parseCooldownSeconds(raw: string | undefined): number {
  const value = raw?.trim();

  if (!value) {
    // Значение по умолчанию достаточно маленькое, чтобы не мешать обычному использованию,
    // но уже защищает от спама и случайных дублей.
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

const targetChatId = parseChatId("TARGET_CHAT_ID");

export const config = {
  // После парсинга остальной код работает только с нормализованным конфигом.
  botToken: requireEnv("BOT_TOKEN"),
  databaseUrl: optionalEnv("DATABASE_URL"),
  databaseSsl: parseBoolean(process.env.DATABASE_SSL, false),
  sqlitePath: optionalEnv("SQLITE_PATH") || "data/submissions.db",
  startAnimation: optionalEnv("START_ANIMATION"),
  startPhoto: optionalEnv("START_PHOTO"),
  startPhotoPath: optionalEnv("START_PHOTO_PATH"),
  startVideo: optionalEnv("START_VIDEO"),
  moderationChatId: parseChatId("MODERATION_CHAT_ID"),
  targetChatId,
  contestChannelId: parseOptionalChatId("CONTEST_CHANNEL_ID") ?? targetChatId,
  contestChannelUrl: optionalEnv("CONTEST_CHANNEL_URL"),
  adminUserIds: parseAdminIds(process.env.ADMIN_USER_IDS),
  displayTimeZone: parseTimeZone(process.env.DISPLAY_TIMEZONE),
  submissionCooldownSeconds: parseCooldownSeconds(process.env.SUBMISSION_COOLDOWN_SECONDS)
};
