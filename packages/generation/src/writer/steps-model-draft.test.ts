import { describe, expect, test } from "bun:test";
import { THEMES } from "@tj/slides";
import { layoutTemplate, type TemplateInput } from "@tj/slides/templates";
import { stableDraftIds } from "./lay-draft";

/*
 * TEACH-75 part af (C8): a step with its model streams in without anything vanishing. Each draft's
 * element keeps its id from the first word to the saved slide, so the renderer updates the same box.
 */
const svg = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" class="slide tk theme-primary" viewBox="0 0 990 450"><g><rect width="90" height="90"/><text x="9" y="40">Sand</text></g></svg>',
)}`;
const base: TemplateInput = {
  template: "steps",
  heading: "Filter",
  figure: { drawn: { src: svg, aspect: 2.2, bare: true } },
};
const DRAFTS: TemplateInput["step"][] = [
  { n: 2, do: "Pour" },
  { n: 2, do: "Pour the mixture through" },
  { n: 2, do: "Pour the mixture through filter paper.", see: "Water" },
  {
    n: 2,
    do: "Pour the mixture through filter paper.",
    see: "Water drips through. The sand stays.",
  },
];
const ids = (step: TemplateInput["step"]) => {
  const r = layoutTemplate({ ...base, step }, THEMES[0] as (typeof THEMES)[number], "ks2");
  return stableDraftIds(r.slide as never, "s4").elements.map((e) => e.id);
};

describe("steps with a model: draft ids survive the hand-over", () => {
  test("every element of each draft is still there, by id, in the next and in the saved slide", () => {
    const seq = DRAFTS.map(ids);
    for (const [i, now] of seq.entries()) {
      expect(new Set(now).size).toBe(now.length);
      for (const later of seq.slice(i + 1)) for (const id of now) expect(later).toContain(id);
    }
    expect(seq.at(-1)).toEqual(
      expect.arrayContaining([
        "d-s4-Step_number-0",
        "d-s4-Heading-0",
        "d-s4-Step-0",
        "d-s4-Step_see-0",
        "d-s4-Diagram-0",
      ]),
    );
  });
});
