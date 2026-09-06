import { EditorContent } from "@tiptap/react";
import type { RichDoc } from "@tj/domain/documents";
import type { CSSProperties } from "react";
import { useAutoHeight } from "./use-auto-height";
import { useInlineEditor } from "./use-inline-editor";

/**
 * The Tiptap surface for the label-shaped elements — an option card, a gap-text sentence, a
 * shape's centred label, and (through `TextEditor`) a text box. It is only ever the *text*: the
 * card, the box and the shape stay the element renderer's job, so the editor sits in exactly the
 * slot the static rendering used and nothing moves on entry or exit.
 *
 * Loaded on demand (see `EditableLabel`), so ProseMirror never reaches a read-only mode.
 */
export function LabelEditor({
  slideId,
  id,
  doc,
  seedEmpty,
  style,
  measure,
}: {
  slideId: string;
  id: string;
  doc: RichDoc | undefined;
  /** A shape with no label yet: start from an empty paragraph and write it back. */
  seedEmpty?: boolean;
  /** Typography for the host, inherited into ProseMirror. */
  style?: CSSProperties;
  /** Elements whose stored height follows their text measure while typing. */
  measure?: { h: number; autoHeight: boolean; chrome: number };
}) {
  const editor = useInlineEditor({ slideId, id, doc, seedEmpty });

  const { ref } = useAutoHeight({
    slideId,
    id,
    h: measure?.h ?? 0,
    mode: "edit",
    autoHeight: measure?.autoHeight ?? false,
    chrome: measure?.chrome ?? 0,
    enabled: !!measure,
  });

  return (
    <div ref={ref} className="td-editor-host" style={{ width: "100%", ...style }}>
      <EditorContent editor={editor} />
    </div>
  );
}

export default LabelEditor;
