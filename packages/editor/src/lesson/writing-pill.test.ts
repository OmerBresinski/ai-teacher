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
  pillSlideIds,
  pillText,
  stepText,
  useWritingPill,
} from "./writing-pill";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `s${i + 1}`);
const look = (over: Partial<PillInput>): PillInput => ({
  active: true,
  done: false,
  writingId: undefined,
  slideIds: ids(11),
  ...over,
});
const w = (n: number) => ({ writingId: `s${n}` });
const run = (inputs: Partial<PillInput>[], from: PillState = PILL_START) =>
  inputs.reduce((s, i) => nextPill(s, look(i)), from);
const text = (s: PillState, slideIds = ids(11)) => pillText(s, slideIds);

describe("nextPill", () => {
  test("planning counts the slides as the plan arrives", () => {
    expect(pillText(run([{ slideIds: ids(2) }]), ids(2))).toBe("Planning the slides…");
    expect(pillText(run([{ slideIds: ids(5) }]), ids(5))).toBe("Planning slide 5…");
  });

  test("writing never goes back to planning between drafts (audit: back to Planning at slide 4)", () => {
    const s = run([w(4), { writingId: undefined }]);
    expect(s.phase).toBe("writing");
    expect(text(s)).toBe("Writing slide 4 of 11…");
  });

  test("the slide number never goes back (a late draft of an earlier slide)", () => {
    expect(text(run([w(5), w(3)]))).toBe("Writing slide 5 of 11…");
  });

  test("the number follows the slide when the teacher deletes or moves one before it", () => {
    const s = run([w(5)]);
    const deleted = ids(11).filter((id) => id !== "s2");
    expect(pillText(s, deleted)).toBe("Writing slide 4 of 10…");
    const moved = ["s5", ...ids(11).filter((id) => id !== "s5")];
    expect(pillText(s, moved)).toBe("Writing slide 1 of 11…");
    expect(
      pillText(
        s,
        ids(11).filter((id) => id !== "s5"),
      ),
    ).toBe("Writing the slides…");
  });

  test("finishing is final until the job ends; then gone; a new job starts over", () => {
    const finishing = run([w(10), { done: true }, { done: false, ...w(3) }]);
    expect(text(finishing)).toBe(FINISHING_TEXT);
    const gone = nextPill(finishing, look({ active: false }));
    expect(gone.phase).toBe("gone");
    expect(text(gone)).toBeNull();
    expect(nextPill(gone, look({ slideIds: ids(2) })).phase).toBe("planning");
  });

  test("nothing new returns the same state (no re-render)", () => {
    const s = run([w(5)]);
    expect(nextPill(s, look(w(5)))).toBe(s);
    expect(nextPill(s, look({ writingId: undefined }))).toBe(s);
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

describe("stepText", () => {
  test("a count moves one number at a time, never skipping a slide", () => {
    expect(stepText("Planning slide 8…", "Planning slide 10…")).toEqual({
      text: "Planning slide 9…",
      step: true,
    });
    expect(stepText("Writing slide 11 of 13…", "Writing slide 13 of 13…")).toEqual({
      text: "Writing slide 12 of 13…",
      step: true,
    });
    // One on: the ordinary dwell; a phase change goes straight to its text.
    expect(stepText("Writing slide 4 of 11…", "Writing slide 5 of 11…")).toEqual({
      text: "Writing slide 5 of 11…",
      step: false,
    });
    expect(stepText("Planning slide 13…", "Writing slide 3 of 13…").text).toBe(
      "Writing slide 3 of 13…",
    );
  });
});

describe("useWritingPill", () => {
  const setup = () => {
    const clock = manualClock();
    const r = renderHook((p: PillInput) => useWritingPill(p, clock), {
      initialProps: look({ slideIds: ids(2) }),
    });
    const tick = (ms: number) => act(() => clock.advance(ms));
    return { r, tick };
  };

  test("slide 1 then 3 within 53 ms shows only 3 (audit: 1 of 11 → 3 of 11)", () => {
    const { r, tick } = setup();
    expect(r.result.current.text).toBe("Planning the slides…");
    tick(PILL_PACE.dwellMs);
    r.rerender(look(w(1)));
    tick(53);
    r.rerender(look(w(3)));
    expect(r.result.current.text).toBe("Planning the slides…");
    tick(PILL_PACE.settleMs);
    expect(r.result.current.text).toBe("Writing slide 3 of 11…");
  });

  test("each text stays at least the dwell time", () => {
    const { r, tick } = setup();
    r.rerender(look(w(3)));
    tick(PILL_PACE.settleMs);
    // The first change waits for the planning text's dwell.
    tick(PILL_PACE.dwellMs);
    expect(r.result.current.text).toBe("Writing slide 3 of 11…");
    r.rerender(look(w(4)));
    tick(PILL_PACE.settleMs);
    expect(r.result.current.text).toBe("Writing slide 3 of 11…");
    tick(PILL_PACE.dwellMs);
    expect(r.result.current.text).toBe("Writing slide 4 of 11…");
  });

  test("the pill stays up between slides and fades out at the hand-over", () => {
    const { r, tick } = setup();
    r.rerender(look(w(5)));
    tick(PILL_PACE.dwellMs * 2);
    r.rerender(look({ writingId: undefined }));
    tick(PILL_PACE.dwellMs * 2);
    expect(r.result.current).toMatchObject({ text: "Writing slide 5 of 11…", visible: true });
    // A stop mid-writing: the pill goes at once (the stopped notice takes its place).
    r.rerender(look({ active: false }));
    expect(r.result.current).toMatchObject({ text: null, visible: false });
  });

  test("at the job's own end the finishing pill fades out, then unmounts", () => {
    const { r, tick } = setup();
    r.rerender(look({ done: true }));
    tick(PILL_PACE.dwellMs * 2);
    expect(r.result.current).toMatchObject({ text: FINISHING_TEXT, visible: true });
    r.rerender(look({ active: false }));
    expect(r.result.current).toMatchObject({ text: FINISHING_TEXT, visible: false });
    tick(PILL_PACE.fadeMs);
    expect(r.result.current.text).toBeNull();
  });

  test("the count shows every number on the way (Greg 26 Oct: 8 → 10, 11 → 13)", () => {
    const { r, tick } = setup();
    const seen: string[] = [];
    const note = () => {
      const t = r.result.current.text;
      if (t && seen[seen.length - 1] !== t) seen.push(t);
    };
    note();
    r.rerender(look({ slideIds: ids(5) }));
    note();
    r.rerender(look({ slideIds: ids(8) }));
    for (let i = 0; i < 20; i++) {
      tick(PILL_PACE.stepMs);
      note();
    }
    r.rerender(look({ slideIds: ids(8), ...w(3) }));
    note();
    for (let i = 0; i < 8; i++) {
      tick(PILL_PACE.dwellMs);
      note();
    }
    r.rerender(look({ slideIds: ids(8), ...w(6) }));
    note();
    for (let i = 0; i < 20; i++) {
      tick(PILL_PACE.stepMs);
      note();
    }
    expect(seen).toEqual([
      "Planning the slides…",
      "Planning slide 3…",
      "Planning slide 4…",
      "Planning slide 5…",
      "Planning slide 6…",
      "Planning slide 7…",
      "Planning slide 8…",
      "Writing slide 3 of 8…",
      "Writing slide 4 of 8…",
      "Writing slide 5 of 8…",
      "Writing slide 6 of 8…",
    ]);
  });
});

describe("Answers slides added during the fill (genux review J9, TEACH-247 part au)", () => {
  const content = ids(14).map((id) => ({ id }));
  const answers = ["g", "a1", "a2", "a3"].map((id) => ({
    id,
    answersRole: id === "g" ? "guard" : "answers",
  }));
  test("the pill counts only the lesson's own slides", () => {
    expect(pillSlideIds([...content, ...answers])).toEqual(ids(14));
    expect(pillSlideIds(undefined)).toEqual([]);
  });
  test("Writing slide 11 of 14 stays of 14 when four Answers slides land mid-writing", () => {
    const before = pillSlideIds(content);
    const after = pillSlideIds([...content, ...answers]);
    const s = nextPill(PILL_START, look({ ...w(11), slideIds: before }));
    expect(pillText(s, before)).toBe("Writing slide 11 of 14…");
    const t = nextPill(s, look({ ...w(11), slideIds: after }));
    expect(pillText(t, after)).toBe("Writing slide 11 of 14…");
  });
  test("the planning count does not jump by four when they land early", () => {
    const planned = [...content.slice(0, 6), ...answers];
    expect(pillText(PILL_START, pillSlideIds(planned))).toBe("Planning slide 6…");
  });
});
