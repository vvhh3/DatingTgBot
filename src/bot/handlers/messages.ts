import type { Context, Telegraf } from "telegraf";
import { moderateText } from "../../moderation/filter.js";
import {
  createSubmission,
  getSubmission,
  updateModerationStatus,
  updateSubmission
} from "../../storage/index.js";
import {
  getCooldownRemainingSeconds,
  lastSubmissionAt,
  pendingMediaDrafts,
  pendingRejectionNotes
} from "../state.js";
import { sendToModeration, updateModerationMessage } from "../services/moderation.js";
import { extractSubmissionContent, isAdmin, isModerationChat } from "../utils.js";

export function registerMessageHandlers(bot: Telegraf<Context>): void {
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
          await updateModerationMessage(bot, updatedSubmission);
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
}
