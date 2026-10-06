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

describe("round 1: text fit and fallbacks", () => {
  const studio = getTheme("studio");
  const plainText = (d: unknown): string => {
    const n = d as { text?: string; content?: unknown[] };
    return n?.text ?? (n?.content ?? []).map(plainText).join("");
  };
  test("a long title steps down so no word breaks, and the subtitle sits under it", () => {
    const r = layoutTemplate(
      {
        template: "title",
        heading: "Weimar Germany: hyperinflation in 1923",
        lead: "What happens when money loses its value?",
        figure: { photo: "/x.jpg", aspect: 0.9 },
      },
      studio,
      "ks3",
    );
    const t = r.slide.elements.find((e) => e.name === "Title");
    const s = r.slide.elements.find((e) => e.name === "Subtitle");
    expect(r.over).toEqual([]);
    expect(t && s && s.y >= t.y + t.h).toBe(true);
  });
  test("a diagram that fails leaves no panel: the slide is words only", () => {
    const r = layoutTemplate(
      {
        template: "diagram-text",
        heading: "Heating",
        lead: "Heating transfers energy.",
        points: ["Particles move faster."],
        figure: { diagram: { ok: false } },
      },
      studio,
      "ks3",
    );
    expect(r.slide.elements.some((e) => e.name === "Panel")).toBe(false);
    expect(r.slide.kind).toBe("content");
  });
  test("an empty drawing (title only) is a failed diagram", () => {
    const svg = `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg><title>x</title><text>Energy</text><g transform="t"><g></g></g></svg>')}`;
    const r = layoutTemplate(
      {
        template: "diagram-text",
        heading: "H",
        points: ["A."],
        figure: { drawn: { src: svg, aspect: 1.2 } },
      },
      studio,
      "ks3",
    );
    expect(r.slide.elements.some((e) => e.name === "Panel" || e.name === "Diagram")).toBe(false);
  });
  test("a column one line over the band closes up or steps down instead of running off", () => {
    const q =
      "A worker's pay rises, but prices rise faster. A pensioner relies on savings in marks. Explain how each is affected.";
    const r = layoutTemplate(
      {
        template: "practice",
        heading: "Explain the crisis",
        questions: [q, q, q],
        instruction:
          "Write in full sentences. Link causes and consequences using because and therefore.",
      },
      studio,
      "ks3",
    );
    expect(r.over).toEqual([]);
    for (const e of r.slide.elements) expect(e.y + e.h).toBeLessThanOrEqual(540);
  });
  test("one or two labelled points beside a figure are key cards", () => {
    const r = layoutTemplate(
      {
        template: "picture-text",
        heading: "Solids",
        lead: "Particles in a solid are closely packed.",
        points: [{ label: "Movement", text: "Particles vibrate about fixed positions." }],
        figure: { photo: "/x.jpg", aspect: 1.2 },
      },
      studio,
      "ks3",
    );
    expect(r.slide.elements.some((e) => e.name === "Key card")).toBe(true);
    expect(r.slide.elements.some((e) => e.name === "Key edge")).toBe(true);
    expect(
      plainText((r.slide.elements.find((e) => e.name === "Key label") as { doc: unknown }).doc),
    ).toBe("Movement");
  });
  test("key cards come from the label field, not a 'Label:' text convention", () => {
    const lay = (points: Parameters<typeof layoutTemplate>[0]["points"]) =>
      layoutTemplate(
        { template: "explain", heading: "Solids", lead: "Packed.", points },
        studio,
        "ks3",
      ).slide.elements;
    const cards = (els: ReturnType<typeof lay>) => els.filter((e) => e.name === "Key card").length;
    // A "Movement: ..." string is a bulleted point, not a card.
    expect(cards(lay(["Movement: Particles vibrate.", "Shape: Fixed."]))).toBe(0);
    // One labelled point among plain ones: one card, the plain point keeps its bullet.
    const mixed = lay([{ label: "Movement", text: "Particles vibrate." }, "They do not flow."]);
    expect(cards(mixed)).toBe(1);
    expect(mixed.filter((e) => e.name === "Bullet").length).toBe(1);
    // Three labelled points are too many cards: bullets with the label in the line.
    const three = lay([
      { label: "A", text: "One." },
      { label: "B", text: "Two." },
      { label: "C", text: "Three." },
    ]);
    expect(cards(three)).toBe(0);
    expect(three.filter((e) => e.name === "Bullet").length).toBe(3);
    // A blank label is no label.
    expect(cards(lay([{ label: " ", text: "Particles vibrate." }]))).toBe(0);
  });
  test("drawDiagram failure: no panel, no wash, words-only sibling; a readable spec keeps its panel", () => {
    const flow = (labels: string[]) => ({
      kind: "flow",
      alt: "steps",
      steps: labels.map((label) => ({ label })),
    });
    const lay = (labels: string[]) =>
      layoutTemplate(
        {
          template: "diagram-text",
          heading: "The process",
          lead: "Each stage follows the last.",
          points: ["It runs in order."],
          figure: { diagram: flow(labels) },
        },
        getTheme("splash"),
        "ks2",
      ).slide.elements;
    // KS2 caps a flow at 4 steps: 8 long steps cannot draw readably in the half panel.
    const failed = lay(Array.from({ length: 8 }, (_, i) => `Stage number ${i + 1} of the process`));
    expect(failed.some((e) => e.name === "Diagram" || e.type === "image")).toBe(false);
    expect(failed.some((e) => e.type === "shape" && e.name !== "Bullet")).toBe(false);
    const ok = lay(["Egg", "Chick", "Hen"]);
    expect(ok.some((e) => e.type === "image")).toBe(true);
    expect(ok.some((e) => e.type === "shape" && e.name !== "Bullet")).toBe(true);
  });
});
