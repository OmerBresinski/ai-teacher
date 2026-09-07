import { useCallback, useMemo, useRef, useState } from "react";

/**
 * The worksheet editor's transient UI state (ADR 0022 §4: React state, never in the Query cache):
 * which block is selected (TeachDeck `worksheet-store.ts` `activeBlockId` / `select`) and which
 * block has the mounted Tiptap editor plus where its caret should land (TeachDeck
 * `lib/worksheet/editing.ts`). Undo never touches any of it.
 */

export type CaretIntent =
  /** The point the teacher clicked, in client coordinates. */
  | { x: number; y: number }
  /** The end of top-level child `child` — where two merged blocks joined. */
  | { child: number }
  | "start"
  | "end";

export type WorksheetSessionState = {
  activeBlockId: string | null;
  editingId: string | null;
  caret: CaretIntent;
};

export type WorksheetSession = WorksheetSessionState & {
  /** Select a block (or the header, `HEADER_KEY`); `null` clears the selection. */
  select: (id: string | null) => void;
  /** Open (or close, with `null`) the text editor on a block, placing the caret. */
  setEditing: (id: string | null, caret?: CaretIntent) => void;
  /** The latest state without subscribing — for window key handlers and pointer callbacks. */
  read: () => WorksheetSessionState;
};

const INITIAL: WorksheetSessionState = { activeBlockId: null, editingId: null, caret: "end" };

export function useWorksheetSessionState(): WorksheetSession {
  const [state, setState] = useState<WorksheetSessionState>(INITIAL);
  const latest = useRef(state);
  latest.current = state;

  const select = useCallback((activeBlockId: string | null) => {
    setState((prev) => (prev.activeBlockId === activeBlockId ? prev : { ...prev, activeBlockId }));
  }, []);
  const setEditing = useCallback((editingId: string | null, caret: CaretIntent = "end") => {
    setState((prev) =>
      prev.editingId === editingId && prev.caret === caret ? prev : { ...prev, editingId, caret },
    );
  }, []);
  const read = useCallback(() => latest.current, []);

  return useMemo(() => ({ ...state, select, setEditing, read }), [state, select, setEditing, read]);
}
