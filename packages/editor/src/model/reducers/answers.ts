/**
 * The lesson's "Answers slides" setting (UX ruling 260, TEACH-191 part e). The guard and Answers
 * slides are made by default; turning them off removes them in one undo step, and turning them on
 * builds them again from the lesson's current questions in its current theme, at the end of the
 * deck.
 *
 * Off never loses the teacher's work. Like Free layout (`freeLayout` keeps the group it was), the
 * removed slides are kept on the lesson (`answersOff.kept`). When the teacher had edited them
 * (the part c rule, `endAnswersUntouched`), turning the setting on puts those slides back as they
 * were instead of building new ones. A rebuild keeps the old slide ids in order, as a re-theme
 * does (part c).
 *
 * The builder (`@tj/slides/relayout`) comes in as `kit`, the way the layout reducers take it.
 */

import type { Lesson } from "@tj/domain/documents";
import { renderTheme } from "../themes";
import { edit } from "./core";
import type { LayoutKit } from "./layout";

export type AnswersKit = Pick<
  LayoutKit,
  "stageOf" | "buildEndAnswers" | "endAnswersUntouched" | "withIds"
>;

/** On unless the teacher turned it off; a lesson stored before the setting reads as on. */
export const answersSlidesOn = (lesson: Lesson): boolean => !lesson.answersOff;

/** Turn the guard and Answers slides off or on; the same lesson when it is already so. */
export function setAnswersSlides(lesson: Lesson, on: boolean, kit: AnswersKit): Lesson {
  if (on === answersSlidesOn(lesson)) return lesson;
  const theme = renderTheme(lesson);
  const stage = kit.stageOf(theme, lesson.ageBand);
  if (!on) {
    const kept = lesson.slides.filter((s) => s.answersRole);
    const edited = kept.length > 0 && !kit.endAnswersUntouched(lesson.slides, theme, stage);
    return edit(lesson, (l) => {
      l.slides = l.slides.filter((s) => !s.answersRole);
      l.answersOff = { kept, edited };
    });
  }
  const { kept, edited } = lesson.answersOff ?? { kept: [], edited: false };
  const lessonSlides = lesson.slides.filter((s) => !s.answersRole);
  // The kept slides go back as they were when the teacher edited them, or when they still match
  // the questions (so every element keeps its id); otherwise they are built again.
  const made =
    edited || kit.endAnswersUntouched([...lessonSlides, ...kept], theme, stage)
      ? kept
      : kit.withIds(kit.buildEndAnswers(lessonSlides, theme, stage), kept);
  return edit(lesson, (l) => {
    l.slides = [...lessonSlides, ...made];
    delete l.answersOff;
  });
}
