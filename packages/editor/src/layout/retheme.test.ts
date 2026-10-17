import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { Lesson, Slide } from "@tj/domain/documents";
import { DEMO_LESSON_SPECS, demoLessonSlides, measureHeadless, type SlideSpec } from "@tj/slides";
import * as kit from "@tj/slides/relayout";
import { ANSWERS_NAMES, answerGroupsOf, endAnswerSlides } from "@tj/slides/templates/end-answers";
import * as reducers from "../model/reducers";
import { getTheme, THEMES } from "../model/themes";
import { renderedHeights } from "./fit-plan";
import { lintSlide } from "./lint";
import {
  recolourSlide,
  relayLayouts,
  rethemeFromReducer,
  rethemeLesson,
  slidesNeedingFit,
} from "./retheme";

/*
 * TEACH-258 FR5: a generated lesson re-themed with `setTheme` alone keeps the old theme's boxes
 * under the new theme's type; `rethemeLesson` tidies what that breaks. The fixture is the fake
 * AI's own slide specs (`@tj/generation` fixtures, the deck the e2e generation writes) run
 * through `materialiseSlide` + `fitSlide` in the default theme, as the pipeline does, and measured
 * with `fitSlide`'s own headless ruler.
 */

const fixture = JSON.parse(
  readFileSync(new URL("../../../generation/src/fixtures/slides.json", import.meta.url), "utf8"),
) as Record<string, SlideSpec>;
const specs: SlideSpec[] = [
  ...DEMO_LESSON_SPECS.filter((s) => s.kind === "title" || s.kind === "objectives"),
  ...Object.values(fixture),
];

function generated(themeId: string): Lesson {
  const { slides } = demoLessonSlides(themeId, { specs });
  return {
    id: "lesson-retheme",
    type: "lesson",
    title: "States of matter",
    themeId,
    slides,
    createdAt: "2026-09-28T00:00:00.000Z",
    updatedAt: "2026-09-28T00:00:00.000Z",
  } as unknown as Lesson;
}

/** Every word the lesson shows, in any element, as a sorted bag. */
function words(lesson: Lesson): string[] {
  const out: string[] = [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === "object") {
      for (const [key, value] of Object.entries(node)) {
        if (key === "text" && typeof value === "string") out.push(...value.split(/\s+/));
        else walk(value);
      }
    }
  };
  walk(lesson.slides.map((s) => s.elements));
  return out.filter(Boolean).sort();
}

/** Lint totals for the lesson as the renderer draws it, under its own theme. */
function lintTotals(lesson: Lesson) {
  const theme = getTheme(lesson.themeId);
  const measure = measureHeadless(theme);
  const totals = { overlaps: 0, overflow: 0, lane: 0 };
  for (const slide of lesson.slides) {
    const lint = lintSlide(renderedHeights(slide, measure), measure, theme);
    totals.overlaps += lint.overlaps.length;
    totals.overflow += lint.overflow.length;
    totals.lane += lint.laneOverflow.length;
  }
  return totals;
}
const show = (t: ReturnType<typeof lintTotals>) =>
  `overlaps ${t.overlaps}, overflow ${t.overflow}, lane ${t.lane}`;

describe("re-theming a generated lesson (TEACH-258 FR5)", () => {
  const base = generated("splash");
  const report: string[] = [];

  test("the fixture has no overlap or overflow in the theme it was generated in", () => {
    // The multiple-choice slide's options already cover its explanation lane when generated, in
    // every theme: a generation finding, not a theme one, so the lane is counted but not held here.
    expect(lintTotals(base)).toMatchObject({ overlaps: 0, overflow: 0 });
  });

  for (const theme of THEMES.filter((t) => t.id !== "splash")) {
    test(`chalk → ${theme.id}: re-fitted with no overlap or overflow, every word kept, one theme`, () => {
      const naive = reducers.setTheme(base, theme.id);
      const measure = measureHeadless(theme);
      const { lesson: after, outcome } = rethemeLesson(base, theme.id, measure);
      const before = lintTotals(naive);
      const fitted = lintTotals(after);
      report.push(
        `${theme.id}: setTheme only → ${show(before)}; rethemeLesson → ${show(fitted)}; tidied ${outcome.tidied.length}, slides ${base.slides.length} → ${after.slides.length}`,
      );
      expect(fitted).toMatchObject({ overlaps: 0, overflow: 0 });
      expect(after.themeId).toBe(theme.id);
      expect(outcome.overflow).toEqual([]);
      expect(words(after)).toEqual(words(base));
      expect(slidesNeedingFit(after, theme, measure).length).toBeLessThanOrEqual(
        slidesNeedingFit(naive, theme, measure).length,
      );
    });
  }

  test("before/after counts (printed for the PR)", () => {
    console.log(`re-theme from chalk\n  ${report.join("\n  ")}`);
    expect(report.length).toBe(THEMES.length - 1);
  });

  test("choosing the theme the lesson already has changes nothing", () => {
    const { lesson, outcome } = rethemeLesson(base, "splash", measureHeadless(getTheme("splash")));
    expect(lesson).toBe(base);
    expect(outcome.tidied).toEqual([]);
  });

  test("the picker's preview always starts from the opening lesson, so browsing never stacks", () => {
    const measure = measureHeadless(getTheme("playground"));
    const once = rethemeLesson(base, "playground", measure).lesson;
    const browsed = rethemeLesson(once, "beacon", measureHeadless(getTheme("beacon"))).lesson;
    // Same result as re-theming the opening lesson directly (`updatedAt` is the clock's).
    const previewed = rethemeFromReducer(browsed, base, "playground", measure).lesson;
    expect(previewed.themeId).toBe(once.themeId);
    expect(previewed.slides).toEqual(once.slides);
    expect(rethemeFromReducer(browsed, base, "splash", measure).lesson).toBe(base);
  });

  test("the palette follows the theme: no old-theme colour is left, text is untouched", () => {
    const chalk = getTheme("splash");
    const night = getTheme("night-lab");
    const { lesson: after } = rethemeLesson(base, "night-lab", measureHeadless(night));
    const json = JSON.stringify(after.slides.map((s) => s.elements)).toLowerCase();
    for (const [key, value] of Object.entries(chalk.colors)) {
      const same =
        (night.colors as Record<string, string>)[key]?.toLowerCase() === value.toLowerCase();
      if (!same) expect(json).not.toContain(`"${value.toLowerCase()}"`);
    }
    expect(words(after)).toEqual(words(base));
    const custom = { ...base.slides[0], elements: [] } as unknown as Parameters<
      typeof recolourSlide
    >[0];
    expect(recolourSlide(custom, chalk, chalk)).toBe(custom);
  });
});

/*
 * TEACH-75 part aq: an adaptive layout laid in one theme's faces broke a word in another's
 * (Studio's 44 title in Treehouse: "Brother / s and sisters"; in Crayon: "Find the resultan / t").
 * A re-theme now re-lays every layout group by its template in the new faces.
 */
describe("re-theme re-lays adaptive layouts in the new theme's faces", () => {
  // 16 Oct 2026, TEACH-215 part d: at the golds' 45.3 heading no word breaks in stale Crayon (or any
  // other theme tried) without also breaking in Studio, so this case has no stale fit to repair.
  // Follow-up: find a heading and theme pair at the new sizes that breaks only after the re-theme.
  test.todo(`"Find the resultant" in crayon: no word breaks`, () => {});
  // 17 Oct 2026, TEACH-205 part d: the side column is 313 wide with or without a visual (ruling
  // 257), so "Brothers and sisters" no longer breaks in stale Treehouse; twelve long headings across
  // nine themes found no other pair that breaks only after the re-theme. Same follow-up as above.
  test.todo(`"Brothers and sisters" in treehouse: no word breaks`, () => {});
});

/*
 * TEACH-191 part c: the deck's Answers slides are built in the theme they are drawn in. Built in
 * Splash and drawn in Paper's wider faces, a wrapped answer ran into the next row (live Year 4
 * Romans, slide 13); a re-theme now builds them again from the questions.
 */
describe("re-theme: the Answers slides follow the new faces", () => {
  const doc = (text: string) => ({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  });
  const live = [
    [
      "Explain the changes",
      "The straight route shortens the journey, and the firm surface helps the cart travel in wet weather.",
      "The farmer has a place to sell grain, and townspeople have a place to buy food.",
    ],
    [
      "Use the clues",
      "The aqueduct brings water into town, and public baths give people a shared place to wash and meet.",
      "Its name suggests a Roman fort, but physical remains would provide more evidence.",
    ],
  ];
  const practice = live.map(([title, ...answers], i) => ({
    id: `p${i}`,
    kind: "open-response",
    elements: [
      {
        id: `h${i}`,
        type: "text",
        name: "Heading",
        x: 64,
        y: 46,
        w: 832,
        h: 54,
        style: { preset: "heading" },
        doc: doc(title as string),
      },
    ],
    question: {
      type: "open-response",
      modelAnswer: answers.map((a, n) => `${n + 1}. ${a}`).join("\n"),
    },
  })) as unknown as Slide[];
  const splash = getTheme("splash", "ks2");
  const deck = (): Lesson => ({
    ...generated("splash"),
    ageBand: "ks2",
    // A writer lesson, so it renders at KS2 like the theme its Answers were built in (TEACH-191 d).
    generation: {
      promptVersions: { planned: "lesson-writer.v4.4" },
    } as unknown as Lesson["generation"],
    slides: [...practice, ...endAnswerSlides(answerGroupsOf(practice), splash, "ks2")],
  });
  const answerBoxes = (lesson: Lesson) =>
    lesson.slides
      .filter((s) => s.answersRole === "answers")
      .flatMap((s) => s.elements)
      .filter((e) => e.type === "text" && e.name === ANSWERS_NAMES.sentence);

  test("Splash to Paper: the answer boxes are rebuilt, the guard keeps its id", () => {
    const base = deck();
    const opening = JSON.stringify(base);
    const after = rethemeLesson(base, "paper", measureHeadless(getTheme("paper")), kit).lesson;
    expect(after.slides.slice(0, 2)).toEqual(practice);
    expect(after.slides[2]?.id).toBe(base.slides[2]?.id);
    const fresh = endAnswerSlides(answerGroupsOf(practice), getTheme("paper", "ks2"), "ks2");
    expect(answerBoxes(after).map((e) => [e.y, e.h])).toEqual(
      answerBoxes({ ...base, slides: fresh }).map((e) => [e.y, e.h]),
    );
    // Without the template code the old boxes stay, too short for Paper's wider face: the bug.
    const stale = rethemeLesson(base, "paper", measureHeadless(getTheme("paper")), null).lesson;
    expect(answerBoxes(stale).map((e) => e.h)).toEqual(answerBoxes(base).map((e) => e.h));
    expect(answerBoxes(after).map((e) => e.h)).not.toEqual(answerBoxes(base).map((e) => e.h));
    // The same pass as the adaptive layouts: re-laying the switched lesson directly agrees.
    const switched = { ...base, themeId: "paper" };
    expect(answerBoxes(relayLayouts(switched, kit, base)).map((e) => [e.y, e.h])).toEqual(
      answerBoxes(after).map((e) => [e.y, e.h]),
    );
    // One undo step: the switch is pure, and going back to the opening theme gives the deck back.
    expect(JSON.stringify(base)).toBe(opening);
    expect(rethemeFromReducer(after, base, "splash", measureHeadless(splash)).lesson).toBe(base);
  });

  test("an edited Answers slide is left byte for byte as it was", () => {
    const base = deck();
    const i = base.slides.findIndex((s) => s.answersRole === "answers");
    const page = base.slides[i] as Slide;
    const edited: Lesson = {
      ...base,
      slides: base.slides.map((s, k) =>
        k === i
          ? {
              ...page,
              elements: page.elements.map((e) =>
                e.type === "text" && e.name === ANSWERS_NAMES.sentence
                  ? { ...e, doc: doc("Firm roads, faster carts.") as never }
                  : e,
              ),
            }
          : s,
      ),
    };
    const after = rethemeLesson(edited, "paper", measureHeadless(getTheme("paper")), kit).lesson;
    const answers = (l: Lesson) =>
      JSON.stringify(
        l.slides
          .filter((s) => s.answersRole)
          .map((s) => s.elements.map((e) => [e.id, e.x, e.y, e.w, e.h, "doc" in e ? e.doc : null])),
      );
    expect(answers(after)).toBe(answers(edited));
  });

  test("nothing to re-lay: the same lesson object comes back", () => {
    const base = deck();
    expect(relayLayouts(base, kit)).toBe(base);
    const plain = { ...base, slides: practice };
    expect(relayLayouts(plain, kit, plain)).toBe(plain);
  });
});
