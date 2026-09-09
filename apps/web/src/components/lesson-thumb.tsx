import { getTheme, SlideFluid } from "@tj/editor/thumb";
import { WorksheetThumb } from "@tj/editor/worksheet-thumb";
// Slide CSS, the paper and the twelve document fonts ride with the first chunk that paints a
// thumbnail (the library route), not with the initial bundle (ADR 0022 §7-8).
import "@tj/editor/styles/editor.css";
import "@tj/editor/styles/worksheet-thumb.css";
import { type DocumentSummary, isWorksheetCover } from "@tj/domain/documents";

/**
 * A document's cover at card size (ADR 0021 §6): a lesson's first slide through `SlideFluid`
 * (CSS container units, no measurement), a worksheet's page 1 through `WorksheetThumb` (the real
 * sheet fitted to the card width, greyscale, clipped; UX ruling 31). Documents without a cover
 * keep the swatch-and-initial fallback.
 */
export function LessonThumb({
  lesson,
  className,
}: {
  lesson: Pick<DocumentSummary, "themeId" | "title"> & Partial<Pick<DocumentSummary, "cover">>;
  className?: string;
}) {
  const theme = getTheme(lesson.themeId);
  if (lesson.cover && isWorksheetCover(lesson.cover)) {
    return (
      <div aria-hidden className={`relative size-full overflow-hidden ${className ?? ""}`}>
        <WorksheetThumb cover={lesson.cover} title={lesson.title} theme={theme} />
      </div>
    );
  }
  if (lesson.cover) {
    return (
      <div aria-hidden className={`size-full overflow-hidden ${className ?? ""}`}>
        <SlideFluid slide={lesson.cover} theme={theme} />
      </div>
    );
  }
  return (
    <div
      aria-hidden
      className={`flex size-full items-center justify-center overflow-hidden ${className ?? ""}`}
      style={{ backgroundColor: theme.colors.background, color: theme.colors.ink }}
    >
      <span className="font-display text-xl leading-none">{lesson.title.slice(0, 1)}</span>
    </div>
  );
}
