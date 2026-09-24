import { describe, expect, test } from "bun:test";
import type { OptionElement, Slide, SlideElement, TextElement } from "@tj/domain/documents";
import { docFromText } from "./factories";
import { fitSlide } from "./fit-slide";
import { SAFE, SPACE } from "./grid";
import { materialiseSlide } from "./materialise";
import { SAFE_BOTTOM } from "./metrics";
import { reflowSlide } from "./reflow";
import type { SlideSpec } from "./specs";
import { measureHeadless } from "./text-measure";
import { getTheme } from "./themes";

/*
 * TEACH-28: the copy of the Year 9 Russian Revolution showcase lesson (np1, 23 Sep 2026), whose
 * print deck had a title under its class line, headings struck through by their rules, answer
 * cards over each other and a worked example off its card. Each case materialises the slide the
 * worker would write and holds the geometry that the print route draws as stored.
 */

const META = { promptVersion: "test", model: "test", at: "2026-09-24T00:00:00.000Z" };
const THEME = "chalk";
const theme = getTheme(THEME);

function make(spec: SlideSpec): Slide {
  let n = 0;
  return materialiseSlide(spec, THEME, META, () => `e${++n}`);
}

const texts = (slide: Slide) =>
  slide.elements.filter((el): el is TextElement => el.type === "text");
const byPreset = (slide: Slide, preset: TextElement["style"]["preset"]) =>
  texts(slide).filter((el) => el.style.preset === preset);
const rule = (slide: Slide) =>
  slide.elements.find((el) => el.type === "shape" && el.name === "Rule") as SlideElement;
const bottom = (el: SlideElement) => el.y + el.h;
const overlapY = (a: SlideElement, b: SlideElement) => a.y < bottom(b) && b.y < bottom(a);
const overlapX = (a: SlideElement, b: SlideElement) => a.x < b.x + b.w && b.x < a.x + a.w;

/** The height the headless ruler gives an element's text at its stored width and size. */
function needed(el: TextElement): number {
  return measureHeadless(theme)({
    doc: el.doc,
    width: el.w,
    style: el.style,
    preset: el.style.preset,
    inset: 0,
    chrome: 0,
  });
}

describe("fitSlide on the showcase lesson (TEACH-28)", () => {
  test("a four-line title grows its box, pushes the class line below it and stays centred", () => {
    const slide = make({
      kind: "title",
      title:
        "The Russian Revolution: why tsarist rule ended in February 1917, how the Bolsheviks won",
      subtitle: "Year 9 · History",
      factRefs: [],
    });
    const [title] = byPreset(slide, "title");
    const [subtitle] = byPreset(slide, "subtitle");
    if (!title || !subtitle) throw new Error("title stack");
    expect(title.h).toBeGreaterThanOrEqual(needed(title) - 0.5);
    expect(subtitle.y).toBeGreaterThanOrEqual(bottom(title));
    expect(bottom(subtitle)).toBeLessThanOrEqual(SAFE_BOTTOM);
    const accent = slide.elements.find((el) => el.type === "shape");
    expect(accent?.y ?? -1).toBeGreaterThanOrEqual(SAFE.y);
  });

  test("a short title keeps the recipe's stack: nothing overlaps, the class line follows the title", () => {
    const slide = make({ kind: "title", title: "Fractions", subtitle: "Year 4", factRefs: [] });
    const [title] = byPreset(slide, "title");
    const [subtitle] = byPreset(slide, "subtitle");
    if (!title || !subtitle) throw new Error("title stack");
    expect(overlapY(title, subtitle)).toBe(false);
    expect(subtitle.y).toBeGreaterThan(title.y);
  });

  test("a two-line heading pushes its rule and the body below it, never through it", () => {
    const slide = make({
      kind: "content",
      heading: "War exposed tsarist weaknesses and created a Petrograd crisis",
      body: "War brought defeats, deaths, inflation and shortages. In Petrograd, bread and fuel queues turned hardship into protests; soldiers mutinied (refused orders). The Tsar failed to restore trust or control the crisis, so he abdicated (gave up power).",
      factRefs: ["k1"],
    });
    const [heading] = byPreset(slide, "heading");
    const [body] = byPreset(slide, "body");
    if (!heading || !body) throw new Error("content");
    expect(heading.h).toBeGreaterThanOrEqual(needed(heading) - 0.5);
    expect(rule(slide).y).toBeGreaterThanOrEqual(bottom(heading));
    expect(body.y).toBeGreaterThan(rule(slide).y);
    expect(bottom(body)).toBeLessThanOrEqual(SAFE_BOTTOM);
  });

  test("two-line answer cards grow in equal rows and the second row moves clear of the first", () => {
    const slide = make({
      kind: "multiple-choice",
      stem: "Which slogan helped the Bolsheviks gain support in 1917?",
      options: [
        { text: "‘Peace, Land and Bread’.", correct: true },
        { text: "‘War, Empire and Famine’", correct: false },
        { text: "‘King, Church and Empire’", correct: false },
        { text: "‘Taxes, War and Order’", correct: false },
      ],
      explanation: "It addressed the war, land ownership and food shortages.",
      factRefs: ["q5"],
    });
    const cards = slide.elements.filter((el): el is OptionElement => el.type === "option");
    expect(cards).toHaveLength(4);
    for (const a of cards)
      for (const b of cards)
        if (a !== b) expect(overlapX(a, b) && overlapY(a, b), `${a.id} over ${b.id}`).toBe(false);
    const heights = new Set(cards.map((card) => card.h));
    expect(heights.size).toBe(1);
    // The stem stays on the question floor: shrinking it would buy the cards no room.
    expect(byPreset(slide, "heading")[0]?.style.fontSize).toBeUndefined();
    for (const card of cards) expect(bottom(card)).toBeLessThanOrEqual(SAFE_BOTTOM);
  });

  test("cards no 2x2 grid can hold at the option floor are reported, not left overlapping", () => {
    const slide = make({
      kind: "multiple-choice",
      stem: "Which event was an important turning point in ending tsarist rule in February 1917?",
      options: [
        { text: "The Tsar won a major victory", correct: false },
        { text: "The Bolsheviks immediately formed a government", correct: false },
        { text: "Russia left the First World War", correct: false },
        {
          text: "Soldiers in Petrograd joined the protesters instead of obeying orders to restore order",
          correct: true,
        },
      ],
      factRefs: ["q1"],
    });
    const cards = slide.elements.filter((el): el is OptionElement => el.type === "option");
    for (const a of cards)
      for (const b of cards) if (a !== b) expect(overlapX(a, b) && overlapY(a, b)).toBe(false);
    // The residual the pipeline must answer (shorter options, or a split): the fit says so.
    expect(fitSlide(slide, theme).overflow.length).toBeGreaterThan(0);
  });

  test("a one-line question hands its second line to the working, which stays on its card", () => {
    const slide = make({
      kind: "worked-example",
      heading: "Explain why the Bolsheviks won the Civil War",
      question: "Explain why the Bolsheviks won the Russian Civil War.",
      steps: [
        "They controlled central Russia and its railways.",
        "This let them move troops and supplies between fronts.",
        "The White forces were divided and had different aims.",
        "Together, Red control and White disunity made victory more likely.",
      ],
      factRefs: ["x1"],
    });
    const card = slide.elements.find((el) => el.type === "shape" && el.name === "Working card");
    const working = byPreset(slide, "body")[1];
    if (!card || !working) throw new Error("worked example");
    expect(bottom(card)).toBeLessThanOrEqual(SAFE_BOTTOM - SPACE[1]);
    expect(bottom(working)).toBeLessThanOrEqual(bottom(card));
    expect(fitSlide(slide, theme).overflow).toEqual([]);
  });

  test("the showcase's two-line question leaves five working lines no card can hold: reported", () => {
    const slide = make({
      kind: "worked-example",
      heading: "Explain why the Bolsheviks won the Civil War",
      question:
        "Explain why the Bolsheviks won the Russian Civil War. Choose the strongest two reasons from a source pack.",
      steps: [
        "They controlled central Russia and its railways.",
        "This let them move troops and supplies between fronts.",
        "The White forces were divided and had different aims.",
        "Together, Red control and White disunity made victory more likely.",
      ],
      factRefs: ["x1"],
    });
    const card = slide.elements.find((el) => el.type === "shape" && el.name === "Working card");
    if (!card) throw new Error("card");
    // The card keeps its foot inside the safe area; the working that runs past it is the
    // residual the editor's Tidy splits onto a continuation slide.
    expect(bottom(card)).toBeLessThanOrEqual(SAFE_BOTTOM - SPACE[1]);
    expect(fitSlide(slide, theme).overflow).toHaveLength(1);
  });

  test("an exit ticket's footnote stays on the foot of the slide while the list above grows", () => {
    const slide = make({
      kind: "exit-ticket",
      heading: "Explain why and how tsarist rule ended",
      items: [
        "Explain why the army’s mutiny was important in ending tsarist rule in February 1917.",
        "Explain how organisation was important in the Bolsheviks’ seizure of power in October 1917.",
        "Explain why disunity weakened the White forces during the Russian Civil War.",
      ],
      footnote: "Answer all three in your books. Use because, so and therefore.",
      factRefs: ["q4"],
    });
    const [list] = byPreset(slide, "body");
    const [foot] = byPreset(slide, "small");
    if (!list || !foot) throw new Error("exit ticket");
    expect(bottom(foot)).toBeLessThanOrEqual(SAFE_BOTTOM);
    expect(foot.y).toBeGreaterThanOrEqual(bottom(list));
  });

  test("a slide whose copy fits the recipe is returned as the recipe drew it", () => {
    const slide = make({
      kind: "content",
      heading: "Forces",
      body: "A push or a pull.",
      factRefs: [],
    });
    expect(fitSlide(slide, theme).slide).toBe(slide);
  });
});

describe("reflowSlide: a box pinned to the foot of the safe area (TEACH-28)", () => {
  const foot = (y: number, h: number): TextElement => ({
    id: "foot",
    type: "text",
    x: SAFE.x,
    y,
    w: SAFE.w,
    h,
    doc: docFromText("Answer in your books."),
    style: { preset: "small" },
  });
  const body = (h: number): TextElement => ({
    id: "body",
    type: "text",
    x: SAFE.x,
    y: 140,
    w: SAFE.w,
    h,
    doc: docFromText("x"),
    style: { preset: "body" },
  });

  test("is not pushed by a block that grows into the slack above it", () => {
    const slide: Slide = { id: "s", kind: "exit-ticket", elements: [body(100), foot(459, 38)] };
    const ruler = (input: { preset: string }) => (input.preset === "body" ? 280 : 38);
    const out = reflowSlide(slide, theme, ruler);
    expect(out.elements.find((el) => el.id === "foot")?.y).toBe(459);
    expect(out.stepped).toEqual([]);
    expect(out.overflow).toEqual([]);
  });

  test("is pushed once the block comes within one spacing stop of it", () => {
    const slide: Slide = { id: "s", kind: "exit-ticket", elements: [body(100), foot(459, 38)] };
    const ruler = (input: { preset: string }) => (input.preset === "body" ? 320 : 38);
    const out = reflowSlide(slide, theme, ruler);
    expect(out.elements.find((el) => el.id === "foot")?.y ?? 0).toBeGreaterThan(459);
  });
});
