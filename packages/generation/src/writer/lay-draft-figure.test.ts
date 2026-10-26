import { describe, expect, test } from "bun:test";
import { replayRun } from "./replay-fixture";

/*
 * The figure slide's picture box settles before its caption types (Greg 26 Oct, TEACH-202 part u).
 * Recorded genlab run (y1 plants): "Four plant parts" streams heading, caption, icon, then its
 * model. Its drafts were laid as a heading and a lead (no picture), then a big picture with a
 * centred caption, then the icon plate, and the closed slide as the figure: the picture grew and
 * moved, and the caption jumped from centre to left while it typed. Every draft now has the closed
 * slide's picture box from the first word, and the caption types where it will stay.
 */

type El = {
  id: string;
  type: string;
  name?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  children?: El[];
};
const flat = (els: El[]): El[] => els.flatMap((e) => [e, ...flat(e.children ?? [])]);
const geo = (e: El | undefined) => (e ? [e.x, e.y, e.w, e.h].map(Math.round).join(",") : "none");

describe("figure slide drafts", () => {
  test("the picture box and the caption keep the closed slide's place from the first draft", async () => {
    const drafts: El[][] = [];
    let closed: El[] | undefined;
    const FIGURE = 3; // slide 4, "Four plant parts"
    await replayRun("../drafts/y1-plants-figure", {
      visual: () => ({ status: "pending" }) as never,
      stream: (t) =>
        Array.from({ length: Math.ceil(t.length / 9) }, (_, i) => t.slice(i * 9, i * 9 + 9)),
      hooks: {
        draft: { ms: 0 },
        onDraftSlide: (i: number, s: { elements: El[] }) => {
          if (i === FIGURE) drafts.push(flat(s.elements));
        },
        onSlide: (i: number, s: { elements: El[] }) => {
          if (i === FIGURE) closed = flat(s.elements);
        },
      } as never,
    });
    expect(drafts.length).toBeGreaterThan(5);
    const photo = (els: El[]) => els.find((e) => e.name === "Photo" || e.type === "image");
    const caption = (els: El[]) => els.find((e) => e.name === "Caption");
    const final = geo(photo(closed ?? []));
    expect(final).not.toBe("none");
    for (const d of drafts) {
      expect(geo(photo(d))).toBe(final);
      // No stand-in plate while the model is on its way, and no lead laid in the caption's place.
      expect(d.some((e) => e.name === "Figure plate" || e.name === "Lead")).toBe(false);
      const c = caption(d);
      if (c) expect(geo(c)).toBe(geo(caption(closed ?? [])));
    }
  });
});
