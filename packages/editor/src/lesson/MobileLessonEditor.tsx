import type { Slide } from "@tj/domain/documents";
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@tj/ui";
import { useLayoutEffect, useRef, useState } from "react";
import { Canvas, type CanvasProps } from "./Canvas";
import { useLesson } from "./document-context";
import { InsertRail, type InsertRailProps } from "./InsertRail";
import { MobileSlideList } from "./MobileSlideList";
import { useSessionActions } from "./use-editor-session";

export function MobileLessonEditor({
  canvas,
  insert,
  initialSlideId,
}: {
  canvas: CanvasProps;
  insert: InsertRailProps;
  initialSlideId?: string;
}) {
  const lesson = useLesson();
  const session = useSessionActions();
  const [editing, setEditing] = useState(false);
  const [inserting, setInserting] = useState(false);
  const returnTo = useRef<HTMLElement | null>(null);
  const doneButton = useRef<HTMLButtonElement>(null);
  const insertTitle = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    if (editing) doneButton.current?.focus();
  }, [editing]);
  const edit = (slide: Slide) => {
    returnTo.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    session.setActiveSlide(slide.id);
    session.setZoom("fit");
    setEditing(true);
  };
  const done = () => {
    session.clearSelection();
    setEditing(false);
    requestAnimationFrame(() => returnTo.current?.focus({ preventScroll: true }));
  };
  return (
    <div className="mobile-editor-body">
      <MobileSlideList
        slides={lesson.slides}
        theme={canvas.theme}
        onEdit={edit}
        hidden={editing}
        initialSlideId={initialSlideId}
      />
      {editing ? (
        <section data-mobile-editor-focus className="mobile-editor-focus" aria-label="Edit slide">
          <div className="mobile-editor-focus-bar">
            <Button ref={doneButton} variant="ghost" onClick={done}>
              Done
            </Button>
            <span>
              Slide {lesson.slides.findIndex((slide) => slide.id === canvas.slide.id) + 1}
            </span>
            <Dialog open={inserting} onOpenChange={setInserting}>
              <DialogTrigger asChild>
                <Button variant="outline">Insert</Button>
              </DialogTrigger>
              <DialogContent
                className="mobile-editor-sheet"
                aria-describedby={undefined}
                onOpenAutoFocus={(event) => {
                  event.preventDefault();
                  insertTitle.current?.focus();
                }}
              >
                <DialogHeader>
                  <DialogTitle ref={insertTitle} tabIndex={-1}>
                    Insert into slide
                  </DialogTitle>
                </DialogHeader>
                <InsertRail
                  {...insert}
                  showLabels
                  onInsert={(element, options) => {
                    insert.onInsert(element, options);
                    setInserting(false);
                  }}
                />
              </DialogContent>
            </Dialog>
          </div>
          <Canvas {...canvas} />
        </section>
      ) : null}
    </div>
  );
}
