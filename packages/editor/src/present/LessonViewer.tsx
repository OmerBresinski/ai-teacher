import {
  hasRevealableAnswer,
  type Lesson,
  type Slide,
  slideStepCount,
  type Theme,
} from "@tj/domain/documents";
import { AppBar, AppBarGroup, AppBarTitle, Button, cn, IconButton, Switch } from "@tj/ui";
import { ChevronLeft, ChevronRight, Play } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { getTheme } from "../model/themes";
import { SlideScaler } from "../slide/SlideScaler";
import { SlideStatic } from "../slide/SlideStatic";
import { SlideView } from "../slide/SlideView";

/*
 * The read-only surface (TeachDeck `components/v2/present/Viewer.tsx`, `f3dbcf7`): the same
 * renderer as the editor, no editing affordances, and the two things a teacher who was sent a
 * lesson wants — teach it, or take a copy. Every behaviour is TeachDeck's: the keys, the swipe,
 * the step maths, the copy. Navigation and persistence are the app's (ADR 0022 §6): `onPresent`,
 * `onDuplicate`, `onBack`; the export control arrives with E1 through `exportSlot`.
 */

const THUMB = 168;
const SWIPE_PX = 48;
/** 168px thumb (16:9 = 168x94.5) + 22px gutters. */
const RAIL_WIDTH = 212;

export type LessonViewerProps = {
  lesson: Lesson;
  /** Open present mode at the slide being viewed (1-based `slide`). */
  onPresent: (slide: number) => void;
  /** Duplicate the lesson; resolves when the app has navigated (drives the button's busy state). */
  onDuplicate: () => Promise<void>;
  /** Leading control in the app bar, e.g. the back button. */
  leading?: ReactNode;
  /** Where the export control sits once it exists (E1). */
  exportSlot?: ReactNode;
};

export function LessonViewer({
  lesson,
  onPresent,
  onDuplicate,
  leading,
  exportSlot,
}: LessonViewerProps) {
  const theme = getTheme(lesson.themeId);
  const [index, setIndex] = useState(0);
  const [step, setStep] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [copying, setCopying] = useState(false);
  const railRef = useRef<HTMLElement>(null);

  const slide = lesson.slides[index];
  const question = slide ? hasRevealableAnswer(slide) : false;
  const total = slide ? slideStepCount(slide) : 0;
  // The answer is its own toggle here, so it is not one of the step dots.
  const contentSteps = Math.max(0, total - (question ? 1 : 0));

  const goToSlide = useCallback((nextIndex: number) => {
    setIndex(nextIndex);
    setStep(0);
    setShowAnswer(false);
  }, []);

  // Moving turns the answer back off: with it on the render is pinned to the last step, so the
  // dots would walk while the slide stood still.
  const next = useCallback(() => {
    setShowAnswer(false);
    if (step < contentSteps) setStep(step + 1);
    else if (index < lesson.slides.length - 1) goToSlide(index + 1);
  }, [step, contentSteps, index, lesson.slides.length, goToSlide]);

  const prev = useCallback(() => {
    setShowAnswer(false);
    if (step > 0) setStep(step - 1);
    else if (index > 0) {
      const previous = lesson.slides[index - 1];
      const steps = previous
        ? slideStepCount(previous) - (hasRevealableAnswer(previous) ? 1 : 0)
        : 0;
      setIndex(index - 1);
      setStep(Math.max(0, steps));
      setShowAnswer(false);
    }
  }, [step, index, lesson.slides]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      // The target is an element in a browser; a synthetic event on `window` has none.
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (target?.closest('[role="dialog"], [role="menu"]')) return;
      // Home and End are present mode's, so they are the viewer's too: the same teacher moves
      // between the two surfaces.
      if (e.key === "ArrowRight") {
        e.preventDefault();
        next();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        prev();
      } else if (e.key === "Home") {
        e.preventDefault();
        goToSlide(0);
      } else if (e.key === "End") {
        e.preventDefault();
        goToSlide(lesson.slides.length - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev, goToSlide, lesson.slides.length]);

  // Keep the current thumb in view as the keyboard moves the deck (an external DOM scroll).
  useEffect(() => {
    railRef.current
      ?.querySelector<HTMLElement>(`[data-thumb-index="${index}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [index]);

  const touch = useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    touch.current = e.pointerType === "mouse" ? null : { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const start = touch.current;
    touch.current = null;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) <= Math.abs(dy)) return;
    if (dx < 0) next();
    else prev();
  };

  const makeCopy = async () => {
    setCopying(true);
    try {
      await onDuplicate();
    } finally {
      setCopying(false);
    }
  };

  return (
    <div className="flex h-dvh flex-col bg-background" data-lesson-viewer>
      <AppBar>
        {/* The visible title is static text: a viewer is read-only, so no inline rename. */}
        <AppBarGroup>
          {leading}
          <AppBarTitle>{lesson.title}</AppBarTitle>
          <span className="shrink-0 text-meta text-ink-3">{lesson.slides.length} slides</span>
        </AppBarGroup>

        {/* One primary in the bar and everything else as text. */}
        <AppBarGroup className="ml-auto gap-2">
          <Button variant="ghost" size="sm" disabled={copying} onClick={makeCopy}>
            {copying ? "Copying…" : "Make a copy"}
          </Button>
          {exportSlot}
          <Button size="sm" onClick={() => onPresent(index + 1)}>
            <Play aria-hidden size={16} strokeWidth={1.5} />
            Present
          </Button>
        </AppBarGroup>
      </AppBar>

      <div className="flex min-h-0 flex-1">
        <nav
          ref={railRef}
          aria-label="Slides"
          className="shrink-0 overflow-y-auto border-border border-r bg-background px-1.5 py-3"
          style={{ width: RAIL_WIDTH }}
        >
          <ul className="flex flex-col gap-2">
            {lesson.slides.map((s, i) => (
              <li key={s.id}>
                <RailRow
                  slide={s}
                  theme={theme}
                  number={i + 1}
                  current={i === index}
                  onSelect={goToSlide}
                />
              </li>
            ))}
          </ul>
        </nav>

        <main className="flex min-w-0 flex-1 flex-col bg-canvas">
          {/* The swipe surface: pointer handlers only, so a keyboard user is not affected. */}
          <div
            className="min-h-0 flex-1 p-10"
            onPointerDown={onPointerDown}
            onPointerUp={onPointerUp}
          >
            {slide ? (
              <SlideScaler zoom="fit">
                <div className="overflow-hidden rounded-dialog shadow-3">
                  <SlideView
                    slide={slide}
                    theme={theme}
                    mode="view"
                    step={showAnswer ? total : step}
                    revealAnswer={showAnswer}
                  />
                </div>
              </SlideScaler>
            ) : null}
          </div>

          <div className="flex h-12 shrink-0 items-center justify-center gap-3 border-border border-t bg-background px-4">
            <IconButton label="Previous" onClick={prev} disabled={index === 0 && step === 0}>
              <ChevronLeft aria-hidden size={16} strokeWidth={1.5} />
            </IconButton>

            {contentSteps > 0 ? (
              <span
                className="flex items-center gap-1"
                role="img"
                aria-label={`Step ${step + 1} of ${contentSteps + 1}`}
              >
                {Array.from({ length: contentSteps + 1 }, (_, i) => (
                  <span
                    // biome-ignore lint/suspicious/noArrayIndexKey: dots are positional
                    key={i}
                    className={cn(
                      "size-[5px] rounded-full motion-safe:transition-colors",
                      i <= step ? "bg-primary" : "bg-border-control",
                    )}
                  />
                ))}
              </span>
            ) : (
              <span className="text-meta text-ink-3 tabular-nums">
                {index + 1} / {lesson.slides.length}
              </span>
            )}

            <IconButton
              label="Next"
              onClick={next}
              disabled={index === lesson.slides.length - 1 && step === contentSteps}
            >
              <ChevronRight aria-hidden size={16} strokeWidth={1.5} />
            </IconButton>

            {question ? (
              <span className="ml-4 flex items-center gap-2 text-body text-ink-2">
                <Switch
                  id="viewer-show-answer"
                  checked={showAnswer}
                  onCheckedChange={setShowAnswer}
                />
                <label htmlFor="viewer-show-answer">Show answer</label>
              </span>
            ) : null}
          </div>
        </main>
      </div>

      {/* Where the deck is, for anyone who cannot see the slide. */}
      <p className="sr-only" role="status" aria-live="polite">
        {`Slide ${index + 1} of ${lesson.slides.length}` +
          (contentSteps > 0 ? `, step ${step + 1} of ${contentSteps + 1}` : "") +
          (question && showAnswer ? ", answer shown" : "")}
      </p>
    </div>
  );
}

/**
 * One slide in the rail: a 168px picture with its number beside it, current slide ringed in the
 * accent. A raw button on purpose: `Button` would put a control's height and padding on a picture.
 */
function RailRow({
  slide,
  theme,
  number,
  current,
  onSelect,
}: {
  slide: Slide;
  theme: Theme;
  number: number;
  current: boolean;
  onSelect: (index: number) => void;
}) {
  return (
    <button
      type="button"
      data-thumb-index={number - 1}
      aria-current={current || undefined}
      aria-label={`Slide ${number}`}
      onClick={() => onSelect(number - 1)}
      className={cn(
        "flex w-full items-center rounded-chip px-1 py-0.5 text-left outline-none",
        "motion-safe:transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50",
        current ? "bg-brand-quiet" : "hover:bg-accent",
      )}
    >
      <span className="w-[18px] shrink-0 pr-1 text-right text-meta text-ink-3 tabular-nums">
        {number}
      </span>
      <span
        className={cn(
          "block shrink-0 overflow-hidden rounded-chip bg-card",
          current ? "ring-2 ring-primary" : "ring-1 ring-border",
        )}
      >
        <SlideStatic slide={slide} theme={theme} width={THUMB} />
      </span>
    </button>
  );
}
