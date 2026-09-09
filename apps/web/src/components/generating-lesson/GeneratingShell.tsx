import type { Lesson } from "@tj/domain/documents";
import type { JobEvent } from "@tj/domain/jobs";
import { getTheme, SlideScaler, SlideView } from "@tj/editor";
import { navigatorThumbWidth, navigatorWidthVar, readNavigatorMode } from "@tj/editor/lesson";
import { SlideStatic } from "@tj/editor/thumb";
import { AppBar, AppBarGroup, Button, cn, Display, IconButton, Skeleton } from "@tj/ui";
import { ArrowLeft, Check, Lock, Square } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { pendingSlides } from "@/lib/pending-slides";
import { announcedLine, STAGES, type StageState, stageLine, stageOf, stageStatus } from "./stage";

/*
 * The generating screen is the editor's shell with the work happening inside it (generating-state
 * PRD §3, TEACH-199): the top bar at the editor's height with the title read-only, the stage line
 * in the centre and Stop at the right; a five-stage strip under it; then the insert rail's column
 * with nothing in it, the navigator's column and the canvas, at the editor's widths, so the editor
 * mounts on top at Ready without a reflow. Under the canvas the lock line says, in words, that the
 * slides can be read and not edited.
 *
 * Presentational: the events and the lesson come in, the stage is derived by `stageOf`. The
 * stream, the refetches and the cancel request live in `GeneratingLesson`.
 */

export const GENERATION_FAILED_MESSAGE = "Generation stopped before the lesson was finished.";
export const GENERATION_CANCELLED_MESSAGE = "Generation stopped.";
export const LOCK_LINE = "Read only until the lesson is ready";
export const STOPPED_LOCK_LINE = "Stopped. What was written is kept.";

/** Thumbs that land in the same refetch fade in one after another. */
const ARRIVE_STAGGER_MS = 80;

export type GeneratingShellProps = {
  lesson: Lesson;
  events: readonly JobEvent[];
  /**
   * The estimate before Stop (TEACH-201's `EstimateText`, which owns its markup and renders
   * nothing when there is no honest number).
   */
  estimate?: ReactNode;
  onBack: () => void;
  onStop: () => void;
  /** Stop is off while the cancel request runs and after it is sent; an error shows beside it. */
  stop?: { pending?: boolean; sent?: boolean; error?: boolean };
  /** The height of the shell; `h-dvh` on the page, a fixed box in the kit. */
  className?: string;
};

export function GeneratingShell({
  lesson,
  events,
  estimate,
  onBack,
  onStop,
  stop,
  className,
}: GeneratingShellProps) {
  const state = stageOf(events);
  const stopped = state.terminal === "failed" || state.terminal === "cancelled";
  const running = state.terminal === null;
  const theme = getTheme(lesson.themeId);
  // The editor's persisted navigator preference, so the column is the width the editor will
  // mount at and nothing reflows at Ready.
  const [navigatorMode] = useState(readNavigatorMode);
  const thumbWidth = navigatorThumbWidth(navigatorMode);
  const newest = lesson.slides.at(-1);
  const arrivals = useArrivals(lesson.slides.length, running);
  const pending = running ? pendingSlides(lesson) : [];

  // Cmd or Ctrl+Period stops the run, the convention for cancelling one. Nothing else is bound.
  useEffect(() => {
    if (!running) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "." && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        onStop();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [running, onStop]);

  const line = stopped ? stoppedLine(state) : stageLine(state);
  const stopDisabled = Boolean(stop?.pending || stop?.sent);

  return (
    <div
      data-testid="generating-shell"
      data-state={state.terminal ?? "running"}
      data-run-stage={state.stage}
      className={cn("flex flex-col overflow-hidden bg-background", className ?? "h-dvh")}
    >
      <AppBar
        data-topbar
        className="grid h-(--topbar-height) shrink-0 grid-cols-[1fr_auto_1fr] items-center"
      >
        <AppBarGroup>
          <IconButton label="Back to library" onClick={onBack}>
            <ArrowLeft aria-hidden size={16} strokeWidth={1.5} />
          </IconButton>
          {/* Read-only: no rename and no save state until the editor takes over (ruling 28). */}
          <h1 className="truncate px-1 text-lead font-semibold">{lesson.title}</h1>
        </AppBarGroup>
        {/*
         * The visible stage line, with the one polite live region beside it announcing only at
         * a stage boundary and every fourth slide. A failure mounts its own `role="alert"` node:
         * a node that appears is announced, a node that changes its role is not.
         */}
        <div className="min-w-0">
          {state.terminal === "failed" ? (
            <p
              role="alert"
              data-testid="generating-stage"
              className="truncate text-body font-medium text-destructive"
            >
              {line}
            </p>
          ) : (
            <span
              data-testid="generating-stage"
              className="block truncate text-body font-medium text-ink-2"
            >
              {line}
            </span>
          )}
          {state.terminal === null ? (
            <output aria-live="polite" className="sr-only" data-testid="generating-announcement">
              {announcedLine(state)}
            </output>
          ) : null}
        </div>
        <AppBarGroup className="justify-end gap-2">
          {estimate}
          {stop?.error ? (
            <span role="alert" className="text-destructive text-meta">
              Could not stop the job.
            </span>
          ) : null}
          {/* A stopped run has nothing to stop; the arrow is the way back (the end-state actions
              come with the Ready, stopped, reloaded ticket, PRD §9 TEACH-D). */}
          {stopped ? null : (
            <Button
              variant="ghost"
              size="sm"
              disabled={stopDisabled}
              onClick={onStop}
              data-generating-stop
            >
              <Square aria-hidden size={14} strokeWidth={1.5} />
              Stop
            </Button>
          )}
        </AppBarGroup>
      </AppBar>

      <StageStrip state={state} />

      <div className="flex min-h-0 flex-1">
        {/* The insert rail's column, empty: the tools arrive at Ready and the canvas does not move. */}
        <div
          aria-hidden="true"
          data-insert-rail-placeholder
          className="w-(--rail-width) shrink-0 border-border border-r bg-background"
        />

        <nav
          aria-label="Slides"
          data-navigator-mode={navigatorMode}
          className="shrink-0 overflow-y-auto border-border border-r bg-background px-1.5 py-3"
          style={{ width: navigatorWidthVar(navigatorMode) }}
        >
          <ul className="flex flex-col gap-2">
            {lesson.slides.map((slide, i) => (
              <ThumbRow
                key={slide.id}
                number={i + 1}
                current={i === lesson.slides.length - 1}
                arriveDelay={arrivals(i)}
              >
                <SlideStatic slide={slide} theme={theme} width={thumbWidth} />
              </ThumbRow>
            ))}
            {pending.map((_, i) => {
              const position = lesson.slides.length + i;
              return (
                <SkeletonRow key={`slot-${position}`} number={position + 1} width={thumbWidth} />
              );
            })}
          </ul>
        </nav>

        <main className="flex min-w-0 flex-1 flex-col bg-canvas" data-canvas>
          <div className="min-h-0 flex-1 p-10">
            {newest ? (
              <SlideScaler zoom="fit">
                <div
                  key={newest.id}
                  data-canvas-slide={newest.id}
                  className={cn(
                    "overflow-hidden rounded-dialog shadow-3",
                    arrivals(lesson.slides.length - 1) !== null && "motion-safe:animate-arrive",
                  )}
                >
                  <SlideView slide={newest} theme={theme} mode="view" />
                </div>
              </SlideScaler>
            ) : (
              <div className="flex h-full flex-col items-center justify-center text-center">
                {/* The title in Lora before the first slide; the strip's dot is the spinner. */}
                <Display as="span" size="lg" className="block">
                  {lesson.title}
                </Display>
                <p className="mt-2 text-body text-ink-3">
                  {stopped ? "No slides were written before it stopped." : "Planning your lesson"}
                </p>
              </div>
            )}
          </div>
          {/* Where the editor's zoom group sits, so the swap at Ready is a text change. */}
          <div
            data-testid="generating-lock"
            className="flex h-12 shrink-0 items-center justify-center gap-1.5 text-meta font-medium text-ink-3"
          >
            {state.terminal === "completed" ? (
              <span aria-hidden className="size-[5px] rounded-full bg-success" />
            ) : (
              <Lock aria-hidden size={14} strokeWidth={1.5} />
            )}
            <span>{lockLine(state)}</span>
          </div>
        </main>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

/**
 * The stage strip: a 40px row on the card surface with a hairline beneath. A done stage carries a
 * tick and its label in ink-3; the live one the 5px accent dot (the `StatusPill` quiet dot) and
 * its label in ink; one still to come a dot in the control border colour. The live dot breathes
 * under `motion-safe` only and is still under reduced motion. A stopped run keeps its live stage
 * in the danger (failed) or neutral (cancelled) tone with the label unchanged.
 */
function StageStrip({ state }: { state: StageState }) {
  const liveDot =
    state.terminal === "failed"
      ? "bg-destructive"
      : state.terminal === "cancelled"
        ? "bg-ink-4"
        : "bg-primary motion-safe:animate-pulse";
  return (
    <section aria-label="Progress" className="shrink-0">
      <ol
        data-testid="generating-strip"
        className="flex h-10 items-center gap-6 border-border border-b bg-card px-4 text-meta font-medium"
      >
        {STAGES.map((stage) => {
          const status = stageStatus(stage.id, state);
          return (
            <li
              key={stage.id}
              data-stage={stage.id}
              data-status={status}
              aria-current={status === "live" ? "step" : undefined}
              className={cn(
                "flex items-center gap-1.5",
                status === "live" ? "text-foreground" : "text-ink-3",
              )}
            >
              {status === "done" ? (
                <Check aria-hidden size={12} strokeWidth={2} />
              ) : (
                <span
                  aria-hidden
                  data-dot
                  className={cn(
                    "size-[5px] shrink-0 rounded-full",
                    status === "live" ? liveDot : "bg-border-control",
                  )}
                />
              )}
              <span>{stage.label}</span>
              <span className="sr-only">
                {status === "done" ? ", done" : status === "live" ? ", now" : ", to come"}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function stoppedLine(state: StageState): string {
  if (state.terminal === "failed") {
    return `${GENERATION_FAILED_MESSAGE} ${state.failure ?? ""}`.trim();
  }
  return GENERATION_CANCELLED_MESSAGE;
}

function lockLine(state: StageState): string {
  if (state.terminal === "completed") return "Ready to edit";
  if (state.terminal !== null) return STOPPED_LOCK_LINE;
  return LOCK_LINE;
}

/**
 * Which navigator rows fade in, and how long each waits (from the viewer's `useArrivals`): only
 * rows that mount after the first render, and only while the run is live, so a reload replays
 * nothing. Rows that land in the same refetch are staggered by `ARRIVE_STAGGER_MS`.
 */
function useArrivals(count: number, live: boolean): (index: number) => number | null {
  const initialCount = useRef(count);
  const previousCount = useRef(count);
  const delays = useRef(new Map<number, number>());
  useEffect(() => {
    previousCount.current = count;
  }, [count]);
  return (index) => {
    if (!live || index < initialCount.current) return null;
    const known = delays.current.get(index);
    if (known !== undefined) return known;
    const delay = Math.max(0, index - previousCount.current) * ARRIVE_STAGGER_MS;
    delays.current.set(index, delay);
    return delay;
  };
}

/**
 * A finished slide in the navigator column: the editor's number column and 168px thumb, the
 * newest one ringed in the accent. Not a control yet: following and pinning arrive with the
 * navigator work (TEACH-200); this is the geometry.
 */
function ThumbRow({
  number,
  current,
  arriveDelay,
  children,
}: {
  number: number;
  current: boolean;
  arriveDelay: number | null;
  children: ReactNode;
}) {
  return (
    <li
      data-slide-thumb={number - 1}
      data-current={current || undefined}
      className={cn(
        "flex w-full items-center rounded-chip px-1 py-0.5",
        current && "bg-brand-quiet",
        arriveDelay !== null && "[--tj-arrive-distance:4px] motion-safe:animate-arrive",
      )}
      style={arriveDelay !== null ? { animationDelay: `${arriveDelay}ms` } : undefined}
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
        {children}
      </span>
      <span className="sr-only">Slide {number}</span>
    </li>
  );
}

/**
 * The box a slide still to be written will take; hidden from the tree until it is real. The
 * placeholders named by kind (`aria-disabled` options a screen reader hears as "Slide 4,
 * Content, not written yet") and the danger hairline on a stopped run are TEACH-200's.
 */
function SkeletonRow({ number, width }: { number: number; width: number }) {
  return (
    <li aria-hidden="true" className="flex w-full items-center px-1 py-0.5">
      <span className="w-[18px] shrink-0 pr-1 text-right text-meta text-ink-3 tabular-nums">
        {number}
      </span>
      <Skeleton
        className="aspect-video shrink-0 rounded-chip ring-1 ring-border"
        style={{ width }}
      />
    </li>
  );
}
