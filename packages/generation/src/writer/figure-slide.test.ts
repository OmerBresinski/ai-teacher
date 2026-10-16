import { describe, expect, test } from "bun:test";
import { THEMES } from "@tj/slides";
import { layoutTemplate, type TemplateInput } from "@tj/slides/templates";
import { getTheme } from "@tj/slides/themes";
import { stableDraftIds } from "./lay-draft";
import { toInput } from "./materialise";

/*
 * TEACH-239 part b (C7): the figure slide in the writer. Wide library models come here (the split
 * with picture and text is FIGURE_WIDE_ASPECT); one a lesson, never beside another diagram slide
 * (ruling 229); a failed model is the icon plate, or the words alone with no icon. The draft path
 * keeps every element's id from the first word to the saved slide.
 */
type S = Record<string, unknown>;
const svg = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" class="slide tk theme-primary" viewBox="0 0 1280 564"><text x="9" y="40">Rain</text></svg>',
)}`;
const drawn = (aspect: number) => ({
  status: "diagram",
  spec: { drawn: { src: svg, aspect, bare: true } },
});
const model = { kind: "model", shows: "the water cycle" };
const figureSlide: S = {
  template: "figure",
  heading: "The water cycle in a town",
  accentWord: "water cycle",
  caption: "The same water goes round and round.",
  icon: "water",
  figure: model,
};
const ctx = (slides: S[], index: number, visual: (k: string) => unknown) =>
  ({
    brief: { id: "t", subject: "science", yearGroup: "Year 6", language: "en-GB" },
    theme: getTheme("paper"),
    stage: "ks2",
    index,
    plan: { flow: [], slides },
    visual,
  }) as never;

describe("writer: the figure slide", () => {
  test("a figure slide with its drawn model keeps the layout, caption and accent", () => {
    const i = toInput(
      figureSlide,
      ctx([{ template: "title" }, figureSlide], 1, () => drawn(2.27)),
    );
    expect(i.template).toBe("figure");
    expect(i.lead).toBe("The same water goes round and round.");
    expect(i.accentWord).toBe("water cycle");
    expect(i.figure && "drawn" in i.figure).toBe(true);
  });
  test("ruling 229: a second figure slide, or one beside a diagram slide, is the old big visual", () => {
    const two = [figureSlide, { template: "explain" }, figureSlide];
    expect(
      toInput(
        figureSlide,
        ctx(two, 2, () => drawn(2.27)),
      ).template,
    ).toBe("big-diagram");
    const beside = [{ template: "diagram-text", diagram: model }, figureSlide];
    expect(
      toInput(
        figureSlide,
        ctx(beside, 1, () => drawn(2.27)),
      ).template,
    ).toBe("big-diagram");
  });
  test("a failed model is the icon plate; with no icon the words stand alone", () => {
    const failed = () => ({ status: "failed" });
    const plate = toInput(figureSlide, ctx([figureSlide], 0, failed));
    expect(plate).toMatchObject({ template: "figure", icon: "water" });
    expect(plate.figure).toBeUndefined();
    const { icon: _, ...noIcon } = figureSlide;
    expect(toInput(noIcon, ctx([noIcon], 0, failed)).template).toBe("explain");
  });
  test("a big visual's library model wider than 1.45 comes here; a narrower one does not", () => {
    const big: S = { template: "big-visual", heading: "Rain", lead: "It falls.", figure: model };
    expect(
      toInput(
        big,
        ctx([big], 0, () => drawn(2.27)),
      ).template,
    ).toBe("figure");
    expect(
      toInput(
        big,
        ctx([big], 0, () => drawn(1.2)),
      ).template,
    ).toBe("big-diagram");
  });
});

describe("figure slide drafts: ids survive the hand-over", () => {
  const base: TemplateInput = {
    template: "figure",
    heading: "The water cycle",
    figure: { drawn: { src: svg, aspect: 2.27, bare: true } },
  };
  const ids = (lead?: string) => {
    const r = layoutTemplate({ ...base, ...(lead ? { lead } : {}) }, THEMES[0] as never, "ks2");
    return stableDraftIds(r.slide as never, "s3").elements.map((e) => e.id);
  };
  test("every element of each draft is still there, by id, in the next and in the saved slide", () => {
    const seq = [
      undefined,
      "The same",
      "The same water goes round",
      "The same water goes round and round.",
    ].map(ids);
    for (const [i, now] of seq.entries()) {
      expect(new Set(now).size).toBe(now.length);
      for (const later of seq.slice(i + 1)) for (const id of now) expect(later).toContain(id);
    }
    expect(seq.at(-1)).toEqual(
      expect.arrayContaining(["d-s3-Heading-0", "d-s3-Diagram-0", "d-s3-Caption-0"]),
    );
  });
});
