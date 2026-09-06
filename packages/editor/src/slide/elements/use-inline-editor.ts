import type { AnyExtension, Content, Editor } from "@tiptap/core";
import { useEditor } from "@tiptap/react";
import type { RichDoc } from "@tj/domain/documents";
import { useEffect, useRef, useState } from "react";
import { useEditSession } from "../../model/use-edit-session";
import { useActiveEditor } from "../../text/active-editor";
import { baseExtensions } from "../../text/extensions";
import { useEditorHooks } from "../editor-hooks";

/**
 * Tiptap v3's StarterKit registers `trailingNode`, which appends a real empty paragraph after any
 * document that ends in a list. On a slide that is not a convenience: the box grows by a whole
 * line the moment the teacher enters edit mode, auto-height writes the taller value back, and the
 * empty paragraph is committed to the model on the first keystroke. It is off here.
 */
export const EDITOR_EXTENSIONS: AnyExtension[] = baseExtensions.map((ext) =>
  ext.name === "starterKit" ? (ext as AnyExtension).configure({ trailingNode: false }) : ext,
);

/** What an element with no text yet starts from: exactly what Tiptap serialises for it. */
export const EMPTY_DOC: RichDoc = { type: "doc", content: [{ type: "paragraph" }] };

const same = (a: RichDoc | undefined, b: RichDoc) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Every inline editing session on the slide, in one place (TeachDeck `use-inline-editor.ts`):
 * text boxes, option cards, gap-text sentences and shape labels all edit the same `doc` field, so
 * they all get the same Tiptap instance, the same registration with `useActiveEditor` (which is
 * what the text toolbar reads), the same write path, and the same Esc/blur exit.
 *
 * The write path is the one change from TeachDeck: every Tiptap `update` is dispatched at once —
 * so the canvas, the navigator thumb and autosave see each keystroke — inside an **edit session**
 * that opens a transaction on the first change and closes it after `IDLE_MS` of quiet or on
 * blur. A burst of typing is therefore one undo step, and a pause splits it into two (ADR 0022
 * §4). Nothing is debounced, so nothing can be lost on the way out.
 */
export function useInlineEditor({
  slideId,
  id,
  doc,
  seedEmpty = false,
}: {
  /** The slide the element sits on: writes are addressed, never ambient. */
  slideId: string;
  /** Element being edited. The write is addressed to it, never to the selection. */
  id: string;
  /** Current model doc. `undefined` is legal for a shape that has no label yet. */
  doc: RichDoc | undefined;
  /** Write {@link EMPTY_DOC} back on entry when the element has no doc at all. */
  seedEmpty?: boolean;
}): Editor | null {
  const hooks = useEditorHooks();
  const active = useActiveEditor();
  // Both fixed on entry: the seed write makes `doc` defined, and neither the starting content nor
  // the session may restart because of it.
  const [initial] = useState(() => doc ?? EMPTY_DOC);
  const seed = useRef(seedEmpty);

  const hooksRef = useRef(hooks);
  hooksRef.current = hooks;
  const activeRef = useRef(active);
  activeRef.current = active;

  const session = useEditSession({
    beginTransaction: () => hooksRef.current?.beginTransaction(),
    endTransaction: () => hooksRef.current?.endTransaction(),
  });
  const sessionRef = useRef(session);
  sessionRef.current = session;

  /** What the editor last wrote, so an echo of our own write is not adopted back. */
  const written = useRef<RichDoc | null>(null);
  const write = (next: RichDoc) => {
    written.current = next;
    sessionRef.current.run(() => hooksRef.current?.writeElementDoc(slideId, id, next));
  };

  const editor = useEditor(
    {
      extensions: EDITOR_EXTENSIONS,
      content: initial as unknown as Content,
      immediatelyRender: true,
      autofocus: "end",
      editorProps: {
        attributes: { class: "td-rt" },
        handleKeyDown: (_view, event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            hooksRef.current?.exitTextEdit();
            return true;
          }
          return false;
        },
      },
      onCreate: ({ editor: created }) => activeRef.current.set(created as Editor, id),
      onUpdate: ({ editor: live }) => write(live.getJSON() as RichDoc),
      // The session closes on blur so the next keystroke, wherever it lands, is a new undo step.
      onBlur: () => sessionRef.current.end(),
      onDestroy: () => {
        if (activeRef.current.elementId === id) activeRef.current.set(null, null);
      },
    },
    [id],
  );

  // A shape that has never carried a label gets its empty paragraph on entry, so the model
  // matches what the editor is showing from the first frame. Seeding is not a keystroke: it is
  // its own single step, closed at once.
  useEffect(() => {
    if (!seed.current) return;
    seed.current = false;
    const h = hooksRef.current;
    if (!h) return;
    h.beginTransaction();
    h.writeElementDoc(slideId, id, EMPTY_DOC);
    h.endTransaction();
  }, [slideId, id]);

  // Leaving the element (unmount) is the end of its session, whatever closed it.
  useEffect(() => () => sessionRef.current.end(), []);

  /**
   * The cache stays the single source of truth. If the doc changes underneath the mounted editor
   * — an undo, a toolbar command applied to the whole doc — adopt it rather than writing the stale
   * ProseMirror document back over it on the next keystroke. Our own writes come straight back
   * as `doc` and are recognised by identity of content.
   */
  useEffect(() => {
    if (!editor || editor.isDestroyed || !doc) return;
    if (written.current && same(written.current, doc)) return;
    if (same(doc, editor.getJSON() as RichDoc)) return;
    editor.commands.setContent(doc as unknown as Content, { emitUpdate: false });
  }, [editor, doc]);

  return editor;
}
