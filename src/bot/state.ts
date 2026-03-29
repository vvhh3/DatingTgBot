import { config } from "../config/index.js";
import type { PendingMediaDraft, PendingRejectionNote } from "./types.js";

const submissionCooldownMs = config.submissionCooldownSeconds * 1000;

// Это временное in-memory состояние процесса.
// Здесь нет критичных данных: после рестарта могут пропасть только черновики и ожидание reply от модератора.
export const lastSubmissionAt = new Map<number, number>();
export const pendingMediaDrafts = new Map<number, PendingMediaDraft>();
export const pendingRejectionNotes = new Map<number, PendingRejectionNote>();

export function getCooldownRemainingSeconds(userId: number): number {
  const lastSentAt = lastSubmissionAt.get(userId);

  if (!lastSentAt || submissionCooldownMs <= 0) {
    return 0;
  }

  const remainingMs = lastSentAt + submissionCooldownMs - Date.now();

  if (remainingMs <= 0) {
    return 0;
  }

  // Округляем вверх, чтобы пользователь не видел "0 секунд", пока ограничение ещё активно.
  return Math.ceil(remainingMs / 1000);
}
