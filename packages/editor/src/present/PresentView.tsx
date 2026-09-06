import { hasRevealableAnswer, type Lesson, slideStepCount } from "@tj/domain/documents";
import { Button, cn, Display, IconButton, Kbd } from "@tj/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getTheme } from "../model/themes";
import { SlideStatic } from "../slide/SlideStatic";
import { Controls } from "./Controls";
import { EndCard, type NextLesson } from "./EndCard";
import { NotesPanel } from "./NotesPanel";
import { Overview } from "./Overview";
import { panelToClose } from "./present-reducer";
import { ShortcutsDialog } from "./ShortcutsDialog";
import { Stage } from "./Stage";
import { STAGE_SCOPE_CLASS } from "./stage-tokens";
import { useFullscreen, useWakeLock } from "./use-fullscreen";
import {
  type PresentSession,
  PresentSessionContext,
  usePresentSession,
} from "./use-present-session";

/*
 * Present mode (TeachDeck `components/v2/present/PresentView.tsx`). Owns the keys, the touch
 * gestures, fullscreen and the wake lock; everything visible is a child reading the session from
 * context. Navigation and persistence are the app's: `onExit`, `next` (series), `onProgress`
 * (TD item 5, ADR 0021 §4).
 */

/** The cover's slide picture: wide enough to read across a room, narrow enough that the title is still the loudest thing. */
const COVER_SLIDE_W = 560;

const SWIPE_PX = 48;
const TAP_MS = 400;
const JUMP_IDLE_MS = 1500;

/** Typing goes to the field, all of it. */
const FIELD = 'input, textarea, select, [contenteditable="true"]';

/**
 * Space and Enter are how a button is pressed and a link followed. Taking them from a focused
 * control would mean nothing on this screen could be operated from the keyboard. Every other key
 * still belongs to the deck.
 */
const CONTROL =
  'button, a[href], [role="button"], [role="menuitem"], [role="option"], [role="radio"], ' +
  '[role="tab"], [role="checkbox"], [role="switch"]';

/** A link on the slide belongs to the link: the stage advances on click, so this exempts anchors. */
const SLIDE_LINK = "a[href]";
const onLink = (e: React.PointerEvent) =>
  Boolean((e.target as Element | null)?.closest?.(SLIDE_LINK));

/** Composite widgets own the arrows as well: they move between their items. */
const COMPOSITE = '[role="menu"], [role="listbox"], [role="radiogroup"], [role="tablist"]';
const COMPOSITE_KEYS = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"];

/** An overlay from the kit owns the keyboard while it is up. */
const OVERLAY = '[role="dialog"], [role="menu"], [role="listbox"]';

export type PresentProgress = {
  /** The furthest slide shown this session. */
  reachedSlideId: string;
  /** The session left slide 1 — the signal that a lesson was actually taught. */
  exitedPastFirst: boolean;
};

export type PresentViewProps = {
  lesson: Lesson;
  /** 0-based. */
  startIndex?: number;
  onExit: () => void;
  /** Set when the lesson is being presented as part of a series. */
  next?: NextLesson;
  /** Called once on exit and on unmount with where the session got to (TD item 5). */
  onProgress?: (progress: PresentProgress) => void;
};

export function PresentView(props: PresentViewProps) {
  const session = usePresentSession();
  return (
    <PresentSessionContext.Provider value={session}>
      <PresentSurface {...props} session={session} />
    </PresentSessionContext.Provider>
  );
}

function PresentSurface({
  lesson,
  startIndex = 0,
  onExit,
  next,
  onProgress,
  session,
}: PresentViewProps & { session: PresentSession }) {
  const { state, dispatch, ink } = session;
  const theme = getTheme(lesson.themeId);
  const fullscreen = useFullscreen();
  const [started, setStarted] = useState(false);
  const [jump, setJump] = useState("");

  const { index, step, ended, notesOpen, blackout, tool, laser } = state;

  // Read through refs by the once-bound key handler and the unmount reporter.
  const stateRef = useRef(state);
  stateRef.current = state;
  const nextRef = useRef(next);
  nextRef.current = next;
  const onProgressRef = useRef(onProgress);
  onProgressRef.current = onProgress;

  const slideIds = useMemo(() => lesson.slides.map((s) => s.id), [lesson.slides]);
  const stepCounts = useMemo(() => lesson.slides.map(slideStepCount), [lesson.slides]);

  useEffect(() => {
    dispatch({ type: "setDeck", slideIds, steps: stepCounts, startIndex });
  }, [slideIds, stepCounts, startIndex, dispatch]);

  // Progress is reported once, from wherever the session ends: the exit action or an unmount
  // (browser back, series chaining). `reported` stops the two paths double-writing.
  const reported = useRef(false);
  const report = useCallback(() => {
    if (reported.current) return;
    reported.current = true;
    const s = stateRef.current;
    const reachedSlideId = s.slideIds[s.reachedIndex];
    if (reachedSlideId) {
      onProgressRef.current?.({ reachedSlideId, exitedPastFirst: s.reachedIndex > 0 || s.ended });
    }
  }, []);
  useEffect(() => report, [report]);

  useWakeLock(started);

  const { enter: enterFullscreen, exit: exitFullscreen, toggle: toggleFullscreen } = fullscreen;

  const exit = useCallback(() => {
    report();
    void exitFullscreen();
    onExit();
  }, [report, exitFullscreen, onExit]);

  // The elapsed clock in the presenter panel counts from here.
  const start = useCallback(
    (goFullscreen: boolean) => {
      dispatch({ type: "startSession", at: Date.now() });
      setStarted(true);
      if (goFullscreen) void enterFullscreen();
    },
    [dispatch, enterFullscreen],
  );

  /* ---------------- keyboard ---------------- */

  const jumpTimer = useRef<number | undefined>(undefined);
  const jumpRef = useRef("");

  useEffect(() => {
    const setDigits = (digits: string) => {
      jumpRef.current = digits;
      setJump(digits);
    };
    const armJumpClear = () => {
      window.clearTimeout(jumpTimer.current);
      jumpTimer.current = window.setTimeout(() => setDigits(""), JUMP_IDLE_MS);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest(FIELD)) return;
      // A control with focus keeps the keys that operate it, and nothing else.
      const onControl = Boolean(target?.closest(CONTROL));
      if (onControl && (e.key === " " || e.key === "Enter")) return;
      if (COMPOSITE_KEYS.includes(e.key) && target?.closest(COMPOSITE)) return;

      const s = stateRef.current;

      // The overview owns every key that moves anything while it is open.
      if (s.overviewOpen) {
        if (e.key === "Escape" || e.key.toLowerCase() === "o") {
          e.preventDefault();
          dispatch({ type: "setOverviewOpen", open: false });
        } else if (!onControl && (e.key === " " || e.key === "PageDown" || e.key === "PageUp")) {
          e.preventDefault();
        }
        return;
      }

      // An open dialog, menu or popover owns the keyboard entirely. Radix dialogs handle their
      // own Escape; the reducer's flag is cleared through `onOpenChange`.
      if (target?.closest(OVERLAY)) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;

      // Blacked out: any key brings the slide back, and does nothing else.
      if (s.blackout !== "none" && e.key !== "Shift" && e.key !== "Tab") {
        e.preventDefault();
        dispatch({ type: "setBlackout", blackout: "none" });
        return;
      }

      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        setDigits((jumpRef.current + e.key).slice(0, 3));
        armJumpClear();
        return;
      }

      const take = () => e.preventDefault();

      // One more press at the end card opens the next lesson in the series.
      const advance = () => {
        const following = nextRef.current;
        if (s.ended && following) {
          report();
          return following.onOpen();
        }
        return dispatch({ type: "next" });
      };

      switch (e.key) {
        case "Enter": {
          take();
          const digits = jumpRef.current;
          setDigits("");
          if (digits) dispatch({ type: "goTo", index: Number(digits) - 1 });
          else advance();
          return;
        }
        case " ":
        case "ArrowRight":
        case "PageDown":
          take();
          return advance();
        case "ArrowLeft":
        case "PageUp":
          take();
          return dispatch({ type: "prev" });
        case "Home":
          take();
          return dispatch({ type: "first" });
        case "End":
          take();
          return dispatch({ type: "last" });
        case "Escape":
          take();
          if (panelToClose(s)) dispatch({ type: "closePanels" });
          else exit();
          return;
        default:
          break;
      }

      switch (e.key.toLowerCase()) {
        case "b":
          take();
          return dispatch({ type: "toggleBlackout", blackout: "black" });
        case "w":
          take();
          return dispatch({ type: "toggleBlackout", blackout: "white" });
        case "f":
          take();
          void toggleFullscreen();
          return;
        case "t": {
          take();
          // The timer panel hangs off a button that only exists on the expanded pill.
          const open = !s.timerOpen;
          if (open) dispatch({ type: "setPillCollapsed", collapsed: false });
          dispatch({ type: "setTimerOpen", open });
          return;
        }
        case "c": {
          take();
          // Collapsing takes the panel anchored to the pill with it.
          if (!s.pillCollapsed) dispatch({ type: "setTimerOpen", open: false });
          dispatch({ type: "setPillCollapsed", collapsed: !s.pillCollapsed });
          return;
        }
        case "p":
          take();
          return dispatch({ type: "toggleTool", tool: "pen" });
        case "h":
          take();
          return dispatch({ type: "toggleTool", tool: "highlighter" });
        case "e":
          take();
          return dispatch({ type: "toggleTool", tool: "eraser" });
        case "l":
          take();
          return dispatch({ type: "toggleLaser" });
        case "x": {
          take();
          const id = s.slideIds[s.index];
          if (id) ink.clearInk(id);
          return;
        }
        case "o":
          take();
          return dispatch({ type: "setOverviewOpen", open: !s.overviewOpen });
        case "n":
          take();
          return dispatch({ type: "setNotesOpen", open: !s.notesOpen });
        case "?":
        case "/":
          take();
          return dispatch({ type: "setShortcutsOpen", open: !s.shortcutsOpen });
        default:
          return;
      }
    };

    window.addEventListener("keydown", onKey);
    const timer = jumpTimer;
    return () => {
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(timer.current);
    };
  }, [exit, toggleFullscreen, dispatch, ink, report]);

  /* ---------------- pointer: tap thirds, swipe, click ---------------- */

  const touch = useRef<{ x: number; y: number; at: number } | null>(null);
  const drawingTool = tool !== "none" || laser;

  const onPointerDown = (e: React.PointerEvent) => {
    if (drawingTool || e.button !== 0) return;
    if (onLink(e)) return;
    touch.current = { x: e.clientX, y: e.clientY, at: Date.now() };
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const startPoint = touch.current;
    touch.current = null;
    if (!startPoint || drawingTool || onLink(e)) return;
    const s = stateRef.current;
    if (s.overviewOpen || s.blackout !== "none" || s.ended) return;
    const dx = e.clientX - startPoint.x;
    const dy = e.clientY - startPoint.y;

    // Keynote, Pitch and Slides all advance on a click.
    if (e.pointerType === "mouse") {
      if (Math.abs(dx) < 12 && Math.abs(dy) < 12) dispatch({ type: "next" });
      return;
    }

    if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy)) {
      dispatch({ type: dx < 0 ? "next" : "prev" });
      return;
    }
    if (Date.now() - startPoint.at > TAP_MS || Math.abs(dx) > 12 || Math.abs(dy) > 12) return;
    const width = (e.currentTarget as HTMLElement).clientWidth;
    if (e.clientX > (width * 2) / 3) dispatch({ type: "next" });
    else if (e.clientX < width / 3) dispatch({ type: "prev" });
  };

  const stepCount = stepCounts[Math.min(index, stepCounts.length - 1)] ?? 0;
  const slide = lesson.slides[Math.min(index, lesson.slides.length - 1)];
  const announcement = ended
    ? next
      ? `End of lesson. Next: ${next.title}`
      : "End of lesson"
    : `Slide ${index + 1} of ${lesson.slides.length}${stepCount > 0 ? `, step ${step + 1} of ${stepCount + 1}` : ""}${
        slide && hasRevealableAnswer(slide) && step >= slideStepCount(slide) ? ", answer shown" : ""
      }`;

  return (
    /*
     * The stage scope (`.tj-stage`, ADR 0022 §3): every `@tj/ui` control below paints itself for
     * the stage. Portalled surfaces carry the class themselves. The slide reads none of these — it
     * paints from its theme.
     */
    <div
      className={cn("fixed inset-0 z-40 flex bg-background text-foreground", STAGE_SCOPE_CLASS)}
      data-present-root
    >
      <div className="relative min-w-0 flex-1">
        <div
          // When the cover goes, slide 1 arrives rather than cutting in — opacity only, once.
          className={cn("absolute inset-0", started && "motion-safe:animate-fade-in")}
          style={{ touchAction: "none" }}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
        >
          <Stage lesson={lesson} theme={theme} />
        </div>

        {ended ? <EndCard title={lesson.title} onExit={exit} next={next} /> : null}
        <Overview lesson={lesson} theme={theme} />

        {started && blackout === "none" && !ended ? (
          <Controls
            slideCount={lesson.slides.length}
            stepCount={stepCount}
            isQuestion={slide ? hasRevealableAnswer(slide) : false}
            onExit={exit}
          />
        ) : null}

        {/* Where the deck is, for anyone who cannot see the slide. */}
        <p className="sr-only" role="status" aria-live="polite">
          {started ? announcement : ""}
        </p>

        {jump ? (
          <div
            className="absolute bottom-6 left-6 z-[450] flex items-center gap-2 rounded-full bg-card py-1.5 pr-2 pl-3.5 text-body text-foreground ring-1 ring-border"
            role="status"
          >
            Go to slide {jump}
            <Kbd>Enter</Kbd>
          </div>
        ) : null}

        {!started ? (
          <div className="absolute inset-0 z-[490] flex items-center justify-center bg-background px-8">
            <div className="flex max-w-[46ch] flex-col items-center text-center">
              {/* The lesson's first slide, so the cover is a lesson about to be taught. */}
              {lesson.slides[0] ? (
                <div
                  aria-hidden
                  className="mb-7 overflow-hidden rounded-card shadow-2"
                  style={{ width: COVER_SLIDE_W }}
                >
                  <SlideStatic slide={lesson.slides[0]} theme={theme} width={COVER_SLIDE_W} />
                </div>
              ) : null}
              <p className="font-medium text-ink-3 text-meta">{lesson.slides.length} slides</p>
              <Display size="lg" as="h1" className="mt-2">
                {lesson.title}
              </Display>
              <div className="mt-6 flex items-center gap-2">
                <Button onClick={() => start(true)}>Start presenting</Button>
                <Button variant="ghost" onClick={() => start(false)}>
                  Stay in this window
                </Button>
                {/* The shortcut sheet has to be signposted from the cover. */}
                <IconButton
                  label="Keyboard shortcuts"
                  tooltipClassName={STAGE_SCOPE_CLASS}
                  onClick={() => dispatch({ type: "setShortcutsOpen", open: true })}
                >
                  <span aria-hidden className="font-semibold text-body">
                    ?
                  </span>
                </IconButton>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {notesOpen ? <NotesPanel lesson={lesson} theme={theme} /> : null}
      <ShortcutsDialog />
    </div>
  );
}
