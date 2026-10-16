import { describe, expect, test } from "bun:test";
import { THEMES } from "@tj/slides";
import { layoutTemplate, type TemplateInput } from "@tj/slides/templates";
import { stableDraftIds } from "./lay-draft";

/*
 * TEACH-75 part ae (C6): picture and text streams in without anything vanishing. Each draft's
 * element keeps its id from the first word to the saved slide, so the renderer updates the same box.
 */
const base: TemplateInput = {
  template: "picture-text",
  heading: "Wrapping the mummy",
  figure: { photo: "", aspect: 1.5 },
  pictureText: { icon: "mummy" },
};
const DRAFTS: Partial<TemplateInput>[] = [
  { lead: "Embalmers" },
  { lead: "Embalmers wrapped the dried body in linen." },
  { lead: "Embalmers wrapped the dried body in linen.", points: ["They tucked"] },
  {
    lead: "Embalmers wrapped the dried body in linen.",
    points: ["They tucked amulets between the layers.", "Wrapping took fifteen days."],
  },
];
const ids = (d: Partial<TemplateInput>) => {
  const r = layoutTemplate({ ...base, ...d }, THEMES[0] as (typeof THEMES)[number], "ks2");
  return stableDraftIds(r.slide as never, "s3").elements.map((e) => e.id);
};

describe("picture and text: draft ids survive the hand-over", () => {
  test("every element of each draft is still there, by id, in the next and in the saved slide", () => {
    const seq = DRAFTS.map(ids);
    for (const [i, now] of seq.entries()) {
      expect(new Set(now).size).toBe(now.length);
      for (const later of seq.slice(i + 1)) for (const id of now) expect(later).toContain(id);
    }
    expect(seq.at(-1)).toEqual(
      expect.arrayContaining([
        "d-s3-Heading-0",
        "d-s3-Picture_field-0",
        "d-s3-Photo-0",
        "d-s3-Lead-0",
        "d-s3-Point-0",
        "d-s3-Point-1",
      ]),
    );
  });
});
