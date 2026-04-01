import type { Context, Telegraf } from "telegraf";
import { confirmReferral, getActiveContest, getReferralByInvitedUserId } from "../../storage/contest.js";
import { referralSubscriptionKeyboard } from "../keyboards.js";
import { isContestChannelMember } from "../services/contest.js";

export function registerReferralActionHandlers(bot: Telegraf<Context>): void {
  bot.action("check_referral_subscription", async (ctx) => {
    if (!ctx.from) {
      await ctx.answerCbQuery("Не удалось определить пользователя.", { show_alert: true });
      return;
    }

    const activeContest = await getActiveContest();

    if (!activeContest) {
      await ctx.answerCbQuery("Сейчас нет активного конкурса.", { show_alert: true });
      return;
    }

    const referral = await getReferralByInvitedUserId(activeContest.id, ctx.from.id);

    if (!referral) {
      await ctx.answerCbQuery("Для тебя не найдено сохранённого приглашения.", { show_alert: true });
      return;
    }

    if (referral.status === "confirmed") {
      await ctx.answerCbQuery("Приглашение уже засчитано.");

      try {
        await ctx.editMessageReplyMarkup(undefined);
      } catch {}

      return;
    }

    const subscribed = await isContestChannelMember(ctx, ctx.from.id);

    if (!subscribed) {
      await ctx.answerCbQuery("Подписка пока не найдена.", { show_alert: true });

      try {
        await ctx.editMessageReplyMarkup(referralSubscriptionKeyboard().reply_markup);
      } catch {}

      return;
    }

    await confirmReferral(activeContest.id, ctx.from.id);
    await ctx.answerCbQuery("Подписка подтверждена, приглашение засчитано.");

    try {
      await ctx.editMessageReplyMarkup(undefined);
    } catch {}

    await ctx.reply("Подписка подтверждена. Приглашение засчитано, а пригласивший получил 1 билет.");
  });
}
