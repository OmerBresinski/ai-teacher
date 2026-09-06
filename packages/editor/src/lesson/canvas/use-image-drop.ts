import { SLIDE_W, type SlideElement } from "@tj/domain/documents";
import { toast } from "@tj/ui";
import { type RefObject, useEffect, useState } from "react";
import { makeImage } from "../../model/insert";
import { UNREADABLE_MESSAGE } from "../AddImagePanel";
import { imageFields, sourceFromFile } from "../image-source";
import { PASTE_IMAGE_EVENT, type PasteImageDetail } from "../transform/use-canvas-keys";

/*
 * Pictures that arrive at the canvas without the panel (TeachDeck `Canvas.tsx` :182 and the drop
 * handlers): an image pasted while the canvas has focus lands at the slide centre; a file dropped
 * on the scroll region lands under the pointer, in slide points, clamped like every insert. Both
 * take the same downscale path as an upload. The two listeners are the shell's only `useEffect`
 * on image handling — they bind browser events, not derived state.
 */

export type ImageDropOptions = {
  /** The scroll region the files are dropped on. */
  scroller: RefObject<HTMLElement | null>;
  /** The 960x540 slide frame, whose on-screen box maps a client point to slide points. */
  stage: RefObject<HTMLElement | null>;
  onInsert: (el: SlideElement) => void;
};

const hasImage = (dt: DataTransfer | null) =>
  !!dt && Array.from(dt.items).some((i) => i.kind === "file" && i.type.startsWith("image/"));

const firstImage = (dt: DataTransfer | null) =>
  Array.from(dt?.files ?? []).find((f) => f.type.startsWith("image/")) ?? null;

/** True while an image file is being dragged over the canvas, for the drop ring. */
export function useImageDrop({ scroller, stage, onInsert }: ImageDropOptions): boolean {
  const [over, setOver] = useState(false);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;

    const insert = async (file: File, at?: { x: number; y: number }) => {
      try {
        const source = await sourceFromFile(file);
        onInsert({ ...makeImage(source.src, source.natural, at), ...imageFields(source) });
      } catch {
        toast(UNREADABLE_MESSAGE);
      }
    };

    // `useCanvasKeys` only dispatches this while the canvas has focus, so no gate is needed here.
    const onPaste = (e: Event) => {
      const { file } = (e as CustomEvent<PasteImageDetail>).detail;
      void insert(file);
    };
    const onDragOver = (e: DragEvent) => {
      if (!hasImage(e.dataTransfer)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      setOver(true);
    };
    const onDragLeave = (e: DragEvent) => {
      // Leaving a child fires too; only the exit from the region itself ends the ring.
      if (e.relatedTarget instanceof Node && el.contains(e.relatedTarget)) return;
      setOver(false);
    };
    const onDrop = (e: DragEvent) => {
      setOver(false);
      const file = firstImage(e.dataTransfer);
      if (!file) return;
      e.preventDefault();
      void insert(file, pointOnSlide(stage.current, e.clientX, e.clientY));
    };

    window.addEventListener(PASTE_IMAGE_EVENT, onPaste);
    el.addEventListener("dragover", onDragOver);
    el.addEventListener("dragleave", onDragLeave);
    el.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener(PASTE_IMAGE_EVENT, onPaste);
      el.removeEventListener("dragover", onDragOver);
      el.removeEventListener("dragleave", onDragLeave);
      el.removeEventListener("drop", onDrop);
    };
  }, [scroller, stage, onInsert]);

  return over;
}

/** A client point in slide points via the stage's rendered box; the centre when there is none. */
export function pointOnSlide(
  stage: HTMLElement | null,
  clientX: number,
  clientY: number,
): { x: number; y: number } | undefined {
  const rect = stage?.getBoundingClientRect();
  if (!rect || rect.width === 0) return undefined;
  const k = SLIDE_W / rect.width;
  return { x: Math.round((clientX - rect.left) * k), y: Math.round((clientY - rect.top) * k) };
}
