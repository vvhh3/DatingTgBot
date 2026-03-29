import type { Context, Telegraf } from "telegraf";
import { config } from "../../config/index.js";
import type { SubmissionRecord } from "../../shared/types.js";
import { moderationKeyboard } from "../keyboards.js";
import { isMessageNotModifiedError } from "../utils.js";

function formatPerson(username?: string, firstName?: string, id?: number): string {
  // Для модератора полезнее всего username, а если его нет — кликабельная ссылка по id.
  if (username) {
    return `@${username}`;
  }

  if (id) {
    return `[${firstName || "Пользователь"}](tg://user?id=${id})`;
  }

  return firstName || "Неизвестно";
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
  // Единый формат карточки модерации для отправки и последующего обновления.
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

export async function sendToModeration(ctx: Context, submission: SubmissionRecord) {
  const keyboard = moderationKeyboard(submission.id);

  // Сохраняем исходный тип контента, чтобы модератор видел заявку в привычном виде.
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

export async function publishSubmission(ctx: Context, submission: SubmissionRecord) {
  // В целевой чат переносим тот же формат, который прислал пользователь.
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

export async function updateModerationMessage(
  bot: Telegraf<Context>,
  submission: SubmissionRecord
): Promise<void> {
  if (!submission.moderationMessageId) {
    return;
  }

  // У текстовых и медиа-сообщений в Telegram разные методы редактирования.
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
    // После решения кнопки больше не нужны.
    await bot.telegram.editMessageReplyMarkup(
      config.moderationChatId,
      submission.moderationMessageId,
      undefined,
      undefined
    );
  } catch (error) {
    // Если разметка уже очищена, Telegram сообщает об этом как об ошибке, но для нас это штатная ситуация.
    if (!isMessageNotModifiedError(error)) {
      throw error;
    }
  }
}
