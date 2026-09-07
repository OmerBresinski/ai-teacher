import type { Content, Editor } from "@tiptap/core";
import { Selection } from "@tiptap/pm/state";
import { EditorContent, useEditor } from "@tiptap/react";
import type { Id, RichDoc, WorksheetBlock } from "@tj/domain/documents";
import { useEffect, useRef } from "react";
import { useActiveEditor } from "../text/active-editor";
import { normaliseDoc } from "../text/normalise";
import { blockExtensions } from "./block-extensions";
import { updateBlock } from "./reducers";
import type { CaretIntent } from "./use-worksheet-session";
import { useTypingSession, useWorksheetHistoryApi, useWorksheetSession } from "./worksheet-context";

/**
 * The single mounted Tiptap instance, for the block being edited (TeachDeck
 * `components/worksheet/BlockTextEditor.tsx`). Every other block renders statically — the same rule
 * the slide renderer follows.
 *
 * The Query cache, not ProseMirror, owns the document. StarterKit's own history is off (see
 * `blockExtensions`); every Tiptap `update` is dispatched at once inside the typing session — one
 * transaction per burst, so nothing is debounced and nothing can be lost on the way out (the same
 * write path as `useInlineEditor`). When the cached doc changes underneath a mounted editor — an
 * undo, a toolbar command — the editor adopts it instead of writing its stale copy back over the top.
 */

export type BlockKeyHandlers = {
  /** Enter with the caret at the end of the block. */
  onSplit: () => void;
  /**
   * Backspace with the caret at the very start. The block's own content comes with it: the caller
   * merges it into the block above, or degrades this block to a paragraph, rather than deleting
   * anything the teacher typed.
   */
  onBackspaceAtStart: (doc: RichDoc) => void;
  /** `/` at the start of an empty paragraph. */
  onSlash: () => void;
  onMove: (direction: -1 | 1) => void;
};

type RichBlock = Extract<WorksheetBlock, { doc: RichDoc }>;

const same = (a: RichDoc, b: RichDoc) => JSON.stringify(a) === JSON.stringify(b);

/** Caret at the end of top-level child `index`, clamped to the document. */
function posAfterChild(editor: Editor, index: number): number {
  const { doc } = editor.state;
  let pos = 0;
  for (let i = 0; i <= index && i < doc.childCount; i++) pos += doc.child(i).nodeSize;
  return Math.max(1, Math.min(pos - 1, doc.content.size));
}

function placeCaret(editor: Editor, caret: CaretIntent): void {
  // Put the caret where the teacher clicked, not at the end of the block.
  if (typeof caret === "object" && "x" in caret) {
    const hit = editor.view.posAtCoords({ left: caret.x, top: caret.y });
    if (hit) {
      editor.commands.focus();
      editor.commands.setTextSelection(hit.pos);
      return;
    }
  }
  if (typeof caret === "object" && "child" in caret) {
    editor.commands.focus();
    editor.commands.setTextSelection(posAfterChild(editor, caret.child));
    return;
  }
  editor.commands.focus(caret === "start" ? "start" : "end");
}

export function BlockTextEditor({
  id,
  doc,
  className,
  caret,
  handlers,
}: {
  id: Id;
  doc: RichDoc;
  className?: string;
  caret: CaretIntent;
  handlers: BlockKeyHandlers;
}) {
  const { dispatch } = useWorksheetHistoryApi();
  const typing = useTypingSession();
  const { setEditing } = useWorksheetSession();
  const active = useActiveEditor();

  // The callbacks are read through refs so the editor instance (created once per block) always
  // sees the latest ones without being rebuilt.
  const keys = useRef(handlers);
  keys.current = handlers;
  const typingRef = useRef(typing);
  typingRef.current = typing;
  const activeRef = useRef(active);
  activeRef.current = active;
  const caretRef = useRef(caret);
  caretRef.current = caret;
  const editorRef = useRef<Editor | null>(null);

  const editor = useEditor(
    {
      extensions: blockExtensions,
      content: normaliseDoc(doc) as unknown as Content,
      immediatelyRender: true,
      editorProps: {
        attributes: { class: "ws-rt" },
        handleKeyDown: (view, event) => {
          const { state } = view;
          const empty = state.doc.textContent.length === 0;
          const mod = event.metaKey || event.ctrlKey;

          if (event.key === "Escape") {
            event.preventDefault();
            setEditing(null);
            return true;
          }
          // Undo / redo are the document history's, never the browser's: with StarterKit's history
          // off, an unhandled ⌘Z would fall through to the native contenteditable undo, which
          // ProseMirror would then observe and dispatch as a *new* edit. The typing session closes
          // first, so the entry that comes off is the burst the teacher just typed.
          if (mod && event.key.toLowerCase() === "z") {
            event.preventDefault();
            if (event.shiftKey) typingRef.current.redo();
            else typingRef.current.undo();
            return true;
          }
          if (mod && event.key.toLowerCase() === "y") {
            event.preventDefault();
            typingRef.current.redo();
            return true;
          }
          if (event.key === "Tab") {
            // Nesting inside a list; swallowed otherwise, because Tab must not walk the focus out
            // of the sheet mid-sentence.
            event.preventDefault();
            const chain = editorRef.current?.chain().focus();
            if (!chain) return true;
            if (event.shiftKey) chain.liftListItem("listItem").run();
            else chain.sinkListItem("listItem").run();
            return true;
          }
          if (event.key === "Enter" && !event.shiftKey && !mod) {
            const atEnd =
              state.selection.empty && state.selection.from === Selection.atEnd(state.doc).from;
            if (atEnd) {
              event.preventDefault();
              keys.current.onSplit();
              return true;
            }
          }
          if (event.key === "Backspace") {
            const atStart =
              state.selection.empty && state.selection.from === Selection.atStart(state.doc).from;
            if (atStart || empty) {
              event.preventDefault();
              keys.current.onBackspaceAtStart(state.doc.toJSON() as RichDoc);
              return true;
            }
          }
          if (event.key === "/" && empty) {
            event.preventDefault();
            keys.current.onSlash();
            return true;
          }
          if (mod && event.shiftKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
            event.preventDefault();
            keys.current.onMove(event.key === "ArrowUp" ? -1 : 1);
            return true;
          }
          return false;
        },
      },
      onCreate: ({ editor: created }) => {
        editorRef.current = created as Editor;
        activeRef.current.set(created as Editor, id);
        placeCaret(created as Editor, caretRef.current);
      },
      onUpdate: ({ editor: live }) =>
        typingRef.current.run(() =>
          dispatch(updateBlock<RichBlock>, id, { doc: live.getJSON() as RichDoc }),
        ),
      // The session closes on blur so the next keystroke, wherever it lands, is a new undo step.
      onBlur: () => typingRef.current.end(),
      onDestroy: () => {
        editorRef.current = null;
        if (activeRef.current.elementId === id) activeRef.current.set(null, null);
      },
    },
    [id],
  );

  /**
   * The cache stays the single source of truth. When its doc changes underneath the mounted editor
   * — an undo, a redo, a toolbar command — adopt it rather than writing this editor's stale
   * ProseMirror document back over it on the next keystroke. Our own writes come straight back as
   * `doc` and match by content. `emitUpdate: false` keeps the adoption out of the history.
   */
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const next = normaliseDoc(doc);
    if (same(next, editor.getJSON() as RichDoc)) return;
    const { from } = editor.state.selection;
    editor.commands.setContent(next as unknown as Content, { emitUpdate: false });
    editor.commands.setTextSelection(Math.max(1, Math.min(from, editor.state.doc.content.size)));
  }, [editor, doc]);

  // Never strand a paused history: the session closes with the editor that opened it.
  useEffect(() => () => typingRef.current.end(), []);

  return (
    <div className={className}>
      <EditorContent editor={editor} />
    </div>
  );
}

export default BlockTextEditor;
