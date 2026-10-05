import { describe, expect, test } from "bun:test";
import type { OptionElement, Slide, SlideElement, TextElement } from "@tj/domain/documents";
import { docFromText } from "./factories";
import { fitSlide } from "./fit-slide";
import { SAFE, SPACE } from "./grid";
import { HEADING_DISPLAY } from "./look";
import { materialiseSlide, materialiseSlides } from "./materialise";
import { SAFE_BOTTOM } from "./metrics";
import { reflowSlide } from "./reflow";
import type { SlideSpec } from "./specs";
import { measureHeadless } from "./text-measure";
import { floorBelow } from "./text-style";
import { getTheme, THEMES } from "./themes";

/*
 * TEACH-28: the copy of the Year 9 Russian Revolution showcase lesson (np1, 23 Sep 2026), whose
 * print deck had a title under its class line, headings struck through by their rules, answer
 * cards over each other and a worked example off its card. Each case materialises the slide the
 * worker would write and holds the geometry that the print route draws as stored.
 */

const META = { promptVersion: "test", model: "test", at: "2026-09-24T00:00:00.000Z" };
const THEME = "chalk";
const theme = getTheme(THEME);

function make(spec: SlideSpec, variant?: string): Slide {
  let n = 0;
  return materialiseSlide(spec, THEME, META, () => `e${++n}`, variant);
}

const texts = (slide: Slide) =>
  slide.elements.filter((el): el is TextElement => el.type === "text");
const byPreset = (slide: Slide, preset: TextElement["style"]["preset"]) =>
  texts(slide).filter((el) => el.style.preset === preset);
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

  test("a two-line heading keeps its size and pushes the body below it, never through it", () => {
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
    // The look names the heading so the fit never steps it down (`look.ts`): one display size
    // across teaching slides, a long heading wrapping to two lines at it.
    expect(heading.style.fontSize).toBe(Math.round(theme.sizes.heading * HEADING_DISPLAY));
    expect(body.y).toBeGreaterThanOrEqual(bottom(heading));
    // A two-line display heading leaves less room: as one slide the words may overrun, which the
    // fit reports for Tidy; with pages (generation) every slide stays inside the safe area.
    const pages = materialiseSlides(
      {
        kind: "content",
        heading: "War exposed tsarist weaknesses and created a Petrograd crisis",
        body: "War brought defeats, deaths, inflation and shortages. In Petrograd, bread and fuel queues turned hardship into protests; soldiers mutinied (refused orders). The Tsar failed to restore trust or control the crisis, so he abdicated (gave up power).",
        factRefs: ["k1"],
      },
      THEME,
      META,
    );
    for (const p of pages)
      for (const el of texts(p)) expect(bottom(el)).toBeLessThanOrEqual(SAFE_BOTTOM);
  });

  test("options that wrap in the grid's cards are laid as full-width rows, one line each, in order", () => {
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
    for (const card of cards) {
      expect(card.x).toBe(SAFE.x);
      expect(card.w).toBe(SAFE.w);
      expect(card.textStyle?.padding).toBe(SPACE[1]);
    }
    // One line each: every row is as tall as the first, and A to D read top to bottom with at
    // least a 14pt gap between rows (T28-8: the rows read as separate cards), landed on the pitch.
    const heights = new Set(cards.map((card) => card.h));
    expect(heights.size).toBe(1);
    for (let i = 1; i < cards.length; i++) {
      const prev = cards[i - 1] as OptionElement;
      const gap = (cards[i] as OptionElement).y - bottom(prev);
      expect(gap).toBeGreaterThanOrEqual(SPACE[2]);
      expect(gap).toBeLessThan(SPACE[2] + 7);
    }
    // The stem stays on the question floor: shrinking it would buy the cards no room.
    expect(byPreset(slide, "heading")[0]?.style.fontSize).toBeUndefined();
    for (const card of cards) expect(bottom(card)).toBeLessThanOrEqual(SAFE_BOTTOM);
    expect(fitSlide(slide, theme).overflow).toEqual([]);
    // The answer data still points at the same cards.
    expect(slide.question?.type === "multiple-choice" && slide.question.options[0]?.id).toBe(
      (cards[0] as OptionElement).id,
    );
  });

  test("options of a word or two keep the recipe's 2x2 grid", () => {
    const slide = make({
      kind: "multiple-choice",
      stem: "In which year did the Tsar abdicate?",
      options: [
        { text: "1917", correct: true },
        { text: "1905", correct: false },
        { text: "1914", correct: false },
        { text: "1921", correct: false },
      ],
      factRefs: ["q2"],
    });
    const cards = slide.elements.filter((el): el is OptionElement => el.type === "option");
    expect(new Set(cards.map((card) => card.x)).size).toBe(2);
    expect(new Set(cards.map((card) => card.y)).size).toBe(2);
    for (const card of cards) expect(card.textStyle?.padding).toBeUndefined();
  });

  test("options of eighty characters each step once and no further; what is left is reported", () => {
    const long = (n: number) =>
      `Option ${n}: soldiers, sailors and workers across the capital refused every order given`;
    const slide = make({
      kind: "multiple-choice",
      stem: "Which event was an important turning point in ending tsarist rule in February 1917?",
      options: [1, 2, 3, 4].map((n) => ({ text: long(n), correct: n === 1 })),
      factRefs: ["q1"],
    });
    const cards = slide.elements.filter((el): el is OptionElement => el.type === "option");
    // One stop under the 31pt option floor (UX ruling 91), never a second.
    for (const card of cards)
      expect(card.textStyle?.fontSize).toBe(floorBelow(theme, "small", "option"));
    expect(byPreset(slide, "heading")[0]?.style.fontSize).toBe(
      floorBelow(theme, "heading", "question"),
    );
    expect(fitSlide(slide, theme).overflow.length).toBeGreaterThan(0);
  });

  test("the showcase's 86-character option (slide 7): full-width rows, one stop down, inside the safe area", () => {
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
    // Full-width rows at one stop under the option floor (UX ruling 91), A to D in order, every
    // row inside the safe area; the stem did not need to step.
    for (const card of cards) {
      expect(card.w).toBe(SAFE.w);
      expect(card.textStyle?.fontSize).toBe(floorBelow(theme, "small", "option"));
      expect(card.textStyle?.fontSize).toBeLessThan(31);
      expect(bottom(card)).toBeLessThanOrEqual(SAFE_BOTTOM);
    }
    // The rows keep the column's gap at the stepped size (re-pitched for the shorter row, not
    // left on the floor size's pitch), and the last row, two lines, still ends clear of the foot.
    for (let i = 1; i < cards.length; i++) {
      const gap = (cards[i] as OptionElement).y - bottom(cards[i - 1] as OptionElement);
      expect(gap).toBeGreaterThanOrEqual(SPACE[2]);
      expect(gap).toBeLessThan(SPACE[2] + 7);
    }
    expect(bottom(cards[3] as OptionElement)).toBeLessThanOrEqual(SAFE_BOTTOM - SPACE[2]);
    expect(byPreset(slide, "heading")[0]?.style.fontSize).toBeUndefined();
    expect(fitSlide(slide, theme).overflow).toEqual([]);
  });

  // Steps of two lines each at the teaching body size: too long for step cards or a strip, so the
  // worked example keeps its working card (the fallback this pins).
  test("a one-line question and four long steps set as step rows, not the working card", () => {
    const slide = make(
      {
        kind: "worked-example",
        heading: "Explain why the Bolsheviks won the Civil War",
        question: "Explain why the Bolsheviks won the Russian Civil War.",
        steps: [
          "They controlled central Russia, its big industrial cities and the main railway lines",
          "Railways let them move troops and supplies quickly between the different fronts of the war",
          "The White armies were divided, far apart and wanted different things after the war was won",
          "Red control of the centre and White disunity together made a Bolshevik victory far more likely",
        ],
        factRefs: ["x1"],
      },
      "working-card",
    );
    // UX ruling 151: the working is step rows, never the dense card.
    expect(slide.elements.some((el) => el.name === "Working card")).toBe(false);
    const steps = slide.elements.filter((el) => /^Step \d+$/.test(el.name ?? ""));
    expect(steps).toHaveLength(4);
    for (const s of steps) expect(bottom(s)).toBeLessThanOrEqual(SAFE_BOTTOM);
    expect(fitSlide(slide, theme).overflow).toEqual([]);
  });

  // Steps of two lines each at the teaching body size: too long for step cards or a strip, so the
  // worked example keeps its working card (the fallback this pins).
  test("the showcase's two-line question and four long steps set as step rows that fit", () => {
    const slide = make(
      {
        kind: "worked-example",
        heading: "Explain why the Bolsheviks won the Civil War",
        question:
          "Explain why the Bolsheviks won the Russian Civil War. Choose the strongest two reasons from a source pack.",
        steps: [
          "They controlled central Russia, its big industrial cities and the main railway lines, and why",
          "Railways let them move troops and supplies quickly between the different fronts, and why",
          "The White armies were divided, far apart and wanted different things after the war, and why",
          "Red control of the centre and White disunity together made a Bolshevik victory likely, and why",
        ],
        factRefs: ["x1"],
      },
      "working-card",
    );
    // UX ruling 151: the working is step rows, each step with its reason inline, never the card;
    // the long lines that overflowed the card now fit.
    expect(slide.elements.some((el) => el.name === "Working card")).toBe(false);
    expect(slide.elements.filter((el) => /^Step \d+$/.test(el.name ?? ""))).toHaveLength(4);
    expect(fitSlide(slide, theme).overflow).toEqual([]);
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
    const list = byPreset(slide, "body");
    const [foot] = byPreset(slide, "small");
    if (list.length === 0 || !foot) throw new Error("exit ticket");
    expect(bottom(foot)).toBeLessThanOrEqual(SAFE_BOTTOM);
    for (const q of list) expect(foot.y).toBeGreaterThanOrEqual(bottom(q));
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

/*
 * TEACH-140: the image-text recipe's photograph runs down the left from the top of the slide to
 * the bottom (0,0 to 540), past the safe area by design. `reflowSlide` counted it as overflow, so
 * every image-text slide stepped its heading and body down to the floor whether its copy fitted
 * or not. A picture is never text overflow: copy that fits keeps the theme's sizes, and copy that
 * really overruns still steps down.
 */
describe("fitSlide on an image-text slide (TEACH-140)", () => {
  const imageText = (body: string): SlideSpec => ({
    kind: "image-text",
    factRefs: ["o3"],
    heading: "Clouds over the sea",
    body,
    callout: { kind: "watch-out", text: "Vapour is invisible." },
  });
  const SENTENCE = "Warm air rises from the sea carrying water vapour. ";
  const laid = (spec: SlideSpec, themeId: string) => {
    let n = 0;
    return materialiseSlide(spec, themeId, META, () => `e${++n}`);
  };

  for (const t of THEMES) {
    test(`${t.id}: copy that fits keeps the theme's sizes, and the picture is not an overflow`, () => {
      const slide = laid(imageText(SENTENCE.trim()), t.id);
      const picture = slide.elements.find((el) => el.type === "image");
      expect(picture && bottom(picture)).toBeGreaterThan(SAFE_BOTTOM);
      for (const el of texts(slide)) expect(el.style.fontSize, el.name ?? el.id).toBeUndefined();
      const again = fitSlide(slide, t);
      expect(again.overflow).toEqual([]);
      expect(again.slide).toBe(slide);
    });

    test(`${t.id}: copy that really overruns still steps the heading and body down`, () => {
      const slide = laid(imageText(SENTENCE.repeat(9).trim()), t.id);
      const heading = byPreset(slide, "heading")[0];
      const body = byPreset(slide, "body")[0];
      expect(heading?.style.fontSize ?? t.sizes.heading).toBeLessThan(t.sizes.heading);
      expect(body?.style.fontSize ?? t.sizes.body).toBeLessThanOrEqual(t.sizes.body);
      expect(fitSlide(slide, t).overflow).toContain(body?.id ?? "body");
    });
  }

  test("reflowSlide: a picture past the safe area alone is not an overflow and steps nothing", () => {
    const slide = laid(imageText(SENTENCE.trim()), THEME);
    const out = reflowSlide(slide, theme, measureHeadless(theme));
    expect(out.overflow).toEqual([]);
    expect(out.stepped).toEqual([]);
    expect(out.splitAt).toBeUndefined();
  });
});

describe("fill-gap: a gap is measured as its answer, not its token", () => {
  const spec = {
    kind: "fill-gap" as const,
    factRefs: [],
    stem: "Complete the sentence with the correct words.",
    sentence:
      "In electrolysis, positive ions move to the ___, where they gain electrons and are ___.",
    answers: ["cathode", "discharged"],
  };
  const meta = { promptVersion: "t", model: "t", at: "t" };
  test.each(THEMES.map((t) => [t.id]))("%s: the fit does not depend on the gap ids", (id) => {
    const heights = ["a", "bbbbbbbbbbbbbbbbbbbbbbbb"].map((prefix) => {
      let n = 0;
      const slide = materialiseSlide(spec, id, meta, () => `${prefix}${n++}`);
      const gap = fitSlide(slide, getTheme(id)).slide.elements.find((e) => e.type === "gap-text");
      return gap?.h;
    });
    expect(heights[0]).toBe(heights[1]);
  });
});
