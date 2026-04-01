import { randomInt } from "node:crypto";
import { Input } from "telegraf";
import type { Context, Telegraf } from "telegraf";
import { Markup } from "telegraf";
import { config } from "../../config/index.js";
import type { ContestTicketEntry } from "../../storage/contest.js";
import {
  confirmReferral,
  createContest,
  createReferralIfFirstSeen,
  finishContest,
  getActiveContest,
  getConfirmedReferralCount,
  getContestTicketEntries,
  getReferralByInvitedUserId,
  registerContestParticipant
} from "../../storage/contest.js";
import { getSubmissionStats } from "../../storage/index.js";
import { referralSubscriptionKeyboard } from "../keyboards.js";
import { botCommands, infoMessage, rulesMessage, welcomeCaption, welcomeDetails } from "../messages.js";
import {
  buildReferralLink,
  extractStartPayload,
  formatContestUserLabel,
  isContestChannelMember,
  parseInviterUserId
} from "../services/contest.js";
import { pendingMediaDrafts } from "../state.js";
import { isAdmin, isModerationChat, isTelegramErrorWithDescription } from "../utils.js";

const CONTEST_WINNER_COUNT = 10;
const MAIN_CONTEST_START_PAYLOAD = "contest_main";
const DEFAULT_CONTEST_POST_TEXT = [
  "Розыгрыш запущен!",
  "",
  "Как участвовать:",
  "1. Нажми кнопку «Участвовать»",
  "2. Получи личную ссылку в боте",
  "3. Приглашай друзей",
  "4. За участие даётся 1 билет",
  "5. Каждый подтверждённый приглашённый даёт ещё 1 билет",
  "",
  "Победителей будет 10.",
  "Чем больше билетов, тем выше шанс на победу."
].join("\n");

type ContestStartResult = {
  message?: string;
  showSubscriptionKeyboard?: boolean;
  skipWelcome?: boolean;
};

async function sendWelcome(ctx: Context): Promise<void> {
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
}

function drawWeightedWinners(entries: ContestTicketEntry[], winnerCount: number): ContestTicketEntry[] {
  const pool = entries
    .filter((entry) => entry.tickets > 0)
    .map((entry) => ({ ...entry }));
  const winners: ContestTicketEntry[] = [];

  while (pool.length > 0 && winners.length < winnerCount) {
    const totalTickets = pool.reduce((sum, entry) => sum + entry.tickets, 0);

    if (totalTickets <= 0) {
      break;
    }

    const winningNumber = randomInt(totalTickets);
    let accumulatedTickets = 0;
    let selectedIndex = 0;

    for (let index = 0; index < pool.length; index += 1) {
      accumulatedTickets += pool[index].tickets;
      if (winningNumber < accumulatedTickets) {
        selectedIndex = index;
        break;
      }
    }

    winners.push(pool[selectedIndex]);
    pool.splice(selectedIndex, 1);
  }

  return winners;
}

async function buildContestLinkMessage(ctx: Context, contestId: string, userId: number): Promise<string> {
  const referralLink = await buildReferralLink(ctx, userId);
  const tickets = (await getConfirmedReferralCount(contestId, userId)) + 1;

  return [
    "Ты участвуешь в конкурсе.",
    "",
    "Твоя личная ссылка:",
    referralLink,
    "",
    "За участие даётся 1 билет.",
    "Каждый подтверждённый приглашённый даёт ещё 1 билет.",
    `Сейчас у тебя билетов: ${tickets}`
  ].join("\n");
}

async function handleContestStart(ctx: Context): Promise<ContestStartResult | undefined> {
  if (!ctx.from) {
    return undefined;
  }

  const activeContest = await getActiveContest();
  if (!activeContest) {
    return undefined;
  }

  const payload = extractStartPayload(ctx);
  const inviterUserId = parseInviterUserId(payload);
  const participant = await registerContestParticipant({
    contestId: activeContest.id,
    userId: ctx.from.id,
    username: ctx.from.username,
    firstName: ctx.from.first_name
  });

  if (payload === MAIN_CONTEST_START_PAYLOAD) {
    return {
      message: await buildContestLinkMessage(ctx, activeContest.id, ctx.from.id),
      skipWelcome: true
    };
  }

  if (!inviterUserId) {
    if (participant.isNew) {
      return {
        message: "Сейчас идёт конкурс. Получить свою реферальную ссылку можно командой /myref."
      };
    }

    return undefined;
  }

  if (!participant.isNew) {
    const existingReferral = await getReferralByInvitedUserId(activeContest.id, ctx.from.id);

    if (existingReferral?.status === "confirmed") {
      return {
        message: "Твоё приглашение в текущем конкурсе уже подтверждено.",
        skipWelcome: true
      };
    }

    if (existingReferral?.status === "pending") {
      return {
        message: "Приглашение уже сохранено. Подпишись на канал и нажми кнопку ниже, чтобы оно засчиталось.",
        showSubscriptionKeyboard: true,
        skipWelcome: true
      };
    }

    return {
      message: "Ты уже участвуешь в конкурсе. Получить свою реферальную ссылку можно командой /myref.",
      skipWelcome: true
    };
  }

  if (inviterUserId === ctx.from.id) {
    return {
      message: "Свою собственную ссылку использовать нельзя.",
      skipWelcome: true
    };
  }

  await createReferralIfFirstSeen({
    contestId: activeContest.id,
    inviterUserId,
    invitedUserId: ctx.from.id,
    invitedUsername: ctx.from.username,
    invitedFirstName: ctx.from.first_name,
    startPayload: payload
  });

  const subscribed = await isContestChannelMember(ctx, ctx.from.id);

  if (!subscribed) {
    return {
      message: [
        "Приглашение сохранено, но пока не засчитано.",
        "Подпишись на основной канал и нажми кнопку «Проверить подписку»."
      ].join("\n"),
      showSubscriptionKeyboard: true,
      skipWelcome: true
    };
  }

  await confirmReferral(activeContest.id, ctx.from.id);

  return {
    message: "Подписка подтверждена. Приглашение засчитано, а пригласивший получил 1 билет.",
    skipWelcome: true
  };
}

function ensureContestAdminAccess(ctx: Context): boolean {
  return Boolean(ctx.chat && isAdmin(ctx.from?.id) && isModerationChat(ctx.chat.id));
}

export function registerCommandHandlers(bot: Telegraf<Context>): void {
  bot.telegram.setMyCommands(botCommands);

  bot.command("rules", async (ctx) => {
    await ctx.reply(rulesMessage);
  });

  bot.command("info", async (ctx) => {
    await ctx.reply(infoMessage);
  });

  bot.command("myref", async (ctx) => {
    await ctx.reply("266");
  });

  bot.start(async (ctx) => {
    const contestStartResult = await handleContestStart(ctx);

    if (contestStartResult?.message) {
      await ctx.reply(
        contestStartResult.message,
        contestStartResult.showSubscriptionKeyboard ? referralSubscriptionKeyboard() : undefined
      );
    }

    if (!contestStartResult?.skipWelcome) {
      await sendWelcome(ctx);
    }
  });

  bot.command("myref", async (ctx) => {
    if (!ctx.from) {
      return;
    }

    const activeContest = await getActiveContest();

    if (!activeContest) {
      await ctx.reply("Сейчас активного конкурса нет.");
      return;
    }

    await registerContestParticipant({
      contestId: activeContest.id,
      userId: ctx.from.id,
      username: ctx.from.username,
      firstName: ctx.from.first_name
    });

    await ctx.reply(await buildContestLinkMessage(ctx, activeContest.id, ctx.from.id));
  });


  bot.command("startContest", async (ctx) => {
    if (!ensureContestAdminAccess(ctx)) {
      await ctx.reply("Эту команду можно использовать только админам в чате модерации.");
      return;
    }

    const activeContest = await getActiveContest();
    if (activeContest) {
      await ctx.reply("Конкурс уже запущен. Сначала заверши текущий через /finishContest.");
      return;
    }

    const contest = await createContest(CONTEST_WINNER_COUNT);
    const botInfo = await ctx.telegram.getMe();
    const contestPostLink = `https://t.me/${botInfo.username}?start=${MAIN_CONTEST_START_PAYLOAD}`;

    await ctx.reply(
      [
        "Конкурс запущен.",
        `ID конкурса: ${contest.id}`,
        "Механика: 1 билет за участие + 1 билет за каждого подтверждённого приглашённого.",
        `При финише будут выбраны ${contest.winnerCount} победителей по билетам.`,
        "",
        "Ссылка для кнопки или поста в основном канале:",
        contestPostLink,
        "",
        "Эту ссылку можно поставить на кнопку «Участвовать» в конкурсном посте."
      ].join("\n")
    );
  });

  bot.command("finishContest", async (ctx) => {
    if (!ensureContestAdminAccess(ctx)) {
      await ctx.reply("Эту команду можно использовать только админам в чате модерации.");
      return;
    }

    const activeContest = await getActiveContest();

    if (!activeContest) {
      await ctx.reply("Сейчас нет активного конкурса.");
      return;
    }

    const ticketEntries = await getContestTicketEntries(activeContest.id);
    const winners = drawWeightedWinners(ticketEntries, activeContest.winnerCount);
    await finishContest(activeContest.id);

    const totalTickets = ticketEntries.reduce((sum, entry) => sum + entry.tickets, 0);
    const winnerLines =
      winners.length > 0
        ? winners.map((winner, index) => {
            const label = formatContestUserLabel(winner.userId, winner.username, winner.firstName);
            return `${index + 1}. ${label} - ${winner.tickets} билет(ов)`;
          })
        : ["Участников конкурса нет, победителей выбрать не удалось."];

    await ctx.reply(
      [
        "Конкурс завершён.",
        `ID конкурса: ${activeContest.id}`,
        `Всего участников с билетами: ${ticketEntries.length}`,
        `Всего билетов: ${totalTickets}`,
        "",
        "Победители:",
        ...winnerLines
      ].join("\n")
    );
  });

  bot.command("contestStats", async (ctx) => {
    if (!ensureContestAdminAccess(ctx)) {
      await ctx.reply("Эту команду можно использовать только админам в чате модерации.");
      return;
    }

    const activeContest = await getActiveContest();

    if (!activeContest) {
      await ctx.reply("Сейчас нет активного конкурса.");
      return;
    }

    const ticketEntries = await getContestTicketEntries(activeContest.id);
    const totalTickets = ticketEntries.reduce((sum, entry) => sum + entry.tickets, 0);
    const topEntries = ticketEntries.slice(0, 10);
    const topLines =
      topEntries.length > 0
        ? topEntries.map((entry, index) => {
            const label = formatContestUserLabel(entry.userId, entry.username, entry.firstName);
            return `${index + 1}. ${label} - ${entry.tickets} билет(ов)`;
          })
        : ["Пока участников нет."];

    await ctx.reply(
      [
        "Статистика конкурса",
        `ID конкурса: ${activeContest.id}`,
        `Победителей будет: ${activeContest.winnerCount}`,
        `Всего участников: ${ticketEntries.length}`,
        `Всего билетов: ${totalTickets}`,
        "",
        "Топ участников:",
        ...topLines
      ].join("\n")
    );
  });

  bot.command("contestPost", async (ctx) => {
    if (!ensureContestAdminAccess(ctx)) {
      await ctx.reply("Эту команду можно использовать только админам в чате модерации.");
      return;
    }

    const activeContest = await getActiveContest();

    if (!activeContest) {
      await ctx.reply("Сначала запусти конкурс через /startContest.");
      return;
    }

    const botInfo = await ctx.telegram.getMe();
    const contestPostLink = `https://t.me/${botInfo.username}?start=${MAIN_CONTEST_START_PAYLOAD}`;

    try {
      await ctx.telegram.sendMessage(config.contestChannelId, DEFAULT_CONTEST_POST_TEXT, {
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.url("Участвовать", contestPostLink)]
        ]).reply_markup
      });

      await ctx.reply("Конкурсный пост опубликован в основной канал.");
    } catch (error) {
      if (isTelegramErrorWithDescription(error, "chat not found")) {
        await ctx.reply(
          "Не удалось опубликовать пост. Проверь CONTEST_CHANNEL_ID и добавлен ли бот в канал."
        );
        return;
      }

      if (
        isTelegramErrorWithDescription(error, "not enough rights") ||
        isTelegramErrorWithDescription(error, "need administrator rights")
      ) {
        await ctx.reply("Боту не хватает прав для публикации в канале. Выдай ему права администратора.");
        return;
      }

      throw error;
    }
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

    if (!ctx.chat || !isModerationChat(ctx.chat.id)) {
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
        `Отменено автором: ${stats.cancelled}`,
        "",
        `Текст: ${stats.textCount}`,
        `Фото: ${stats.photoCount}`,
        `Видео: ${stats.videoCount}`
      ].join("\n")
    );
  });
}
