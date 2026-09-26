import type { Slide, Theme } from "@tj/domain/documents";
import { Button } from "@tj/ui";
import { type ReactNode, useLayoutEffect, useRef } from "react";
import { SlideScaler } from "../slide/SlideScaler";
import { SlideView } from "../slide/SlideView";

/** One native scroll surface; inactive slides never mount editing or drag handlers. */
export function MobileSlideList({
  slides,
  theme,
  onEdit,
  onView,
  initialSlideId,
  footer,
  hidden = false,
  followArrivals = false,
}: {
  slides: readonly Slide[];
  theme: Theme;
  onEdit?: (slide: Slide) => void;
  onView?: (id: string | null) => void;
  initialSlideId?: string;
  footer?: ReactNode;
  hidden?: boolean;
  followArrivals?: boolean;
}) {
  const ref = useRef<HTMLElement>(null);
  const following = useRef(true);
  const initial = useRef(initialSlideId);
  const count = slides.length;
  // biome-ignore lint/correctness/useExhaustiveDependencies: each appended slide needs a fresh scroll measurement.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || hidden) return;
    if (initial.current) {
      const card = Array.from(el.querySelectorAll<HTMLElement>("[data-mobile-slide]")).find(
        (node) => node.dataset.mobileSlide === initial.current,
      );
      if (card) el.scrollTop = card.offsetTop - el.offsetTop;
      initial.current = undefined;
    } else if (followArrivals && following.current) el.scrollTop = el.scrollHeight;
  }, [count, hidden, followArrivals]);
  return (
    <section
      ref={ref}
      hidden={hidden}
      data-mobile-lesson-list
      aria-label="Lesson slides"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the named scroll region must support keyboard scrolling.
      tabIndex={0}
      className="mobile-lesson-list"
      onScroll={(event) => {
        const el = event.currentTarget;
        following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
        if (!onView) return;
        if (following.current) {
          onView(null);
          return;
        }
        const top = el.getBoundingClientRect().top;
        const visible = Array.from(el.querySelectorAll<HTMLElement>("[data-mobile-slide]")).find(
          (card) => card.getBoundingClientRect().bottom > top + 80,
        );
        if (visible?.dataset.mobileSlide) onView(visible.dataset.mobileSlide);
      }}
    >
      {slides.map((slide, index) => (
        <article key={slide.id} data-mobile-slide={slide.id} className="mobile-lesson-card">
          <div className="mobile-lesson-card-label">
            <span>Slide {index + 1}</span>
            {onEdit ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onEdit(slide)}
                aria-label={`Edit slide ${index + 1}`}
              >
                Edit
              </Button>
            ) : null}
          </div>
          {onEdit ? (
            <button
              type="button"
              className="mobile-lesson-paper"
              aria-label={`Open slide ${index + 1} for editing`}
              onClick={() => onEdit(slide)}
            >
              <div inert>
                <SlideScaler zoom="fit">
                  <SlideView slide={slide} theme={theme} mode="view" />
                </SlideScaler>
              </div>
            </button>
          ) : (
            <div className="mobile-lesson-paper">
              <SlideScaler zoom="fit">
                <SlideView slide={slide} theme={theme} mode="view" />
              </SlideScaler>
            </div>
          )}
        </article>
      ))}
      {footer}
    </section>
  );
}
