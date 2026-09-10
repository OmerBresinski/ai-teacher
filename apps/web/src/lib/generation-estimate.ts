import type { JobEvent } from "@tj/domain/jobs";
import { z } from "zod";

/**
 * TEACH-201: an honest time estimate for a `lesson.plan` run, from per-stage history (PRD
 * "Generating view" section 4). Pure arithmetic on fixtures; the history comes from
 * `useGenerationEstimates` (`GET /jobs/estimates`, Omer's TEACH-203) and the text is rendered by
 * `EstimateText`.
 *
 * The rules, in one place:
 * - History is a median (p50) and an 80th percentile (p80) per stage, in milliseconds, over the
 *   last completed runs. Fewer than `MIN_HISTORY_RUNS` runs: no estimate.
 * - Remaining time is the sum, over the stages not yet finished, of p50 (low) and p80 (high).
 *   Writing is per slide, multiplied by the slides still to come. The stage in progress
 *   contributes its estimate less the time already spent in it, floored at zero.
 * - The text rounds outwards to minutes and never shows seconds. Under `MIN_SHOWN_MS` it shows
 *   nothing and the stage line speaks for itself.
 * - Nothing here ticks: `now` is passed in, and the caller recomputes only when an event arrives.
 * - When the time spent in the current stage passes its high bound the caller shows "Taking
 *   longer than usual" until the next event (`stageOverdue`).
 */

// ---------------------------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------------------------

/** The stage keys `GET /jobs/estimates` returns (PRD section 4). Durations in milliseconds. */
export const STAGE_KEYS = [
  "plan",
  "generateSlide",
  "worksheet",
  "illustratePicture",
  "evaluate",
  "repair",
] as const;
export type StageKey = (typeof STAGE_KEYS)[number];

export const StageEstimateSchema = z.object({
  p50: z.number().nonnegative(),
  p80: z.number().nonnegative(),
});
export type StageEstimate = z.infer<typeof StageEstimateSchema>;

/**
 * `stages` is partial: a history recorded before a stage was measured (no repair yet, say) still
 * parses, and the missing stage counts as zero, so the estimate runs a little low rather than
 * falling silent.
 */
export const EstimateHistorySchema = z.object({
  /** Completed runs the figures are drawn from. */
  runs: z.number().int().nonnegative(),
  stages: z
    .object({
      plan: StageEstimateSchema,
      generateSlide: StageEstimateSchema,
      worksheet: StageEstimateSchema,
      illustratePicture: StageEstimateSchema,
      evaluate: StageEstimateSchema,
      repair: StageEstimateSchema,
    })
    .partial(),
});
export type EstimateHistory = z.infer<typeof EstimateHistorySchema>;

const NO_TIME: StageEstimate = { p50: 0, p80: 0 };

/** One stage's figures, zero when the history has none for it. */
export function stageStat(history: EstimateHistory, key: StageKey): StageEstimate {
  return history.stages[key] ?? NO_TIME;
}

/** Below this many completed runs the medians mean nothing, so no time is shown (PRD 4.6). */
export const MIN_HISTORY_RUNS = 5;
/** Below this much remaining the text says nothing and the stage line speaks (PRD 4.3). */
export const MIN_SHOWN_MS = 20_000;

// ---------------------------------------------------------------------------------------------
// Stage derivation. TODO(TEACH-199): replace with the shell's `stageOf(events)` when it lands.
// ---------------------------------------------------------------------------------------------

/**
 * The generating stages in run order. `worksheet` sits inside Writing on the strip (the PRD keeps
 * five stages) but is its own line of history, so it is its own step here.
 */
export type Stage = "planning" | "writing" | "worksheet" | "pictures" | "checking" | "ready";

export interface StagePosition {
  stage: Stage;
  /** Slides written so far and the total the outline promised, once a "Slide n of N" has landed. */
  slide?: { n: number; total: number };
  /** ISO time of the event that put the run where it is; the current stage's clock starts here. */
  since: string;
}

const SLIDE_MESSAGE = /\bslide\s+(\d+)\s+of\s+(\d+)\b/i;

/**
 * Where a run is, from `percent` and the message: 2, 6 and 10 are Planning; over 10 up to 80 is
 * Writing with "Slide n of N"; 85 is the worksheet; 88 a picture placed on resume (the strip shows it inside Writing since TEACH-220); 90 Checking; 100 Ready.
 * Marked for replacement by TEACH-199's `stageOf`, which owns the table and reads
 * `progress.stage` once the worker sends it; keep the two in step until then.
 *
 * Returns `null` before the run has started or once it ended other than by completing.
 */
export function stagePositionOf(events: readonly JobEvent[]): StagePosition | null {
  let position = null as StagePosition | null;
  for (const event of events) {
    switch (event.type) {
      case "queued":
        break;
      case "started":
        position = { stage: "planning", since: event.at };
        break;
      case "progress": {
        const { percent, message } = event.progress;
        const slide = message?.match(SLIDE_MESSAGE);
        const before: StagePosition | null = position;
        const slideInfo: StagePosition["slide"] =
          slide?.[1] !== undefined && slide[2] !== undefined
            ? { n: Number(slide[1]), total: Number(slide[2]) }
            : before?.slide;
        const stage = stageForPercent(percent, before?.stage ?? "planning");
        // A message-only tick within the same stage does not restart the stage's clock; a slide
        // landing does, because the slides written have dropped out of the estimate.
        const moved: boolean =
          before === null ||
          stage !== before.stage ||
          (slide !== null && slideInfo?.n !== before.slide?.n);
        position = {
          stage,
          ...(slideInfo ? { slide: slideInfo } : {}),
          since: moved || before === null ? event.at : before.since,
        };
        break;
      }
      case "completed":
        position = { ...position, stage: "ready", since: event.at };
        break;
      case "failed":
      case "cancelled":
        return null;
    }
  }
  return position;
}

function stageForPercent(percent: number | undefined, current: Stage): Stage {
  if (percent === undefined) return current;
  if (percent >= 100) return "ready";
  if (percent >= 90) return "checking";
  if (percent >= 88) return "pictures";
  if (percent >= 85) return "worksheet";
  if (percent > 10) return "writing";
  return "planning";
}

// ---------------------------------------------------------------------------------------------
// Remaining time
// ---------------------------------------------------------------------------------------------

export interface EstimateRange {
  lowMs: number;
  highMs: number;
}

export interface EstimateOptions {
  /** Slides the brief asked for; used until the outline's "Slide n of N" gives the real total. */
  slides: number;
}

const STAGE_ORDER: readonly Stage[] = [
  "planning",
  "writing",
  "worksheet",
  "pictures",
  "checking",
  "ready",
];

/**
 * One stage's low and high in milliseconds for this run. Writing is the per-slide figure times
 * the slides still to come; the picture step is one placement (the count is not known ahead of the
 * run, and the stage is skipped entirely when no picture is placed); Checking is Reviewed to
 * Done, which includes Repair.
 */
function stageRange(
  stage: Stage,
  history: EstimateHistory,
  slidesToCome: number,
): EstimateRange | null {
  const stat = (key: StageKey) => stageStat(history, key);
  switch (stage) {
    case "planning":
      return { lowMs: stat("plan").p50, highMs: stat("plan").p80 };
    case "writing":
      return {
        lowMs: stat("generateSlide").p50 * slidesToCome,
        highMs: stat("generateSlide").p80 * slidesToCome,
      };
    case "worksheet":
      return { lowMs: stat("worksheet").p50, highMs: stat("worksheet").p80 };
    case "pictures":
      return { lowMs: stat("illustratePicture").p50, highMs: stat("illustratePicture").p80 };
    case "checking":
      return {
        lowMs: stat("evaluate").p50 + stat("repair").p50,
        highMs: stat("evaluate").p80 + stat("repair").p80,
      };
    case "ready":
      return null;
  }
}

function slidesToCome(position: StagePosition, planned: number): number {
  if (position.slide) return Math.max(0, position.slide.total - position.slide.n);
  return Math.max(0, planned);
}

/** Milliseconds spent in the current stage at `now`, never negative. */
function spentMs(position: StagePosition, now: number): number {
  return Math.max(0, now - Date.parse(position.since));
}

/**
 * The time left in the run as a range, or `null` when nothing honest can be said: fewer than
 * five runs of history, no run under way, or the run is over.
 */
export function estimateRemaining(
  history: EstimateHistory | null | undefined,
  events: readonly JobEvent[],
  now: number,
  options: EstimateOptions,
): EstimateRange | null {
  if (!history || history.runs < MIN_HISTORY_RUNS) return null;
  const position = stagePositionOf(events);
  if (position === null || position.stage === "ready") return null;

  const toCome = slidesToCome(position, options.slides);
  const spent = spentMs(position, now);
  let lowMs = 0;
  let highMs = 0;
  for (const stage of STAGE_ORDER.slice(STAGE_ORDER.indexOf(position.stage))) {
    const range = stageRange(stage, history, toCome);
    if (range === null) continue;
    if (stage === position.stage) {
      // The current stage contributes only what is left of it.
      lowMs += Math.max(0, range.lowMs - spent);
      highMs += Math.max(0, range.highMs - spent);
    } else {
      lowMs += range.lowMs;
      highMs += range.highMs;
    }
  }
  return { lowMs, highMs };
}

/**
 * The high bound of the unit of work under way: the stage's p80, or for Writing one slide's p80,
 * since each slide landing restarts the clock. `null` when there is no history or no run.
 */
export function currentStageHighMs(
  history: EstimateHistory | null | undefined,
  events: readonly JobEvent[],
): number | null {
  if (!history || history.runs < MIN_HISTORY_RUNS) return null;
  const position = stagePositionOf(events);
  if (position === null || position.stage === "ready") return null;
  return stageRange(position.stage, history, 1)?.highMs ?? null;
}

/** True once the time spent in the current stage has passed its high bound (PRD 4.5). */
export function stageOverdue(
  history: EstimateHistory | null | undefined,
  events: readonly JobEvent[],
  now: number,
): boolean {
  const high = currentStageHighMs(history, events);
  if (high === null) return false;
  const position = stagePositionOf(events);
  return position !== null && spentMs(position, now) > high;
}

/**
 * The range may only narrow while events keep coming (PRD 4.4): a later reading never raises
 * either bound above the earlier one. Used by the component between one event and the next.
 */
export function narrowRange(previous: EstimateRange | null, next: EstimateRange): EstimateRange {
  if (previous === null) return next;
  return {
    lowMs: Math.min(previous.lowMs, next.lowMs),
    highMs: Math.min(previous.highMs, next.highMs),
  };
}

// ---------------------------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------------------------

export const TAKING_LONGER_TEXT = "Taking longer than usual";

const MINUTE_MS = 60_000;

/**
 * The range in friendly units, rounded outwards: the low bound down to whole minutes, the high
 * bound up. "About 2 to 3 minutes left"; "Less than a minute left" when the high bound is under
 * a minute; "Less than 2 minutes left" when the low bound rounds to nothing; "About 1 minute
 * left" or "About 2 minutes left" when both bounds land on the same minute. Never seconds.
 * `null` under `MIN_SHOWN_MS` or with no range.
 */
export function estimateText(range: EstimateRange | null): string | null {
  if (range === null || range.highMs < MIN_SHOWN_MS) return null;
  if (range.highMs < MINUTE_MS) return "Less than a minute left";
  const low = Math.floor(range.lowMs / MINUTE_MS);
  const high = Math.ceil(range.highMs / MINUTE_MS);
  if (low >= high || high === 1) return `About ${high} ${high === 1 ? "minute" : "minutes"} left`;
  if (low < 1) return `Less than ${high} minutes left`;
  return `About ${low} to ${high} minutes left`;
}
