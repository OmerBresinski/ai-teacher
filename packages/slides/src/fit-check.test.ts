import { describe, expect, test } from "bun:test";
import type { Slide, TextElement } from "@tj/domain/documents";
import { docFromText } from "./factories";
import { answersOverQuestions, fitsPlanned, slideFits, stepsTaken } from "./fit-check";
import { materialiseSlide } from "./materialise";
import { ANSWERS_NAME, isGeneratedSlide } from "./reflow";
import type { SlideSpec } from "./specs";
import { ladderStops, resolveFontSize } from "./text-style";
import { getTheme, THEMES } from "./themes";

const META = { promptVersion: "test", model: "test", at: "2026-09-30T00:00:00.000Z" };

const short: SlideSpec = {
  kind: "content",
  factRefs: ["k1"],
  heading: "Roots take in water",
  body: "Roots take water and minerals from the soil.",
};

const long: SlideSpec = {
  kind: "content",
  factRefs: ["k1"],
  heading: "Roots, stems and leaves each do a different job for the plant",
  body: Array.from(
    { length: 9 },
    (_, i) =>
      `Point ${i + 1}: the roots hold the plant in the soil and take in water and minerals, which travel up the stem to the leaves.`,
  ).join(" "),
};

const worked: SlideSpec = {
  kind: "worked-example",
  factRefs: ["w1"],
  heading: "Sharing in a ratio",
  question: "Share 35 sweets in the ratio 2 : 5.",
  steps: [
    "Add the parts: 2 + 5 = 7 parts.",
    "Find one part: 35 ÷ 7 = 5 sweets.",
    "Multiply: 2 × 5 = 10 and 5 × 5 = 25.",
    "Check: 10 + 25 = 35.",
  ],
} as SlideSpec;

describe("fitsPlanned", () => {
  test("a short slide fits at body size on every theme", () => {
    const result = fitsPlanned(short, { stepDown: 0 });
    expect(result.failing).toEqual([]);
    expect(result.ok).toBe(true);
  });

  test("a slide whose words run past the safe area fails, at either headroom, naming the themes", () => {
    for (const stepDown of [0, 1] as const) {
      const result = fitsPlanned(long, { stepDown });
      expect(result.ok).toBe(false);
      expect(result.failing.length).toBe(THEMES.length);
      expect(result.failing.every((f) => f.overflow.length > 0 || f.steps > stepDown)).toBe(true);
    }
  });

  test("the save gate allows the one stop down the planning headroom does not", () => {
    // A worked example whose steps only fit a stop down on some themes: planned, it is refused;
    // saved, it passes.
    const plan = fitsPlanned(worked, { stepDown: 0 });
    const save = fitsPlanned(worked, { stepDown: 1 });
    expect(save.ok).toBe(true);
    expect(plan.ok).toBe(false);
    expect(plan.failing.every((f) => f.steps === 1 && f.overflow.length === 0)).toBe(true);
  });

  test("the slide judged is the slide the caller saves: `finish` runs before the check", () => {
    // An answers reveal laid over the heading, as a caller might add after materialising.
    const finish = (slide: Slide): Slide => {
      const heading = slide.elements.find((e) => e.type === "text");
      if (!heading) throw new Error("no heading");
      const cover = {
        id: "answers",
        type: "shape",
        shape: "rect",
        name: ANSWERS_NAME,
        x: heading.x,
        y: heading.y,
        w: heading.w,
        h: heading.h,
        revealStep: 1,
        reveal: "fade",
      } as Slide["elements"][number];
      return { ...slide, elements: [...slide.elements, cover] };
    };
    const result = fitsPlanned(short, { stepDown: 1, finish });
    expect(result.failing).toHaveLength(THEMES.length);
    expect(result.failing.every((f) => f.answers.length > 0)).toBe(true);
  });

  test("themes can be narrowed", () => {
    const one = fitsPlanned(long, { stepDown: 1, themes: [getTheme("chalk")] });
    expect(one.failing.map((f) => f.theme)).toEqual(["chalk"]);
  });
});

describe("stepsTaken", () => {
  const theme = getTheme("chalk");
  let n = 0;
  const slide = (): Slide => materialiseSlide(short, "chalk", META, () => `e${++n}`);

  test("0 when every text is at its own size", () => {
    expect(stepsTaken(slide(), theme)).toBe(0);
  });

  test("counts ladder stops under the text's own size", () => {
    const s = slide();
    // The key idea under the heading: the last text the recipe lays.
    const body = s.elements.findLast((e): e is TextElement => e.type === "text");
    if (!body) throw new Error("no body");
    const own = resolveFontSize(theme, body.style.preset);
    const next = ladderStops(theme).find((stop) => stop < own - 0.5) as number;
    body.style = { ...body.style, fontSize: next };
    expect(stepsTaken(s, theme)).toBe(1);
    expect(slideFits(s, theme, 0).ok).toBe(false);
    expect(slideFits(s, theme, 1)).toMatchObject({ ok: true, steps: 1 });
  });
});

describe("answersOverQuestions", () => {
  const theme = getTheme("chalk");
  const text = (id: string, y: number, h: number, words: string): Slide["elements"][number] => ({
    id,
    type: "text",
    x: 58,
    y,
    w: 844,
    h,
    doc: docFromText(words),
    style: { preset: "body", autoHeight: true },
  });
  const panel = (y: number, h: number): Slide["elements"][number] => ({
    id: "answers",
    type: "shape",
    shape: "rect",
    name: ANSWERS_NAME,
    x: 58,
    y,
    w: 844,
    h,
    revealStep: 1,
    reveal: "fade",
  });
  const slide = (elements: Slide["elements"]): Slide => ({ id: "s", kind: "starter", elements });

  test("answers clear of the questions: nothing", () => {
    expect(
      answersOverQuestions(
        slide([text("q", 140, 60, "1. What do roots do?"), panel(400, 60)]),
        theme,
      ),
    ).toEqual([]);
  });

  test("answers laid over the questions they answer: the questions are named", () => {
    const covered = slide([text("q", 140, 300, "1. What do roots do?"), panel(400, 60)]);
    expect(answersOverQuestions(covered, theme)).toEqual(["q"]);
    // And the slide does not fit, at any headroom.
    expect(slideFits(covered, theme, 1).answers).toEqual(["q"]);
    expect(slideFits(covered, theme, 1).ok).toBe(false);
  });

  test("questions that grow into the answers as drawn count, though stored short", () => {
    const long = Array.from({ length: 12 }, (_, i) => `${i + 1}. Name a part of a plant.`).join(
      "\n",
    );
    expect(answersOverQuestions(slide([text("q", 140, 40, long), panel(400, 60)]), theme)).toEqual([
      "q",
    ]);
  });

  test("a slide with no answers reveal has nothing to cover", () => {
    expect(
      answersOverQuestions(slide([text("q", 140, 300, "1. What do roots do?")]), theme),
    ).toEqual([]);
  });
});

describe("isGeneratedSlide", () => {
  let n = 0;
  const made = (): Slide => materialiseSlide(short, "chalk", META, () => `g${++n}`);

  test("a slide as generation wrote it: every element the AI's", () => {
    expect(isGeneratedSlide(made())).toBe(true);
  });

  test("an edited element or one a teacher inserted makes the slide the teacher's", () => {
    const s = made();
    const edited = {
      ...s,
      elements: s.elements.map((e, i) => (i === 0 ? { ...e, authoredBy: "teacher" as const } : e)),
    };
    expect(isGeneratedSlide(edited)).toBe(false);
    const inserted = {
      ...s,
      elements: [...s.elements, { ...s.elements[0], id: "mine", authoredBy: undefined }],
    };
    expect(isGeneratedSlide(inserted as Slide)).toBe(false);
  });

  test("an empty slide is nobody's", () => {
    const empty: Slide = { id: "s", kind: "content", elements: [] };
    expect(isGeneratedSlide(empty)).toBe(false);
  });
});
