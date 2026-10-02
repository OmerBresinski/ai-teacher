/** Question reducers: the question block on a slide and its written explanation / model answer. */

import { type Id, type Lesson, type QuestionData, withSetAnswers } from "@tj/domain/documents";
import { current, isDraft } from "immer";
import { editSlide, findElement } from "./core";

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

/**
 * One answer of a coded question set (TEACH-101), written to the question and to the answers box
 * it reveals in the same edit, so the two never drift and one Undo restores both. A set whose box
 * is gone keeps the answer on the question only.
 */
export const setSetAnswer = (lesson: Lesson, slideId: Id, index: number, answer: string): Lesson =>
  editSlide(lesson, slideId, (s) => {
    const q = s.question;
    const item = q?.type === "set" ? q.items[index] : undefined;
    if (q?.type !== "set" || !item || item.answer === answer) return;
    item.answer = answer;
    const box = findElement(s, q.answersId);
    if (box && (box.type === "text" || box.type === "shape") && box.doc) {
      const doc = isDraft(box.doc) ? current(box.doc) : box.doc;
      const items = q.items.map(({ answer, lineIndex }) => ({ answer, lineIndex }));
      box.doc = withSetAnswers(doc, items);
    }
  });
