import { LIBRARY_THEMES } from "@/mocks/library-fixtures";
import type { DocumentSummary } from "@/mocks/library-schema";

const FALLBACK_THEME = { swatch: "#F2EFE8", ink: "#1F2328" };
// Every card and series sheet renders a thumb; a Map turns the per-render scan into one lookup.
const THEMES_BY_ID = new Map(LIBRARY_THEMES.map((theme) => [theme.id, theme]));

export function LessonThumb({
  lesson,
  className,
}: {
  lesson: Pick<DocumentSummary, "themeId" | "title">;
  className?: string;
}) {
  const theme = THEMES_BY_ID.get(lesson.themeId) ?? FALLBACK_THEME;
  return (
    <div
      aria-hidden
      className={`flex size-full items-center justify-center overflow-hidden ${className ?? ""}`}
      style={{ backgroundColor: theme.swatch, color: theme.ink }}
    >
      <span className="font-display text-xl leading-none">{lesson.title.slice(0, 1)}</span>
    </div>
  );
}
