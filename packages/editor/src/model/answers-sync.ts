import type { Id, Lesson } from "@tj/domain/documents";
import { syncAnswers } from "@tj/slides/answers-slide";
import { renderTheme } from "./themes";

/*
 * Answers slides after a regenerate (UX ruling 200), in reducer shape for `history.dispatch`. Its
 * own module, loaded on demand by `LessonEditor.applyProposals`: the answers-slide layout (the
 * set structure and its ruler) is not needed to open the editor, and the route chunk has a budget
 * (ADR 0022 §8).
 */
export const syncAnswersReducer = (lesson: Lesson, regenerated: ReadonlySet<Id>): Lesson =>
  syncAnswers(lesson, renderTheme(lesson), undefined, regenerated);
