import { describe, expect, test } from "bun:test";
import type { SlideElement } from "@tj/domain/documents";
import { MIN_FONT_SIZE, THEMES } from "../themes";
import { GRID_GLYPH, GRID_NAMES, type GridCard, gridShape } from "./cards-grid";
import { GRID_GROUPS, type GridGroup, gridFitsAt } from "./cards-grid-capacity";
import CAPACITY from "./cards-grid-capacity.json" with { type: "json" };
import { type Figure, layoutTemplate, type Stage, type TemplateInput } from "./index";

/*
 * Cards grid (UX ruling 203, P3): fit on every theme and stage, the never-throw corpus, the
 * picture-missing paths (a lost icon shows the theme glyph, never an empty box) and the grid's
 * shape by count.
 */
const STAGES: Stage[] = ["ks1", "ks2", "ks3"];
const icon = (alt: string): Figure => ({ photo: `https://x.test/${alt}.jpg`, aspect: 1, alt });

/** Cards inside each stage's measured budget (`cards-grid-capacity.json`, 4 cards under a heading). */
const CARDS: Record<"ks1" | "ks2", GridCard[]> = {
  ks2: [
    { label: "Roots", text: "Hold the plant firmly in the soil and take in water." },
    { label: "Stem", text: "Carries water up from the roots and holds the leaves high." },
    { label: "Leaves", text: "Use sunlight to make food for the whole plant." },
    { label: "Flower", text: "Attracts insects so the plant can make new seeds." },
  ],
  ks1: [
    { label: "Sun", text: "It keeps us warm." },
    { label: "Rain", text: "It helps plants grow." },
    { label: "Wind", text: "It blows the leaves." },
    { label: "Snow", text: "It is cold and white." },
  ],
};
const cardsAt = (stage: Stage, n: number, withIcons = true): GridCard[] =>
  CARDS[stage === "ks1" ? "ks1" : "ks2"]
    .slice(0, n)
    .map((c) => (withIcons ? { ...c, icon: icon(c.label) } : c));

function samples(stage: Stage): TemplateInput[] {
  const out: TemplateInput[] = [];
  for (const n of [2, 3, 4])
    for (const heading of ["", "Parts of a flowering plant"])
      for (const withIcons of [true, false])
        out.push({ template: "cards-grid", heading, grid: cardsAt(stage, n, withIcons) });
  out.push({
    template: "cards-grid",
    heading: "Parts of a flowering plant",
    grid: cardsAt(stage, 4).map((c, n) => (n % 2 ? { ...c, icon: undefined, iconLost: true } : c)),
  });
  return out;
}

const fontSizes = (els: SlideElement[]) =>
  els.flatMap((e) => {
    const s = (e as { style?: { fontSize?: number } }).style?.fontSize;
    return s === undefined ? [] : [{ name: e.name ?? e.type, size: s }];
  });
const named = (els: SlideElement[], name: string) => els.filter((e) => e.name === name);

describe("cards grid", () => {
  for (const theme of THEMES)
    for (const stage of STAGES)
      test(`${theme.id} ${stage}: every count fits, text at or over the floor`, () => {
        const faults: string[] = [];
        for (const input of samples(stage)) {
          const r = layoutTemplate(input, theme, stage);
          const tag = `${input.grid?.length} cards, heading "${input.heading}"`;
          for (const o of r.over) faults.push(`${tag} over: ${o}`);
          for (const { name, size } of fontSizes(r.slide.elements))
            if (size < MIN_FONT_SIZE.body) faults.push(`${tag} ${name} ${size}`);
          for (const e of r.slide.elements)
            if (e.y + e.h > 540 - 16) faults.push(`${tag} ${e.name} below the foot`);
          if (named(r.slide.elements, GRID_NAMES.card).length !== input.grid?.length)
            faults.push(`${tag}: card count`);
        }
        expect(faults).toEqual([]);
      });

  test("the shape follows the count: a row of 2, three columns, 2x2", () => {
    expect(gridShape(2)).toEqual({ cols: 2, rows: 1 });
    expect(gridShape(3)).toEqual({ cols: 3, rows: 1 });
    expect(gridShape(4)).toEqual({ cols: 2, rows: 2 });
    const theme = THEMES[0];
    if (!theme) throw new Error("no theme");
    for (const n of [2, 3, 4]) {
      const r = layoutTemplate(
        { template: "cards-grid", heading: "", grid: cardsAt("ks2", n) },
        theme,
        "ks2",
      );
      const cards = named(r.slide.elements, GRID_NAMES.card);
      expect(new Set(cards.map((c) => c.x)).size).toBe(gridShape(n).cols);
      expect(new Set(cards.map((c) => c.y)).size).toBe(gridShape(n).rows);
      expect(r.slide.kind).toBe("content");
    }
  });

  test("a lost icon shows the theme glyph, never an empty box; no icon planned gives no slot", () => {
    for (const theme of THEMES) {
      const lost = layoutTemplate(
        {
          template: "cards-grid",
          heading: "Parts of a plant",
          grid: cardsAt("ks2", 4, false).map((c) => ({ ...c, iconLost: true })),
        },
        theme,
        "ks2",
      ).slide.elements;
      const glyphs = lost.filter((e) => e.type === "icon");
      expect(glyphs).toHaveLength(4);
      for (const g of glyphs) {
        expect((g as { icon: string }).icon).toBe(GRID_GLYPH);
        expect((g as { color?: string }).color).toBe(theme.colors.accent);
      }
      expect(lost.filter((e) => e.type === "image")).toHaveLength(0);

      const none = layoutTemplate(
        { template: "cards-grid", heading: "Parts of a plant", grid: cardsAt("ks2", 4, false) },
        theme,
        "ks2",
      ).slide.elements;
      expect(none.filter((e) => e.type === "icon" || e.type === "image")).toHaveLength(0);
      // The text takes the card's full width: the label starts at the card's padding.
      const card = named(none, GRID_NAMES.card)[0];
      const label = named(none, GRID_NAMES.label)[0];
      expect((label?.x ?? 0) - (card?.x ?? 0)).toBe(18);
    }
  });

  test("an icon still being found is an open square slot the picture pipeline measures", () => {
    const theme = THEMES[0];
    if (!theme) throw new Error("no theme");
    const r = layoutTemplate(
      {
        template: "cards-grid",
        heading: "Parts of a plant",
        grid: cardsAt("ks2", 4, false).map((c, n) => ({
          ...c,
          icon: { photo: "", alt: c.label, request: `slot:icon.${n}` },
        })),
      },
      theme,
      "ks2",
    );
    const slots = r.slide.elements.filter((e) => e.type === "image");
    expect(slots).toHaveLength(4);
    for (const s of slots) {
      expect(s.w).toBe(s.h);
      expect(s.w).toBeLessThanOrEqual(72);
    }
  });

  const ODD: TemplateInput[] = [
    { template: "cards-grid", heading: "" },
    { template: "cards-grid", heading: "Only a heading", grid: [] },
    { template: "cards-grid", heading: "One", grid: [{ label: "", text: "" }] },
    {
      template: "cards-grid",
      heading: "Too many",
      grid: Array.from({ length: 9 }, (_, n) => ({ label: `Card ${n}`, text: "Words." })),
    },
    {
      template: "cards-grid",
      heading: "Long",
      lead: "A lead sentence over the cards.",
      grid: [
        { label: "Supercalifragilisticexpialidocious", text: "word ".repeat(80) },
        { label: "x", text: "y", icon: { photo: "" } },
        { label: "x", text: "y", icon: { diagram: { kind: "nope" } } },
      ],
    },
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

  test("more than four cards is reported, and only four are laid", () => {
    const theme = THEMES[0];
    if (!theme) throw new Error("no theme");
    const r = layoutTemplate(ODD[3] as TemplateInput, theme, "ks2");
    expect(r.over).toContain("cards 9/4");
    expect(named(r.slide.elements, GRID_NAMES.card)).toHaveLength(4);
  });

  // Each cell is checked to fit as measured (the writer's budget never overflows), not searched again.
  test("the writer's budget table is the renderer's measurement: every cell fits", () => {
    for (const g of Object.keys(GRID_GROUPS) as GridGroup[])
      for (const cell of CAPACITY[g]) {
        const tag = `${g} ${cell.cards} cards, heading ${cell.heading}`;
        expect(gridFitsAt(GRID_GROUPS[g], cell.cards, cell.heading, cell.words), tag).toBe(true);
      }
    // KS1, 2x2 under a heading at its two-line limit: 5 words a body.
    expect(CAPACITY.KS1.find((c) => c.cards === 4 && c.heading)?.words).toBe(5);
  }, 30_000);
});
