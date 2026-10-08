import { describe, expect, it } from "bun:test";
import type { Slide } from "@tj/domain/documents";
import { PDF_ATTRIBUTION, printedSlide } from "./pdf-credit";

const pic = (id: string, provider: string, licence?: string, fit = "contain") => ({
  id,
  type: "image",
  x: 0,
  y: 0,
  w: 100,
  h: 100,
  src: "data:,",
  alt: id,
  fit,
  source: {
    provider,
    id,
    pageUrl: `https://commons.wikimedia.org/wiki/File:${id}.jpg`,
    photographer: "Ann",
    photographerUrl: "https://example.org",
    author: "Ann",
    licence,
    sourceUrl: `https://commons.wikimedia.org/wiki/File:${id}.jpg`,
  },
});

const slide = {
  id: "s",
  kind: "content",
  elements: [
    pic("Calf", "commons", "CC BY-SA 4.0", "cover"),
    pic("Cow", "commons", "CC0"),
    pic("Old_map", "commons", "Public domain"),
    pic("p1", "pexels"),
    pic("g1", "generated"),
    {
      id: "grp",
      type: "group",
      x: 0,
      y: 0,
      w: 1,
      h: 1,
      children: [pic("Wall", "commons", "CC BY 2.0")],
    },
  ],
} as never as Slide;

describe("printedSlide (TEACH-251)", () => {
  it('defaults to "off": the slide prints whole, with no credit', () => {
    expect(PDF_ATTRIBUTION).toBe("off");
    expect(printedSlide(slide)).toEqual({ slide, credits: [] });
    expect(printedSlide(slide).slide).toBe(slide);
  });

  it('"line": the slide prints whole, with a line for each CC BY or BY-SA picture only', () => {
    const out = printedSlide(slide, "line");
    expect(out.slide).toBe(slide);
    expect(out.credits).toEqual(["Calf, Ann, CC BY-SA 4.0, cropped", "Wall, Ann, CC BY 2.0"]);
  });

  it('"omit": those pictures leave the printed slide, the rest stay, and nothing is written', () => {
    const out = printedSlide(slide, "omit");
    expect(out.credits).toEqual([]);
    const ids = (els: readonly { id: string; children?: unknown }[]): string[] =>
      els.flatMap((e) => [e.id, ...(e.children ? ids(e.children as never) : [])]);
    expect(ids(out.slide.elements as never)).toEqual(["Cow", "Old_map", "p1", "g1", "grp"]);
  });

  it("leaves a slide that owes nothing untouched in either mode", () => {
    const plain = { ...slide, elements: slide.elements.slice(1, 5) } as Slide;
    expect(printedSlide(plain, "omit").slide).toBe(plain);
    expect(printedSlide(plain, "line").credits).toEqual([]);
  });
});
