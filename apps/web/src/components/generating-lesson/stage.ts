import type { JobEvent, JobProgress } from "@tj/domain/jobs";

/**
 * The four stages a teacher sees while a lesson is generated (generating-state PRD §3), in the
 * order the strip shows them. The pipeline's own stages (plan → generate → illustrate → evaluate
 * → repair, ADR 0025) fold into these: the worksheet and, since TEACH-220, the pictures are
 * placed inside "Writing the slides and pictures" (the photograph is chosen before its slide's
 * text and lands with it; the illustrate step only fills a slot a resumed run left empty), and
 * Repair is part of "Checking".
 */
export const STAGES = [
  { id: "planning", label: "Planning" },
  { id: "writing", label: "Writing the slides and pictures" },
  { id: "checking", label: "Checking" },
  { id: "ready", label: "Ready" },
] as const;

export type StageId = (typeof STAGES)[number]["id"];

export type StageStatus = "done" | "live" | "todo";

export interface StageState {
  stage: StageId;
  /** "Slide n of N" while Generate writes the content slides. */
  slide: { n: number; total: number } | null;
  /** The worksheet call at the end of Writing (`85 "Worksheet ready"`), still inside Writing. */
  worksheet: boolean;
  /** The last progress message, for the stopped states. */
  message: string | undefined;
  terminal: "completed" | "failed" | "cancelled" | null;
  /** The worker's fixed text on a `failed` event. */
  failure: string | undefined;
}

const ORDER: readonly StageId[] = STAGES.map((s) => s.id);

/** The pipeline's own stage names, as `progress.stage` will carry them (PRD §8). */
export type PipelineStage = "plan" | "generate" | "illustrate" | "evaluate" | "repair";

/**
 * The worker's `progress.stage`, once it exists (PRD §8); read here so nothing else has to. Dead
 * until `JobProgressSchema` gains the field and `lesson-plan.ts`'s `onProgress` sets it: the
 * schema is strict, so today no event can carry it.
 */
const PIPELINE_STAGES: Record<PipelineStage, StageId> = {
  plan: "planning",
  generate: "writing",
  illustrate: "writing",
  evaluate: "checking",
  repair: "checking",
};

const SLIDE_COUNT = /^Slide (\d+) of (\d+)$/;

/**
 * Which stage a run is in, from its events alone (PRD §4). `percent` today: 2, 6 and 10 are
 * Planning; over 10 up to 88 is Writing (85 is the worksheet and 88 a picture the illustrate step
 * placed on resume, both still Writing); 90 is Checking; 100 is Ready. A
 * `progress.stage` field wins over the percent when the worker sends one. Stages never go
 * backwards: a late event with a lower percent (the worker coalesces at 250ms) cannot undo a
 * stage already reached.
 */
export function stageOf(events: readonly JobEvent[]): StageState {
  let stage: StageId = "planning";
  let slide: StageState["slide"] = null;
  let worksheet = false;
  let message: string | undefined;
  let terminal: StageState["terminal"] = null;
  let failure: string | undefined;

  for (const event of events) {
    if (event.type === "completed") {
      terminal = "completed";
      stage = "ready";
      continue;
    }
    if (event.type === "failed") {
      terminal = "failed";
      failure = event.error.message;
      continue;
    }
    if (event.type === "cancelled") {
      terminal = "cancelled";
      continue;
    }
    if (event.type !== "progress") continue;
    const { progress } = event;
    if (progress.message !== undefined) message = progress.message;
    const next = stageFromProgress(progress);
    if (next !== null && ORDER.indexOf(next) > ORDER.indexOf(stage)) stage = next;
    const count = progress.message?.match(SLIDE_COUNT);
    if (count && stage === "writing") {
      slide = { n: Number(count[1]), total: Number(count[2]) };
    }
    // The worksheet is a message fact, not a percent fact: 85 is emitted with "Slides ready" too,
    // when the lesson already had a sheet or the budget stopped before it.
    if (stage === "writing" && progress.message === "Worksheet ready") worksheet = true;
    // A picture the illustrate step placed on resume (88) comes after the slides and the worksheet:
    // the plain Writing line, with neither the count nor the worksheet.
    if (stage === "writing" && progress.message === "Pictures placed") {
      worksheet = false;
      slide = null;
    }
    if (stage !== "writing") {
      slide = null;
      worksheet = false;
    }
  }

  return { stage, slide, worksheet, message, terminal, failure };
}

function stageFromProgress(progress: JobProgress & { stage?: PipelineStage }): StageId | null {
  if (progress.stage !== undefined) return PIPELINE_STAGES[progress.stage] ?? null;
  const percent = progress.percent;
  if (percent === undefined) return null;
  if (percent >= 100) return "ready";
  if (percent >= 90) return "checking";
  if (percent > 10) return "writing";
  return "planning";
}

/** Ticked, live or still to come, for one strip item. */
export function stageStatus(id: StageId, state: StageState): StageStatus {
  if (state.terminal === "completed") return "done";
  const current = ORDER.indexOf(state.stage);
  const own = ORDER.indexOf(id);
  if (own < current) return "done";
  if (own === current) return "live";
  return "todo";
}

/**
 * What the polite live region says (PRD §3): the stage line, but changing only at a stage
 * boundary and every fourth slide, so a twenty-slide lesson is five announcements, not twenty.
 * Pure over the state: between fourth slides the line is the last one announced.
 */
export function announcedLine(state: StageState): string {
  if (state.stage !== "writing" || state.worksheet || !state.slide) return stageLine(state);
  const announced = Math.floor(state.slide.n / 4) * 4;
  if (announced === 0) return "Writing the slides and pictures";
  return stageLine({ ...state, slide: { ...state.slide, n: announced } });
}

/** The one line in the top bar (PRD §3): the stage, with the count while there is one. */
export function stageLine(state: StageState): string {
  switch (state.stage) {
    case "planning":
      return "Planning";
    case "writing":
      if (state.worksheet) return "Writing the worksheet";
      return state.slide
        ? `Writing the slides and pictures, ${state.slide.n} of ${state.slide.total}`
        : "Writing the slides and pictures";
    case "checking":
      return "Checking";
    case "ready":
      return "Ready to edit";
  }
}
