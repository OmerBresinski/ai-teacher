/**
 * Type sizes a layout owns, by age (UX ruling 21 A, 17 Oct 2026: the approved golds' sizes). Sizes,
 * boxes, paddings and gaps are layout: the same in every theme and set by age only (THEMING.md:
 * "a theme may never move a box, change a padding or change a type size"). Each value is the
 * gold's own px at 1440 wide, in slide points (x 2/3), and is drawn as given
 * (`TextStyle.fixedSize`), never snapped to the stage's type steps.
 */
import type { Theme } from "@tj/domain/documents";
import { BODY_SMALL, KEY_STAGE_TYPE, type KeyStage, keyStageOf } from "./themes";

export type LayoutAge = "early" | "primary" | "secondary";

/** Gold px (1440 wide) in slide points (960 wide). */
const px = (v: number) => (v * 2) / 3;

/** The gold's age for a key stage: KS1 early, KS2 primary, KS3 and up secondary; none reads as KS2. */
export function layoutAgeOf(ks: KeyStage | undefined): LayoutAge {
  if (ks === "ks1") return "early";
  if (ks === undefined || ks === "ks2") return "primary";
  return "secondary";
}

/**
 * The smallest reading size at a key stage (ruling 162: the stage's bodySmall), the same in every
 * theme. No stage reads as KS2.
 */
export function readingFloorOf(ks: KeyStage | undefined): number {
  return Math.round(KEY_STAGE_TYPE[ks ?? "ks2"].body * BODY_SMALL);
}

/** The cover's title and question sizes. Every cover composition reads these. */
export type CoverType = {
  /** The title's size before any step-down: the top of its fit ladder. */
  title: number;
  /** The ladder's floor: 62% of the top, never under 56 px (gold `cover5.html` fit). */
  titleFloor: number;
  /** One rung of the ladder (2 px). */
  titleStep: number;
  titleLineHeight: number;
  /** The question under the title: the gold's size, held at the stage's reading floor. */
  question: number;
  questionLineHeight: number;
};

/**
 * The gold covers' px. Primary and secondary: round 5 `cover5.html` `shape` comp (`--ts: 82px`,
 * `.title` line-height 1.04; the question `.q` at `--t-body`, 33 px primary and 31 px secondary in
 * `northstars/theme-v2.css`, line-height `--lh-body` 1.3). Early: the gold's KS1 comp (`ks1`:
 * `--ts: 84px`, `.q` 34 px / 1.3).
 */
const COVER_GOLD: Record<LayoutAge, { title: number; question: number }> = {
  early: { title: 84, question: 34 },
  primary: { title: 82, question: 33 },
  secondary: { title: 82, question: 31 },
};

/** The cover's sizes at a key stage (undefined: KS2). */
export function coverTypeAt(ks: KeyStage | undefined): CoverType {
  const g = COVER_GOLD[layoutAgeOf(ks)];
  return {
    title: px(g.title),
    titleFloor: px(Math.max(56, Math.round(g.title * 0.62))),
    titleStep: px(2),
    titleLineHeight: 1.04,
    question: Math.max(px(g.question), readingFloorOf(ks)),
    questionLineHeight: 1.3,
  };
}

/** The cover's sizes for a theme read at a key stage (`atKeyStage`); no stage reads as KS2. */
export const coverType = (t: Theme): CoverType => coverTypeAt(keyStageOf(t));
