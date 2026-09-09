import type { JobEvent } from "@tj/domain/jobs";
import type { EstimateHistory } from "./generation-estimate";

/**
 * Stand-in for `GET /jobs/estimates?name=lesson.plan&slides=8` until Omer's endpoint lands
 * (TEACH-203). Milliseconds. With eight slides planned and nothing spent, the sum at Planning is
 * 127 s low and 172 s high: "About 2 to 3 minutes left". Used by the unit tests and the `/kit`
 * exhibit only; a real run with no endpoint shows no time.
 */
export const ESTIMATE_HISTORY_FIXTURE: EstimateHistory = {
  runs: 23,
  stages: {
    plan: { p50: 12_000, p80: 16_000 },
    generateSlide: { p50: 10_000, p80: 13_000 },
    worksheet: { p50: 12_000, p80: 16_000 },
    illustratePicture: { p50: 5_000, p80: 8_000 },
    evaluate: { p50: 12_000, p80: 18_000 },
    repair: { p50: 6_000, p80: 10_000 },
  },
};

/** Too few runs to say anything (PRD 4.6). */
export const THIN_HISTORY_FIXTURE: EstimateHistory = { ...ESTIMATE_HISTORY_FIXTURE, runs: 4 };

const JOB = {
  jobId: "01a06a15-1849-7000-ac6a-c07e27fe308b" as JobEvent["jobId"],
  workspaceId: "01a06a15-1849-7000-ac6a-c07e27fe308c" as JobEvent["workspaceId"],
};

/** A `started` event at `at`, followed by one progress event per `[percent, message]` step. */
export function runEvents(
  at: number,
  steps: readonly (readonly [number, string])[],
  stepMs = 1_000,
): JobEvent[] {
  const events: JobEvent[] = [{ type: "started", ...JOB, at: new Date(at).toISOString() }];
  steps.forEach(([percent, message], i) => {
    events.push({
      type: "progress",
      ...JOB,
      at: new Date(at + (i + 1) * stepMs).toISOString(),
      progress: { percent, message },
    });
  });
  return events;
}

/** The steps of a recorded eight-slide run, in the worker's order (PRD section 4). */
export const RUN_STEPS: readonly (readonly [number, string])[] = [
  [2, "Reading the brief"],
  [6, "Planning the lesson"],
  [10, "Planned"],
  [20, "Slide 1 of 8"],
  [29, "Slide 2 of 8"],
  [38, "Slide 3 of 8"],
  [46, "Slide 4 of 8"],
  [55, "Slide 5 of 8"],
  [63, "Slide 6 of 8"],
  [72, "Slide 7 of 8"],
  [80, "Slide 8 of 8"],
  [85, "Worksheet ready"],
  [88, "Pictures placed"],
  [90, "Reviewed"],
  [100, "Done"],
];
