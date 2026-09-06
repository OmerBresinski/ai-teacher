import { getTheme, SlideFluid } from "@tj/editor/thumb";
// Slide CSS and the twelve document fonts ride with the first chunk that paints a slide (the
// library route), not with the initial bundle (ADR 0022 §7-8).
import "@tj/editor/styles/editor.css";
import type { DocumentSummary } from "@/mocks/library-schema";

/**
 * A lesson's first slide at card size (ADR 0021 §6). The summary carries `cover`; the thumb fills
 * whatever box the card gives it (`SlideFluid` scales with CSS container units — no measurement).
 * Worksheets and documents without a first slide keep the swatch-and-initial fallback.
 */
export function LessonThumb({
  lesson,
  className,
}: {
  lesson: Pick<DocumentSummary, "themeId" | "title"> & Partial<Pick<DocumentSummary, "cover">>;
  className?: string;
}) {
  const theme = getTheme(lesson.themeId);
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
