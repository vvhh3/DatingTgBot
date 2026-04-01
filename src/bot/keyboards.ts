import { Markup } from "telegraf";
import { config } from "../config/index.js";

export const REJECT_REASONS = [
  { key: "rules", label: "❌ Не прошёл правила" },
  { key: "insults", label: "🤬 Оскорбления запрещены" },
  { key: "spam", label: "🚫 Флуд / спам" },
  { key: "nsfw", label: "🔞 Запрещённый контент" },
  { key: "noReason", label: "☺ Без причины" },
  { key: "offTopic", label: "😔 Не по теме" },
  { key: "six", label: "☺ 67 +Реп W спайк дружелюбный бандит 52 ngg" }
] as const;

export function moderationKeyboard(submissionId: string) {
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

export function rejectReasonsKeyboard(submissionId: string) {
  const buttons = REJECT_REASONS.map((reason) => [
    Markup.button.callback(reason.label, `reject_reason:${reason.key}:${submissionId}`)
  ]);

  buttons.push([Markup.button.callback("⬅️ Назад", `back:${submissionId}`)]);

  return Markup.inlineKeyboard(buttons);
}

export function userPendingSubmissionKeyboard(submissionId: string) {
  return Markup.inlineKeyboard([
    [Markup.button.callback("Отменить заявку", `cancel_submission:${submissionId}`)]
  ]);
}

export function referralSubscriptionKeyboard() {
  const rows = [];

  if (config.contestChannelUrl) {
    rows.push([Markup.button.url("Подписаться на канал", config.contestChannelUrl)]);
  }

  rows.push([Markup.button.callback("Проверить подписку", "check_referral_subscription")]);

  return Markup.inlineKeyboard(rows);
}
