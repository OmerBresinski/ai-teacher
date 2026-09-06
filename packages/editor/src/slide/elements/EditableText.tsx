import type { TextElement } from "@tj/domain/documents";
import { lazy, Suspense } from "react";
import { useEditingState } from "../editor-hooks";
import { type ElementViewProps, resolveTextStyle } from "./kit";
import { StaticText } from "./TextView";
import { useAutoHeight } from "./use-auto-height";

/** Tiptap and ProseMirror load only when this element is the one being edited. */
const TextEditor = lazy(() => import("./TextEditor"));

/**
 * A text element in edit mode. Owns the one editing-state subscription the renderer makes
 * (`editingTextId`) and the auto-height measurement, and hands over to Tiptap only for the
 * element actually being typed into.
 */
export function EditableText({ element, theme, slideId }: ElementViewProps<TextElement>) {
  const editing = useEditingState().editingTextId === element.id;
  const r = resolveTextStyle(element.style, theme);

  const { ref, overflowing } = useAutoHeight({
    slideId,
    id: element.id,
    h: element.h,
    mode: "edit",
    autoHeight: r.autoHeight,
    chrome: r.padding * 2,
    enabled: !editing,
  });

  const staticView = (
    <StaticText
      element={element}
      theme={theme}
      mode="edit"
      bodyRef={ref}
      overflowing={overflowing}
    />
  );
  if (!editing) return staticView;

  return (
    <Suspense fallback={staticView}>
      <TextEditor element={element} theme={theme} slideId={slideId} />
    </Suspense>
  );
}

export default EditableText;
