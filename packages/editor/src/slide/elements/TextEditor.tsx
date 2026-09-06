import type { TextElement, Theme } from "@tj/domain/documents";
import { resolveTextStyle, textTypeCss } from "./kit";
import { LabelEditor } from "./LabelEditor";
import { TextShell } from "./TextView";

/**
 * A text element being typed into: the same box the static path draws, with the one Tiptap
 * instance in place of the rendered HTML.
 *
 * The editor's DOM carries the same `td-rt` class as the static path, and the typography lives on
 * the host so it inherits into ProseMirror — the text does not move on entry or exit.
 */
export function TextEditor({
  element,
  theme,
  slideId,
}: {
  element: TextElement;
  theme: Theme;
  slideId: string;
}) {
  const r = resolveTextStyle(element.style, theme);
  return (
    <TextShell r={r} mode="edit" theme={theme}>
      <LabelEditor
        slideId={slideId}
        id={element.id}
        doc={element.doc}
        style={{ flex: "0 0 auto", ...textTypeCss(r) }}
        measure={{ h: element.h, autoHeight: r.autoHeight, chrome: r.padding * 2 }}
      />
    </TextShell>
  );
}

export default TextEditor;
