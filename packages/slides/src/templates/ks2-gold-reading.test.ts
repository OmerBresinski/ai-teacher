/**
 * Ruling 162 amended by Greg 18 Oct (item 31 A): KS2 reading text at the golds' 33-34px on quick
 * check, picture-with-points and split-compare. Sizes in slide points (px x 2/3): 33 px = 22 pt,
 * 34 px = 22.67 pt, 37 px = 24.67 pt. Every other stage, and the side-by-side look, is unchanged.
 */
import { describe, expect, test } from "bun:test";
import type { SlideElement, TextElement } from "@tj/domain/documents";
import { KS2_GOLD_READING } from "../layout-sizes";
import { getTheme, THEMES } from "../themes";
import { layoutTemplate, type Stage, type TemplateInput } from "./index";
import { mixInput } from "./picture-text-capacity";
import CAPS from "./picture-text-capacity.json" with { type: "json" };

const texts = (els: SlideElement[], name: string) =>
  els.filter((e): e is TextElement => e.type === "text" && e.name === name);

const pt14 = [
  "They tucked amulets between the linen layers to protect the dead on their journey.",
  "They brushed every layer of linen with sticky resin to glue it in place.",
  "Wrapping one body with its amulets and prayers could take up to fifteen days.",
];
const mummy: TemplateInput = {
  template: "picture-text",
  heading: "Wrapping the mummy",
  accentWord: "mummy",
  lead: "Embalmers wrapped the dried body in hundreds of metres of linen.",
  points: pt14,
  figure: { photo: "x.jpg", aspect: 1.5 },
  pictureText: { icon: "mummy" },
};
const FOOT = 540 - 43;

describe("picture with points at KS2 (gold lead 37 px, points 33 px, line height 1.3)", () => {
  test("3 points of 14 words and a picture end above the foot in Paper and Geometric", () => {
    for (const id of ["paper", "geometric"]) {
      const r = layoutTemplate(mummy, getTheme(id), "ks2");
      // The column fits; only the measured word cap (50, uneven splits included) names the 53 words.
      expect(r.over).toEqual([`picture-text words 53/${CAPS.KS2.words}`]);
      const pts = texts(r.slide.elements, "Point");
      expect(pts).toHaveLength(3);
      const last = pts.at(-1) as TextElement;
      expect(last.y + last.h).toBeLessThanOrEqual(FOOT);
      for (const p of pts) {
        expect(p.style?.fontSize).toBe(KS2_GOLD_READING.picturePoint);
        expect(p.style?.fixedSize).toBe(true);
        expect(p.style?.lineHeight).toBe(1.3);
      }
      const lead = texts(r.slide.elements, "Lead")[0] as TextElement;
      expect(lead.style?.fixedSize).toBe(true);
      expect(lead.style?.lineHeight).toBe(1.3);
      expect(lead.style?.fontSize).toBeLessThanOrEqual(KS2_GOLD_READING.pictureLead);
      expect(lead.style?.fontSize).toBeGreaterThanOrEqual(KS2_GOLD_READING.pictureLeadFloor);
    }
  });

  test("short content draws at the gold's own sizes, comfortable (k = 1)", () => {
    const r = layoutTemplate({ ...mummy, points: pt14.slice(0, 2) }, getTheme("paper"), "ks2");
    expect(r.tight).toBe(false);
    expect(texts(r.slide.elements, "Lead")[0]?.style?.fontSize).toBe(KS2_GOLD_READING.pictureLead);
  });

  test("the KS2 word cap is measured over uneven splits too, and is above master's 42", () => {
    expect(CAPS.KS2.words).toBeGreaterThan(42);
    expect(CAPS.KS2.comfortable).toBeLessThanOrEqual(CAPS.KS2.words);
    // Lead 16 + points 20/10/10 at the cap lays out on every theme with the column inside the foot.
    for (const t of THEMES) {
      const r = layoutTemplate(mixInput(CAPS.KS2.words, 16, [2, 1, 1]), t, "ks2");
      expect([t.id, r.over.filter((o) => o.startsWith("picture-text column"))]).toEqual([t.id, []]);
    }
  });

  test("KS3 keeps the stage's steps and the roles' line heights", () => {
    const r = layoutTemplate({ ...mummy, points: pt14.slice(0, 2) }, getTheme("paper"), "ks3");
    for (const p of texts(r.slide.elements, "Point")) {
      expect(p.style?.fixedSize).toBeUndefined();
      expect(p.style?.lineHeight).toBe(1.4);
    }
  });
});

const quick = (n: number): TemplateInput => ({
  template: "question-set",
  heading: "Quick check: the heart",
  questions: [
    "Which organ pumps blood around the body?",
    "Which vessels carry blood away from the heart?",
    "Which gas does blood pick up in the lungs?",
    "What is the beat you feel in your wrist?",
    "Which liquid part of blood carries nutrients?",
  ].slice(0, n),
  answers: ["The heart", "Arteries", "Oxygen", "Your pulse", "Plasma"].slice(0, n),
});

describe("quick check at KS2 (gold v12/questions-b: 33 px rows)", () => {
  test("5 questions of 7-9 words sit on one line each at 33 px, comfortable", () => {
    for (const id of ["paper", "geometric"]) {
      const r = layoutTemplate(quick(5), getTheme(id), "ks2");
      expect(r.over).toEqual([]);
      expect(r.tight).toBe(false);
      for (const q of texts(r.slide.elements, "Question")) {
        expect(q.style?.fontSize).toBe(KS2_GOLD_READING.quickRow);
        expect(q.style?.fixedSize).toBe(true);
        // One line: the row's height is one line at the stored line height.
        expect(q.h).toBeLessThanOrEqual(Math.ceil(22 * 1.4));
      }
    }
  });

  test("rows that need two lines at 33 px are tight, as at every stage", () => {
    const long = quick(3);
    long.questions = (long.questions ?? []).map((q) => `${q} Say why in a few more words.`);
    const r = layoutTemplate(long, getTheme("paper"), "ks2");
    expect(r.over).toEqual([]);
    expect(r.tight).toBe(true);
  });

  test("KS3 never draws the KS2 gold row", () => {
    const r = layoutTemplate(quick(5), getTheme("paper"), "ks3");
    for (const q of texts(r.slide.elements, "Question")) expect(q.style?.fixedSize).toBeUndefined();
  });
});

const split = (stage: Stage) =>
  layoutTemplate(
    {
      template: "split-compare",
      heading: "Two ways to compare",
      sides: [
        { title: "Simile", text: "Compares using 'like' or 'as'. 'The wind howls like a wolf.'" },
        {
          title: "Metaphor",
          text: "Says something is something else to suggest a shared quality.",
        },
      ],
    },
    getTheme("paper"),
    stage,
  );

describe("split-compare at KS2 (gold sc-21: side text 34 px, never under 33 px)", () => {
  test("side text at 33-34 px, drawn as given", () => {
    const words = texts(split("ks2").slide.elements, "Side words");
    expect(words).toHaveLength(2);
    for (const w of words) {
      expect(w.style?.fixedSize).toBe(true);
      expect(w.style?.fontSize).toBeGreaterThanOrEqual(KS2_GOLD_READING.splitTextFloor);
      expect(w.style?.fontSize).toBeLessThanOrEqual(KS2_GOLD_READING.splitText);
    }
  });

  test("KS3 keeps the stage's steps", () => {
    for (const w of texts(split("ks3").slide.elements, "Side words"))
      expect(w.style?.fixedSize).toBeUndefined();
  });
});
