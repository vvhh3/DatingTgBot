import { Input } from "telegraf";
import type { Context, Telegraf } from "telegraf";
import { config } from "../../config/index.js";
import { getSubmissionStats } from "../../storage/index.js";
import { botCommands, infoMessage, rulesMessage, welcomeCaption, welcomeDetails } from "../messages.js";
import { pendingMediaDrafts } from "../state.js";
import { isAdmin, isModerationChat } from "../utils.js";

export function registerCommandHandlers(bot: Telegraf<Context>): void {
  bot.telegram.setMyCommands(botCommands);

  bot.command("rules", async (ctx) => {
    await ctx.reply(rulesMessage);
  });

  bot.command("info", async (ctx) => {
    await ctx.reply(infoMessage);
  });

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
}
