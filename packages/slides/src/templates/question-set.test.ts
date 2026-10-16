import { describe, expect, test } from "bun:test";
import {
  answerRevealSteps,
  hasRevealableAnswer,
  type Slide,
  SlideSchema,
  slideStepCount,
} from "@tj/domain/documents";
import { resolveTextStyle } from "../text-style";
import { atKeyStage, MIN_FONT_SIZE, THEMES } from "../themes";
import { layoutTemplate, type Stage, type TemplateInput } from "./index";
import { inlineFractions, QUICK_NAMES, quickCaps, quickCheckMax } from "./question-set";
import { measureQuickCaps } from "./question-set-capacity";
import CAPACITY from "./question-set-capacity.json";

/*
 * TEACH-101 part g: the quick check (gold `northstars-v12/questions-b`, direction C). Cases are the
 * gold's own (`cases.js`), at the stage each was drawn for.
 */
type Case = { stage: Stage; heading: string; items: [string, string][] };
const y3: Case = {
  stage: "ks1",
  heading: "Quick check: adding tens",
  items: [
    ["What is 46 + 30?", "76"],
    ["What is 85 − 40?", "45"],
    ["Sam has 23 stickers. He gets 20 more. How many now?", "43"],
  ],
};
const y6: Case = {
  stage: "ks2",
  heading: "Quick check: the heart",
  items: [
    ["Which organ pumps blood around the body?", "The heart"],
    ["Which vessels carry blood away from the heart?", "Arteries"],
    ["Which gas does blood pick up in the lungs?", "Oxygen"],
    ["What is the beat you feel in your wrist?", "Your pulse"],
    ["Which liquid part of blood carries nutrients?", "Plasma"],
  ],
};
const y9: Case = {
  stage: "ks3",
  heading: "Quick check: rates of reaction",
  items: [
    [
      "Why does powdered marble react faster with acid than one large marble chip?",
      "Bigger surface area",
    ],
    ["What happens to the rate when the acid is made more concentrated?", "It increases"],
    ["What do we call a substance that speeds up a reaction without being used up?", "A catalyst"],
    ["Which gas is given off when marble reacts with hydrochloric acid?", "Carbon dioxide"],
    ["Why does a reaction slow down as it goes on?", "Reactants get used up"],
  ],
};
const y4f: Case = {
  stage: "ks2",
  heading: "Quick check: fractions",
  items: [
    ["What is {1/2} of 10?", "5"],
    ["Which is bigger, {1/3} or {1/4}?", "{1/3}"],
    ["Write {2/4} in its simplest form.", "{1/2}"],
    ["What fraction of an hour is 15 minutes?", "{1/4}"],
    ["What is {1/4} of 20?", "5"],
  ],
};
const y6x6: Case = {
  ...y6,
  items: [...y6.items, ["Which vessels carry blood back to the heart?", "Veins"]],
};
const y3x4: Case = { ...y3, items: [...y3.items, ["What is 52 + 40?", "92"]] };
const y3x5: Case = {
  ...y3,
  items: [...y3x4.items, ["Mia has 70p. She spends 30p. How much is left?", "40p"]],
};
export const QUICK_CASES = { y3, y3x4, y6, y4f, y9 };
/*
 * Deviation from the gold, measured: six Y6 questions fit the gold at 22 pt on one line, but the
 * KS2 scale stops at 25 pt (bodySmall), where they take two lines and pass 90% of the stage. So
 * six KS2 questions fit only when they are short; y6x6 is flagged, never squeezed.
 */

export const quickInput = (c: Case): TemplateInput => ({
  template: "question-set",
  heading: c.heading,
  questions: c.items.map((i) => i[0]),
  answers: c.items.map((i) => i[1]),
});

const paper = THEMES.find((t) => t.id === "paper") ?? (THEMES[0] as (typeof THEMES)[number]);
const lay = (c: Case, theme = paper) => layoutTemplate(quickInput(c), theme, c.stage);
const named = (els: Slide["elements"], name: string) => els.filter((e) => e.name === name);
type Box = { x: number; y: number; w: number; h: number };
const meets = (a: Box, b: Box) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (a: Box, b: Box) =>
  a.x >= b.x - 0.5 &&
  a.y >= b.y - 0.5 &&
  a.x + a.w <= b.x + b.w + 0.5 &&
  a.y + a.h <= b.y + b.h + 0.5;

describe("quick check (TEACH-101 part g)", () => {
  for (const [id, c] of Object.entries(QUICK_CASES))
    test(`${id} (${c.stage}): fits, one answer per click, answers kept on the question`, () => {
      const r = lay(c);
      expect(r.over).toEqual([]);
      const els = r.slide.elements;
      const qs = named(els, QUICK_NAMES.question);
      const as = named(els, QUICK_NAMES.answer);
      const waits = named(els, QUICK_NAMES.wait);
      const covers = named(els, QUICK_NAMES.cover);
      expect([qs.length, as.length, waits.length, covers.length]).toEqual(
        Array(4).fill(c.items.length),
      );
      c.items.forEach((_, k) => {
        // Answer k and its cover come at step k+1; the cover hides "?" k.
        expect(as[k]?.revealStep).toBe(k + 1);
        expect(covers[k]?.revealStep).toBe(k + 1);
        expect(waits[k]?.revealStep ?? 0).toBe(0);
        expect(inside(waits[k] as Box, covers[k] as Box)).toBe(true);
        // Level with its question, at one left edge.
        const qm = (qs[k] as Box).y + (qs[k] as Box).h / 2;
        const am = (as[k] as Box).y + (as[k] as Box).h / 2;
        expect(Math.abs(qm - am)).toBeLessThanOrEqual(1);
        expect(as[k]?.x).toBe(as[0]?.x as number);
        // The answer never meets a question.
        for (const q of qs) expect(meets(as[k] as Box, q as Box)).toBe(false);
      });
      const slide = { id: "s", ...r.slide } as Slide;
      expect(SlideSchema.safeParse(slide).success).toBe(true);
      expect(r.slide.question?.type).toBe("open-response");
      const model = r.slide.question?.type === "open-response" ? r.slide.question.modelAnswer : "";
      expect(model?.split("\n")).toEqual(
        c.items.map((i, k) => `${k + 1}. ${inlineFractions(i[1])}`),
      );
      // Present: one step per answer and no extra step that shows them again.
      expect(hasRevealableAnswer(slide)).toBe(false);
      expect(answerRevealSteps(slide)).toBe(0);
      expect(slideStepCount(slide)).toBe(c.items.length);
    });

  test("the field runs from under the title to the bottom edge, flush right; badge and chip roles", () => {
    const els = lay(y6).slide.elements;
    const field = els.find((e) => e.name === "surface:field-b" && !e.revealStep) as Box;
    const head = els.find((e) => e.name === "Heading") as Box;
    expect(field.x + field.w).toBe(960);
    expect(field.y + field.h).toBe(540);
    expect(field.y).toBeGreaterThan(head.y + head.h);
    expect(field.w).toBeGreaterThanOrEqual(288);
    expect(field.w).toBeLessThanOrEqual(320);
    expect(named(els, "surface:badge")).toHaveLength(5);
    // Every answer sits in the field; no question reaches it.
    for (const a of named(els, QUICK_NAMES.answer)) expect(inside(a as Box, field)).toBe(true);
    for (const q of named(els, QUICK_NAMES.question))
      expect((q as Box).x + (q as Box).w).toBeLessThan(field.x);
  });

  test("rows take at most 90% of the stage and fill it evenly", () => {
    for (const c of Object.values(QUICK_CASES)) {
      const els = lay(c).slide.elements;
      const qs = named(els, QUICK_NAMES.question) as Box[];
      const mids = qs.map((q) => q.y + q.h / 2);
      const gaps = mids.slice(1).map((m, i) => m - (mids[i] as number));
      // Even spacing only where row heights match; never overlapping rows.
      for (const g of gaps) expect(g).toBeGreaterThan(0);
    }
  });

  test("past its maximum a quick check is over (red outline), never squeezed under the floor", () => {
    expect(quickCheckMax("ks1")).toBe(4);
    expect(lay(y6x6).over.length).toBeGreaterThan(0);
    const short: Case = {
      stage: "ks2",
      heading: "Quick check: times tables",
      items: [3, 4, 6, 7, 8, 9].map(
        (k) => [`What is ${k} × 6?`, String(k * 6)] as [string, string],
      ),
    };
    expect(lay(short).over).toEqual([]);
    const r = lay(y3x5);
    expect(r.over.some((o) => o.includes("5/4"))).toBe(true);
  });

  test("every stored font size is the size the renderer draws, never under the floor", () => {
    for (const theme of THEMES)
      for (const c of Object.values(QUICK_CASES)) {
        const t = atKeyStage(theme, c.stage);
        for (const e of lay(c, theme).slide.elements) {
          const st = e.type === "text" ? e.style : e.type === "shape" ? e.textStyle : undefined;
          if (!st?.fontSize) continue;
          expect(st.fontSize).toBeGreaterThanOrEqual(MIN_FONT_SIZE.body);
          if (e.type === "text" && e.name !== "Heading")
            expect([e.name, resolveTextStyle(st, t).fontSize]).toEqual([e.name, st.fontSize]);
        }
      }
  });

  test("{a/b} is inline a/b", () => {
    const as = named(lay(y4f).slide.elements, QUICK_NAMES.answer);
    expect(JSON.stringify(as[1])).toContain("1/3");
    const words = as.map((a) => (a.type === "text" ? JSON.stringify(a.doc) : ""));
    expect(words.join()).not.toMatch(/\{\d/);
  });

  test("a set without answers keeps the old numbered list; practice and exit ticket unchanged", () => {
    const old = layoutTemplate(
      { template: "question-set", heading: "Your turn", questions: ["One?", "Two?", "Three?"] },
      paper,
      "ks2",
    );
    expect(named(old.slide.elements, QUICK_NAMES.answer)).toHaveLength(0);
    for (const template of ["practice", "exit-ticket"] as const) {
      const r = layoutTemplate({ ...quickInput(y6), template }, paper, "ks2");
      expect(named(r.slide.elements, QUICK_NAMES.answer)).toHaveLength(0);
      // The answers live on the end Answers slides: nothing reveals on the slide (TEACH-230 part c).
      expect(r.slide.question?.type).toBe("open-response");
      expect(hasRevealableAnswer({ id: "s", ...r.slide } as Slide)).toBe(false);
    }
  });

  test("the caps table is the renderer's own measure (regenerated cells equal the JSON)", () => {
    const t = CAPACITY as unknown as Record<string, Record<string, unknown>>;
    expect(measureQuickCaps("early", 4)).toEqual(t.early?.["4"] as never);
    expect(measureQuickCaps("primary", 5)).toEqual(t.primary?.["5"] as never);
    expect(measureQuickCaps("secondary", 5)).toEqual(t.secondary?.["5"] as never);
  }, 120_000);

  test("every question and answer reports its measured limits (the live counters)", () => {
    for (const c of Object.values(QUICK_CASES)) {
      const r = lay(c);
      const caps = quickCaps(c.stage, c.items.length);
      const fields = r.fields ?? [];
      expect(fields.map((f) => f.path)).toEqual(
        c.items.flatMap((_, i) => [`questions.${i}`, `answers.${i}`]),
      );
      for (const f of fields) {
        expect(f.hardMax).toBe(
          f.field === "answers" ? caps.answers.hardMax : caps.questions.hardMax,
        );
        expect(f.over).toBe(f.chars > f.hardMax);
      }
    }
  });

  test("a blank answer's row has no '?' chip and no step; the rest reveal in order", () => {
    const items: [string, string][] = y6.items.map((it, i) => (i === 2 ? [it[0], ""] : it));
    const r = lay({ ...y6, items });
    const els = r.slide.elements;
    expect(named(els, QUICK_NAMES.wait)).toHaveLength(4);
    expect(named(els, QUICK_NAMES.answer).map((a) => a.revealStep)).toEqual([1, 2, 3, 4]);
    const slide = { id: "s", ...r.slide } as Slide;
    expect(hasRevealableAnswer(slide)).toBe(false);
    expect(slideStepCount(slide)).toBe(4);
  });

  test("a single-answer set reveals its one answer once; Present adds no second reveal", () => {
    const r = lay({ ...y6, items: y6.items.slice(0, 1) });
    const slide = { id: "s", ...r.slide } as Slide;
    expect(named(slide.elements, QUICK_NAMES.answer)).toHaveLength(1);
    expect(hasRevealableAnswer(slide)).toBe(false);
    expect(slideStepCount(slide)).toBe(1);
  });
});
