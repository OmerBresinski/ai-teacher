import type { RichDoc } from "@tj/domain/documents";
import { type CSSProperties, lazy, type ReactElement, Suspense } from "react";
import { useEditingState } from "../editor-hooks";
import type { LabelParts } from "./kit";
import { useAutoHeight } from "./use-auto-height";

/** Tiptap and ProseMirror load only when this element is the one being edited. */
const LabelEditor = lazy(() => import("./LabelEditor"));

export type { LabelParts };

/**
 * The edit-mode wrapper for the label-shaped elements: option cards, gap-text and shape labels.
 * It owns the one editing-state subscription those renderers make (`editingTextId`) and the
 * auto-height measurement, and hands the renderer back either nothing (draw the static text) or
 * a mounted editor to put in the same slot.
 *
 * A render prop rather than three near-identical components, because the whole point is that the
 * editing and resting states are the *same* card, box or shape.
 */
export function EditableLabel({
  slideId,
  id,
  doc,
  seedEmpty,
  style,
  measure,
  render,
}: {
  slideId: string;
  id: string;
  doc: RichDoc | undefined;
  seedEmpty?: boolean;
  /** Typography for the editor host, so the text does not move on entry. */
  style?: CSSProperties;
  /** Only for elements whose stored height follows their text (gap-text). */
  measure?: { h: number; autoHeight: boolean; chrome: number };
  render: (parts: LabelParts) => ReactElement | null;
}) {
  const editing = useEditingState().editingTextId === id;

  // While the editor is mounted it measures its own host; two observers on the same element
  // would fight over the stored height.
  const { ref, overflowing } = useAutoHeight({
    slideId,
    id,
    h: measure?.h ?? 0,
    mode: "edit",
    autoHeight: measure?.autoHeight ?? false,
    chrome: measure?.chrome ?? 0,
    enabled: !!measure && !editing,
  });

  const resting = () => render({ editor: null, bodyRef: measure ? ref : undefined, overflowing });
  if (!editing) return resting();

  return (
    <Suspense fallback={resting()}>
      {render({
        editor: (
          <LabelEditor
            slideId={slideId}
            id={id}
            doc={doc}
            seedEmpty={seedEmpty}
            style={style}
            measure={measure}
          />
        ),
        overflowing: false,
      })}
    </Suspense>
  );
}

export default EditableLabel;
