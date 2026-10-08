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
 *    where the run had 14 to 20), which moves each marker's box and its item's x and width by a
 *    few points. Those slides are compared on everything but marker and item geometry;
 *  - a run whose notes call was refused by its budget (y1) has empty notes here too.
 */

const SKIP: Record<string, number[]> = {};
/** The marker badge and the text laid against it (items, options, a question set's instruction). */
const BADGE_ALIGNED = new Set(["Marker", "Item", "Option text", "Instruction", "Rule"]);
const plain = (d: unknown): string => {
  const n = d as { text?: string; content?: unknown[] } | undefined;
  return n?.text ?? (n?.content ?? []).map(plain).join(" ");
};
const stable = (e: El, loose: boolean) => {
  const { id: _i, source: _s, style: _t, period: _p, ...rest } = e;
  if (!loose || !BADGE_ALIGNED.has(String(e.name))) return rest;
  const { x: _x, y: _y, w: _w, h: _h, textStyle: _ts, ...words } = rest;
  return words;
};

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
      const loose = got.some((e) => e.name === "Marker");
      expect({ i, kind: s.kind, background: s.background }).toEqual({
        i,
        kind: want.kind as never,
        background: want.background as never,
      });
      expect({ i, elements: got.map((e) => stable(e, loose)) }).toEqual({
        i,
        elements: want.elements.map((e) => stable(e, loose)),
      });
    });
  });
});
