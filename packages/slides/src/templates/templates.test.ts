import { describe, expect, test } from "bun:test";
import { getTheme } from "../themes";
import { measureTemplate, sample, TEMPLATE_DOCS } from "./capacity";
import { layoutTemplate, templateScale } from "./index";

describe("BAKEOFF template set", () => {
  test("templates read the one key-stage type scale", () => {
    const s = templateScale(getTheme("splash"), "ks1");
    expect(s.body).toBe(33);
    expect(s.lead).toBe(s.body);
  });
  test("a picture sequence draws its pictures in a row with an arrow between each", () => {
    const r = layoutTemplate(
      {
        template: "picture-sequence",
        heading: "A frog's life cycle",
        sequence: ["Frogspawn", "Tadpole", "Froglet", "Frog"].map((caption) => ({
          caption,
          figure: { photo: "" },
        })),
      },
      getTheme("splash"),
      "ks1",
    );
    expect(r.over).toEqual([]);
    const photos = r.slide.elements.filter((e) => e.type === "image");
    expect(photos).toHaveLength(4);
    expect(r.slide.elements.filter((e) => e.name === "Arrow")).toHaveLength(3);
    const ys = new Set(photos.map((p) => p.y));
    expect(ys.size).toBe(1);
    for (const [a, b] of photos.slice(1).map((p, i) => [photos[i], p] as const))
      expect((a?.x ?? 0) + (a?.w ?? 0)).toBeLessThan(b.x);
  });
  test("every measured capacity lays out clean, and a little more is marked over", () => {
    const t = getTheme("splash");
    const doc = TEMPLATE_DOCS.find((d) => d.id === "picture-text");
    if (!doc) throw new Error("no picture-text");
    const cap = measureTemplate(doc, t, "ks2");
    const v = cap.variants.find((x) => x.label === "lead + 2 points");
    const n = v?.maxCharsPerItem ?? 0;
    expect(n).toBeGreaterThan(30);
    const input = (k: number) => ({
      template: "picture-text" as const,
      heading: "Animals and their young",
      lead: sample(k),
      points: [sample(k, 4), sample(k, 7)],
      figure: { photo: "x", aspect: 4 / 3 },
    });
    expect(layoutTemplate(input(n), t, "ks2").over).toEqual([]);
    expect(layoutTemplate(input(n * 2), t, "ks2").over.length).toBeGreaterThan(0);
  });
});
