import { describe, expect, test } from "bun:test";
import { type El, replayRun, savedSlides } from "./replay-fixture";

/*
 * Replay (TEACH-110 part b): a saved writer output from the pinned evidence runs through the
 * ported stage, with the run's recorded repair and notes answers and its recorded pictures and
 * drawings, and must reproduce that run's saved slides. No model is called.
 *
 * Documented differences:
 *  - element ids (random per layout); picture `source`, `style` and `period` stamps (TEACH-251);
 *  - list-marker badges: part a lays the numeral badge at master's sizes (25 at KS2, 21 at KS3
 *    where the run had 14 to 20), which moves each marker's box and the text set against it
 *    (items, options, an instruction, rules). Those elements are compared exactly except their
 *    box, within 8 pt (y1 slide 6's instruction: 40 pt), and the badge's own font size;
 *  - a run whose notes call was refused by its budget (y1) has empty notes here too.
 */

const SKIP: Record<string, number[]> = {};
/** The marker badge and the text laid against it (items, options, a question set's instruction). */
const BADGE_ALIGNED = new Set(["Marker", "Item", "Option text", "Instruction", "Rule"]);
const plain = (d: unknown): string => {
  const n = d as { text?: string; content?: unknown[] } | undefined;
  return n?.text ?? (n?.content ?? []).map(plain).join(" ");
};
/** How far a badge-aligned element may sit from the run's, in points, by default. */
const TOLERANCE = 8;
/** Documented larger moves: a question set's instruction under part a's bigger KS1 badges. */
const WIDER: Record<string, Record<number, number>> = { "y1-science-animals-young": { 5: 40 } };
const stable = (e: El) => {
  const { id: _i, source: _s, style: _t, period: _p, ...rest } = e;
  return rest;
};
/** An element compared exactly, except a badge-aligned one's box (within `tol`) and badge size. */
function expectSame(got: El, want: El, tol: number, at: string) {
  const g = stable(got);
  const w = stable(want);
  if (!BADGE_ALIGNED.has(String(w.name))) {
    expect({ at, el: g }).toEqual({ at, el: w });
    return;
  }
  for (const k of ["x", "y", "w", "h"]) {
    const d = Math.abs(Number(g[k]) - Number(w[k]));
    expect({ at, k, within: d <= tol }).toEqual({ at, k, within: true });
  }
  const style = (x: El) => {
    const { fontSize: _f, ...s } = (x.textStyle ?? {}) as El;
    return s;
  };
  const { x: _x, y: _y, w: _w, h: _h, textStyle: _ts, ...words } = g;
  const { x: _x2, y: _y2, w: _w2, h: _h2, textStyle: _ts2, ...wantWords } = w;
  expect({ at, el: words, style: style(g) }).toEqual({ at, el: wantWords, style: style(w) });
  if (w.name !== "Marker")
    expect({ at, fontSize: (g.textStyle as El | undefined)?.fontSize }).toEqual({
      at,
      fontSize: (w.textStyle as El | undefined)?.fontSize,
    });
}

describe.each([
  "y1-science-animals-young",
  "y2-maths-halves-quarters",
  "y5-maths-fractions-of-amounts",
  "y8-french-my-family",
  "y11-chemistry-rates-of-reaction",
  "y12-psychology-multi-store-model",
])("replay %s", (b) => {
  test("the stage reproduces the saved slides", async () => {
    const out = await replayRun(b);
    const saved = savedSlides(b);
    expect(out.slides.length).toBe(saved.length);
    out.slides.forEach((s, i) => {
      const want = saved[i] as El & { elements: El[]; notes?: string };
      const got = s.elements as unknown as El[];
      expect({ i, notes: s.notes }).toEqual({ i, notes: want.notes ?? "" });
      if (SKIP[b]?.includes(i)) {
        // The words are the run's, minus the picture.
        const words = (els: El[]) => els.filter((e) => e.type === "text").map((e) => plain(e.doc));
        expect({ i, words: words(got) }).toEqual({ i, words: words(want.elements) });
        return;
      }
      expect({ i, kind: s.kind, background: s.background }).toEqual({
        i,
        kind: want.kind as never,
        background: want.background as never,
      });
      expect({ i, n: got.length }).toEqual({ i, n: want.elements.length });
      const tol = WIDER[b]?.[i] ?? TOLERANCE;
      for (const [k, e] of got.entries())
        expectSame(e, want.elements[k] as El, tol, `s${i + 1} #${k}`);
    });
  });
});
