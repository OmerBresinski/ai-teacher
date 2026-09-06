import type { Editor } from "@tiptap/core";
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";

/**
 * The Tiptap editor instance currently mounted for the text element being edited (TeachDeck
 * `lib/text/active-editor.ts`, a zustand store; here React state per ADR 0022 §4). The inline
 * editor sets it on create and clears it on destroy; the text toolbar reads it to drive marks on
 * the caret rather than on the whole doc.
 *
 * Typed against `@tiptap/core`'s `Editor` so consumers that only *read* it (the toolbar) never
 * import `@tiptap/react` — that stays inside the lazily loaded editor chunk (§8).
 */
export type ActiveEditor = { editor: Editor | null; elementId: string | null };

export type ActiveEditorApi = ActiveEditor & {
  set: (editor: Editor | null, elementId: string | null) => void;
};

const NONE: ActiveEditor = { editor: null, elementId: null };

const ActiveEditorContext = createContext<ActiveEditorApi | null>(null);

export function ActiveEditorProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ActiveEditor>(NONE);
  const set = useCallback((editor: Editor | null, elementId: string | null) => {
    setState((prev) =>
      prev.editor === editor && prev.elementId === elementId ? prev : { editor, elementId },
    );
  }, []);
  const value = useMemo(() => ({ ...state, set }), [state, set]);
  return <ActiveEditorContext.Provider value={value}>{children}</ActiveEditorContext.Provider>;
}

/**
 * Outside the provider — the viewer, present, thumbs — there is never an active editor, and the
 * setter is a no-op, so an element renderer can call this unconditionally.
 */
const NOOP: ActiveEditorApi = { ...NONE, set: () => {} };

export function useActiveEditor(): ActiveEditorApi {
  return useContext(ActiveEditorContext) ?? NOOP;
}
