/*
 * Code-only metrics for the bake-off. Pure functions, no I/O, so `score-code.ts` and the tests
 * share them.
 *
 * Rewrite: verbatim overlap = the longest run of consecutive words a fact shares with ANY input
 * sentence (words lower-cased, punctuation stripped); the brief flags a run of 8 or more. Evidence
 * ids must all exist in the section's `{{sentences}}` block.
 *
 * Select: agreement with the by-construction labels. A match is "the answer names a card". The
 * error classes the brief ranks: wrong card, or a `full` where the label is `partial`/`none`
 * (worst); then a miss (`none` where a card was right); then `missing` naming the gap.
 */

import type { RewriteOutput, SelectOutput } from "./schemas";

export const OVERLAP_FLAG = 8;

export function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’']/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Length of the longest common contiguous word run between two word lists. */
export function longestSharedRun(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  let best = 0;
  let prev = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        cur[j] = (prev[j - 1] as number) + 1;
        if ((cur[j] as number) > best) best = cur[j] as number;
      }
    }
    prev = cur;
  }
  return best;
}

/** The longest run `text` shares with any one of `sentences`. */
export function longestOverlap(text: string, sentences: string[]): number {
  const t = words(text);
  let best = 0;
  for (const s of sentences) best = Math.max(best, longestSharedRun(t, words(s)));
  return best;
}

/** The sentence texts of a rendered `{{sentences}}` block, by id. */
export function sentencesById(block: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of block.split("\n")) {
    const m = /^\[(s\d+)\]\s*\([^)]*\)\s*(.*)$/.exec(line);
    if (m) map.set(m[1] as string, m[2] as string);
  }
  return map;
}

export interface FactRow {
  kind: "keyIdea" | "misconception" | "vocabulary" | "workedExample" | "question";
  index: number;
  text: string;
  evidence: string[];
  overlap: number;
  invalidEvidence: string[];
}

/** Every fact of a rewrite answer as one text (the fields a reader would see), with its checks. */
export function rewriteFacts(output: RewriteOutput, sentences: Map<string, string>): FactRow[] {
  const all = [...sentences.values()];
  const rows: FactRow[] = [];
  const add = (kind: FactRow["kind"], index: number, text: string, evidence: string[]): void => {
    rows.push({
      kind,
      index,
      text,
      evidence,
      overlap: longestOverlap(text, all),
      invalidEvidence: evidence.filter((id) => !sentences.has(id)),
    });
  };
  for (const [i, k] of output.keyIdeas.entries())
    add("keyIdea", i, [k.statement, k.example ?? ""].join(" "), k.evidence);
  for (const [i, m] of output.misconceptions.entries())
    add("misconception", i, `${m.wrong} ${m.right}`, m.evidence);
  for (const [i, v] of output.vocabulary.entries())
    add("vocabulary", i, `${v.term} ${v.definition}`, v.evidence);
  for (const [i, w] of output.workedExamples.entries())
    add("workedExample", i, [w.problem, ...w.steps, w.answer].join(" "), w.evidence);
  for (const [i, q] of output.questions.entries())
    add("question", i, [q.stem, q.answer, ...q.distractors].join(" "), q.evidence);
  return rows;
}

export interface RewriteScore {
  facts: number;
  flaggedOverlap: number;
  maxOverlap: number;
  invalidEvidenceFacts: number;
}

export function scoreRewrite(output: RewriteOutput, sentencesBlock: string): RewriteScore {
  const rows = rewriteFacts(output, sentencesById(sentencesBlock));
  return {
    facts: rows.length,
    flaggedOverlap: rows.filter((r) => r.overlap >= OVERLAP_FLAG).length,
    maxOverlap: rows.reduce((m, r) => Math.max(m, r.overlap), 0),
    invalidEvidenceFacts: rows.filter((r) => r.invalidEvidence.length > 0).length,
  };
}

export interface SelectLabel {
  cardId: "c1" | "c2" | "c3" | null;
  covers: "full" | "partial" | "none";
  missing: string[];
  kind?: string;
  zOutcome?: string | null;
}

export type SelectVerdict =
  | "correct"
  | "wrong-card"
  | "full-should-be-partial"
  | "full-should-be-none"
  | "partial-should-be-none"
  | "partial-should-be-full"
  | "missed";

export function selectVerdict(pred: SelectOutput, label: SelectLabel): SelectVerdict {
  if (label.covers === "none") {
    if (pred.covers === "none") return "correct";
    return pred.covers === "full" ? "full-should-be-none" : "partial-should-be-none";
  }
  if (pred.covers === "none") return "missed";
  if (pred.cardId !== label.cardId) return "wrong-card";
  if (pred.covers === label.covers) return "correct";
  return pred.covers === "full" ? "full-should-be-partial" : "partial-should-be-full";
}

/** Does `missing` name the gap: any label phrase shares ≥ 2 content words (≥ 4 letters) with any prediction. */
export function missingNamesGap(pred: string[], label: SelectLabel): boolean {
  const targets = [...label.missing, label.zOutcome ?? ""].filter(Boolean);
  const content = (t: string) => new Set(words(t).filter((w) => w.length >= 4));
  for (const p of pred) {
    const pw = content(p);
    for (const t of targets) {
      let shared = 0;
      for (const w of content(t)) if (pw.has(w)) shared += 1;
      if (shared >= 2) return true;
    }
  }
  return false;
}

export interface SelectScore {
  items: number;
  answered: number;
  /** Predicted matches (cardId not null) that were the right card with the right `covers`. */
  precision: number | null;
  /** Labelled matches (full or partial) the prediction got exactly right. */
  recall: number | null;
  verdicts: Record<SelectVerdict, number>;
  /** Over labelled-partial items answered partial on the right card: `missing` named Z's concept. */
  missingNamed: number;
  missingChecked: number;
  schemaFailures: number;
}

export function scoreSelect(
  rows: { id: string; ok: boolean; output?: unknown; schemaFailures: number }[],
  labels: Record<string, SelectLabel>,
): SelectScore {
  const verdicts: Record<SelectVerdict, number> = {
    correct: 0,
    "wrong-card": 0,
    "full-should-be-partial": 0,
    "full-should-be-none": 0,
    "partial-should-be-none": 0,
    "partial-should-be-full": 0,
    missed: 0,
  };
  let predictedMatches = 0;
  let correctMatches = 0;
  let labelledMatches = 0;
  let missingNamed = 0;
  let missingChecked = 0;
  let answered = 0;
  for (const row of rows) {
    const label = labels[row.id];
    if (!label) throw new Error(`no label for ${row.id}`);
    if (label.covers !== "none") labelledMatches += 1;
    if (!row.ok || !row.output) continue;
    answered += 1;
    const pred = row.output as SelectOutput;
    const v = selectVerdict(pred, label);
    verdicts[v] += 1;
    if (pred.cardId !== null) {
      predictedMatches += 1;
      if (v === "correct") correctMatches += 1;
    }
    if (label.covers === "partial" && pred.covers === "partial" && pred.cardId === label.cardId) {
      missingChecked += 1;
      if (missingNamesGap(pred.missing, label)) missingNamed += 1;
    }
  }
  return {
    items: rows.length,
    answered,
    precision: predictedMatches ? correctMatches / predictedMatches : null,
    recall: labelledMatches ? correctMatches / labelledMatches : null,
    verdicts,
    missingNamed,
    missingChecked,
    schemaFailures: rows.reduce((s, r) => s + r.schemaFailures, 0),
  };
}

/** A small seeded PRNG (mulberry32) so a shuffle is reproducible from its seed. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  const rand = seededRandom(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}
