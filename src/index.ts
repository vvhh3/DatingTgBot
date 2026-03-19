import { Telegraf, Markup } from "telegraf";
import type { Context } from "telegraf";
import { config } from "./config.js";
import { moderateText } from "./filter.js";
import {
  createSubmission,
  getSubmission,
  updateModerationStatus,
  updateSubmission
} from "./storage.js";

const bot = new Telegraf(config.botToken);

function isTelegramErrorWithDescription(error: unknown, descriptionPart: string): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const maybeResponse = (error as { response?: { description?: unknown } }).response;
  return typeof maybeResponse?.description === "string" && maybeResponse.description.includes(descriptionPart);
}

function isAdmin(userId: number | undefined): boolean {
  if (!userId) {
    return false;
  }

  if (config.adminUserIds.size === 0) {
    return true;
  }

  return config.adminUserIds.has(userId);
}

function getMessageText(ctx: Context): string | undefined {
  if (!("message" in ctx.update) || !ctx.message) {
    return undefined;
  }

  if ("text" in ctx.message && typeof ctx.message.text === "string") {
    return ctx.message.text;
  }

  if ("caption" in ctx.message && typeof ctx.message.caption === "string") {
    return ctx.message.caption;
  }

  return undefined;
}

function buildModerationCaption(submissionId: string, text: string): string {
  return [
    "Новая анонимная заявка",
    "",
    `ID: ${submissionId}`,
    "",
    text
  ].join("\n");
}

function moderationKeyboard(submissionId: string) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("Опубликовать", `approve:${submissionId}`),
      Markup.button.callback("Отклонить", `reject:${submissionId}`)
    ]
  ]);
}

bot.start(async (ctx) => {
  await ctx.reply(
    [
      "Присылай сообщение сюда, и я отправлю его анонимно в предложку после проверки.",
      "Запрещены: 18+, оскорбления, экстремизм, ссылки и контакты.",
      "Сейчас поддерживается обычный текст или подпись к медиа.",
      "Команда /chatid покажет ID текущего чата и твой user ID."
    ].join("\n")
  );
});

bot.command("chatid", async (ctx) => {
  const chatTitle =
    "title" in ctx.chat && typeof ctx.chat.title === "string"
      ? ctx.chat.title
      : "Личный чат";
  const userId = ctx.from?.id ?? "недоступен";

  await ctx.reply(
    [
      `Chat ID: ${ctx.chat.id}`,
      `Chat type: ${ctx.chat.type}`,
      `Chat title: ${chatTitle}`,
      `Your user ID: ${userId}`
    ].join("\n")
  );
});

bot.on("message", async (ctx) => {
  if (ctx.chat.type !== "private") {
    return;
  }

  const text = getMessageText(ctx);

  if (!text) {
    await ctx.reply("Пока что я принимаю только текстовые сообщения или подписи к медиа.");
    return;
  }

  const result = moderateText(text);

  if (!result.allowed) {
    await ctx.reply(
      [
        "Сообщение не прошло автоматическую проверку.",
        `Причины: ${result.reasons.join(", ")}`
      ].join("\n")
    );
    return;
  }

  const record = await createSubmission({
    userId: ctx.from.id,
    username: ctx.from.username,
    firstName: ctx.from.first_name,
    text
  });

  const moderationMessage = await ctx.telegram.sendMessage(
    config.moderationChatId,
    buildModerationCaption(record.id, record.text),
    moderationKeyboard(record.id)
  );

  await updateSubmission(record.id, {
    moderationMessageId: moderationMessage.message_id
  });

  await ctx.reply("Сообщение принято и отправлено на модерацию анонимно.");
});

bot.action(/^approve:(.+)$/, async (ctx) => {
  const adminId = ctx.from?.id;

  if (!isAdmin(adminId)) {
    await ctx.answerCbQuery("Недостаточно прав", { show_alert: true });
    return;
  }

  const submissionId = ctx.match[1];
  const submission = await getSubmission(submissionId);

  if (!submission) {
    await ctx.answerCbQuery("Заявка не найдена", { show_alert: true });
    return;
  }

  if (submission.status !== "pending") {
    await ctx.answerCbQuery("Заявка уже обработана");
    return;
  }

  await ctx.answerCbQuery("Публикую...");

  let published;

  try {
    published = await ctx.telegram.sendMessage(config.targetChatId, submission.text);
  } catch (error) {
    if (isTelegramErrorWithDescription(error, "chat not found")) {
      await ctx.reply(
        [
          "Не удалось опубликовать сообщение.",
          "Проверь TARGET_CHAT_ID и убедись, что бот добавлен в целевой чат.",
          "Если это канал, выдай боту права администратора."
        ].join("\n")
      );
      return;
    }

    throw error;
  }

  await updateModerationStatus(submission.id, "approved", {
    publishedMessageId: published.message_id
  });

  if (ctx.callbackQuery.message) {
    await ctx.editMessageText(
      [
        "Заявка опубликована",
        "",
        `ID: ${submission.id}`,
        "",
        submission.text
      ].join("\n")
    );
  }

  await ctx.telegram.sendMessage(
    submission.userId,
    "Твоё анонимное сообщение прошло модерацию и было опубликовано."
  );
});

bot.action(/^reject:(.+)$/, async (ctx) => {
  const adminId = ctx.from?.id;

  if (!isAdmin(adminId)) {
    await ctx.answerCbQuery("Недостаточно прав", { show_alert: true });
    return;
  }

  const submissionId = ctx.match[1];
  const submission = await getSubmission(submissionId);

  if (!submission) {
    await ctx.answerCbQuery("Заявка не найдена", { show_alert: true });
    return;
  }

  if (submission.status !== "pending") {
    await ctx.answerCbQuery("Заявка уже обработана");
    return;
  }

  await ctx.answerCbQuery("Отклоняю...");

  await updateModerationStatus(submission.id, "rejected", {
    rejectionReason: "Отклонено модератором"
  });

  if (ctx.callbackQuery.message) {
    await ctx.editMessageText(
      [
        "Заявка отклонена",
        "",
        `ID: ${submission.id}`,
        "",
        submission.text
      ].join("\n")
    );
  }

  await ctx.telegram.sendMessage(
    submission.userId,
    "Твоё анонимное сообщение не прошло финальную модерацию."
  );
});

bot.catch(async (error, ctx) => {
  console.error("Bot error", error);

  try {
    await ctx.reply("Произошла ошибка при обработке сообщения. Попробуй ещё раз.");
  } catch {
    // ignore secondary errors
  }
});

bot.launch();

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
