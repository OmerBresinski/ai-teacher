import type { ImageElement, SlideElement } from "@tj/domain/documents";
import { IconButton, Popover, PopoverContent, PopoverTrigger } from "@tj/ui";
import { X } from "lucide-react";
import { type ReactNode, useLayoutEffect, useRef } from "react";
import { ImagePicker, type ImageSearchClient } from "../images/ImagePicker";
import { makeImage } from "../model/insert";
import * as reducers from "../model/reducers";
import { useHistory, useLesson } from "./document-context";
import { type ImageSource, imageFields } from "./image-source";
import { useActiveSlide, useSessionActions, useSessionUi } from "./use-editor-session";

/*
 * "Add image" (TeachDeck `components/v2/editor/AddImagePanel.tsx`): the popover chrome anchored
 * to the rail's Image button. The body is the document-agnostic `ImagePicker` (upload + Pexels
 * photos through the injected client); this file keeps the lesson-specific `pick()` — insert or
 * Replace — and the open/close session wiring. Open/closed and the replace target live in the
 * session (`imagePanel`), so the rail button, the `i` shortcut and the image toolbar's Replace
 * all reach the same popover.
 */

export type AddImagePanelProps = {
  /** The rail button the popover anchors to and toggles from. */
  children: ReactNode;
  onInsert: (el: SlideElement) => void;
  /** Pexels search + pick, injected by the app. Absent → the Photos tab says so. */
  images?: ImageSearchClient;
};

export function AddImagePanel({ children, onInsert, images }: AddImagePanelProps) {
  const { imagePanel } = useSessionUi();
  const { openImagePanel, closeImagePanel } = useSessionActions();
  const lesson = useLesson();
  const history = useHistory();
  const slide = useActiveSlide(lesson.slides);
  const replacing = imagePanel?.mode === "replace" ? imagePanel.elementId : null;
  // When this open began. The content stays mounted through its fade-out and a pointer down in
  // that window is reported by Radix a tick later — after a click on Replace has already opened
  // the panel again — so a dismiss whose pointer down predates the open is not about this open.
  const openedAt = useRef(0);
  useLayoutEffect(() => {
    if (imagePanel) openedAt.current = performance.now();
  }, [imagePanel]);

  const pick = (source: ImageSource) => {
    if (replacing && slide) {
      // Same id, same frame. A new picture starts untouched: the old crop, focal point and
      // transform go with the old bitmap (TEACH-153); a plain upload over a searched image
      // clears the old provenance; either flavour flips the element to teacher-authored
      // (Images Decision 4).
      history.dispatch(reducers.updateElement<ImageElement>, slide.id, replacing, {
        alt: undefined,
        credit: undefined,
        creditUrl: undefined,
        crop: undefined,
        focal: undefined,
        imageTransform: undefined,
        source: undefined,
        authoredBy: "teacher",
        ...imageFields(source),
      });
    } else {
      // A new element carries no `authoredBy`, which the pipeline treats as the teacher's.
      onInsert({ ...makeImage(source.src, source.natural), ...imageFields(source) });
    }
    closeImagePanel();
  };

  return (
    <Popover
      open={imagePanel !== null}
      onOpenChange={(open) => (open ? openImagePanel() : closeImagePanel())}
    >
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        className="w-[360px] p-0"
        aria-label={replacing ? "Replace image" : "Add image"}
        data-add-image-panel
        onInteractOutside={(e) => {
          if (e.detail.originalEvent.timeStamp < openedAt.current) e.preventDefault();
        }}
      >
        <div className="flex items-center justify-between gap-2 px-3 pt-2.5 pb-2">
          <h2 className="m-0 font-semibold text-body text-foreground">
            {replacing ? "Replace image" : "Add image"}
          </h2>
          <IconButton label="Close" size="sm" noTooltip onClick={closeImagePanel}>
            <X aria-hidden size={16} strokeWidth={1.5} />
          </IconButton>
        </div>
        <ImagePicker images={images} target="slide" onPick={pick} />
      </PopoverContent>
    </Popover>
  );
}
