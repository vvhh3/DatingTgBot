import type { Context, Telegraf } from "telegraf";
import { config } from "../../config/index.js";
import { createMorningMotivation } from "./ai.js";

const MORNING_HOUR = 10;
const MORNING_MINUTE = 0;
const CHECK_INTERVAL_MS = 60_000;

function getLocalDateTimeParts(date: Date, timeZone: string): {
  dateKey: string;
  hour: number;
  minute: number;
} {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return {
    dateKey: `${values.year}-${values.month}-${values.day}`,
    hour: Number(values.hour),
    minute: Number(values.minute)
  };
}

async function sendMorningMotivation(bot: Telegraf<Context>): Promise<void> {
  try {
    const message = await createMorningMotivation();
    await bot.telegram.sendMessage(config.moderationChatId, message);
  } catch (error) {
    console.error("Failed to send morning AI motivation.", error);
  }
}

export function scheduleMorningMotivation(bot: Telegraf<Context>): void {
  let lastSentDateKey: string | undefined;

  const tick = () => {
    const now = getLocalDateTimeParts(new Date(), config.displayTimeZone);

    if (
      now.hour === MORNING_HOUR &&
      now.minute === MORNING_MINUTE &&
      now.dateKey !== lastSentDateKey
    ) {
      lastSentDateKey = now.dateKey;
      void sendMorningMotivation(bot);
    }
  };

  tick();
  setInterval(tick, CHECK_INTERVAL_MS);
}
