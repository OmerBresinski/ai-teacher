/**
 * The document half of the editor, for every component under `LessonEditor`: the lesson in the
 * Query cache and the history API that edits it (`useDocumentHistory`, ADR 0022 §4). Split in two
 * so a component that only dispatches (a toolbar button) does not re-render on every keystroke.
 */

import type { Lesson } from "@tj/domain/documents";
import { createContext, useContext } from "react";
import type { DocumentHistory } from "../model/use-document-history";

export type HistoryApi = Omit<DocumentHistory, "lesson">;

const LessonContext = createContext<Lesson | null>(null);
const HistoryContext = createContext<HistoryApi | null>(null);

export const LessonProvider = LessonContext.Provider;
export const HistoryProvider = HistoryContext.Provider;

export function useLesson(): Lesson {
  const lesson = useContext(LessonContext);
  if (!lesson) throw new Error("useLesson is only available inside <LessonEditor>");
  return lesson;
}

export function useHistory(): HistoryApi {
  const history = useContext(HistoryContext);
  if (!history) throw new Error("useHistory is only available inside <LessonEditor>");
  return history;
}
