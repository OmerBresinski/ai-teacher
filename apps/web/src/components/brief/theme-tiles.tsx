import type { RichDoc, Slide } from "@tj/domain/documents";
import { newSlide } from "@tj/editor/starter";
import { Check } from "lucide-react";
import { useId, useMemo } from "react";
import { LessonThumb } from "@/components/lesson-thumb";
import { LIBRARY_THEMES } from "@/lib/library-themes";

/*
 * The brief's theme picker (TEACH-177 item 5): six 16:9 tiles, each the title slide the lesson
 * would open with in that theme, drawn with the topic the teacher has just typed. Native radios
 * keep the radio semantics (arrow keys move the choice, one tab stop); the chosen tile carries
 * the kit's two-tone focus band and a tick. `lessonFromBrief` yields no slides, so the tile
 * builds the title slide itself with the same recipe the editor uses (`newSlide("title")`) and
 * swaps in the topic.
 */

function docOf(text: string): RichDoc {
  return { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
}

/** The title slide in `themeId` with the topic as its title and the class as its subtitle. */
export function titleSlideFor(topic: string, subtitle: string, themeId: string): Slide {
  const slide = newSlide("title", themeId);
  return {
    ...slide,
    elements: slide.elements.map((element) => {
      if (element.type !== "text") return element;
      if (element.style.preset === "title" && topic) return { ...element, doc: docOf(topic) };
      if (element.style.preset === "subtitle" && subtitle)
        return { ...element, doc: docOf(subtitle) };
      return element;
    }),
  };
}

export function ThemeTiles({
  labelId,
  topic,
  subtitle,
  value,
  onValueChange,
}: {
  labelId: string;
  topic: string;
  subtitle: string;
  value: string;
  onValueChange: (themeId: string) => void;
}) {
  const name = useId();
  const covers = useMemo(
    () =>
      new Map(LIBRARY_THEMES.map((theme) => [theme.id, titleSlideFor(topic, subtitle, theme.id)])),
    [topic, subtitle],
  );
  return (
    <div
      role="radiogroup"
      aria-labelledby={labelId}
      className="grid grid-cols-2 gap-3 sm:grid-cols-3"
      data-testid="theme-tiles"
    >
      {LIBRARY_THEMES.map((theme) => {
        const checked = theme.id === value;
        return (
          <label key={theme.id} className="group relative block cursor-pointer">
            <input
              type="radio"
              name={name}
              value={theme.id}
              checked={checked}
              onChange={() => onValueChange(theme.id)}
              className="peer sr-only"
            />
            <span className="block overflow-hidden rounded-card border border-border-control motion-safe:transition-[box-shadow,border-color] peer-checked:border-ring peer-checked:ring-[3px] peer-checked:ring-ring/50 peer-focus-visible:border-ring peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/50">
              <LessonThumb
                lesson={{
                  title: topic || "Lesson",
                  themeId: theme.id,
                  cover: covers.get(theme.id),
                }}
              />
            </span>
            <span className="mt-1.5 flex items-center gap-1.5 text-meta text-ink-2 peer-checked:text-foreground">
              {theme.name}
            </span>
            {checked ? (
              <span
                aria-hidden
                className="absolute top-2 right-2 flex size-5 items-center justify-center rounded-full bg-primary-fill text-primary-foreground"
              >
                <Check size={12} strokeWidth={2.5} />
              </span>
            ) : null}
          </label>
        );
      })}
    </div>
  );
}
