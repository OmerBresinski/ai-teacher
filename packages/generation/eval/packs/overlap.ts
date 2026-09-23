import type { PackFacts, Sentence } from "./schema";

/*
 * Verbatim overlap, measured structurally: the longest run of consecutive words a fact shares with
 * any source sentence. Words are lower-cased tokens with punctuation stripped; a run of
 * `FLAG_AT_WORDS` or more is flagged. The number says how much was copied; whether copying was
 * right (a formula, a date, a proper noun run) is not code's call and is recorded, not judged.
 */

export const FLAG_AT_WORDS = 8;

export const words = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^\p{L}\p{N}'\s-]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);

/** Length of the longest common contiguous run of tokens between `a` and `b` (dynamic programming). */
export function longestCommonRun(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  let prev = new Array<number>(b.length + 1).fill(0);
  let best = 0;
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        const v = (prev[j - 1] ?? 0) + 1;
        cur[j] = v;
        if (v > best) best = v;
      }
    }
    prev = cur;
  }
  return best;
}

export interface Overlap {
  /** Longest shared run, in words. */
  longest: number;
  /** The sentence that shares it (the first at that length). */
  sentenceId: string | null;
  flagged: boolean;
}

export function overlapOf(text: string, sentences: readonly Sentence[]): Overlap {
  const t = words(text);
  let best: Overlap = { longest: 0, sentenceId: null, flagged: false };
  for (const s of sentences) {
    const n = longestCommonRun(t, words(s.text));
    if (n > best.longest) best = { longest: n, sentenceId: s.id, flagged: n >= FLAG_AT_WORDS };
  }
  return best;
}

/** One fact flattened to the text a reader would compare: every prose field, in order. */
export function factText(type: keyof PackFacts, fact: PackFacts[keyof PackFacts][number]): string {
  const f = fact as Record<string, unknown>;
  const pick = (keys: string[]) =>
    keys
      .map((k) => f[k])
      .flatMap((v) => (Array.isArray(v) ? v.map(String) : typeof v === "string" ? [v] : []))
      .join(" ");
  switch (type) {
    case "keyIdeas":
      return pick(["statement", "explanation", "example", "analogy"]);
    case "misconceptions":
      return pick(["belief", "correction"]);
    case "vocabulary":
      return pick(["term", "definition"]);
    case "workedExamples":
      return pick(["problem", "steps", "answer"]);
    case "questions": {
      const d = (f.distractors as { text: string }[] | undefined)?.map((x) => x.text) ?? [];
      return `${pick(["stem", "answer", "reasoning"])} ${d.join(" ")}`;
    }
  }
}

export interface FactOverlapRow {
  type: keyof PackFacts;
  index: number;
  overlap: Overlap;
}

/** Overlap of every fact in a section against the section's sentence window. */
export function sectionOverlap(facts: PackFacts, window: readonly Sentence[]): FactOverlapRow[] {
  const rows: FactOverlapRow[] = [];
  for (const type of [
    "keyIdeas",
    "misconceptions",
    "vocabulary",
    "workedExamples",
    "questions",
  ] as const) {
    facts[type].forEach((fact, index) => {
      rows.push({ type, index, overlap: overlapOf(factText(type, fact), window) });
    });
  }
  return rows;
}
