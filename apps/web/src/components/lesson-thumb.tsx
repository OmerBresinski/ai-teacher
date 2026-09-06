import { LIBRARY_THEMES } from "@/mocks/library-fixtures";
import type { DocumentSummary } from "@/mocks/library-schema";

const FALLBACK_THEME = { swatch: "#F2EFE8", ink: "#1F2328" };

export function LessonThumb({
  lesson,
  className,
}: {
  lesson: Pick<DocumentSummary, "themeId" | "title">;
  className?: string;
}) {
  const theme = LIBRARY_THEMES.find((entry) => entry.id === lesson.themeId) ?? FALLBACK_THEME;
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
