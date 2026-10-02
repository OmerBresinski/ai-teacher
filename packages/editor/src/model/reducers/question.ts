/** Question reducers: the question block on a slide and its written explanation / model answer. */

import {
  answersInBox,
  type Id,
  type Lesson,
  type QuestionData,
  setItemsFromBox,
  withSetAnswer,
} from "@tj/domain/documents";
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
 * One answer of a coded question set (TEACH-101), by its position in the answers box. The box is
 * the source of truth: only that answer's characters change in it, and the question's copy of the
 * answers is re-read from the box in the same edit, so one Undo restores both. A set whose box is
 * gone keeps the answer on the question only.
 */
export const setSetAnswer = (
  lesson: Lesson,
  slideId: Id,
  position: number,
  answer: string,
): Lesson =>
  editSlide(lesson, slideId, (s) => {
    const q = s.question;
    if (q?.type !== "set") return;
    const box = findElement(s, q.answersId);
    if (box && (box.type === "text" || box.type === "shape") && box.doc) {
      const doc = isDraft(box.doc) ? current(box.doc) : box.doc;
      // The box holds the answer trimmed (the drawer's field keeps a space being typed), so a
      // space alone changes nothing yet.
      const text = answer.trim();
      if (answersInBox(doc)[position]?.answer === text) return;
      const next = withSetAnswer(doc, position, text);
      box.doc = next;
      q.items = setItemsFromBox(next);
      return;
    }
    const item = q.items[position];
    if (item && item.answer !== answer) item.answer = answer;
  });
