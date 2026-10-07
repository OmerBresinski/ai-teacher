/**
 * The picture library (TEACH-84, UX rulings 88 and 158): the pure parts the worker and the tests
 * share. The library's storage keys, the card a brief is embedded by, the calibrated reuse
 * threshold, and the number rule. No database here (`@tj/db` `bank.ts`) and no model call (the
 * embedder is `@tj/ai` `createOpenAiEmbedder`).
 */
import { storageKey, type WorkspaceId } from "@tj/domain";
import { normaliseQuery } from "./query";

/**
 * The reserved key space the library's bytes live under. Storage keys must start with a
 * Workspace UUID (ADR 0026, `StorageKeySchema`), and the library belongs to no Workspace, so it
 * takes a fixed UUID no Workspace is ever minted with (ids are random v4/v7). `/files` serves a
 * key only to its own Workspace, so these bytes are never served directly: a hit is copied into
 * the lesson's Workspace first.
 */
export const BANK_STORAGE_SPACE = "00000000-0000-4000-8000-00000000ba4c" as WorkspaceId;

/** `<BANK_STORAGE_SPACE>/bank/<id>.<ext>`. */
export function bankStorageKey(id: string, ext: string): string {
  return storageKey(BANK_STORAGE_SPACE, "bank", `${id}.${ext}`);
}

/** The library's subject tag: the brief subject as a search query is normalised. */
export function bankSubject(subject: string): string {
  return normaliseQuery(subject);
}

/**
 * The card a brief is embedded by and a row is stored with: the subject, then what the picture
 * must show. Topic is a tag, not part of the card: the threshold was calibrated on cards without
 * it (`calibration/brief-pairs.json`).
 */
export function bankCard(brief: { subject: string; mustShow: readonly string[] }): string {
  const subject = brief.subject.replace(/\s+/g, " ").trim();
  const items = brief.mustShow.map((m) => m.replace(/\s+/g, " ").trim()).filter(Boolean);
  return items.length > 0 ? `${subject}: ${items.join(", ")}` : subject;
}

/**
 * The calibrated cosine thresholds between two cards (`text-embedding-3-small`), picked on the
 * hand-labelled set `apps/worker/calibration/library/brief-pairs.json` (38 pairs) by
 * `calibrate.ts` beside it (output in `result.txt`). The highest pair that must not share a
 * picture scored 0.744 ("plant cell" v "animal cell"), so a hit needs 0.76 and the numbers
 * agreeing ("three apples" v "five apples" scored 0.96): precision 1.00, recall 12 of 14. The
 * lowest "same" pair scored 0.677, so below 0.65 is a clear miss. Between is the grey zone, a miss
 * in phase 1 (the judge pick over the top 3 is phase 2).
 */
export const BANK_HIT_THRESHOLD = 0.76;
export const BANK_MISS_THRESHOLD = 0.65;

/** The §5.5 embedding deadline: an embedding slower than this is a miss, never a wait. */
export const BANK_EMBED_TIMEOUT_MS = 300;

export type BankZone = "hit" | "grey" | "miss";

export function bankZone(similarity: number): BankZone {
  if (similarity >= BANK_HIT_THRESHOLD) return "hit";
  if (similarity >= BANK_MISS_THRESHOLD) return "grey";
  return "miss";
}

const UNITS =
  "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split(
    " ",
  );
const TENS = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split(" ");

/** The numbers a card states, digits or words ("twenty-four" is 24), sorted. */
export function numbersIn(text: string): number[] {
  const out: number[] = [];
  const s = text.toLowerCase();
  for (const m of s.matchAll(/\d+(?:\.\d+)?/g)) out.push(Number(m[0]));
  const words = s.match(/[a-z]+/g) ?? [];
  for (let i = 0; i < words.length; i++) {
    const tens = TENS.indexOf(words[i] ?? "");
    if (tens >= 2) {
      const unit = UNITS.indexOf(words[i + 1] ?? "");
      const ones = unit > 0 && unit < 10 ? unit : 0;
      out.push(tens * 10 + ones);
      if (ones) i += 1;
      continue;
    }
    const unit = UNITS.indexOf(words[i] ?? "");
    if (unit >= 2) out.push(unit);
  }
  return out.sort((a, b) => a - b);
}

/**
 * Two cards may share a picture only when they state the same numbers: "24 counters in four
 * groups of six" is not "12 counters in three groups of four", however alike they embed.
 */
export function numbersAgree(a: string, b: string): boolean {
  const x = numbersIn(a);
  const y = numbersIn(b);
  return x.length === y.length && x.every((n, i) => n === y[i]);
}

/** Cosine similarity of two vectors (the calibration script; the lookup uses pgvector). */
export function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}
