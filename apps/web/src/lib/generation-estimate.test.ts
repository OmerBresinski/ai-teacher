import { describe, expect, test } from "bun:test";
import type { JobEvent } from "@tj/domain/jobs";
import {
  currentStageHighMs,
  estimateRemaining,
  estimateText,
  MIN_SHOWN_MS,
  narrowRange,
  stageOverdue,
  stagePositionOf,
} from "./generation-estimate";
import {
  ESTIMATE_HISTORY_FIXTURE as HISTORY,
  RUN_STEPS,
  runEvents,
  THIN_HISTORY_FIXTURE,
} from "./generation-estimate.fixture";

const T0 = Date.parse("2026-09-09T10:00:00.000Z");
const STEP_MS = 1_000;
/** The first `count` steps of the recorded run; the last lands at `T0 + count * STEP_MS`. */
const upTo = (count: number) => runEvents(T0, RUN_STEPS.slice(0, count), STEP_MS);
const landedAt = (count: number) => T0 + count * STEP_MS;
const SLIDE_6 = 9;
const SLIDES = { slides: 8 };

describe("stagePositionOf (temporary until TEACH-199's stageOf)", () => {
  test("follows the percent table and reads the slide count out of the message", () => {
    expect(stagePositionOf(upTo(0))).toEqual({ stage: "planning", since: iso(T0) });
    expect(stagePositionOf(upTo(3))?.stage).toBe("planning");
    expect(stagePositionOf(upTo(4))).toEqual({
      stage: "writing",
      slide: { n: 1, total: 8 },
      since: iso(landedAt(4)),
    });
    expect(stagePositionOf(upTo(12))?.stage).toBe("worksheet");
    expect(stagePositionOf(upTo(13))?.stage).toBe("pictures");
    expect(stagePositionOf(upTo(14))?.stage).toBe("checking");
    expect(stagePositionOf(upTo(15))?.stage).toBe("ready");
  });

  test("a message-only tick keeps the stage's clock; a slide landing restarts it", () => {
    const planning = upTo(2);
    expect(stagePositionOf(planning)?.since).toBe(iso(T0));
    const tick: JobEvent = {
      ...upTo(SLIDE_6)[SLIDE_6],
      at: iso(landedAt(SLIDE_6) + 400),
      progress: { message: "Still writing" },
    } as JobEvent;
    expect(stagePositionOf([...upTo(SLIDE_6), tick])?.since).toBe(iso(landedAt(SLIDE_6)));
    expect(stagePositionOf(upTo(SLIDE_6 + 1))?.since).toBe(iso(landedAt(SLIDE_6 + 1)));
  });

  test("nothing before the run starts, nothing after it fails or is cancelled", () => {
    expect(stagePositionOf([])).toBeNull();
    const failed = {
      type: "failed",
      jobId: upTo(0)[0]?.jobId ?? "",
      workspaceId: upTo(0)[0]?.workspaceId ?? "",
      at: iso(landedAt(5)),
      error: { code: "model_error", message: "The model stopped.", retryable: false },
    } as unknown as JobEvent;
    expect(stagePositionOf([...upTo(4), failed])).toBeNull();
  });
});

describe("estimateRemaining", () => {
  test("at Planning with eight slides planned it sums every stage (acceptance 1)", () => {
    const range = estimateRemaining(HISTORY, upTo(2), T0, SLIDES);
    expect(range).toEqual({ lowMs: 127_000, highMs: 172_000 });
    expect(estimateText(range)).toBe("About 2 to 3 minutes left");
    // Five seconds into Planning the text still rounds outwards to the same range.
    expect(estimateText(estimateRemaining(HISTORY, upTo(2), T0 + 5_000, SLIDES))).toBe(
      "About 2 to 3 minutes left",
    );
  });

  test("the current stage's share is its estimate less the time spent, floored at zero", () => {
    // Planning's p50 is 12 s and p80 16 s: at 14 s in, the low share is gone and 2 s of high remain.
    const range = estimateRemaining(HISTORY, upTo(2), T0 + 14_000, SLIDES);
    expect(range).toEqual({ lowMs: 127_000 - 12_000, highMs: 172_000 - 14_000 });
    const overrun = estimateRemaining(HISTORY, upTo(2), T0 + 60_000, SLIDES);
    expect(overrun).toEqual({ lowMs: 115_000, highMs: 156_000 });
  });

  test("Writing is multiplied by the slides still to come (acceptance 2)", () => {
    const range = estimateRemaining(HISTORY, upTo(SLIDE_6), landedAt(SLIDE_6), SLIDES);
    // Two slides to come, then the worksheet, one picture and Checking (evaluate + repair).
    expect(range).toEqual({
      lowMs: 20_000 + 12_000 + 5_000 + 18_000,
      highMs: 26_000 + 16_000 + 8_000 + 28_000,
    });
    expect(estimateText(range)).toBe("Less than 2 minutes left");
  });

  test("the outline's slide count takes over from the brief's", () => {
    const planned = estimateRemaining(HISTORY, upTo(3), landedAt(3), { slides: 3 });
    const outlined = estimateRemaining(HISTORY, upTo(4), landedAt(4), { slides: 3 });
    // Three planned (plus 9 s of Planning left), eight in the outline: seven to come after slide 1.
    expect(planned?.lowMs).toBe(9_000 + 30_000 + 12_000 + 5_000 + 18_000);
    expect(outlined?.lowMs).toBe(70_000 + 12_000 + 5_000 + 18_000);
  });

  test("both bounds fall as events land, reading each at its own moment (acceptance 2)", () => {
    let previous = estimateRemaining(HISTORY, upTo(2), landedAt(2), SLIDES);
    for (let count = 3; count <= 14; count++) {
      const next = estimateRemaining(HISTORY, upTo(count), landedAt(count), SLIDES);
      expect(next).not.toBeNull();
      if (previous && next) {
        expect(next.lowMs).toBeLessThanOrEqual(previous.lowMs);
        expect(next.highMs).toBeLessThanOrEqual(previous.highMs);
      }
      previous = next;
    }
  });

  test("nothing under five runs of history, nothing without a run, nothing once Ready", () => {
    expect(estimateRemaining(THIN_HISTORY_FIXTURE, upTo(2), T0, SLIDES)).toBeNull();
    expect(estimateRemaining(null, upTo(2), T0, SLIDES)).toBeNull();
    expect(estimateRemaining(HISTORY, [], T0, SLIDES)).toBeNull();
    expect(estimateRemaining(HISTORY, upTo(15), landedAt(15), SLIDES)).toBeNull();
  });

  test("at Checking ten seconds in, the text goes quiet under 20 seconds (acceptance 5)", () => {
    const fresh = estimateRemaining(HISTORY, upTo(14), landedAt(14), SLIDES);
    expect(fresh).toEqual({ lowMs: 18_000, highMs: 28_000 });
    expect(estimateText(fresh)).toBe("Less than a minute left");
    const later = estimateRemaining(HISTORY, upTo(14), landedAt(14) + 10_000, SLIDES);
    expect(later?.highMs).toBeLessThan(MIN_SHOWN_MS);
    expect(estimateText(later)).toBeNull();
  });
});

describe("stageOverdue", () => {
  test("flips once the time in the current stage passes its high bound (acceptance 3)", () => {
    const events = upTo(SLIDE_6);
    expect(currentStageHighMs(HISTORY, events)).toBe(13_000);
    expect(stageOverdue(HISTORY, events, landedAt(SLIDE_6) + 13_000)).toBe(false);
    expect(stageOverdue(HISTORY, events, landedAt(SLIDE_6) + 13_001)).toBe(true);
    // Planning's bound is the stage's own p80; Checking's is evaluate plus repair.
    expect(stageOverdue(HISTORY, upTo(2), T0 + 16_001)).toBe(true);
    expect(currentStageHighMs(HISTORY, upTo(14))).toBe(28_000);
  });

  test("never without history or a run", () => {
    expect(stageOverdue(THIN_HISTORY_FIXTURE, upTo(2), T0 + 60_000)).toBe(false);
    expect(stageOverdue(HISTORY, [], T0 + 60_000)).toBe(false);
    expect(stageOverdue(HISTORY, upTo(15), landedAt(15) + 60_000)).toBe(false);
  });
});

describe("narrowRange", () => {
  test("never raises a bound above the reading before it", () => {
    expect(narrowRange(null, { lowMs: 10, highMs: 20 })).toEqual({ lowMs: 10, highMs: 20 });
    expect(narrowRange({ lowMs: 10, highMs: 20 }, { lowMs: 12, highMs: 25 })).toEqual({
      lowMs: 10,
      highMs: 20,
    });
    expect(narrowRange({ lowMs: 10, highMs: 20 }, { lowMs: 5, highMs: 15 })).toEqual({
      lowMs: 5,
      highMs: 15,
    });
  });
});

describe("estimateText", () => {
  test("rounds outwards to whole minutes and never shows seconds", () => {
    expect(estimateText({ lowMs: 120_000, highMs: 180_000 })).toBe("About 2 to 3 minutes left");
    expect(estimateText({ lowMs: 119_000, highMs: 181_000 })).toBe("About 1 to 4 minutes left");
    expect(estimateText({ lowMs: 120_000, highMs: 120_000 })).toBe("About 2 minutes left");
    expect(estimateText({ lowMs: 30_000, highMs: 59_000 })).toBe("Less than a minute left");
    expect(estimateText({ lowMs: 30_000, highMs: 90_000 })).toBe("Less than 2 minutes left");
    expect(estimateText({ lowMs: 20_000, highMs: 20_000 })).toBe("Less than a minute left");
  });

  test("says nothing under 20 seconds or with no range", () => {
    expect(estimateText({ lowMs: 5_000, highMs: 19_999 })).toBeNull();
    expect(estimateText(null)).toBeNull();
  });
});

function iso(ms: number): string {
  return new Date(ms).toISOString();
}
