export type MatchMode = "word" | "stem" | "phrase";

export interface BannedTerm {
  value: string;
  mode: MatchMode;
  useConfusableSkeleton?: boolean;
}

export interface BannedCategory {
  reason: string;
  terms: BannedTerm[];
}

function word(value: string, useConfusableSkeleton = true): BannedTerm {
  return { value, mode: "word", useConfusableSkeleton };
}

function stem(value: string, useConfusableSkeleton = true): BannedTerm {
  return { value, mode: "stem", useConfusableSkeleton };
}

function phrase(value: string, useConfusableSkeleton = true): BannedTerm {
  return { value, mode: "phrase", useConfusableSkeleton };
}

export const bannedCategories: BannedCategory[] = [
  {
    reason: "18+ или сексуальный контент",
    terms: [
      word("секс"),
      word("порно"),
      stem("эротик"),
      stem("интим"),
      word("голая"),
      word("голые"),
      word("голый"),
      word("нюдс"),
      word("nude", false),
      word("nudes", false),
      word("xxx", false)
    ]
  },
  {
    reason: "оскорбления или агрессия",
    terms: [
      stem("дебил"),
      stem("идиот"),
      word("тупой"),
      word("тупая"),
      word("тупые"),
      word("тупица"),
      stem("мраз"),
      stem("ублюд"),
      stem("шлюх"),
      stem("сук"),
      stem("пидор"),
      stem("пидар"),
      stem("мудак"),
      stem("хуй")
    ]
  },
  {
    reason: "экстремизм, нацизм или разжигание ненависти",
    terms: [
      stem("нацист"),
      stem("нацизм"),
      stem("гитлер"),
      stem("свастик"),
      word("88", false),
      phrase("14/88", false),
      phrase("white power", false),
      phrase("расовая чистка"),
      phrase("расовая война")
    ]
  }
];
