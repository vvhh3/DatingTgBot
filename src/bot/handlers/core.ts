import type { Context, Telegraf } from "telegraf";
import { config } from "../../config/index.js";
import { isAdmin } from "../utils.js";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

export function registerCoreHandlers(bot: Telegraf<Context>): void {
  bot.command("test_error", async (ctx) => {
    if (isAdmin(ctx.from?.id)) {
      throw new Error("💥 Это тестовая ошибка для проверки отправки в чат модераторов");
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

    const safeUpdateType = escapeHtml(updateType ?? "неизвестно");
    const safeChatType = escapeHtml(chatType ?? "?");
    const safeUserLabel = escapeHtml(username ? `@${username}` : firstName ?? "неизвестно");
    const safePayload = payload ? escapeHtml(truncate(payload, 800)) : "";
    const safeMessage = escapeHtml(truncate(error.message, 1000));
    const safeStack = escapeHtml(truncate(stack, 2500));

    const text = [
      "❌ <b>ОШИБКА БОТА</b>",
      "",
      `Тип апдейта: <code>${safeUpdateType}</code>`,
      `Чат: <code>${chatId ?? "?"}</code> (${safeChatType})`,
      `Пользователь: <code>${fromId ?? "?"}</code> (${safeUserLabel})`,
      safePayload ? `Данные: <code>${safePayload}</code>` : "",
      "",
      `Сообщение: ${safeMessage}`,
      "",
      `<pre>${safeStack}</pre>`
    ].filter(Boolean).join("\n");

    try {
      await bot.telegram.sendMessage(config.moderationChatId, text, { parse_mode: "HTML" });
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
