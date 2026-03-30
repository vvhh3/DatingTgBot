import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FilterResult } from "../shared/types.js";

const MAX_TEXT_LENGTH = 900;
const WORD_CHAR_CLASS = "\\p{L}\\p{N}_";
const currentModuleDirectory = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_BANNED_TERMS_FILES = [
  path.resolve(currentModuleDirectory, "..", "..", "data", "banned-terms.txt"),
  path.resolve(currentModuleDirectory, "..", "data", "banned-terms.txt")
];
const configuredBannedTermsFile = process.env.BANNED_TERMS_FILE?.trim();
const suspiciousLinks = /(https?:\/\/|t\.me\/|telegram\.me\/|wa\.me\/)/iu;
const obfuscationSeparators = /[\s._,*+\-|\\/]+/gu;
const obfuscatedRunPattern =
  /(?<![\p{L}\p{N}_])(?:[\p{L}\p{N}](?:[\s._,*+\-|\\/]+[\p{L}\p{N}]){2,})(?![\p{L}\p{N}_])/gu;
const intraWordSeparatorPattern = /(?<=[\p{L}\p{N}])[._,*+\-|\\/]+(?=[\p{L}\p{N}])/gu;

const confusableMap = new Map<string, string>([
  ["а", "a"],
  ["a", "a"],
  ["е", "e"],
  ["e", "e"],
  ["к", "k"],
  ["k", "k"],
  ["м", "m"],
  ["m", "m"],
  ["н", "h"],
  ["h", "h"],
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
  ["x", "x"],
  ["в", "b"],
  ["b", "b"]
]);

function wholeWord(pattern: string): RegExp {
  // Матчим запрещённый термин как отдельное слово, а не как часть безопасного текста.
  return new RegExp(`(?<![${WORD_CHAR_CLASS}])(?:${pattern})(?![${WORD_CHAR_CLASS}])`, "iu");
}

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeText(text: string): string {
  // Нормализуем форму символов и пробелы, чтобы все последующие проверки работали по одному канону.
  return text
    .normalize("NFKC")
    .replace(/ё/giu, "е")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function toConfusableSkeleton(text: string): string {
  // Сводим похожие кириллические и латинские символы к общей форме.
  return [...text].map((char) => confusableMap.get(char) ?? char).join("");
}

function isSingleLetterToken(token: string): boolean {
  return /^[\p{L}\p{N}]$/u.test(token);
}

function mergeSpacedLetterRuns(text: string): string {
  // Собираем последовательности вроде "с п а м" в одно слово,
  // если это действительно серия одиночных символов.
  const tokens = text.split(" ").filter(Boolean);
  const merged: string[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (!isSingleLetterToken(token)) {
      merged.push(token);
      continue;
    }

    const run: string[] = [token];
    let nextIndex = index + 1;

    while (nextIndex < tokens.length && isSingleLetterToken(tokens[nextIndex])) {
      run.push(tokens[nextIndex]);
      nextIndex += 1;
    }

    if (run.length >= 3) {
      merged.push(run.join(""));
      index = nextIndex - 1;
      continue;
    }

    merged.push(...run);
    index = nextIndex - 1;
  }

  return merged.join(" ");
}

function compactObfuscatedRuns(text: string): string {
  // Убираем разделители в искусственно "разорванных" словах: s.p.a.m, c-п-а-м и т.п.
  return text.replace(obfuscatedRunPattern, (match) => match.replace(obfuscationSeparators, ""));
}

function compactIntraWordSeparators(text: string): string {
  return text.replace(intraWordSeparatorPattern, "");
}

function tokenizeWords(text: string): string[] {
  return text.match(/[\p{L}\p{N}]+/gu) ?? [];
}

function isSingleWordTerm(term: string): boolean {
  return !/\s/u.test(term);
}

function isApproximateMatch(source: string, target: string): boolean {
  // Разрешаем только одну правку и только для достаточно длинных слов,
  // чтобы ловить простые опечатки без чрезмерного числа ложных срабатываний.
  if (source === target) {
    return true;
  }

  if (Math.abs(source.length - target.length) > 1) {
    return false;
  }

  if (source.length < 5 || target.length < 5) {
    return false;
  }

  if (source[0] !== target[0] || source[source.length - 1] !== target[target.length - 1]) {
    return false;
  }

  let indexA = 0;
  let indexB = 0;
  let edits = 0;

  while (indexA < source.length && indexB < target.length) {
    if (source[indexA] === target[indexB]) {
      indexA += 1;
      indexB += 1;
      continue;
    }

    edits += 1;

    if (edits > 1) {
      return false;
    }

    if (source.length > target.length) {
      indexA += 1;
      continue;
    }

    if (source.length < target.length) {
      indexB += 1;
      continue;
    }

    indexA += 1;
    indexB += 1;
  }

  if (indexA < source.length || indexB < target.length) {
    edits += 1;
  }

  return edits <= 1;
}

function loadBannedTerms(): string[] {
  // Ищем словарь по нескольким путям, чтобы код одинаково работал из src и из dist.
  const candidateFiles = configuredBannedTermsFile
    ? [configuredBannedTermsFile, ...DEFAULT_BANNED_TERMS_FILES]
    : DEFAULT_BANNED_TERMS_FILES;
  let lastError: unknown;

  for (const bannedTermsFile of candidateFiles) {
    try {
      const content = readFileSync(bannedTermsFile, "utf8");

      return content
        .split(/\r?\n/)
        .map((line) => line.replace(/#.*$/, "").trim())
        .filter(Boolean)
        .flatMap((line) => line.split(","))
        .map((item) => normalizeText(item))
        .filter(Boolean);
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(`Cannot read banned terms file: ${candidateFiles.join(", ")}`, { cause: lastError });
}

const bannedPatterns = loadBannedTerms().map((term) => {
  const normalizedTerm = toConfusableSkeleton(term);

  return {
    term,
    normalizedTerm,
    pattern: wholeWord(escapeForRegex(normalizedTerm))
  };
});

export function moderateText(input: string): FilterResult {
  // Проверяем текст в нескольких представлениях:
  // обычный normal form, skeleton, слитные буквы и слова без маскирующих разделителей.
  const text = normalizeText(input);
  const confusableSkeleton = toConfusableSkeleton(text);
  const mergedSpacedLetters = mergeSpacedLetterRuns(confusableSkeleton);
  const compactedObfuscatedRuns = compactObfuscatedRuns(confusableSkeleton);
  const compactedIntraWordSeparators = compactIntraWordSeparators(compactedObfuscatedRuns);
  const wordTokens = new Set([
    ...tokenizeWords(confusableSkeleton),
    ...tokenizeWords(mergedSpacedLetters),
    ...tokenizeWords(compactedObfuscatedRuns),
    ...tokenizeWords(compactedIntraWordSeparators)
  ]);
  const reasons: string[] = [];

  if (!text) {
    reasons.push("empty");
  }

  if (text.length > MAX_TEXT_LENGTH) {
    reasons.push("too_long");
  }

  if (suspiciousLinks.test(text)) {
    reasons.push("forbidden_content");
  }

  if (
    bannedPatterns.some(
      (entry) =>
        entry.pattern.test(confusableSkeleton) ||
        entry.pattern.test(mergedSpacedLetters) ||
        entry.pattern.test(compactedObfuscatedRuns) ||
        entry.pattern.test(compactedIntraWordSeparators) ||
        (isSingleWordTerm(entry.normalizedTerm) &&
          [...wordTokens].some((token) => isApproximateMatch(token, entry.normalizedTerm)))
    )
  ) {
    reasons.push("forbidden_content");
  }

  return {
    allowed: reasons.length === 0,
    reasons: [...new Set(reasons)]
  };
}
