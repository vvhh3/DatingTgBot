import { bannedCategories, type BannedTerm } from "./banned-terms.js";
import type { FilterResult } from "./types.js";

const MAX_TEXT_LENGTH = 900;
const WORD_CHAR_CLASS = "\\p{L}\\p{N}_";
const suspiciousLinks = /(https?:\/\/|t\.me\/|telegram\.me\/|wa\.me\/)/iu;

const confusableMap = new Map<string, string>([
  ["а", "a"],
  ["a", "a"],
  ["е", "e"],
  ["e", "e"],
  ["к", "k"],
  ["k", "k"],
  ["м", "m"],
  ["m", "m"],
  ["о", "o"],
  ["o", "o"],
  ["р", "p"],
  ["p", "p"],
  ["с", "c"],
  ["c", "c"],
  ["т", "t"],
  ["t", "t"],
  ["у", "y"],
  ["y", "y"],
  ["х", "x"],
  ["x", "x"]
]);

function wholeWord(pattern: string): RegExp {
  return new RegExp(`(?<![${WORD_CHAR_CLASS}])(?:${pattern})(?![${WORD_CHAR_CLASS}])`, "iu");
}

function wordStem(pattern: string): RegExp {
  return new RegExp(`(?<![${WORD_CHAR_CLASS}])(?:${pattern})[${WORD_CHAR_CLASS}]*`, "iu");
}

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizePhraseValue(value: string): string {
  return escapeForRegex(value).replace(/\s+/g, "\\s+");
}

function normalizeText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/ё/giu, "е")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function toConfusableSkeleton(text: string): string {
  return [...text].map((char) => confusableMap.get(char) ?? char).join("");
}

function createPattern(term: BannedTerm): RegExp {
  const normalizedValue = normalizeText(term.value);
  const matchValue = term.useConfusableSkeleton ? toConfusableSkeleton(normalizedValue) : normalizedValue;
  const preparedValue = term.mode === "phrase" ? normalizePhraseValue(matchValue) : escapeForRegex(matchValue);

  switch (term.mode) {
    case "word":
      return wholeWord(preparedValue);
    case "stem":
      return wordStem(preparedValue);
    case "phrase":
      return wholeWord(preparedValue);
  }
}

const categoryRules = bannedCategories.map((category) => ({
  reason: category.reason,
  terms: category.terms.map((term) => ({
    ...term,
    pattern: createPattern(term)
  }))
}));

export function moderateText(input: string): FilterResult {
  const text = normalizeText(input);
  const confusableSkeleton = toConfusableSkeleton(text);
  const reasons: string[] = [];

  if (!text) {
    reasons.push("пустое сообщение");
  }

  if (text.length > MAX_TEXT_LENGTH) {
    reasons.push(`слишком длинное сообщение (максимум ${MAX_TEXT_LENGTH} символов)`);
  }

  if (suspiciousLinks.test(text)) {
    reasons.push("ссылки и внешние контакты запрещены");
  }

  for (const rule of categoryRules) {
    const matched = rule.terms.some((term) => {
      const targetText = term.useConfusableSkeleton ? confusableSkeleton : text;
      return term.pattern.test(targetText);
    });

    if (matched) {
      reasons.push(rule.reason);
    }
  }

  return {
    allowed: reasons.length === 0,
    reasons
  };
}
