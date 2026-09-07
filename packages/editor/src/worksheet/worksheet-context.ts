import type { Id, Worksheet, WorksheetBlock } from "@tj/domain/documents";
import { createContext, useContext, useMemo } from "react";
import { updateBlock } from "./reducers";
import type { TypingSession } from "./typing-session";
import type { WorksheetHistory } from "./use-worksheet-history";
import type { WorksheetSession } from "./use-worksheet-session";

/**
 * What every component under `WorksheetEditor` reaches for (the lesson editor's
 * `document-context.ts`, for worksheets): the worksheet in the Query cache, the history API that
 * edits it (`useWorksheetHistory`, ADR 0022 §4), the typing session that groups keystrokes into one
 * undo step, and the UI session (selection, open editor). Four contexts, so a toolbar button that
 * only dispatches does not re-render on every keystroke.
 */

export type WorksheetHistoryApi = Omit<WorksheetHistory, "worksheet">;

const WorksheetContext = createContext<Worksheet | null>(null);
const HistoryContext = createContext<WorksheetHistoryApi | null>(null);
const TypingContext = createContext<TypingSession | null>(null);
const SessionContext = createContext<WorksheetSession | null>(null);

export const WorksheetProvider = WorksheetContext.Provider;
export const WorksheetHistoryProvider = HistoryContext.Provider;
export const TypingSessionProvider = TypingContext.Provider;
export const WorksheetSessionProvider = SessionContext.Provider;

function required<T>(value: T | null, name: string): T {
  if (value === null) throw new Error(`${name} is only available inside <WorksheetEditor>`);
  return value;
}

export function useWorksheet(): Worksheet {
  return required(useContext(WorksheetContext), "useWorksheet");
}

export function useWorksheetHistoryApi(): WorksheetHistoryApi {
  return required(useContext(HistoryContext), "useWorksheetHistoryApi");
}

export function useTypingSession(): TypingSession {
  return required(useContext(TypingContext), "useTypingSession");
}

export function useWorksheetSession(): WorksheetSession {
  return required(useContext(SessionContext), "useWorksheetSession");
}

export type BlockWrites = {
  /** A keystroke-rate write: the whole run collapses into one undo entry. */
  patch: <T extends WorksheetBlock>(id: Id, fn: Partial<T> | ((block: T) => void)) => void;
  /** A discrete write (a click, not a keystroke): its own undo entry. */
  commit: <T extends WorksheetBlock>(id: Id, fn: Partial<T> | ((block: T) => void)) => void;
};

/** The two ways a field on the sheet writes its block (TeachDeck `EditableBlocks.tsx` `patch` / `commit`). */
export function useBlockWrites(): BlockWrites {
  const { dispatch } = useWorksheetHistoryApi();
  const typing = useTypingSession();
  return useMemo(
    () => ({
      patch: <T extends WorksheetBlock>(id: Id, fn: Partial<T> | ((block: T) => void)) =>
        typing.run(() => dispatch(updateBlock<T>, id, fn)),
      commit: <T extends WorksheetBlock>(id: Id, fn: Partial<T> | ((block: T) => void)) => {
        typing.end();
        dispatch(updateBlock<T>, id, fn);
      },
    }),
    [dispatch, typing],
  );
}
