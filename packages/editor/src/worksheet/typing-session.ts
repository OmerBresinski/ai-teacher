import { useCallback, useMemo, useRef } from "react";
import { type EditSession, IDLE_MS, useEditSession } from "../model/use-edit-session";

/**
 * One undo step per typing session, across every editable surface on the sheet (TeachDeck
 * `lib/worksheet/typing-session.ts`).
 *
 * A block's Tiptap editor, an option's inline field and a table cell all write to the document on
 * a keystroke, so without this a five-character burst is five entries in the history and Undo
 * appears to do nothing. The mechanics are `useEditSession` (TEACH-104): the first write opens a
 * transaction, and the transaction closes once the writes stop for `IDLE_MS` (500 ms, the same
 * window TeachDeck used) or immediately when the caller knows the run is over — a blur, an
 * unmount, or the moment before an undo is applied.
 *
 * Where TeachDeck kept the session as module state so it survived the unmount of the field that
 * opened it, here one session is created by `WorksheetEditor` and handed down through context:
 * clicking straight from one option into the next still lands in the same open transaction.
 */

export type TypingTransactions = {
  beginTransaction: () => number | undefined;
  endTransaction: (token?: number) => void;
  undo: () => void;
  redo: () => void;
};

export type TypingSession = EditSession & {
  /** Close any open session, then undo — never let a paused history swallow it. */
  undo: () => void;
  /** Close any open session, then redo. */
  redo: () => void;
};

export function useTypingSessionState(
  history: TypingTransactions,
  idleMs: number = IDLE_MS,
): TypingSession {
  const historyRef = useRef(history);
  historyRef.current = history;
  const session = useEditSession(history, idleMs);

  const undo = useCallback(() => {
    session.end();
    historyRef.current.undo();
  }, [session]);
  const redo = useCallback(() => {
    session.end();
    historyRef.current.redo();
  }, [session]);

  return useMemo(() => ({ ...session, undo, redo }), [session, undo, redo]);
}
