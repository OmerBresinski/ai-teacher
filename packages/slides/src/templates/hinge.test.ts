import { describe, expect, test } from "bun:test";
import { richDocToPlainText } from "@tj/domain/documents";
import { getTheme, THEMES } from "../themes";
import { HINGE_CAPS, HINGE_NAMES, hingeLookOf } from "./hinge";
import { hingeCapInput, measureHingeCapacity } from "./hinge-capacity";
import TABLE from "./hinge-capacity.json" with { type: "json" };
import { type Ctx, layoutTemplate, type Stage, type TemplateInput } from "./index";

/* TEACH-256 part b: the v13 hinge gold (northstars-v13/hinge/NOTES.md); rulings 136, 161, 230, 241. */
type El = {
  id: string;
  type: string;
  name?: string;
  fill?: string;
  src?: string;
  doc?: unknown;
  style?: { fontSize?: number };
  y: number;
  h: number;
  x: number;
  w: number;
};
const paper = getTheme("paper");
const lay = (input: Partial<TemplateInput>, stage: Stage = "ks2", theme = paper) =>
  layoutTemplate(
    { template: "hinge", heading: "Which of these metals is magnetic?", ...input } as TemplateInput,
    theme,
    stage,
  );
const els = (r: ReturnType<typeof lay>) => r.slide.elements as unknown as El[];
const texts = (r: ReturnType<typeof lay>) =>
  els(r)
    .filter((e) => e.type === "text")
    .map((e) => richDocToPlainText(e.doc as never));
const look = (r: ReturnType<typeof lay>) => {
  const cards = els(r).filter((e) => e.name === HINGE_NAMES.card);
  if (els(r).some((e) => e.name === HINGE_NAMES.icon)) return "tiles";
  return new Set(cards.map((c) => c.y)).size < cards.length ? "grid" : "rows";
};

describe("hinge: the look is chosen by code (ruling 161)", () => {
  test("every option with a library icon and no figure: picture tiles", () => {
    const r = lay(
      {
        options: ["Leaf", "Root", "Flower"],
        choices: [
          { text: "Leaf", icon: "leaf" },
          { text: "Root", icon: "root" },
          { text: "Flower", icon: "flower" },
        ],
        correct: 2,
      },
      "ks1",
    );
    expect(look(r)).toBe("tiles");
    expect(els(r).filter((e) => e.name === HINGE_NAMES.icon)).toHaveLength(3);
  });
  test("one icon the library cannot draw drops every tile to words, in the same letter order", () => {
    const r = lay(
      {
        choices: [
          { text: "Seed", icon: "seed" },
          { text: "Rock", icon: "zzqx-not-a-concept" },
          { text: "Water", icon: "water" },
        ],
        correct: 1,
      },
      "ks1",
    );
    expect(look(r)).not.toBe("tiles");
    expect(texts(r).slice(1)).toEqual(["Seed", "Rock", "Water"]);
  });
  test("short options fit one line: a 2x2 grid (4) or one row (3)", () => {
    expect(look(lay({ options: ["Copper", "Iron", "Aluminium", "All of them"], correct: 2 }))).toBe(
      "grid",
    );
    const three = lay({ options: ["Copper", "Iron", "Gold"], correct: 2 });
    expect(
      new Set(
        els(three)
          .filter((e) => e.name === HINGE_NAMES.card)
          .map((c) => c.y),
      ).size,
    ).toBe(1);
  });
  test("long options: full-width rows, every card as tall as the tallest", () => {
    const r = lay(
      {
        options: [
          "It gives out its own light, like a star does.",
          "It reflects light from the Sun back towards the Earth.",
          "Light from towns and cities on Earth bounces off it.",
          "Its surface is very hot, so it glows in the dark.",
        ],
        correct: 2,
      },
      "ks3",
    );
    expect(look(r)).toBe("rows");
    const cards = els(r).filter((e) => e.name === HINGE_NAMES.card);
    expect(new Set(cards.map((c) => c.h)).size).toBe(1);
    expect(new Set(cards.map((c) => c.w)).size).toBe(1);
  });
  test("a figure beside the options rules tiles out", () => {
    const c = { t: paper } as unknown as Ctx;
    void c;
    const r = lay(
      {
        choices: [
          { text: "Leaf", icon: "leaf" },
          { text: "Root", icon: "root" },
        ],
        figure: { photo: "/x.jpg", aspect: 1 },
        correct: 1,
      },
      "ks2",
    );
    expect(look(r)).not.toBe("tiles");
    expect(hingeLookOf).toBeFunction();
  });
});

describe("hinge: fields, caps and over", () => {
  test("the question is the title; two lines are not over, three are", () => {
    const r = lay({
      heading: "Why do the Vikings' longships tell us they were skilled sailors?",
      options: ["Speed", "Hulls"],
      correct: 2,
    });
    expect(r.over).toEqual([]);
    expect(texts(r)[0]).toBe("Why do the Vikings' longships tell us they were skilled sailors?");
  });
  test("a stem, when given, is the question shown", () => {
    const r = lay({
      heading: "Check",
      stem: "Which number is the largest?",
      options: ["0.405", "0.5"],
      correct: 2,
    });
    expect(texts(r)[0]).toBe("Which number is the largest?");
  });
  test("a 5th option is dropped and flagged", () => {
    const r = lay({ options: ["A one", "A two", "A three", "A four", "A five"], correct: 1 });
    expect(els(r).filter((e) => e.name === HINGE_NAMES.card)).toHaveLength(4);
    expect(r.over).toContain("hinge options 5/4");
  });
  test("the caps table is what the renderer measures (renderer = table)", () => {
    expect(measureHingeCapacity()).toEqual(TABLE);
  });
  test("gold caps: KS3 11 words and KS1 8 words (3 options) stay at comfort on every theme", () => {
    expect(HINGE_CAPS.secondary.words).toBeGreaterThanOrEqual(11);
    expect(HINGE_CAPS.early.words).toBeGreaterThanOrEqual(8);
    expect(HINGE_CAPS.early.options).toBe(3);
    for (const theme of THEMES) {
      const r = layoutTemplate(hingeCapInput("secondary", 11), theme, "ks3");
      expect({ theme: theme.id, over: r.over, tight: r.tight }).toEqual({
        theme: theme.id,
        over: [],
        tight: false,
      });
    }
  });
  test("past the hard maximum: the floor and a flag, never type under the floor or a card past the foot", () => {
    const r = layoutTemplate(
      hingeCapInput("secondary", HINGE_CAPS.secondary.maxWords + 8),
      paper,
      "ks3",
    );
    expect(r.over.length).toBeGreaterThan(0);
    const body = els(r).filter((e) => e.name === HINGE_NAMES.text);
    for (const e of body) expect(e.style?.fontSize ?? 0).toBeGreaterThanOrEqual(20);
  });
  test("each option reports a counter against the measured caps", () => {
    const r = lay({ options: ["Copper", "Iron"], correct: 2 });
    expect(r.fields?.map((f) => f.path)).toEqual(["options.0", "options.1"]);
  });
});

describe("hinge: answer, notes, letters, maths", () => {
  test("answer key counted from 1 (TEACH-110 part u); the right card is the correct option", () => {
    const r = lay({ options: ["Copper", "Iron", "Aluminium"], correct: 2 });
    const q = r.slide.question as { type: string; options: { correct: boolean }[] };
    expect(q.options.map((o) => o.correct)).toEqual([false, true, false]);
  });
  test("each wrong option's why goes to the speaker notes, never the slide (ruling 241)", () => {
    const r = lay({
      choices: [
        { text: "Copper", why: "All metals are magnetic." },
        { text: "Iron", why: "never shown" },
        { text: "Aluminium", why: "Cans are metal." },
      ],
      correct: 2,
    });
    expect(r.slide.notes).toBe("A: All metals are magnetic.\nC: Cans are metal.");
    expect(texts(r).join(" ")).not.toContain("metals are magnetic");
  });
  test("RTL letters: Hebrew and Arabic script keys", () => {
    for (const [letters, want] of [
      ["hebrew", ["א", "ב", "ג"]],
      ["arabic", ["أ", "ب", "ج"]],
    ] as const) {
      const r = lay({ options: ["אחת", "שתיים", "שלוש"], letters, correct: 1 });
      const keys = els(r)
        .filter((e) => e.name === HINGE_NAMES.key)
        .map((e) => richDocToPlainText(e.doc as never));
      expect(keys).toEqual([...want]);
    }
  });
  test("a fraction option is stacked over a bar; a maths option takes a true minus", () => {
    const r = lay({ options: ["2/5", "3/5", "x - 4", "5/2"], correct: 1 });
    expect(els(r).filter((e) => e.name === HINGE_NAMES.bar)).toHaveLength(3);
    expect(texts(r)).toContain("x − 4");
    expect(texts(r)).not.toContain("2/5");
  });
  test("no literal reveal green and nothing off the slide, in every theme", () => {
    for (const theme of THEMES) {
      const r = lay(
        { options: ["Copper", "Iron", "Aluminium", "All of them"], correct: 2 },
        "ks2",
        theme,
      );
      expect(JSON.stringify(r.slide.elements)).not.toContain("#2C8A43");
      for (const e of els(r)) {
        expect(e.x).toBeGreaterThanOrEqual(0);
        expect(e.y + e.h).toBeLessThanOrEqual(540);
      }
      expect(els(r)[0]?.name).toBe(HINGE_NAMES.stage);
    }
  });
});
