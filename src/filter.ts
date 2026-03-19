import { readFileSync } from "node:fs";
import path from "node:path";
import type { FilterResult } from "./types.js";

const MAX_TEXT_LENGTH = 900;
const WORD_CHAR_CLASS = "\\p{L}\\p{N}_";
const BANNED_TERMS_FILE = path.resolve("data", "banned-terms.txt");
const suspiciousLinks = /(https?:\/\/|t\.me\/|telegram\.me\/|wa\.me\/)/iu;
const obfuscationSeparators = /[\s._,*+\-|\\/]+/gu;
const obfuscatedRunPattern =
  /(?<![\p{L}\p{N}_])(?:[\p{L}\p{N}](?:[\s._,*+\-|\\/]+[\p{L}\p{N}]){2,})(?![\p{L}\p{N}_])/gu;

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
  return new RegExp(`(?<![${WORD_CHAR_CLASS}])(?:${pattern})(?![${WORD_CHAR_CLASS}])`, "iu");
}

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

function isSingleLetterToken(token: string): boolean {
  return /^[\p{L}\p{N}]$/u.test(token);
}

function mergeSpacedLetterRuns(text: string): string {
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
  return text.replace(obfuscatedRunPattern, (match) => match.replace(obfuscationSeparators, ""));
}

function loadBannedTerms(): string[] {
  let content: string;

  try {
    content = readFileSync(BANNED_TERMS_FILE, "utf8");
  } catch (error) {
    throw new Error(`Cannot read banned terms file: ${BANNED_TERMS_FILE}`, { cause: error });
  }

  return content
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*$/, "").trim())
    .filter(Boolean)
    .flatMap((line) => line.split(","))
    .map((item) => normalizeText(item))
    .filter(Boolean);
}

const bannedPatterns = loadBannedTerms().map((term) => {
  const normalizedTerm = toConfusableSkeleton(term);

  return {
    term,
    pattern: wholeWord(escapeForRegex(normalizedTerm))
  };
});

export function moderateText(input: string): FilterResult {
  const text = normalizeText(input);
  const confusableSkeleton = toConfusableSkeleton(text);
  const mergedSpacedLetters = mergeSpacedLetterRuns(confusableSkeleton);
  const compactedObfuscatedRuns = compactObfuscatedRuns(confusableSkeleton);
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
        entry.pattern.test(compactedObfuscatedRuns)
    )
  ) {
    reasons.push("forbidden_content");
  }

  return {
    allowed: reasons.length === 0,
    reasons: [...new Set(reasons)]
  };
}
