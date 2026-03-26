import { Markup } from "telegraf";

export const REJECT_REASONS = [
  { key: "rules", label: "❌ Не прошёл правила" },
  { key: "insults", label: "😮Оскорбления запрещены" },
  { key: "spam", label: "🚫 Флуд / спам" },
  { key: "nsfw", label: "🔞 Запрещённый контент" },
  { key: "noReason", label: "☺ без причины" },
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

  buttons.push([
    Markup.button.callback("⬅️ Назад", `back:${submissionId}`)
  ]);

  return Markup.inlineKeyboard(buttons);
}
