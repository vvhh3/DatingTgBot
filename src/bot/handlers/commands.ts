import { randomInt } from "node:crypto";
import { Input } from "telegraf";
import type { Context, Telegraf } from "telegraf";
import { config } from "../../config/index.js";
import { createContest, createReferralIfFirstSeen, finishContest, getActiveContest, getConfirmedReferralCount, getContestTicketEntries, getReferralByInvitedUserId, registerContestParticipant, confirmReferral } from "../../storage/contest.js";
import { getSubmissionStats } from "../../storage/index.js";
import type { ContestTicketEntry } from "../../storage/contest.js";
import { referralSubscriptionKeyboard } from "../keyboards.js";
import { botCommands, infoMessage, rulesMessage, welcomeCaption, welcomeDetails } from "../messages.js";
import { buildReferralLink, extractStartPayload, formatContestUserLabel, isContestChannelMember, parseInviterUserId } from "../services/contest.js";
import { pendingMediaDrafts } from "../state.js";
import { isAdmin, isModerationChat } from "../utils.js";

const CONTEST_WINNER_COUNT = 10;

type ContestStartResult = {
  message?: string;
  showSubscriptionKeyboard?: boolean;
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
    let current = 0;
    let selectedIndex = 0;

    for (let index = 0; index < pool.length; index += 1) {
      current += pool[index].tickets;
      if (winningNumber < current) {
        selectedIndex = index;
        break;
      }
    }

    winners.push(pool[selectedIndex]);
    pool.splice(selectedIndex, 1);
  }

  return winners;
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
        message: "Твоё приглашение в текущем конкурсе уже подтверждено."
      };
    }

    if (existingReferral?.status === "pending") {
      return {
        message: "Приглашение уже сохранено. Подпишись на канал и нажми кнопку ниже, чтобы оно засчиталось.",
        showSubscriptionKeyboard: true
      };
    }

    return {
      message: "В текущем конкурсе засчитывается только первый источник входа нового пользователя."
    };
  }

  if (inviterUserId === ctx.from.id) {
    return {
      message: "Свою собственную ссылку использовать нельзя."
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
      showSubscriptionKeyboard: true
    };
  }

  await confirmReferral(activeContest.id, ctx.from.id);

  return {
    message: "Подписка подтверждена. Приглашение засчитано, а пригласивший получил 1 билет."
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

  bot.start(async (ctx) => {
    const contestStartResult = await handleContestStart(ctx);

    if (contestStartResult?.message) {
      await ctx.reply(
        contestStartResult.message,
        contestStartResult.showSubscriptionKeyboard ? referralSubscriptionKeyboard() : undefined
      );
    }

    await sendWelcome(ctx);
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

    const referralLink = await buildReferralLink(ctx, ctx.from.id);
    const tickets = await getConfirmedReferralCount(activeContest.id, ctx.from.id);

    await ctx.reply(
      [
        "Твоя реферальная ссылка:",
        referralLink,
        "",
        "За 1 подтверждённого приглашённого начисляется 1 билет.",
        `Сейчас у тебя билетов: ${tickets}`
      ].join("\n")
    );
  });

  bot.command("mytickets", async (ctx) => {
    if (!ctx.from) {
      return;
    }

    const activeContest = await getActiveContest();

    if (!activeContest) {
      await ctx.reply("Сейчас активного конкурса нет.");
      return;
    }

    const tickets = await getConfirmedReferralCount(activeContest.id, ctx.from.id);

    await ctx.reply(`У тебя ${tickets} билет(ов) в текущем конкурсе.`);
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

    await ctx.reply(
      [
        "Конкурс запущен.",
        `ID конкурса: ${contest.id}`,
        "Механика: 1 подтверждённый приглашённый = 1 билет.",
        `При финише будут выбраны ${contest.winnerCount} победителей по билетам.`,
        "Участники получают ссылку командой /myref."
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
            return `${index + 1}. ${label} — ${winner.tickets} билет(ов)`;
          })
        : ["Подтверждённых билетов нет, победителей выбрать не удалось."];

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

  bot.command("cancel", async (ctx) => {
    if (!ctx.from) {
      return;
    }

    if (pendingMediaDrafts.delete(ctx.from.id)) {
      await ctx.reply("Р§РµСЂРЅРѕРІРёРє РјРµРґРёР° СѓРґР°Р»С‘РЅ.");
      return;
    }

    await ctx.reply("РЎРѕС…СЂР°РЅС‘РЅРЅРѕРіРѕ С‡РµСЂРЅРѕРІРёРєР° РјРµРґРёР° СЃРµР№С‡Р°СЃ РЅРµС‚.");
  });

  bot.command("stats", async (ctx) => {
    if (!isAdmin(ctx.from?.id)) {
      await ctx.reply("РќРµРґРѕСЃС‚Р°С‚РѕС‡РЅРѕ РїСЂР°РІ.");
      return;
    }

    if (!isModerationChat(ctx.chat.id)) {
      await ctx.reply("Р­С‚Сѓ РєРѕРјР°РЅРґСѓ РјРѕР¶РЅРѕ РёСЃРїРѕР»СЊР·РѕРІР°С‚СЊ С‚РѕР»СЊРєРѕ РІ С‡Р°С‚Рµ РјРѕРґРµСЂР°С†РёРё.");
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
