import type { Slide, Theme } from "@tj/domain/documents";
import { Button } from "@tj/ui";
import { type ReactNode, useLayoutEffect, useRef } from "react";
import { SlideScaler } from "../slide/SlideScaler";
import { SlideView } from "../slide/SlideView";
import { LiveSlide, useWritingPicture } from "./live-draft";
import { useProposals } from "./proposals-context";

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
  followId,
}: {
  slides: readonly Slide[];
  theme: Theme;
  onEdit?: (slide: Slide) => void;
  onView?: (id: string | null) => void;
  initialSlideId?: string;
  footer?: ReactNode;
  hidden?: boolean;
  followArrivals?: boolean;
  /**
   * The slide being written while the editor follows the writing (UX audit J7): its card scrolls
   * into view as it changes, as the desktop strip and canvas follow it. Absent once the teacher
   * has taken over (any click or key press ends the follow).
   */
  followId?: string;
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
  // The teacher's own scroll (a wheel, a swipe, momentum after it) ends the follow on this list for
  // good: the list is never pulled back to the writing slide under their finger.
  const taken = useRef(false);
  const takeOver = () => {
    taken.current = true;
  };
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || hidden || !followId || taken.current) return;
    const card = Array.from(el.querySelectorAll<HTMLElement>("[data-mobile-slide]")).find(
      (node) => node.dataset.mobileSlide === followId,
    );
    if (!card) return;
    const still =
      typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const top = card.offsetTop - el.offsetTop;
    if (typeof el.scrollTo === "function")
      el.scrollTo({ top, behavior: still ? "auto" : "smooth" });
    else el.scrollTop = top;
  }, [followId, hidden]);
  return (
    <section
      ref={ref}
      hidden={hidden}
      data-mobile-lesson-list
      aria-label="Lesson slides"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the named scroll region must support keyboard scrolling.
      tabIndex={0}
      className="mobile-lesson-list"
      onWheel={takeOver}
      onTouchStart={takeOver}
      onTouchMove={takeOver}
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
                  <WritingSlideView slide={slide} theme={theme} />
                </SlideScaler>
              </div>
            </button>
          ) : (
            <div className="mobile-lesson-paper">
              <SlideScaler zoom="fit">
                <WritingSlideView slide={slide} theme={theme} />
              </SlideScaler>
            </div>
          )}
        </article>
      ))}
      {footer}
    </section>
  );
}

/**
 * A card while the lesson is written: a planned slide as its outline, a new lesson's first two
 * slides typing out (live-draft `useWritingPicture`), and the slide being written typing in from
 * its draft as it does on the desktop canvas (Greg's answer 68). `LiveSlide` keeps the last draft
 * until the saved copy catches up, so a card never flashes an older copy at the hand-over.
 */
function WritingSlideView({ slide, theme }: { slide: Slide; theme: Theme }) {
  const { drafts, reveal, writingSlideIds } = useProposals();
  const pictured = useWritingPicture(slide, false);
  if (!drafts) return <SlideView slide={pictured} theme={theme} mode="view" />;
  // One `LiveSlide` owns the card's outline, the first-slides reveal and the draft, so a draft that
  // takes over from the reveal carries on from the words already typed, caret and all.
  return (
    <LiveSlide
      store={drafts}
      slideId={slide.id}
      slide={slide}
      writing={writingSlideIds?.has(slide.id) ?? false}
      reveal={reveal}
      render={(shown) => <SlideView slide={shown ?? slide} theme={theme} mode="view" />}
    />
  );
}
