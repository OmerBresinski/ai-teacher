import { describe, expect, test } from "bun:test";
import type { SlideElement } from "@tj/domain/documents";
import { MIN_FONT_SIZE, THEMES } from "../themes";
import { BANNER_HEIGHTS, BANNER_NAMES, bannerOk } from "./banner-text";
import { BANNER_GROUPS, type BannerGroup, bannerFitsAt } from "./banner-text-capacity";
import CAPACITY from "./banner-text-capacity.json" with { type: "json" };
import { type Figure, layoutTemplate, type Stage, type TemplateInput } from "./index";

/*
 * Banner picture + text (UX ruling 203, P4): fit on every theme and stage, the never-throw corpus,
 * the picture-missing paths (a photo that cannot fill the strip goes beside the words; a failed
 * one leaves the words alone, never an empty strip) and the strip's place.
 */
const STAGES: Stage[] = ["ks1", "ks2", "ks3"];
/** A wide photo whose subject sits in a thin band, so it can fill the strip. */
const wide: Figure = {
  photo: "https://x.test/river.jpg",
  aspect: 1.5,
  alt: "A river in a valley",
  subjects: [{ name: "river", x: 0.3, y: 0.4, w: 0.4, h: 0.2 }],
};
const WORDS: Record<"ks1" | "ks2", Pick<TemplateInput, "heading" | "lead" | "points">> = {
  ks2: {
    heading: "How a river shapes the land",
    lead: "Over thousands of years, flowing water wears away rock and carries it downstream.",
    points: [
      { label: "Erosion", text: "water wears away the banks and bed." },
      { label: "Transport", text: "the river carries stones and sand." },
      { label: "Deposition", text: "slow water drops what it carries." },
    ],
  },
  ks1: {
    heading: "Our school garden",
    lead: "We grow flowers and vegetables in our garden.",
    points: [
      { label: "Water", text: "every dry day." },
      { label: "Weeds", text: "pulled out by hand." },
    ],
  },
};
const words = (stage: Stage) => WORDS[stage === "ks1" ? "ks1" : "ks2"];
const samples = (stage: Stage): TemplateInput[] =>
  (["top", "bottom"] as const).flatMap((at) =>
    [0, 1, 3].map((n) => ({
      template: "banner-text" as const,
      ...words(stage),
      points: words(stage).points?.slice(0, n),
      figure: wide,
      at,
    })),
  );
const fontSizes = (els: SlideElement[]) =>
  els.flatMap((e) => {
    const s = (e as { style?: { fontSize?: number } }).style?.fontSize;
    return s === undefined ? [] : [{ name: e.name ?? e.type, size: s }];
  });
const strip = (els: SlideElement[]) => els.find((e) => e.name === BANNER_NAMES.strip);

describe("banner text", () => {
  for (const theme of THEMES)
    for (const stage of STAGES)
      test(`${theme.id} ${stage}: top and bottom strips fit, text at or over the floor`, () => {
        const faults: string[] = [];
        for (const input of samples(stage)) {
          const r = layoutTemplate(input, theme, stage);
          const tag = `${input.at} ${input.points?.length} points`;
          for (const o of r.over) faults.push(`${tag} over: ${o}`);
          for (const { name, size } of fontSizes(r.slide.elements))
            if (size < MIN_FONT_SIZE.body) faults.push(`${tag} ${name} ${size}`);
          const s = strip(r.slide.elements);
          if (!s) faults.push(`${tag}: no strip`);
          for (const e of r.slide.elements)
            if (e.type === "text" && e.y + e.h > 540 - 16) faults.push(`${tag} ${e.name} low`);
        }
        expect(faults).toEqual([]);
      });

  // With room for the words the strip is 40% of the slide; with more words it narrows to a third.
  test("the strip bleeds to the edges, at 40% of the slide, top or bottom", () => {
    const theme = THEMES[0];
    if (!theme) throw new Error("no theme");
    const [top, bottom] = (["top", "bottom"] as const).map((at) =>
      layoutTemplate(
        { template: "banner-text", ...words("ks2"), points: [], figure: wide, at },
        theme,
        "ks2",
      ),
    );
    const t = strip(top?.slide.elements ?? []);
    const b = strip(bottom?.slide.elements ?? []);
    expect(t).toMatchObject({ x: 0, y: 0, w: 960, h: BANNER_HEIGHTS[0] });
    expect(b).toMatchObject({ x: 0, w: 960 });
    expect((b?.y ?? 0) + (b?.h ?? 0)).toBe(540);
    expect(top?.slide.kind).toBe("image-text");
    // Every word sits under a top strip and over a bottom one.
    for (const e of top?.slide.elements ?? [])
      if (e.type === "text") expect(e.y).toBeGreaterThan(t?.h ?? 0);
    for (const e of bottom?.slide.elements ?? [])
      if (e.type === "text") expect(e.y + e.h).toBeLessThan(b?.y ?? 0);
  });

  test("a photo that would be cut blind goes beside the words; a failed one leaves the words", () => {
    const theme = THEMES[0];
    if (!theme) throw new Error("no theme");
    const portrait: Figure = { photo: "https://x.test/p.jpg", aspect: 0.75, alt: "A tall tree" };
    expect(bannerOk({ template: "banner-text", heading: "h", figure: portrait })).toBe(false);
    const side = layoutTemplate(
      { template: "banner-text", ...words("ks2"), figure: portrait },
      theme,
      "ks2",
    );
    expect(strip(side.slide.elements)).toBeUndefined();
    expect(side.slide.elements.filter((e) => e.type === "image")).toHaveLength(1);
    expect(side.slide.kind).toBe("image-text");
    const none = layoutTemplate({ template: "banner-text", ...words("ks2") }, theme, "ks2");
    expect(none.slide.elements.filter((e) => e.type === "image")).toHaveLength(0);
    expect(none.slide.kind).toBe("content");
    expect(none.over).toEqual([]);
  });

  test("a picture still being found is an open strip at the strip's shape", () => {
    const theme = THEMES[0];
    if (!theme) throw new Error("no theme");
    const r = layoutTemplate(
      {
        template: "banner-text",
        ...words("ks2"),
        points: [],
        figure: { photo: "", request: "slot:picture" },
      },
      theme,
      "ks2",
    );
    const s = strip(r.slide.elements);
    expect(s).toMatchObject({ w: 960, h: BANNER_HEIGHTS[0] });
  });

  const ODD: TemplateInput[] = [
    { template: "banner-text", heading: "" },
    { template: "banner-text", heading: "No figure", points: ["a", "b"] },
    { template: "banner-text", heading: "Diagram", figure: { diagram: { kind: "nope" } } },
    {
      template: "banner-text",
      heading: "Too much",
      lead: "word ".repeat(120),
      points: Array.from({ length: 7 }, (_, n) => ({ label: `L${n}`, text: "text" })),
      figure: wide,
      at: "bottom",
    },
    { template: "banner-text", heading: "Open", figure: { photo: "" } },
  ];
  for (const stage of STAGES)
    test(`odd input at ${stage} still gives a slide on every theme`, () => {
      for (const theme of THEMES)
        for (const input of ODD) {
          const r = layoutTemplate(input, theme, stage);
          expect(Array.isArray(r.slide.elements)).toBe(true);
          expect(Array.isArray(r.over)).toBe(true);
        }
    });

  test("the writer's fit table is the renderer's measurement at each cell's edge", () => {
    for (const g of Object.keys(BANNER_GROUPS) as BannerGroup[])
      for (const cell of CAPACITY[g]) {
        expect(bannerFitsAt(BANNER_GROUPS[g], cell.points, cell.chars), `${g} ${cell.points}`).toBe(
          true,
        );
        if (cell.chars < 400)
          expect(bannerFitsAt(BANNER_GROUPS[g], cell.points, cell.chars + 2)).toBe(false);
      }
  }, 30_000);
});
