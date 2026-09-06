import type { RichDoc } from "@tj/domain/documents";
import { createContext, useContext } from "react";

/**
 * What the element renderers need from whoever owns the document, in edit mode only. Nothing in
 * this package's view, present, capture or thumb paths provides either context, so those modes
 * never touch editor state (ADR 0022 §4); `LessonEditor` provides both.
 *
 * Two contexts on purpose: the functions are stable for the editor's life, the two ids change on
 * every entry to and exit from text editing. A renderer that only measures height subscribes to
 * the first and is left alone by the second.
 */
export type EditorHooks = {
  /**
   * Non-undoable and slide-addressed: a measured height is derived, not a user edit, and it must
   * land on the slide being rendered, not on whichever slide is active.
   */
  writeElementHeight: (slideId: string, id: string, h: number) => void;
  /** An undoable write of an element's rich text. */
  writeElementDoc: (slideId: string, id: string, doc: RichDoc) => void;
  /** An undoable write of a question slide's "Why?" text. */
  writeExplanation: (slideId: string, text: string) => void;
  /** Wrap a run of writes into one undo step (`useEditSession` drives these). */
  beginTransaction: () => void;
  endTransaction: () => void;
  /** Leave text editing: clears `editingTextId` and puts focus back on the canvas. */
  exitTextEdit: () => void;
  exitExplanationEdit: () => void;
};

export type EditingState = {
  /** The element whose text is being typed into, if any. */
  editingTextId: string | null;
  /** The question slide whose explanation is being typed into, if any. */
  editingExplanation: string | null;
};

export const EditorHooksContext = createContext<EditorHooks | null>(null);
export const EditingStateContext = createContext<EditingState>({
  editingTextId: null,
  editingExplanation: null,
});

export const useEditorHooks = (): EditorHooks | null => useContext(EditorHooksContext);
export const useEditingState = (): EditingState => useContext(EditingStateContext);
