/**
 * TEACH-247 part ag (Great Fire of London, Year 2): the job laid the deck out in the theme the
 * lesson started in (Splash) and the teacher picked Crayon Box while it wrote. A slide arriving
 * after the pick was only recoloured, so Crayon's wider handwriting face ran a task through the
 * divider under it and an exit ticket's second task through its card's border. It is now fitted
 * to the lesson's theme as it is recoloured.
 */
import { describe, expect, test } from "bun:test";
import type { Lesson, Slide, SlideElement } from "@tj/domain/documents";
import { measureHeadless, SAFE, SPACE } from "@tj/slides";
import { layoutTemplate, type TemplateInput } from "@tj/slides/templates";
import { inLessonTheme } from "../layout/retheme";
import { tidySlide } from "../layout/tidy";
import { renderTheme } from "../model/themes";
import { seededLesson } from "./test-harness";

const EXIT = [
  "Where and when did the Great Fire begin? Write.",
  "Explain spread; name two ways people fought the fire.",
];
const input = (template: string, questions: string[]): TemplateInput =>
  ({
    template,
    heading: template === "practice" ? "Imagine another street" : "Show what you know",
    questions,
  }) as TemplateInput;

const lessonIn = (themeId: string): Lesson =>
  ({ ...seededLesson(), themeId, yearGroup: "Year 2" }) as Lesson;

const laidIn = (from: string, template: string, questions: string[]): Slide => {
  const theme = renderTheme(lessonIn(from));
  const r = layoutTemplate(input(template, questions), theme, "ks1");
  const elements = (r.slide.elements as SlideElement[]).map((e) => ({ ...e, authoredBy: "ai" }));
  return { id: `job-${template}`, ...r.slide, elements } as Slide;
};

type Box = { name?: string; x: number; y: number; w: number; h: number };
const els = (s: Slide) => s.elements as unknown as Box[];
const textOf = (a: { doc?: unknown }) => JSON.stringify(a.doc ?? "");

describe("a job slide laid in the starting theme is fitted to the teacher's (TEACH-247 part ag)", () => {
  const lesson = lessonIn("crayon");
  const theme = renderTheme(lesson);
  const ruler = measureHeadless(theme);

  test("exit ticket: the card grows with a task the browser wraps taller", () => {
    const slide = laidIn("splash", "exit-ticket", EXIT);
    // The browser drew the second task taller than the ruler did (Great Fire s13 ran 6px past its card).
    const browser = ((a: { doc?: unknown }) =>
      ruler(a as never) * (textOf(a).includes("Explain spread") ? 1.4 : 1)) as typeof ruler;
    const fitted = inLessonTheme(slide, lesson, browser);
    const card = els(fitted).find((e) => e.name === "surface:card") as Box;
    for (const t of els(fitted).filter((e) => e.name === "Task"))
      expect(t.y + t.h).toBeLessThanOrEqual(card.y + card.h);
  });

  test("an ordinary Tidy never grows a card past the recipe's foot", () => {
    const slide = { ...laidIn("crayon", "exit-ticket", EXIT), id: "own" } as Slide;
    const browser = ((a: { doc?: unknown }) =>
      ruler(a as never) * (textOf(a).includes("Explain spread") ? 1.4 : 1)) as typeof ruler;
    const out = tidySlide({ ...lesson, slides: [slide] }, "own", browser).lesson.slides[0] as Slide;
    const card = els(out).find((e) => e.name === "surface:card") as Box;
    expect(card.y + card.h).toBeLessThanOrEqual(SAFE.y + SAFE.h - SPACE[1] + 0.5);
  });
});
