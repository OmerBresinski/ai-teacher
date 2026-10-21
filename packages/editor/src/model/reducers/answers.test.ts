import { describe, expect, test } from "bun:test";
import { type Lesson, parseLesson, type Slide } from "@tj/domain/documents";
import { measureHeadless } from "@tj/slides";
import * as kit from "@tj/slides/relayout";
import { ANSWERS_NAMES } from "@tj/slides/templates/end-answers";
import JSZip from "jszip";
import { exportLessonPptx } from "../../export/pptx";
import { rethemeLesson } from "../../layout/retheme";
import { getTheme, renderTheme } from "../themes";
import { answersSlidesOn, setAnswersSlides } from "./answers";

/*
 * TEACH-191 part e (ruling 260): the guard and Answers slides are on by default and the teacher can
 * turn them off. Off removes them in one step and keeps them on the lesson; on builds them again
 * from the current questions, or puts back the ones the teacher had edited.
 */

const doc = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

const practice = (answers: string[][]): Slide[] =>
  answers.map((list, i) => ({
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
        doc: doc(`Practice ${i + 1}`),
      },
    ],
    question: {
      type: "open-response",
      modelAnswer: list.map((a, n) => `${n + 1}. ${a}`).join("\n"),
    },
  })) as unknown as Slide[];

const ANSWERS = [
  ["Evaporation", "Condensation"],
  ["The sun heats the water and it rises as vapour into the air."],
];

function lessonWith(themeId: string, questions: Slide[]): Lesson {
  const base = {
    version: 1,
    id: "lesson-answers",
    title: "The water cycle",
    themeId,
    ageBand: "ks2",
    slides: questions,
    createdAt: "2026-10-16T00:00:00.000Z",
    updatedAt: "2026-10-16T00:00:00.000Z",
  } as unknown as Lesson;
  const theme = renderTheme(base);
  return {
    ...base,
    slides: [...questions, ...kit.buildEndAnswers(questions, theme, kit.stageOf(theme, "ks2"))],
  };
}

const roles = (l: Lesson) => l.slides.map((s) => s.answersRole ?? "-");
const answerWords = (l: Lesson) =>
  l.slides
    .filter((s) => s.answersRole === "answers")
    .flatMap((s) => s.elements)
    .map((e) => JSON.stringify("doc" in e ? e.doc : null))
    .join(" ");

describe("setAnswersSlides", () => {
  test("a lesson reads as on; off removes the guard and every Answers slide, the input untouched", () => {
    const lesson = lessonWith("splash", practice(ANSWERS));
    const opening = JSON.stringify(lesson);
    expect(answersSlidesOn(lesson)).toBe(true);
    expect(roles(lesson)).toEqual(["-", "-", "guard", "answers"]);
    const off = setAnswersSlides(lesson, false, kit);
    expect(roles(off)).toEqual(["-", "-"]);
    expect(answersSlidesOn(off)).toBe(false);
    expect(off.answersOff?.edited).toBe(false);
    expect(off.answersOff?.kept.map((s) => s.id)).toEqual(lesson.slides.slice(2).map((s) => s.id));
    // Pure, so the history's undo hands the opening lesson back.
    expect(JSON.stringify(lesson)).toBe(opening);
    // Already so: the same object, no undo step.
    expect(setAnswersSlides(off, false, kit)).toBe(off);
    expect(setAnswersSlides(lesson, true, kit)).toBe(lesson);
  });

  test("off then on gives the same slides back, ids kept in order", () => {
    const lesson = lessonWith("splash", practice(ANSWERS));
    const back = setAnswersSlides(setAnswersSlides(lesson, false, kit), true, kit);
    expect(back.answersOff).toBeUndefined();
    expect(back.slides).toEqual(lesson.slides);
  });

  test("on after a practice answer was edited: built again from the current answers", () => {
    const lesson = lessonWith("splash", practice(ANSWERS));
    const off = setAnswersSlides(lesson, false, kit);
    const changed = practice([["Evaporation", "Precipitation"], ANSWERS[1] as string[]]);
    const edited = { ...off, slides: changed };
    const on = setAnswersSlides(edited, true, kit);
    expect(roles(on)).toEqual(["-", "-", "guard", "answers"]);
    expect(answerWords(on)).toContain("Precipitation");
    expect(answerWords(on)).not.toContain("Condensation");
    // Same ids policy as a re-theme (part c): the guard keeps its id.
    expect(on.slides[2]?.id).toBe(lesson.slides[2]?.id);
  });

  test("an edited Answers slide is kept while off and put back exactly as it was", () => {
    const lesson = lessonWith("splash", practice(ANSWERS));
    const i = lesson.slides.findIndex((s) => s.answersRole === "answers");
    const page = lesson.slides[i] as Slide;
    const mine = {
      ...page,
      elements: page.elements.map((e) =>
        e.type === "text" && e.name === ANSWERS_NAMES.sentence
          ? { ...e, doc: doc("My own model answer.") as never }
          : e,
      ),
    };
    const teacher = { ...lesson, slides: lesson.slides.map((s, k) => (k === i ? mine : s)) };
    const off = setAnswersSlides(teacher, false, kit);
    expect(roles(off)).toEqual(["-", "-"]);
    expect(off.answersOff?.edited).toBe(true);
    // Even after the questions change, on puts the teacher's slides back, not a rebuild.
    const changed = { ...off, slides: practice([["Freezing"], ["Melting"]]) };
    const on = setAnswersSlides(changed, true, kit);
    expect(on.slides.filter((s) => s.answersRole)).toEqual(teacher.slides.slice(2));
    expect(answerWords(on)).toContain("My own model answer.");
  });

  test("a lesson without the field parses as on; the setting survives save and reload", () => {
    const lesson = lessonWith("splash", practice(ANSWERS));
    expect(answersSlidesOn(parseLesson(JSON.parse(JSON.stringify(lesson))))).toBe(true);
    const off = setAnswersSlides(lesson, false, kit);
    const reloaded = parseLesson(JSON.parse(JSON.stringify(off)));
    expect(answersSlidesOn(reloaded)).toBe(false);
    expect(reloaded.answersOff?.kept.length).toBe(2);
    expect(setAnswersSlides(reloaded, true, kit).slides).toEqual(lesson.slides);
  });

  test("a re-theme while off adds none; on then builds them in the new theme", () => {
    const lesson = lessonWith("splash", practice(ANSWERS));
    const off = setAnswersSlides(lesson, false, kit);
    const paper = rethemeLesson(off, "paper", measureHeadless(getTheme("paper")), kit).lesson;
    expect(roles(paper)).toEqual(["-", "-"]);
    expect(paper.answersOff).toEqual(off.answersOff);
    const on = setAnswersSlides(paper, true, kit);
    const fresh = lessonWith("paper", practice(ANSWERS));
    const shape = (slides: Slide[]) => slides.map((s) => s.elements.map(({ id: _, ...e }) => e));
    expect(shape(on.slides.slice(2))).toEqual(shape(fresh.slides.slice(2)));
  });

  test("PPTX export of a lesson with them off has no guard or Answers slide", async () => {
    const lesson = setAnswersSlides(lessonWith("splash", practice(ANSWERS)), false, kit);
    const zip = await JSZip.loadAsync(
      await (await exportLessonPptx(lesson, renderTheme(lesson), {})).arrayBuffer(),
    );
    const files = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f));
    const xml = (await Promise.all(files.map((f) => zip.file(f)?.async("string")))).join("");
    expect(files.length).toBeGreaterThan(0);
    expect(xml).not.toContain("Answers on the next slide");
    expect(xml).not.toContain("Evaporation");
  }, 30_000);
});
