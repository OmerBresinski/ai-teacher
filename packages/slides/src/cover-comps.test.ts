import { describe, expect, test } from "bun:test";
import type { TextElement } from "@tj/domain/documents";
import { layoutSlide } from "./layouts";
import { applyLook } from "./look";
import { atKeyStage, getTheme, MIN_FONT_SIZE } from "./themes";

const run = (text: string) => ({ type: "text", text });
const doc = (...runs: object[]) => ({
  type: "doc",
  content: [{ type: "paragraph", content: runs }],
});

// The writer's title cap is 8 words (heading) and 12 (lead); the lines below are past it.
const LONG_TITLE = "Why did the industrial revolution transform everyday working lives?";
const LONG_LEAD =
  "What changed for families when factories, railways and new machines arrived in towns?";

function cover(stage: "ks1" | "ks2" | "ks3", title: string, lead: string) {
  const theme = atKeyStage(getTheme("geometric"), stage);
  const l = layoutSlide("title", "geometric", "split");
  const els = l.elements.map((e) => {
    if (e.type === "image") return { ...e, src: "/x.jpg" };
    if (e.type !== "text") return e;
    if (e.style.preset === "caption") return { ...e, doc: doc(run("HISTORY · YEAR 9")) };
    if (e.style.preset === "title") return { ...e, doc: doc(run(title)) };
    return { ...e, doc: doc(run(lead)) };
  });
  return applyLook({ id: "c", kind: "title", elements: els, background: {} } as never, theme);
}

describe("geometric hexagon cover column (round 5 cover)", () => {
  for (const stage of ["ks1", "ks2", "ks3"] as const)
    for (const [title, lead] of <[string, string][]>[
      ["How do volcanoes erupt?", "What happens under the ground before lava reaches the surface?"],
      [LONG_TITLE, LONG_LEAD],
    ])
      test(`${stage}: "${title.slice(0, 20)}": the question is the small step, under the title, inside the slide`, () => {
        const s = cover(stage, title, lead);
        const texts = s.elements.filter((e): e is TextElement => e.type === "text");
        const t = texts.find((e) => e.style.preset === "title")!;
        const q = texts.find((e) => e.style.preset === "small" && e.y > t.y)!;
        expect(q).toBeTruthy();
        expect(q.style.fontSize!).toBeLessThanOrEqual(getTheme("geometric").sizes.small);
        expect(q.style.fontSize!).toBeGreaterThanOrEqual(MIN_FONT_SIZE.small);
        expect(q.y).toBeGreaterThanOrEqual(t.y + t.h);
        expect(q.y + q.h).toBeLessThanOrEqual(540 - 43);
        // Beside the hexagon, never under it.
        expect(q.x + q.w).toBeLessThanOrEqual(507);
        expect(t.x + t.w).toBeLessThanOrEqual(507);
      });
});
