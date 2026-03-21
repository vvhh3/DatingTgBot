import { Telegraf, Markup, Input } from "telegraf";
import type { Context } from "telegraf";
import { config } from "./config.js";
import { moderateText } from "./filter.js";
import {
  createSubmission,
  getSubmission,
  getSubmissionStats,
  updateModerationStatus,
  updateSubmission
} from "./storage.js";
import type { SubmissionRecord } from "./types.js";

const bot = new Telegraf(config.botToken);
const submissionCooldownMs = config.submissionCooldownSeconds * 1000;

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

  // собираем контекст
  const updateType = ctx?.updateType;
  const chatId = ctx?.chat?.id;
  const chatType = ctx?.chat?.type;
  const fromId = ctx?.from?.id;
  const username = ctx?.from?.username;
  const firstName = ctx?.from?.first_name;

  let payload = "";
  if ("message" in (ctx?.update ?? {})) {
    const msg: any = (ctx as any).message;
    if (msg.text) payload = msg.text;
    else if (msg.caption) payload = msg.caption;
  } else if ("callback_query" in (ctx?.update ?? {})) {
    const cq: any = (ctx as any).update.callback_query;
    payload = cq.data || "";
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

  // отправляем модераторам
  try {
    await bot.telegram.sendMessage(
      config.moderationChatId,
      text,
      { parse_mode: "Markdown" }
    );
  } catch (sendErr) {
    console.error("Failed to send error to moderation chat:", sendErr);
  }

  // отвечаем пользователю
  if (ctx) {
    try {
      await ctx.reply("Произошла ошибка при обработке сообщения. Попробуй ещё раз.");
    } catch {}
  }
});


const welcomeCaption = [
  "💫 Добро пожаловать!",
  "",
  "Ищешь того самого незнакомца? 🤔",
  "Встретил(а) кого-то, но не решился(ась) подойти? 🥲",
  "Я помогу найти ⬇️⬇️"
].join("\n");
const welcomeDetails = [
  "━━━━━━━━━━━━━━━",
  "",
  "Оставь здесь:",
  "1️⃣ Где?",
  "2️⃣ Когда?",
  "3️⃣ Как выглядел человек?",
  "",
  "📸 Можно прикреплять фото или видео — так шансы найти человека значительно выше!",
  "",
  "Кто знает, может, ваша история начнётся прямо здесь… 😍🥰",
  "",
  "━━━━━━━━━━━━━━━",
  "",
  "📩 Как опубликовать пост:",
  "Напишите мне — укажите текст, при необходимости прикрепите фото/видео.",
  "Я отправлю ваш пост на модерацию, и после проверки он появится в канале.",
  "",
  "━━━━━━━━━━━━━━━",
  "",
  "📜 ПРАВИЛА (обязательно к прочтению):",
  "",
  "🚫 СТРОГО ЗАПРЕЩЕНО:",
  "",
  "❌ Оскорбления и флейм",
  "❌ Политика и провокации",
  "❌ Спам и реклама без согласования с администрацией",
  "❌ Флуд (бессмысленные сообщения, спам символами)",
  "❌ Контент 18+ (взрослый и шок-контент)",
  "❌ Публикации, связанные с продажей или покупкой товаров",
  "",
  "⚠️ Нарушение правил ведёт к предупреждению или бану без предупреждения",
].join("\n");

const lastSubmissionAt = new Map<number, number>();
const pendingMediaDrafts = new Map<
  number,
  {
    contentType: "photo" | "video";
    photoFileId?: string;
    videoFileId?: string;
    createdAt: number;
  }
>();
const pendingRejectionNotes = new Map<
  number,
  {
    submissionId: string;
    promptMessageId: number;
  }
>();

type ExtractedSubmissionContent =
  | {
    contentType: "text";
    text: string;
  }
  | {
    contentType: "photo";
    text: string;
    photoFileId: string;
  }
  | {
    contentType: "video";
    text: string;
    videoFileId: string;
  };

function isTelegramErrorWithDescription(error: unknown, descriptionPart: string): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const maybeResponse = (error as { response?: { description?: unknown } }).response;
  return typeof maybeResponse?.description === "string" && maybeResponse.description.includes(descriptionPart);
}

function isMessageNotModifiedError(error: unknown): boolean {
  return isTelegramErrorWithDescription(error, "message is not modified");
}
bot.use((ctx, next) => {
  console.log("UPDATE RECEIVED:", JSON.stringify(ctx.update, null, 2));
  return next();
});

console.log("BOT STARTED");
function isAdmin(userId: number | undefined): boolean {
  if (!userId) {
    return false;
  }

  if (config.adminUserIds.size === 0) {
    return true;
  }

  return config.adminUserIds.has(userId);
}

function isModerationChat(chatId: number): boolean {
  return chatId === config.moderationChatId;
}

function getCooldownRemainingSeconds(userId: number): number {
  const lastSentAt = lastSubmissionAt.get(userId);

  if (!lastSentAt || submissionCooldownMs <= 0) {
    return 0;
  }

  const remainingMs = lastSentAt + submissionCooldownMs - Date.now();

  if (remainingMs <= 0) {
    return 0;
  }

  return Math.ceil(remainingMs / 1000);
}

function extractSubmissionContent(ctx: Context): ExtractedSubmissionContent | undefined {
  if (!("message" in ctx.update) || !ctx.message) {
    return undefined;
  }

  if ("photo" in ctx.message && Array.isArray(ctx.message.photo) && ctx.message.photo.length > 0) {
    const largestPhoto = ctx.message.photo[ctx.message.photo.length - 1];
    const caption = typeof ctx.message.caption === "string" ? ctx.message.caption.trim() : "";

    return {
      contentType: "photo",
      text: caption,
      photoFileId: largestPhoto.file_id
    };
  }

  if ("video" in ctx.message && ctx.message.video) {
    const caption = typeof ctx.message.caption === "string" ? ctx.message.caption.trim() : "";

    return {
      contentType: "video",
      text: caption,
      videoFileId: ctx.message.video.file_id
    };
  }

  if ("text" in ctx.message && typeof ctx.message.text === "string") {
    return {
      contentType: "text",
      text: ctx.message.text
    };
  }

  return undefined;
}

function formatPerson(username: string | undefined, firstName: string | undefined): string {
  if (username) {
    return `@${username}`;
  }

  if (firstName) {
    return firstName;
  }

  return "не указано";
}

function formatDecision(status: SubmissionRecord["status"]): string {
  switch (status) {
    case "approved":
      return "Одобрено";
    case "rejected":
      return "Отклонено";
    default:
      return "На модерации";
  }
}

function formatDateTime(value: string | undefined): string {
  if (!value) {
    return "не указано";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: config.displayTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).format(date);
}

function formatModerator(submission: SubmissionRecord): string {
  if (!submission.moderatedByUserId && !submission.moderatedByUsername && !submission.moderatedByFirstName) {
    return "ещё не назначен";
  }

  return formatPerson(submission.moderatedByUsername, submission.moderatedByFirstName);
}

function formatContentType(submission: SubmissionRecord): string {
  switch (submission.contentType) {
    case "photo":
      return "Фото";
    case "video":
      return "Видео";
    default:
      return "Текст";
  }
}

function buildModerationCaption(submission: SubmissionRecord): string {
  return [
    "Новая анонимная заявка",
    "",
    `ID: ${submission.id}`,
    `Тип заявки: ${formatContentType(submission)}`,
    `Отправитель: ${formatPerson(submission.username, submission.firstName)}`,
    `Статус: ${formatDecision(submission.status)}`,
    `Решение принял: ${formatModerator(submission)}`,
    submission.moderatedAt ? `Время решения: ${formatDateTime(submission.moderatedAt)}` : "",
    submission.rejectionReason ? `Причина отклонения: ${submission.rejectionReason}` : "",
    "",
    `Текст сообщения: ${submission.text}`
  ].filter(Boolean).join("\n");
}

function moderationKeyboard(submissionId: string) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("Опубликовать", `approve:${submissionId}`),
      Markup.button.callback("Отклонить", `reject:${submissionId}`)
    ],
    [
      Markup.button.callback("Отклонить с комментарием", `reject_note:${submissionId}`)
    ]
  ]);
}

async function sendToModeration(ctx: Context, submission: SubmissionRecord) {
  const keyboard = moderationKeyboard(submission.id);

  if (submission.contentType === "photo" && submission.photoFileId) {
    return ctx.telegram.sendPhoto(config.moderationChatId, submission.photoFileId, {
      caption: buildModerationCaption(submission),
      ...keyboard
    });
  }

  if (submission.contentType === "video" && submission.videoFileId) {
    return ctx.telegram.sendVideo(config.moderationChatId, submission.videoFileId, {
      caption: buildModerationCaption(submission),
      ...keyboard
    });
  }

  return ctx.telegram.sendMessage(
    config.moderationChatId,
    buildModerationCaption(submission),
    keyboard
  );
}

async function publishSubmission(ctx: Context, submission: SubmissionRecord) {
  if (submission.contentType === "photo" && submission.photoFileId) {
    return ctx.telegram.sendPhoto(config.targetChatId, submission.photoFileId, {
      caption: submission.text || undefined
    });
  }

  if (submission.contentType === "video" && submission.videoFileId) {
    return ctx.telegram.sendVideo(config.targetChatId, submission.videoFileId, {
      caption: submission.text || undefined
    });
  }

  return ctx.telegram.sendMessage(config.targetChatId, submission.text);
}

async function updateModerationMessage(submission: SubmissionRecord): Promise<void> {
  if (!submission.moderationMessageId) {
    return;
  }

  if (submission.contentType === "photo" || submission.contentType === "video") {
    await bot.telegram.editMessageCaption(
      config.moderationChatId,
      submission.moderationMessageId,
      undefined,
      buildModerationCaption(submission)
    );
  } else {
    await bot.telegram.editMessageText(
      config.moderationChatId,
      submission.moderationMessageId,
      undefined,
      buildModerationCaption(submission)
    );
  }

  try {
    await bot.telegram.editMessageReplyMarkup(
      config.moderationChatId,
      submission.moderationMessageId,
      undefined,
      undefined
    );
  } catch (error) {
    if (!isMessageNotModifiedError(error)) {
      throw error;
    }
  }
}

bot.start(async (ctx) => {
  if (config.startAnimation) {
    try {
      await ctx.replyWithAnimation(config.startAnimation, {
        caption: welcomeCaption
      });
      await ctx.reply(welcomeDetails);
      return;
    } catch (error) {
      console.warn("Failed to send start animation, falling back to other welcome message options.", error);
    }
  }

  if (config.startPhotoPath) {
    try {
      await ctx.replyWithPhoto(Input.fromLocalFile(config.startPhotoPath), {
        caption: welcomeCaption
      });
      await ctx.reply(welcomeDetails);
      return;
    } catch (error) {
      console.warn("Failed to send start photo from local file, falling back to other welcome message options.", error);
    }
  }

  if (config.startVideo) {
    try {
      await ctx.replyWithVideo(config.startVideo, {
        caption: welcomeCaption
      });
      await ctx.reply(welcomeDetails);
      return;
    } catch (error) {
      console.warn("Failed to send start video, falling back to other welcome message options.", error);
    }
  }

  if (config.startPhoto) {
    try {
      await ctx.replyWithPhoto(config.startPhoto, {
        caption: welcomeCaption
      });
      await ctx.reply(welcomeDetails);
      return;
    } catch (error) {
      console.warn("Failed to send start photo, falling back to text-only welcome message.", error);
    }
  }

  await ctx.reply([welcomeCaption, welcomeDetails].join("\n\n"));
});

bot.command("cancel", async (ctx) => {
  if (!ctx.from) {
    return;
  }

  if (pendingMediaDrafts.delete(ctx.from.id)) {
    await ctx.reply("Черновик медиа удалён.");
    return;
  }

  await ctx.reply("Сохранённого черновика медиа сейчас нет.");
});

bot.command("stats", async (ctx) => {
  if (!isAdmin(ctx.from?.id)) {
    await ctx.reply("Недостаточно прав.");
    return;
  }

  if (!isModerationChat(ctx.chat.id)) {
    await ctx.reply("Эту команду можно использовать только в чате модерации.");
    return;
  }

  const stats = await getSubmissionStats();

  await ctx.reply(
    [
      "📊 Статистика заявок",
      "",
      `Всего: ${stats.total}`,
      `На модерации: ${stats.pending}`,
      `Одобрено: ${stats.approved}`,
      `Отклонено: ${stats.rejected}`,
      "",
      `Текст: ${stats.textCount}`,
      `Фото: ${stats.photoCount}`,
      `Видео: ${stats.videoCount}`
    ].join("\n")
  );
});

bot.on("message", async (ctx) => {
  if (
    ctx.chat.type !== "private" &&
    isModerationChat(ctx.chat.id) &&
    "text" in ctx.message &&
    typeof ctx.message.text === "string"
  ) {
    const pendingRejection = pendingRejectionNotes.get(ctx.from.id);

    if (
      pendingRejection &&
      ctx.message.reply_to_message &&
      ctx.message.reply_to_message.message_id === pendingRejection.promptMessageId
    ) {
      if (!isAdmin(ctx.from?.id)) {
        pendingRejectionNotes.delete(ctx.from.id);
        await ctx.reply("Недостаточно прав.");
        return;
      }

      const moderatorComment = ctx.message.text.trim();

      if (!moderatorComment) {
        await ctx.reply("Напиши комментарий текстом в ответ на сообщение бота.");
        return;
      }

      const submission = await getSubmission(pendingRejection.submissionId);

      if (!submission) {
        pendingRejectionNotes.delete(ctx.from.id);
        await ctx.reply("Заявка не найдена.");
        return;
      }

      if (submission.status !== "pending") {
        pendingRejectionNotes.delete(ctx.from.id);
        await ctx.reply("Заявка уже обработана.");
        return;
      }

      const updatedSubmission = await updateModerationStatus(submission.id, "rejected", {
        rejectionReason: moderatorComment,
        moderatedByUserId: ctx.from.id,
        moderatedByUsername: ctx.from.username,
        moderatedByFirstName: ctx.from.first_name,
        moderatedAt: new Date().toISOString()
      });

      pendingRejectionNotes.delete(ctx.from.id);

      if (updatedSubmission) {
        await updateModerationMessage(updatedSubmission);
      }
      console.log("489 USER ID:", submission.userId);
      try {
        console.log("491 USER ID:", submission.userId);
        await ctx.telegram.sendMessage(
          submission.userId,
          [
            "Твоё анонимное сообщение не прошло модерацию.",
            "",
            `Комментарий модератора: ${moderatorComment}`
          ].join("\n")
        );
      } catch (error) {
        console.log("501 USER ID:", submission.userId);
        console.warn("Не удалось отправить комментарий модератора пользователю:", error);
      }

      await ctx.reply("Заявка отклонена, комментарий отправлен автору.");
      return;
    }
  }

  if (ctx.chat.type !== "private") {
    return;
  }

  const content = extractSubmissionContent(ctx);

  if (!content) {
    await ctx.reply("Пока что я принимаю только обычный текст, фото или видео с подписью.");
    return;
  }

  if ((content.contentType === "photo" || content.contentType === "video") && !content.text) {
    pendingMediaDrafts.set(ctx.from.id, {
      contentType: content.contentType,
      photoFileId: content.contentType === "photo" ? content.photoFileId : undefined,
      videoFileId: content.contentType === "video" ? content.videoFileId : undefined,
      createdAt: Date.now()
    });
    await ctx.reply("Медиа сохранено. Теперь отправь следующим сообщением текст для этой заявки.");
    return;
  }

  const pendingMediaDraft = pendingMediaDrafts.get(ctx.from.id);
  const isCompletingPendingDraft = content.contentType === "text" && Boolean(pendingMediaDraft);

  if (!isCompletingPendingDraft) {
    const remainingSeconds = getCooldownRemainingSeconds(ctx.from.id);

    if (remainingSeconds > 0) {
      await ctx.reply(`Подожди ${remainingSeconds} сек. перед следующей заявкой.`);
      return;
    }
  }

  const submissionContent =
    content.contentType === "text" && pendingMediaDraft
      ? pendingMediaDraft.contentType === "photo"
        ? {
          contentType: "photo" as const,
          text: content.text,
          photoFileId: pendingMediaDraft.photoFileId as string
        }
        : {
          contentType: "video" as const,
          text: content.text,
          videoFileId: pendingMediaDraft.videoFileId as string
        }
      : content;

  const result = moderateText(submissionContent.text);

  if (!result.allowed) {
    if (result.reasons.includes("too_long")) {
      await ctx.reply("Сообщение слишком длинное. Сократи текст и попробуй ещё раз.");
      return;
    }

    await ctx.reply("В твоём сообщении присутствуют запрещённые слова, выражения или ссылки. Измени текст и отправь ещё раз.");
    return;
  }

  const record = await createSubmission({
    userId: ctx.from.id,
    username: ctx.from.username,
    firstName: ctx.from.first_name,
    text: submissionContent.text,
    contentType: submissionContent.contentType,
    photoFileId: submissionContent.contentType === "photo" ? submissionContent.photoFileId : undefined,
    videoFileId: submissionContent.contentType === "video" ? submissionContent.videoFileId : undefined
  });

  const moderationMessage = await sendToModeration(ctx, record);

  await updateSubmission(record.id, {
    moderationMessageId: moderationMessage.message_id
  });

  lastSubmissionAt.set(ctx.from.id, Date.now());
  pendingMediaDrafts.delete(ctx.from.id);

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
  const moderatedAt = new Date().toISOString();

  try {
    published = await publishSubmission(ctx, submission);
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

  const updatedSubmission = await updateModerationStatus(submission.id, "approved", {
    publishedMessageId: published.message_id,
    moderatedByUserId: ctx.from.id,
    moderatedByUsername: ctx.from.username,
    moderatedByFirstName: ctx.from.first_name,
    moderatedAt
  });

  if (updatedSubmission) {
    await updateModerationMessage(updatedSubmission);
  }

  try {
    await ctx.telegram.sendMessage(
      submission.userId,
      "Твоё анонимное сообщение прошло модерацию и было опубликовано."
    );
  } catch (error) {
    console.warn("Не удалось отправить авто-уведомление пользователю после одобрения:", error);
  }
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

  const updatedSubmission = await updateModerationStatus(submission.id, "rejected", {
    rejectionReason: "Отклонено модератором",
    moderatedByUserId: ctx.from.id,
    moderatedByUsername: ctx.from.username,
    moderatedByFirstName: ctx.from.first_name,
    moderatedAt: new Date().toISOString()
  });

  if (updatedSubmission) {
    await updateModerationMessage(updatedSubmission);
  }

  try {
    await ctx.telegram.sendMessage(
      submission.userId,
      "Твоё анонимное сообщение не прошло финальную модерацию."
    );
  } catch (error) {
    console.warn("Не удалось отправить авто-уведомление пользователю после отклонения:", error);
  }
});

bot.action(/^reject_note:(.+)$/, async (ctx) => {
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

  const prompt = await ctx.reply(
    "Напиши комментарий для автора в ответ на это сообщение. После этого заявка будет отклонена.",
    {
      reply_markup: {
        force_reply: true,
        selective: true
      }
    }
  );

  pendingRejectionNotes.set(ctx.from.id, {
    submissionId,
    promptMessageId: prompt.message_id
  });

  await ctx.answerCbQuery("Жду комментарий модератора");
});

bot.launch();

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
