import type { Context, Telegraf } from "telegraf";
import { config } from "../../config/index.js";
import { isAdmin } from "../utils.js";

export function registerCoreHandlers(bot: Telegraf<Context>): void {
  bot.command("test_error", async (ctx) => {
    if (isAdmin(ctx.from?.id)) {
      throw new Error("💥 Это тестовая ошибка для проверки отправки в чат модеров");
    } else {
      await ctx.reply("Команда доступна только админам");
    }
  });

  bot.catch(async (err, ctx) => {
    console.error("Bot error:", err);

    const error = err instanceof Error ? err : new Error(String(err));
    const stack = error.stack || error.message || String(error);
    const updateType = ctx?.updateType;
    const chatId = ctx?.chat?.id;
    const chatType = ctx?.chat?.type;
    const fromId = ctx?.from?.id;
    const username = ctx?.from?.username;
    const firstName = ctx?.from?.first_name;

    let payload = "";
    if ("message" in (ctx?.update ?? {})) {
      const message = (ctx as Context & { message?: { text?: string; caption?: string } }).message;
      if (message?.text) {
        payload = message.text;
      } else if (message?.caption) {
        payload = message.caption;
      }
    } else if ("callback_query" in (ctx?.update ?? {})) {
      const callbackQuery = (ctx as Context & {
        update: { callback_query?: { data?: string } };
      }).update.callback_query;
      payload = callbackQuery?.data || "";
    }

    const humanInfoLines = [
      "❌ *ОШИБКА БОТА*",
      "",
      `Тип апдейта: ${updateType ?? "неизвестно"}`,
      `Чат: ${chatId ?? "?"} (${chatType ?? "?"})`,
      `Пользователь: ${fromId ?? "?"} (${username ? "@" + username : firstName ?? "неизвестно"})`,
      payload ? `Данные: ${payload}` : "",
      "",
      `Сообщение: ${error.message}`,
      "",
      "Stack:"
    ].filter(Boolean);

    const text = humanInfoLines.join("\n") + `\n\`\`\`\n${stack}\n\`\`\``;

    try {
      await bot.telegram.sendMessage(config.moderationChatId, text, { parse_mode: "Markdown" });
    } catch (sendErr) {
      console.error("Failed to send error to moderation chat:", sendErr);
    }

    if (ctx) {
      try {
        await ctx.reply("Произошла ошибка при обработке сообщения. Попробуй ещё раз.");
      } catch {}
    }
  });

  bot.use((ctx, next) => {
    console.log("UPDATE RECEIVED:", JSON.stringify(ctx.update, null, 2));
    return next();
  });
}
