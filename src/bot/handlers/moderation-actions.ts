import type { Context, Telegraf } from "telegraf";
import { getSubmission, updateModerationStatus } from "../../storage/index.js";
import { REJECT_REASONS, moderationKeyboard, rejectReasonsKeyboard } from "../keyboards.js";
import { pendingRejectionNotes } from "../state.js";
import {
  clearUserPendingMessage,
  publishSubmission,
  updateModerationMessage
} from "../services/moderation.js";
import { isAdmin, isTelegramErrorWithDescription } from "../utils.js";

export function registerModerationActionHandlers(bot: Telegraf<Context>): void {
  bot.action(/^cancel_submission:(.+)$/, async (ctx) => {
    const submissionId = ctx.match[1];
    const submission = await getSubmission(submissionId);

    if (!submission) {
      await ctx.answerCbQuery("Заявка не найдена", { show_alert: true });

      try {
        await ctx.editMessageReplyMarkup(undefined);
      } catch {}

      return;
    }

    if (submission.userId !== ctx.from.id) {
      await ctx.answerCbQuery("Отменить можно только свою заявку", { show_alert: true });
      return;
    }

    if (submission.status !== "pending") {
      await ctx.answerCbQuery("Заявка уже обработана");

      try {
        await ctx.editMessageReplyMarkup(undefined);
      } catch {}

      return;
    }

    const updatedSubmission = await updateModerationStatus(submission.id, "cancelled", {
      rejectionReason: "Отменено автором до решения модератора",
      moderatedByUserId: submission.userId,
      moderatedByUsername: submission.username,
      moderatedByFirstName: submission.firstName,
      moderatedAt: new Date().toISOString()
    });

    if (updatedSubmission) {
      await updateModerationMessage(bot, updatedSubmission);
      await clearUserPendingMessage(bot, updatedSubmission);
    }

    await ctx.answerCbQuery("Заявка отменена");
    await ctx.editMessageText(
      "Заявка отменена. Модераторы больше не смогут её одобрить или отклонить."
    );
  });

  bot.action(/^reject:(.+)$/, async (ctx) => {
    const adminId = ctx.from?.id;
    const submissionId = ctx.match[1];

    if (!isAdmin(adminId)) {
      await ctx.answerCbQuery("Недостаточно прав", { show_alert: true });
      return;
    }

    const submission = await getSubmission(submissionId);
    if (!submission) {
      await ctx.answerCbQuery("Заявка не найдена", { show_alert: true });
      return;
    }

    if (submission.status !== "pending") {
      await ctx.answerCbQuery("Заявка уже обработана");
      return;
    }

    await ctx.editMessageReplyMarkup(rejectReasonsKeyboard(submissionId).reply_markup);
  });

  bot.action(/reject_reason:(.+):(.+)/, async (ctx) => {
    const reasonKey = ctx.match[1];
    const submissionId = ctx.match[2];
    const submission = await getSubmission(submissionId);

    if (!submission) {
      return;
    }

    if (submission.status !== "pending") {
      await ctx.answerCbQuery("Заявка уже обработана");
      return;
    }

    const reason = REJECT_REASONS.find((item) => item.key === reasonKey);
    const textReason = reason?.label || "Отклонено модератором";

    const updatedSubmission = await updateModerationStatus(submissionId, "rejected", {
      rejectionReason: textReason,
      moderatedByUserId: ctx.from.id,
      moderatedByUsername: ctx.from.username,
      moderatedByFirstName: ctx.from.first_name,
      moderatedAt: new Date().toISOString()
    });

    if (updatedSubmission) {
      await updateModerationMessage(bot, updatedSubmission);
      await clearUserPendingMessage(bot, updatedSubmission);
    }

    try {
      await ctx.telegram.sendMessage(
        submission.userId,
        `Твоё анонимное сообщение отклонено.\nПричина: ${textReason}`
      );
    } catch (error) {
      console.warn("Не удалось отправить уведомление пользователю после отклонения:", error);
    }
  });

  bot.action(/back:(.+)/, async (ctx) => {
    const submissionId = ctx.match[1];

    const submission = await getSubmission(submissionId);
    if (!submission || submission.status !== "pending") {
      await ctx.answerCbQuery("Заявка уже обработана");
      return;
    }

    await ctx.editMessageReplyMarkup(moderationKeyboard(submissionId).reply_markup);
  });

  bot.action(/^reject_now:(.+)$/, async (ctx) => {
    const adminId = ctx.from?.id;
    const submissionId = ctx.match[1];

    if (!isAdmin(adminId)) {
      await ctx.answerCbQuery("Недостаточно прав", { show_alert: true });
      return;
    }

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
      await updateModerationMessage(bot, updatedSubmission);
      await clearUserPendingMessage(bot, updatedSubmission);
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

    let published: Awaited<ReturnType<typeof publishSubmission>>;
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
      await updateModerationMessage(bot, updatedSubmission);
      await clearUserPendingMessage(bot, updatedSubmission);
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
}
