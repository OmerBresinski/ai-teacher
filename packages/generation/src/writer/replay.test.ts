import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { type El, replayRun, savedSlides } from "./replay-fixture";

/*
 * Parity (TEACH-110 part e): the saved base4f-p123 writer outputs (lab/ab-base4f, runs
 * base4f-p123-1 and -2) run through the stage with the run's recorded repair, objective-repair
 * and notes answers and the lab replay's picture states, and must reproduce the lab's replayed
 * decks (runs base4f-p123s-1 and -2, keepPic e3e89767, unshared 5ad4ed59; DECISIONS.md D48c)
 * element for element. No model is called.
 *
 * Not compared:
 *  - element ids (random per layout); picture `source`, `style` and `period` stamps (TEACH-251);
 *  - a list marker's numeral size (part a lays badges at master's sizes; boxes are unchanged);
 *  - speaker notes: the lab replay's notes call failed on every lesson, the stage replays the
 *    original run's notes.
 *
 * Photos in ranged (multi-picture) slots keep their own shape inside the run's box (TEACH-237).
 *
 * One documented difference: r2 y1 slide 6 "Find the pairs". The lab replay kept a split of 5 of
 * its 8 single pictures (splitOk), replacing the matching table the original run shipped. splitOk
 * is not ported: a split ships only when every picture lands, so the slide is the reroute's
 * adults / young word table, as the original run shipped it.
 */

const DIR = join(import.meta.dir, "fixtures/replay");
const LESSONS = readdirSync(DIR).sort();
const stable = (e: El) => {
  const { id: _i, source: _s, style: _t, period: _p, ...rest } = e;
  // A list marker's numeral is laid at master's badge sizes (TEACH-110 part a), not the lab's.
  if (rest.name === "Marker" && rest.textStyle) {
    const { fontSize: _f, ...ts } = rest.textStyle as El;
    return { ...rest, textStyle: ts };
  }
  return rest;
};

/**
 * TEACH-237: a photo in a ranged slot (compare, picture-sequence, tiles) takes its own shape inside
 * the run's box instead of being cropped to it, so its box may be smaller and its crop gone. Every
 * other field is still the run's.
 */
function expectRangedPhoto(got: El, want: El, at: string) {
  const { x, y, w, h, crop: _c, ...rest } = stable(got);
  const { x: wx, y: wy, w: ww, h: wh, crop: _wc, ...wantRest } = stable(want);
  expect({ at, el: rest }).toEqual({ at, el: wantRest });
  const inside =
    Number(x) >= Number(wx) - 1 &&
    Number(y) >= Number(wy) - 1 &&
    Number(x) + Number(w) <= Number(wx) + Number(ww) + 1 &&
    Number(y) + Number(h) <= Number(wy) + Number(wh) + 1;
  expect({ at, inside }).toEqual({ at, inside: true });
}

describe.each(LESSONS)("replay %s", (b) => {
  test("the stage reproduces the lab's replayed slides", async () => {
    const out = await replayRun(b);
    const saved = savedSlides(b);
    expect(out.slides.length).toBe(saved.length);
    out.slides.forEach((s, i) => {
      const want = saved[i] as El & { elements: El[] };
      const got = s.elements as unknown as El[];
      if (b === "y1-science-animals-young-r2" && i === 5) {
        // the matching table, never a partial split of single photos
        expect(got.some((e) => e.type === "image" && e.name === "Diagram")).toBe(true);
        expect(got.filter((e) => e.type === "image" && e.name === "Photo")).toHaveLength(0);
        return;
      }
      expect({ i, kind: s.kind, background: s.background }).toEqual({
        i,
        kind: want.kind as never,
        background: want.background as never,
      });
      expect({ i, n: got.length }).toEqual({ i, n: want.elements.length });
      // Ranged slots are the multi-picture ones; title, picture-text and big-picture hold one photo.
      const ranged =
        want.elements.filter((e) => e.type === "image" && e.name === "Photo").length > 1;
      for (const [k, el] of got.entries()) {
        const w = want.elements[k] as El;
        // Every writer element is the AI's (WRITER-CONTRACT §5); the lab's elements predate it.
        expect({ at: `s${i + 1} #${k}`, by: el.authoredBy }).toEqual({
          at: `s${i + 1} #${k}`,
          by: "ai",
        });
        const { authoredBy: _by, ...e } = el;
        if (ranged && w.type === "image" && w.name === "Photo") {
          expectRangedPhoto(e, w, `s${i + 1} #${k}`);
          continue;
        }
        expect({ at: `s${i + 1} #${k}`, el: stable(e) }).toEqual({
          at: `s${i + 1} #${k}`,
          el: stable(w),
        });
      }
    });
  });
});
