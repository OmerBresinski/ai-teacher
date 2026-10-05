import { describe, expect, test } from "bun:test";
import { materialiseSlide } from "./materialise";
import { carriesPicture, withoutPicture } from "./no-picture";
import type { SlideSpec } from "./specs";

const meta = { promptVersion: "test", model: "test", at: "2026-09-30T00:00:00.000Z" };
const hasSlot = (spec: SlideSpec, variant?: string, structure = {}) =>
  materialiseSlide(spec, "chalk", meta, undefined, variant, structure).elements.some(
    // The cover's pattern is theme art, not a picture slot (UX ruling 156).
    (e) =>
      (e.type === "image" && e.name !== "Cover pattern") ||
      e.name === "Photo slot" ||
      e.name === "Diagram placeholder",
  );

describe("withoutPicture: every picture-bearing slide has a form with no slot", () => {
  const cases: [string, SlideSpec, string | undefined, object][] = [
    [
      "title split",
      { kind: "title", factRefs: [], title: "Rivers", subtitle: "Year 8" },
      "split",
      {},
    ],
    [
      "title photo-band",
      { kind: "title", factRefs: [], title: "Rivers", subtitle: "Year 8" },
      "photo-band",
      {},
    ],
    [
      "image-text",
      {
        kind: "image-text",
        factRefs: [],
        heading: "A meander",
        body: "The river bends.",
        caption: "Meander",
      } as SlideSpec,
      undefined,
      {},
    ],
    [
      "content with a photo",
      { kind: "content", factRefs: [], heading: "A meander", body: "The river bends." },
      "headed",
      { photo: { subject: "A river meander from above" } },
    ],
    [
      "content with a diagram",
      {
        kind: "content",
        factRefs: [],
        heading: "A meander",
        body: "The river bends.",
        diagram: "A meander, labelled",
      } as SlideSpec,
      "headed",
      {},
    ],
  ];
  for (const [name, spec, variant, structure] of cases) {
    test(name, () => {
      expect(carriesPicture(spec, variant, structure)).toBe(true);
      expect(hasSlot(spec, variant, structure)).toBe(true);
      const out = withoutPicture(spec, variant, structure);
      expect(carriesPicture(out.spec, out.variant, out.structure)).toBe(false);
      expect(hasSlot(out.spec, out.variant, out.structure)).toBe(false);
      // The words the slide teaches are kept.
      const words = JSON.stringify(out.spec);
      if ("body" in spec) expect(words).toContain(spec.body);
      if ("title" in spec) expect(words).toContain(spec.title);
    });
  }
  test("a slide with no picture comes back as it was", () => {
    const spec: SlideSpec = { kind: "objectives", factRefs: [], items: ["describe a meander"] };
    expect(withoutPicture(spec)).toEqual({ spec, structure: {} });
  });
});
