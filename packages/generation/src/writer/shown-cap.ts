import NEED from "./content-need.json" with { type: "json" };
import type { WriterStage } from "./schema";

/*
 * The one place a measured cap becomes the number the writer is shown (loop 1 of the layout pilot,
 * 17 Oct 2026; build/CRAMMING-ROOT-CAUSE.md). Writers read a cap as a target: 26% of fields were
 * written at 85% or more of whatever cap was shown, and caps of 5 words or under were filled to
 * 90% or more two times in three. So the writer is shown about three quarters of each measured cap,
 * in words and in characters, while the measured cap (the schema's `maxLength`, the layout's own fit
 * check) stays the hard limit. Every menu number, every slot-fill Fits number and every logged
 * field's cap goes through here; nothing else divides characters by words.
 */

/**
 * Characters a word, spaces included, per stage: the 80th percentile of body text the writers
 * actually wrote (pilot build/CPW-BY-STAGE.md, 742 fields: KS1 p80 5.71, KS2 6.44 to 6.60, KS3-5
 * 7.12). The capacity tables are measured in characters with a sample passage of about 5.6
 * characters a word (`panel-list-capacity.ts` "Measuring text"), the corpus mean, so a word count
 * taken at the mean overflows about half the time; at p80 a field written to its words fits its
 * characters four times in five. Slot-fill's old flat 8 (a p95 guess with no stage) under-counted
 * every stage by 1 to 2 characters a word and so showed fewer words than the slide holds.
 */
export const CHARS_PER_WORD: Record<WriterStage, number> = {
  KS1: 5.8,
  KS2: 6.6,
  "KS3-5": 7.0,
};

/** The share of a measured cap the writer is shown (about 75%, Greg's loop-1 approval, 17 Oct). */
export const SHOWN_SHARE = 0.75;

/**
 * No body field is offered with a shown cap under this many words: a count or zone that would go
 * below it is not offered (ceiling words of 1 to 5 were written at 100% median fill).
 */
export const MIN_SHOWN_WORDS = 5;

/**
 * Planning headroom (loop 1b, Greg 17 Oct 2026): at the flow step, an idea whose counted words
 * need more than this share of its fit's shown words takes a roomier fit or two slides, decided
 * while the slide count can still change. Rendered into the prompt by `{{fits:plan-share}}`.
 */
export const PLAN_SHARE = 0.8;

/** A writer stage from a stage key (`KS1`, `KS2`, `KS3`, `KS4`, `KS3-5`, `KS5`). */
export function writerStageOfKey(stageKey: string): WriterStage {
  if (stageKey === "KS1" || stageKey === "KS2") return stageKey;
  return "KS3-5";
}

/** The most whole words whose characters stay within `chars` at this stage (the hard cap in words). */
export function wordsWithin(chars: number, stage: WriterStage): number {
  let w = 0;
  while ((w + 1) * CHARS_PER_WORD[stage] <= chars + 1e-9) w += 1;
  return w;
}

/** The characters the writer is shown for a measured cap of `chars`. */
export const shownChars = (chars: number): number => Math.floor(chars * SHOWN_SHARE);

/** The words the writer is shown for a measured cap of `chars` characters. */
export const shownWords = (chars: number, stage: WriterStage): number =>
  wordsWithin(shownChars(chars), stage);

/**
 * Content need (CAP-NEED-AUDIT.md, 18 Oct 2026): the words a good version of a field takes, p80
 * per stage, checked in as data with its source (`content-need.json`). Keyed `layout.field`
 * (`practice.task`, `hinge.option`, `visual-text.lead`, ...). Undefined is need unknown.
 */
/** The field's median need at a stage (`content-need.json`), or undefined when unknown. */
export function needMedianOf(key: string, stage: WriterStage): number | undefined {
  const row = (NEED as unknown as Record<string, Record<string, { median: number } | undefined>>)[
    key
  ];
  return row?.[stage]?.median;
}

export function needOf(key: string | undefined, stage: WriterStage): number | undefined {
  if (!key) return undefined;
  const row = (NEED as unknown as Record<string, Record<string, { p80: number } | undefined>>)[key];
  return row?.[stage]?.p80;
}

/**
 * The words the writer is shown for a field with a known need: what the slide holds at comfort
 * (`wordsWithin`, the room), never less than the need where the room allows it, never more than
 * twice the need (a cap far above the need is read as a target and padded), and otherwise the 75%
 * share. Need unknown keeps the 75% share (`shownWords`). The measured cap stays the hard limit.
 */
export function shownFor(
  chars: number,
  stage: WriterStage,
  key?: string,
  /** The room in characters when it is less than the measured cap (a pictured side's headroom). */
  roomChars = chars,
  /** The room in words when a probe measured it directly (the hinge's options per count). */
  roomWords?: number,
): number {
  const room = roomWords ?? wordsWithin(roomChars, stage);
  const share = Math.min(shownWords(chars, stage), room);
  const need = needOf(key, stage);
  if (need === undefined) return share;
  // A censored need (many stored fields pinned at their cap) is a lower bound: show the room.
  if (isCensored(key, stage)) return Math.min(room, Math.floor(2 * need));
  return Math.min(room, Math.max(share, need), Math.floor(2 * need));
}

/** The need row is a lower bound at this stage (`censored` in content-need.json). */
export function isCensored(key: string | undefined, stage: WriterStage): boolean {
  if (!key) return false;
  const row = (
    NEED as unknown as Record<string, Record<string, { censored?: boolean } | undefined>>
  )[key];
  return row?.[stage]?.censored === true;
}

/**
 * The longest prefix of `[count, words]` pairs (ascending counts) a menu may offer: every shown cap
 * at least `floor`, and no cliff, so one more item never leaves less than half the previous cap.
 * Counts past the first that fails are dropped too, so the offer stays contiguous.
 */
export function offerable(
  pairs: [number, number][],
  floor = MIN_SHOWN_WORDS,
  /**
   * Waive the no-cliff rule for a count whose words still hold the field's median need (practice
   * and the exit ticket: CAP-NEED-AUDIT.md rows 1d, 3b). The floor always holds.
   */
  waive: (w: number) => boolean = () => false,
): [number, number][] {
  const out: [number, number][] = [];
  for (const [n, w] of pairs) {
    const prev = out.at(-1)?.[1];
    if (w < floor || (!waive(w) && prev !== undefined && w * 2 < prev)) break;
    out.push([n, w]);
  }
  return out;
}
