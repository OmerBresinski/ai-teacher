import { describe, expect, test } from "bun:test";
import { getTheme } from "@tj/slides/themes";
import { sampleBriefLesson } from "../testing";
import { withActivities } from "./activities";
import { gridFitsLine } from "./cards-grid-fits";
import { charsOver, fitTable } from "./fixes";
import fixture from "./fixtures/activities/y1-animals.json" with { type: "json" };
import { materialise, type Plan, type VisualState, visualsOf } from "./materialise";
import { CARDS_GRID_DEFAULT, writerSchema } from "./schema";
import { validate } from "./strict-subset";

/*
 * Cards grid on the writer's side (UX ruling 203, P3): the schema entry is off by default (master's
 * schema byte for byte) and older outputs still parse with it on; each card's icon is a small
 * square picture ask; a failed icon shows the theme glyph, never an empty box.
 */
type S = Record<string, unknown>;
type J = Record<string, unknown>;

const icon = (shows: string) => ({ shows, must_see: [shows], subject: "generic" });
const grid: S = {
  template: "cards-grid",
  heading: "Parts of a plant",
  lead: null,
  grid: [
    { label: "Roots", text: "Take in water from the soil.", icon: icon("plant roots") },
    { label: "Stem", text: "Holds the plant up.", icon: icon("a green stem") },
    { label: "Leaves", text: "Make food from sunlight.", icon: icon("a leaf") },
    { label: "Flower", text: "Makes the seeds.", icon: null },
  ],
};

describe("the cards-grid schema", () => {
  const SLIDES = (fixture as { brief: { slides: { min: number; max: number } } }).brief.slides;
  const on = writerSchema("KS2", SLIDES, undefined, { cardsGrid: true }) as J;
  const defs = on.$defs as Record<string, J>;

  test("is off by default: master's schema byte for byte", () => {
    expect(CARDS_GRID_DEFAULT).toBe(false);
    expect(JSON.stringify(writerSchema("KS2", SLIDES))).toBe(
      JSON.stringify(writerSchema("KS2", SLIDES, undefined, { cardsGrid: false })),
    );
    expect(JSON.stringify(writerSchema("KS2", SLIDES))).not.toContain("cards-grid");
    expect(JSON.stringify(on)).toContain("cards-grid");
  });

  test("older outputs still validate with it on (round trip)", () => {
    const k1 = writerSchema("KS1", SLIDES, undefined, { cardsGrid: true }) as J;
    expect(validate(withActivities(k1, "KS1"), (fixture as { main: unknown }).main)).toEqual([]);
  });

  test("a grid of 2 to 4 cards validates; 1 or 5 does not", () => {
    expect(validate(defs["cards-grid"] as J, grid, on)).toEqual([]);
    const cards = grid.grid as S[];
    expect(validate(defs["cards-grid"] as J, { ...grid, grid: cards.slice(0, 2) }, on)).toEqual([]);
    expect(validate(defs["cards-grid"] as J, { ...grid, grid: cards.slice(0, 1) }, on)).not.toEqual(
      [],
    );
    expect(
      validate(defs["cards-grid"] as J, { ...grid, grid: [...cards, cards[0]] }, on),
    ).not.toEqual([]);
  });
});

describe("cards grid on the writer's layout", () => {
  const brief = { ...sampleBriefLesson().brief, keyStage: "KS2" } as never;
  const base = {
    brief,
    theme: getTheme(undefined as never, "KS2" as never),
    stage: "KS2" as never,
  };
  const plan = { slides: [] } as unknown as Plan;
  const run = (s: S, visual: (k: string) => VisualState) =>
    materialise(s, { ...base, index: 3, plan, visual });
  const photo = (k: string): VisualState => ({
    status: "photo",
    photo: { src: `https://x.test/${k}.jpg`, alt: k, aspect: 1 },
  });

  test("each planned icon is a small square photo ask, flagged as an icon", () => {
    const asks = visualsOf(grid, 3, { ...base, plan });
    expect(asks.map((a) => a.key)).toEqual(["icon.0", "icon.1", "icon.2"]);
    for (const a of asks) {
      if (a.type !== "photo") throw new Error("not a photo ask");
      expect(a.icon).toBe(true);
      expect(a.aspect).toBe(1);
      expect(a.fixedShape).toBe(true);
    }
  });

  test("placed icons are shown; the card with no icon has no slot", () => {
    const r = run(grid, photo);
    expect(r.over).toEqual([]);
    const els = r.slide.elements;
    expect(els.filter((e) => e.type === "image")).toHaveLength(3);
    expect(els.filter((e) => e.type === "icon")).toHaveLength(0);
    expect(els.filter((e) => e.name === "Card")).toHaveLength(4);
  });

  test("a failed icon shows the theme glyph, never an empty box", () => {
    const r = run(grid, (k) => (k === "icon.1" ? { status: "failed" } : photo(k)));
    const els = r.slide.elements;
    expect(els.filter((e) => e.type === "image")).toHaveLength(2);
    expect(els.filter((e) => e.type === "icon")).toHaveLength(1);
    expect(r.over).toEqual([]);
  });

  test("while pending, every planned icon is an open slot", () => {
    const r = run(grid, () => ({ status: "pending" }));
    const slots = r.slide.elements.filter((e) => e.type === "image");
    expect(slots).toHaveLength(3);
    for (const s of slots) expect(s.w).toBe(s.h);
  });
});

describe("the cards grid's fit", () => {
  test("the fit table has the grid, from the renderer's table: 28 characters a body in a KS1 2x2", () => {
    const v = fitTable().KS1?.layouts["cards-grid"]?.variants ?? [];
    expect(v.map((x) => x.counts.grid)).toEqual([2, 3, 4]);
    expect(v.find((x) => x.counts.grid === 4)?.chars).toBe(28);
    expect(gridFitsLine("KS1")).toContain("4 cards, 28 (5 words)");
  });

  test("the schema caps each label and body; an overlong body is reported for repair", () => {
    const SLIDES = (fixture as { brief: { slides: { min: number; max: number } } }).brief.slides;
    const on = writerSchema("KS1", SLIDES, undefined, { cardsGrid: true }) as J;
    const def = (on.$defs as Record<string, J>)["cards-grid"] as J;
    const long = {
      ...grid,
      grid: [
        { label: "Roots", text: "word ".repeat(60), icon: null },
        ...(grid.grid as S[]).slice(1),
      ],
    };
    expect(validate(def, long, on)).not.toEqual([]);
    const over = charsOver(
      {
        ...grid,
        grid: (grid.grid as S[]).map((c) => ({
          ...c,
          text: "A body far longer than a small card in a two by two grid can hold.",
        })),
      },
      "KS1",
    );
    expect(over.some((o) => o.startsWith("grid[1]"))).toBe(true);
  });
});
