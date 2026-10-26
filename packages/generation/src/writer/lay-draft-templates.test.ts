import { expect, test } from "bun:test";
import { PLANNED_VISUAL_BOX } from "../stages/write";
import { replayRun } from "./replay-fixture";

/*
 * Beyond the figure (lay-draft-figure.test.ts): on the same recorded y1 plants run, the title
 * slide and every visual-text slide keep each picture box from their first draft to the closed
 * slide, and the planned outline's visual box is the box those layouts lay (judge 638: the box
 * jumped size and place at the outline-to-slide swap).
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
const box = (e: El) => [e.x, e.y, e.w, e.h].map(Math.round).join(",");

async function run() {
  const drafts = new Map<number, El[][]>();
  const closed = new Map<number, El[]>();
  await replayRun("../drafts/y1-plants-figure", {
    visual: () => ({ status: "pending" }) as never,
    stream: (t: string) =>
      Array.from({ length: Math.ceil(t.length / 9) }, (_, i) => t.slice(i * 9, i * 9 + 9)),
    hooks: {
      draft: { ms: 0 },
      onDraftSlide: (i: number, s: { elements: El[] }) => {
        drafts.set(i, [...(drafts.get(i) ?? []), flat(s.elements)]);
      },
      onSlide: (i: number, s: { elements: El[] }) => {
        closed.set(i, flat(s.elements));
      },
    } as never,
  });
  return { drafts, closed };
}

const got = run();

// Title (slide 1) and visual-text (slides 3, 5, 6, 11).
for (const index of [0, 2, 4, 5, 10])
  test(`slide ${index + 1}: every picture box in every draft is the closed slide's box`, async () => {
    const { drafts, closed } = await got;
    const end = new Map((closed.get(index) ?? []).map((e) => [e.id, box(e)]));
    const pics = (drafts.get(index) ?? []).flatMap((d) => d.filter((e) => e.type === "image"));
    expect(pics.length).toBeGreaterThan(0);
    for (const p of pics) expect(box(p)).toBe(end.get(p.id) ?? box(p));
  });

test("the planned outline's visual box is where visual-text and figure lay their picture", async () => {
  const { closed } = await got;
  const pic = (i: number) => {
    const p = (closed.get(i) ?? []).find((e) => e.type === "image");
    return p && { x: Math.round(p.x), y: Math.round(p.y), w: Math.round(p.w), h: Math.round(p.h) };
  };
  expect(pic(2)).toEqual(PLANNED_VISUAL_BOX["visual-text"]);
  expect(pic(3)).toEqual(PLANNED_VISUAL_BOX["figure-slide"]);
});

test("an outline's visual box comes from its flow layout, or is left out", async () => {
  const { plannedVisualBox } = await import("../stages/write");
  expect(plannedVisualBox("discussion fig")).toEqual(PLANNED_VISUAL_BOX["visual-text"]);
  expect(plannedVisualBox("visual-text points-0-fig")).toEqual(PLANNED_VISUAL_BOX["visual-text"]);
  expect(plannedVisualBox("figure-slide")).toEqual(PLANNED_VISUAL_BOX["figure-slide"]);
  expect(plannedVisualBox("panel-list")).toBeUndefined();
  expect(plannedVisualBox("practice")).toBeUndefined();
});
