import { describe, expect, test } from "bun:test";
import { createProgressiveDeck } from "./progressive";
import { dropUnwrittenBlanks, patchKept, plannedSlide } from "./write";

/*
 * TEACH-202 part o: at the writer's stream end only true planned blanks leave the deck, a slide
 * with any streamed content never does, a dropped slide never comes back, and a resumed run
 * (off screen) changes nothing.
 */

type S = { id: string; elements: { name?: string }[] };
const content = (id: string): S => ({ id, elements: [{ name: "Heading" }] });
const blank = (id: string) => plannedSlide(id, "Practise halves") as unknown as S;

function deck() {
  const d = createProgressiveDeck<S>({ write: async () => {}, onError: () => {} });
  d.patch(0, content("s1"), "done");
  d.patch(2, content("s3"), "done");
  d.patch(3, content("s4"), "writing");
  d.patch(4, blank("s5"), "writing");
  d.patch(5, content("s6"), "writing");
  return d;
}

describe("unwritten blanks at the stream's end", () => {
  test("a planned blank outside the final deck is dropped; content never is", () => {
    const d = deck();
    const dropped = new Set<number>();
    // The final deck holds 0, 2 and 3; slide 6 (index 5) streamed a draft but is not in it.
    const latest = new Map<number, unknown>([
      [0, {}],
      [2, {}],
      [3, {}],
    ]);
    const out = dropUnwrittenBlanks(d, {
      offScreen: false,
      latest,
      kept: new Set([0, 1, 2, 3]),
      dropped,
    });
    expect(out).toEqual([4]);
    expect([...d.patches().keys()]).toEqual([0, 2, 3, 5]);
    expect(d.patches().get(5)?.slide.id).toBe("s6");
  });

  test("a dropped slide is not patched back in", () => {
    const d = deck();
    const dropped = new Set<number>();
    dropUnwrittenBlanks(d, { offScreen: false, latest: new Map(), kept: new Set(), dropped });
    patchKept(d, dropped, 4, blank("s5"), "writing");
    patchKept(d, dropped, 6, content("s7"), "writing");
    expect(d.patches().has(4)).toBe(false);
    expect(d.patches().has(6)).toBe(true);
  });

  test("a resumed run (off screen) drops nothing", () => {
    const d = deck();
    const dropped = new Set<number>();
    const out = dropUnwrittenBlanks(d, {
      offScreen: true,
      latest: new Map(),
      kept: new Set(),
      dropped,
    });
    expect(out).toEqual([]);
    expect(dropped.size).toBe(0);
    expect([...d.patches().keys()]).toEqual([0, 2, 3, 4, 5]);
  });
});
