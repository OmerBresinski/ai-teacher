/**
 * The writing pill's state machine (jank audit #7, 26 Oct): planning → writing N of M → finishing
 * → gone, never backwards, and the shown text settled and held so it never flaps.
 */
import { describe, expect, test } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import {
  FINISHING_TEXT,
  nextPill,
  PILL_PACE,
  PILL_START,
  type PillInput,
  type PillState,
  pillText,
  useWritingPill,
} from "./writing-pill";

const look = (over: Partial<PillInput>): PillInput => ({
  active: true,
  done: false,
  writingIndex: -1,
  slideCount: 11,
  ...over,
});
const run = (inputs: Partial<PillInput>[], from: PillState = PILL_START) =>
  inputs.reduce((s, i) => nextPill(s, look(i)), from);

describe("nextPill", () => {
  test("planning counts the slides as the plan arrives", () => {
    expect(pillText(run([{ slideCount: 2 }]))).toBe("Planning the slides…");
    expect(pillText(run([{ slideCount: 2 }, { slideCount: 5 }]))).toBe("Planning slide 5…");
  });

  test("writing never goes back to planning between drafts (audit: back to Planning at slide 4)", () => {
    const s = run([{ writingIndex: 3 }, { writingIndex: -1 }]);
    expect(s.phase).toBe("writing");
    expect(pillText(s)).toBe("Writing slide 4 of 11…");
  });

  test("the slide number never goes back (a late draft of an earlier slide)", () => {
    const s = run([{ writingIndex: 4 }, { writingIndex: 2 }]);
    expect(pillText(s)).toBe("Writing slide 5 of 11…");
  });

  test("the count never shrinks, and grows with a slide the job adds", () => {
    expect(run([{ writingIndex: 4 }, { writingIndex: 5, slideCount: 10 }]).of).toBe(11);
    expect(run([{ writingIndex: 4 }, { writingIndex: 5, slideCount: 13 }]).of).toBe(13);
  });

  test("finishing is final until the job ends; then gone; a new job starts over", () => {
    const finishing = run([{ writingIndex: 9 }, { done: true }, { done: false, writingIndex: 3 }]);
    expect(pillText(finishing)).toBe(FINISHING_TEXT);
    const gone = nextPill(finishing, look({ active: false }));
    expect(gone.phase).toBe("gone");
    expect(pillText(gone)).toBeNull();
    expect(nextPill(gone, look({ slideCount: 2 })).phase).toBe("planning");
  });

  test("nothing new returns the same state (no re-render)", () => {
    const s = run([{ writingIndex: 4 }]);
    expect(nextPill(s, look({ writingIndex: 4 }))).toBe(s);
    expect(nextPill(s, look({ writingIndex: -1 }))).toBe(s);
  });
});

/** A clock moved by hand. */
function manualClock() {
  let at = 0;
  const due: { at: number; fn: () => void; live: boolean }[] = [];
  return {
    now: () => at,
    timer: (fn: () => void, ms: number) => {
      const t = { at: at + ms, fn, live: true };
      due.push(t);
      return () => {
        t.live = false;
      };
    },
    advance(ms: number) {
      const end = at + ms;
      for (;;) {
        const next = due.filter((t) => t.live && t.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!next) break;
        next.live = false;
        at = next.at;
        next.fn();
      }
      at = end;
    },
  };
}

describe("useWritingPill", () => {
  const setup = () => {
    const clock = manualClock();
    const r = renderHook((p: PillInput) => useWritingPill(p, clock), {
      initialProps: look({ slideCount: 2 }),
    });
    const tick = (ms: number) => act(() => clock.advance(ms));
    return { r, tick };
  };

  test("slide 1 then 3 within 53 ms shows only 3 (audit: 1 of 11 → 3 of 11)", () => {
    const { r, tick } = setup();
    expect(r.result.current.text).toBe("Planning the slides…");
    tick(PILL_PACE.dwellMs);
    r.rerender(look({ writingIndex: 0 }));
    tick(53);
    r.rerender(look({ writingIndex: 2 }));
    expect(r.result.current.text).toBe("Planning the slides…");
    tick(PILL_PACE.settleMs);
    expect(r.result.current.text).toBe("Writing slide 3 of 11…");
  });

  test("each text stays at least the dwell time", () => {
    const { r, tick } = setup();
    r.rerender(look({ writingIndex: 2 }));
    tick(PILL_PACE.settleMs);
    // The first change waits for the planning text's dwell.
    tick(PILL_PACE.dwellMs);
    expect(r.result.current.text).toBe("Writing slide 3 of 11…");
    r.rerender(look({ writingIndex: 3 }));
    tick(PILL_PACE.settleMs);
    expect(r.result.current.text).toBe("Writing slide 3 of 11…");
    tick(PILL_PACE.dwellMs);
    expect(r.result.current.text).toBe("Writing slide 4 of 11…");
  });

  test("the pill stays up between slides and fades out at the hand-over", () => {
    const { r, tick } = setup();
    r.rerender(look({ writingIndex: 4 }));
    tick(PILL_PACE.dwellMs * 2);
    r.rerender(look({ writingIndex: -1 }));
    tick(PILL_PACE.dwellMs * 2);
    expect(r.result.current).toMatchObject({ text: "Writing slide 5 of 11…", visible: true });
    r.rerender(look({ active: false }));
    expect(r.result.current).toMatchObject({ text: "Writing slide 5 of 11…", visible: false });
    tick(PILL_PACE.fadeMs);
    expect(r.result.current.text).toBeNull();
  });
});
