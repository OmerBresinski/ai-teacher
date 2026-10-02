import { describe, expect, test } from "bun:test";
import type { RichDoc, Slide, TextElement } from "@tj/domain/documents";
import { docFromChunks, isChunked } from "./factories";
import { materialiseSlide } from "./materialise";
import type { SlideSpecOf } from "./specs";
import { measureHeadless } from "./text-measure";
import { getTheme, MIN_FONT_SIZE } from "./themes";

/*
 * A teaching body written as labelled chunks ("Solid: …", one a line) is set out in parts: each
 * chunk its own paragraph opening on a bold label. The look and the structure pass keep the parts,
 * beside a picture slot too, and the headless ruler measures a bold label at the bold weight.
 */

const meta = { promptVersion: "t", model: "m", at: "2026-10-02T00:00:00.000Z" };
const SHORT = [
  "Solid: the particles touch and only vibrate.",
  "Liquid: the particles touch but slide past each other.",
  "Gas: the particles are far apart and move fast.",
].join("\n");
const LONG_CHUNK =
  "Ice: in the sealed jar, the ice particles stay the same as the solid melts. They move past each other, so the water changes shape; none escape, so the mass stays the same.";
const LONG = [
  LONG_CHUNK,
  LONG_CHUNK.replace("Ice:", "The model:"),
  LONG_CHUNK.replace("Ice:", "Gas:"),
].join("\n");

const spec = (body: string): SlideSpecOf<"content"> => ({
  kind: "content",
  factRefs: [],
  heading: "Particles in three states",
  body,
});
const bodyOf = (slide: Slide) =>
  slide.elements.find(
    (e): e is TextElement =>
      e.type === "text" && e.style.preset === "body" && e.doc.content?.length === 3,
  );
const labels = (doc: RichDoc) => (doc.content ?? []).map((p) => p.content?.[0]);

describe("docFromChunks", () => {
  test("two or more labelled lines: one paragraph each, the label bold", () => {
    const doc = docFromChunks(SHORT);
    expect(isChunked(doc)).toBe(true);
    expect(labels(doc)).toEqual([
      { type: "text", text: "Solid:", marks: [{ type: "bold" }] },
      { type: "text", text: "Liquid:", marks: [{ type: "bold" }] },
      { type: "text", text: "Gas:", marks: [{ type: "bold" }] },
    ]);
    expect(doc.content?.[0]?.content?.[1]?.text).toBe(" the particles touch and only vibrate.");
  });

  test("one label, a ratio, an unlabelled line or a label over four words stays plain text", () => {
    for (const text of [
      "Gas: the particles move fast.",
      "Mix it 2:3 by volume.\nThen stir it well.",
      "Solid: the particles vibrate.\nThe particles in a liquid slide past each other.",
      "What the particles in a solid do: vibrate.\nGas: they move fast.",
    ]) {
      const doc = docFromChunks(text);
      expect(isChunked(doc), text).toBe(false);
      expect(JSON.stringify(doc)).not.toContain("bold");
    }
  });
});

describe("a chunked teaching body keeps its parts", () => {
  test("the look leaves it whole: no lead and card, no key card", () => {
    const slide = materialiseSlide(spec(SHORT), "chalk", meta);
    const body = bodyOf(slide);
    expect(body && isChunked(body.doc)).toBe(true);
    const names = slide.elements.map((e) => e.name);
    expect(names).not.toContain("Explanation card");
    expect(names).not.toContain("Key card");
  });

  test("too long for the column beside a photo slot, re-set to fit it, the chunks stay paragraphs", () => {
    const photo = { subject: "Ice melting in a sealed jar", mustShow: ["ice"] };
    const slide = materialiseSlide(spec(LONG), "chalk", meta, undefined, 0, { photo });
    const body = bodyOf(slide);
    expect(body && isChunked(body.doc)).toBe(true);
    expect(body?.style.fontSize).toBeLessThanOrEqual(getTheme("chalk").sizes.body);
    expect(body?.style.fontSize).toBeGreaterThanOrEqual(MIN_FONT_SIZE.body);
  });
});

describe("the headless ruler sets a bold run at the bold weight", () => {
  const text = "Evaporation: water turns into vapour";
  const doc = (bold: boolean): RichDoc => ({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text, ...(bold ? { marks: [{ type: "bold" }] } : {}) }],
      },
    ],
  });
  const measure = measureHeadless(getTheme("chalk"));
  const height = (bold: boolean, width: number) =>
    measure({ doc: doc(bold), width, style: {}, preset: "body", inset: 0, chrome: 0 });

  test("words that fit one line at the regular weight wrap when bold", () => {
    expect(height(true, 370)).toBe(2 * height(false, 370));
  });

  test("in a wide column the two take the same line", () => {
    expect(height(true, 800)).toBe(height(false, 800));
  });
});
