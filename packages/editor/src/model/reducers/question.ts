/** Question reducers: the question block on a slide and its written explanation / model answer. */

import type { Id, Lesson, QuestionData } from "@tj/domain/documents";
import { editSlide } from "./core";

export const setQuestion = (lesson: Lesson, slideId: Id, q: QuestionData | undefined): Lesson =>
  editSlide(lesson, slideId, (s) => {
    if (q) s.question = q;
    else delete s.question;
  });

/**
 * The reason under the answer on a true-false or multiple-choice slide, and the model answer on
 * an open response. Empty text removes the field, so a cleared reason leaves the document as if
 * it had never carried one. Other question types are untouched.
 */
export const setExplanation = (lesson: Lesson, slideId: Id, text: string): Lesson =>
  editSlide(lesson, slideId, (s) => {
    const q = s.question;
    if (!q) return;
    const value = text.trim();
    if (q.type === "true-false" || q.type === "multiple-choice") {
      if (value) q.explanation = value;
      else delete q.explanation;
    } else if (q.type === "open-response") {
      if (value) q.modelAnswer = value;
      else delete q.modelAnswer;
    }
  });
