/*
 * Readability and repetition measures (Generation quality §5, Decision 4; TEACH-210). Pure
 * functions over plain text, used by `checkLesson` on prose kinds only — never on question stems,
 * vocabulary definitions or notes, so notation-heavy subjects are not penalised. Heuristics, not
 * linguistics: good enough to flag a Year 5 slide written in 25-word sentences.
 */

const SENTENCE_END = /[.!?]+(?:\s+|$)/;
const WORD = /[\p{L}\p{N}'’-]+/gu;

/** The words in `text`, lower-cased, apostrophes and hyphens kept inside a word. */
export function words(text: string): string[] {
  return (text.match(WORD) ?? []).map((w) => w.toLowerCase());
}

/** Word counts per sentence; a fragment with no terminal punctuation is one sentence. */
export function sentenceLengths(text: string): number[] {
  return text
    .split(SENTENCE_END)
    .map((s) => words(s).length)
    .filter((n) => n > 0);
}

export function meanSentenceLength(text: string): number | null {
  const lengths = sentenceLengths(text);
  if (lengths.length === 0) return null;
  return lengths.reduce((sum, n) => sum + n, 0) / lengths.length;
}

/**
 * Syllables in one English word by vowel groups, with the usual corrections (a silent final `e`
 * and `-es`/`-ed` endings are dropped, a consonant + `le` ending keeps its `e`). Never below one
 * for a word with letters.
 */
export function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (w.length === 0) return 0;
  if (w.length <= 3) return 1;
  let stripped = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "");
  stripped = stripped.replace(/^y/, "");
  const groups = stripped.match(/[aeiouy]{1,2}/g)?.length ?? 0;
  return Math.max(1, groups);
}

/**
 * Flesch–Kincaid grade level: `0.39 × words/sentence + 11.8 × syllables/word − 15.59`. `null` for
 * text with no words.
 */
export function fleschKincaidGrade(text: string): number | null {
  const lengths = sentenceLengths(text);
  const ws = words(text);
  if (lengths.length === 0 || ws.length === 0) return null;
  const syl = ws.reduce((sum, w) => sum + syllables(w), 0);
  return 0.39 * (ws.length / lengths.length) + 11.8 * (syl / ws.length) - 15.59;
}

/**
 * The reading age the text asks for: a US grade reads at roughly `grade + 5` years, so a grade of 4
 * is a reading age of about 9. Rounded to one decimal; `null` without words.
 */
export function readingAge(text: string): number | null {
  const grade = fleschKincaidGrade(text);
  return grade === null ? null : Math.round((grade + 5) * 10) / 10;
}

/**
 * Every run of `n` consecutive words in `text`, as space-joined keys. Repetition is measured on
 * these across a whole lesson (a phrase said twelve times across slides and sheet).
 */
export function ngrams(text: string, n: number): string[] {
  const ws = words(text);
  const out: string[] = [];
  for (let i = 0; i + n <= ws.length; i++) out.push(ws.slice(i, i + n).join(" "));
  return out;
}
