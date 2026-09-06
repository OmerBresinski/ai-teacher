import { SLIDE_H, SLIDE_W, type Slide, slideStepCount, type Theme } from "@tj/domain/documents";
import {
  cn,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
  IconButton,
  IconGroup,
} from "@tj/ui";
import { Minus, MoreHorizontal, Plus } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ZoomControl } from "../kit/ZoomControl";
import { SlideScaler } from "../slide/SlideScaler";
import { SlideView } from "../slide/SlideView";
import { SlideActions } from "./canvas/SlideActions";
import { SlideTabs } from "./canvas/SlideTabs";
import { useLesson } from "./document-context";
import { type PreviewMap, SelectionLayer } from "./transform/SelectionLayer";
import { useCanvasKeys } from "./transform/use-canvas-keys";
import {
  useAnswerShowing,
  useSessionActions,
  useSessionRead,
  useSessionUi,
  useZoom,
} from "./use-editor-session";

/*
 * The editor canvas (TeachDeck `components/v2/editor/Canvas.tsx`): a scroll region holding the
 * 960x540 slide at the session's zoom, with the transform layer as a sibling of `SlideView` inside
 * the same `SlideScaler`, the slide's own floating chrome (actions pill, Question / Answer tabs) in
 * screen space over it, and the zoom cluster bottom-right. Image drop and paste arrive with the
 * images ticket (TEACH-107); the contextual toolbar with TEACH-105.
 */

export const ZOOM_STEPS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 4, 8];
/** `--canvas-gap`: the gutter around the slide at every zoom. */
export const GUTTER = 40;

/** The slide frame's id, so the Question / Answer tabs can point `aria-controls` at it. */
const STAGE_ID = "slide-stage";

export type CanvasProps = {
  slide: Slide;
  theme: Theme;
  onFocusChange: (focused: boolean) => void;
  /** Fires whenever the measured scale changes — a ref write in the shell, not state. */
  onScaleChange?: (scale: number) => void;
};

export function Canvas({ slide, theme, onFocusChange, onScaleChange }: CanvasProps) {
  const lesson = useLesson();
  const zoom = useZoom();
  const { previewStep } = useSessionUi();
  const { setZoom } = useSessionActions();
  const read = useSessionRead();
  // The Answer tab and the last reveal step are the same state (SPEC §6), decided once.
  const showingAnswer = useAnswerShowing(slide);

  const [scale, setScale] = useState(1);
  /** What 'fit' resolves to: the scroll region minus the gutter, measured on the region itself. */
  const [fitScale, setFitScale] = useState(1);
  const [focused, setFocused] = useState(false);
  /** The in-flight geometry of a drag, painted by `SlideView` instead of the cache (ADR 0022 §4). */
  const [preview, setPreview] = useState<PreviewMap | null>(null);

  const scroller = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  // The Question / Answer tabs' wrapper: the pill hangs off the other end of the same band, and at
  // a low zoom the two ends meet, so the pill measures the tabs and gives way.
  const tabs = useRef<HTMLDivElement>(null);

  useCanvasKeys({ enabled: focused, lesson, slide });

  const focus = useCallback(
    (next: boolean) => {
      setFocused(next);
      onFocusChange(next);
    },
    [onFocusChange],
  );

  const onScale = useCallback(
    (s: number) => {
      setScale(s);
      onScaleChange?.(s);
    },
    [onScaleChange],
  );

  /* ---- fit ---------------------------------------------------------------- */
  // Measured on the scroller, not on the content box inside it: the content is sized from the
  // scale, so measuring it would feed the answer back into the question — at 100% it is already
  // wider than a small window and "fit" could never shrink it.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setFitScale(
        Math.max(0.05, Math.min((width - GUTTER * 2) / SLIDE_W, (height - GUTTER * 2) / SLIDE_H)),
      );
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const effectiveZoom = zoom === "fit" ? fitScale : zoom;

  /* ---- zoom about the pointer ------------------------------------------ */
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const current = read().zoom;
      const from = current === "fit" ? scale : current;
      const next = clampZoom(from * 0.995 ** e.deltaY);
      zoomAbout(el, from, next, e.clientX, e.clientY);
      setZoom(next);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [scale, read, setZoom]);

  /* ---- space to pan ----------------------------------------------------- */
  const [spaceDown, setSpaceDown] = useState(false);
  useEffect(() => {
    if (!focused) return;
    const down = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat) return;
      if (
        e.target instanceof Element &&
        e.target.closest('input,textarea,[contenteditable="true"]')
      )
        return;
      e.preventDefault();
      setSpaceDown(true);
    };
    const up = (e: KeyboardEvent) => e.code === "Space" && setSpaceDown(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      setSpaceDown(false);
    };
  }, [focused]);

  const pan = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const onPanDown = (e: React.PointerEvent) => {
    const el = scroller.current;
    if (!spaceDown || !el) return;
    e.preventDefault();
    pan.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
    el.setPointerCapture(e.pointerId);
  };
  const onPanMove = (e: React.PointerEvent) => {
    const el = scroller.current;
    if (!pan.current || !el) return;
    el.scrollLeft = pan.current.left - (e.clientX - pan.current.x);
    el.scrollTop = pan.current.top - (e.clientY - pan.current.y);
  };
  const onPanUp = (e: React.PointerEvent) => {
    pan.current = null;
    scroller.current?.releasePointerCapture?.(e.pointerId);
  };

  /* ---- layout ----------------------------------------------------------- */
  const contentW = SLIDE_W * scale + GUTTER * 2;
  const contentH = SLIDE_H * scale + GUTTER * 2;
  const steps = slideStepCount(slide);

  return (
    <main className="relative min-w-0 flex-1 bg-canvas" data-canvas>
      {/* A labelled, focusable scroll region, not a control: the pointer handlers are pan (space
          plus drag), and the keys that act on the canvas are bound by `useCanvasKeys` while it has
          focus. A keyboard user who has just tabbed in gets a neutral inset hairline. */}
      {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: pan and focus tracking on the scroll region; every activation inside is a real control */}
      {/* biome-ignore lint/a11y/useSemanticElements: a fieldset is not a scroll region; the group role names the region for a screen reader */}
      <div
        ref={scroller}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the canvas region is the keyboard target for `useCanvasKeys`
        tabIndex={0}
        role="group"
        aria-label="Slide canvas"
        className={cn(
          "absolute inset-0 overflow-auto outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--border-strong)]",
          spaceDown && "cursor-grab",
        )}
        onFocus={() => focus(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) focus(false);
        }}
        onPointerDownCapture={(e) => {
          if (
            e.target instanceof Element &&
            e.target.closest('input,textarea,[contenteditable="true"]')
          )
            return;
          scroller.current?.focus({ preventScroll: true });
        }}
        onPointerDown={onPanDown}
        onPointerMove={onPanMove}
        onPointerUp={onPanUp}
      >
        <div style={{ minWidth: "100%", minHeight: "100%", width: contentW, height: contentH }}>
          <SlideScaler zoom={effectiveZoom} gutter={GUTTER} onScale={onScale}>
            <div
              ref={stage}
              id={STAGE_ID}
              data-slide-frame
              // A theme swap should read as the paper changing rather than a repaint, so the slide
              // root's two colours cross-fade. Written as a descendant of *this* stage, which only
              // the editor canvas mounts: thumbnails, present and print keep painting instantly.
              className={cn(
                "rounded-dialog",
                "[&_[data-slide-root]]:transition-[background-color,color]",
                "[&_[data-slide-root]]:duration-(--duration-base)",
                "[&_[data-slide-root]]:ease-(--ease-standard)",
                "motion-reduce:[&_[data-slide-root]]:transition-none",
              )}
              style={{
                position: "relative",
                width: SLIDE_W,
                height: SLIDE_H,
                boxShadow: "var(--shadow-slide)",
              }}
            >
              {/* `isolation` contains the slide's own z-indices so the selection layer stays above them. */}
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: "inherit",
                  overflow: "hidden",
                  isolation: "isolate",
                }}
              >
                <SlideView
                  slide={slide}
                  theme={theme}
                  mode="edit"
                  step={previewStep}
                  // The final step IS the answer reveal (SPEC §6); the Answer tab is a shortcut.
                  revealAnswer={showingAnswer}
                  transformOverride={preview ?? undefined}
                />
              </div>
              {/* An inset hairline in the theme's own line colour gives the slide an edge against the gutter. */}
              <span
                aria-hidden
                style={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: "inherit",
                  pointerEvents: "none",
                  boxShadow: `inset 0 0 0 1px ${theme.colors.line}`,
                }}
              />
              <SelectionLayer slide={slide} preview={preview} onPreview={setPreview} />
            </div>
          </SlideScaler>
        </div>
      </div>

      {/* A click on the slide's floating controls must not blur the canvas — that would disable
          `useCanvasKeys` until the canvas is clicked again. Suppressing the mousedown's default
          focus-steal keeps focus where it was; the buttons carry their own roles and keys. */}
      {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: not a control — it only stops the default focus-steal for the buttons inside it */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: same */}
      <div
        onMouseDown={(e) => {
          if (e.target instanceof Element && e.target.closest("button")) e.preventDefault();
        }}
      >
        <SlideActions slide={slide} stageRef={stage} tabsRef={tabs} scale={scale} />
        {/* Wrapped so the pill can measure the tabs' own floating box. */}
        <div ref={tabs}>
          <SlideTabs slide={slide} stageRef={stage} stageId={STAGE_ID} scale={scale} />
        </div>
      </div>
      <CanvasFooter scale={scale} steps={steps} />
    </main>
  );
}

/* ------------------------------------------------------------------ */
/* Zoom helpers                                                        */
/* ------------------------------------------------------------------ */

const clampZoom = (z: number) => Math.min(8, Math.max(0.1, z));

/** Keep the point under the cursor still while the content resizes around it. */
function zoomAbout(el: HTMLElement, from: number, to: number, clientX: number, clientY: number) {
  const rect = el.getBoundingClientRect();
  const cx = clientX - rect.left;
  const cy = clientY - rect.top;
  const ratio = to / from;
  requestAnimationFrame(() => {
    el.scrollLeft = (el.scrollLeft + cx) * ratio - cx;
    el.scrollTop = (el.scrollTop + cy) * ratio - cy;
  });
}

/**
 * 'fit' has no fixed percentage — step from what is actually on screen, so a 72% fit steps up to
 * 75% before it steps down.
 */
export function stepZoom(current: number, dir: 1 | -1): number {
  const i = ZOOM_STEPS.findIndex((z) => z > current + 0.0001);
  const next =
    dir === 1
      ? ZOOM_STEPS[i === -1 ? ZOOM_STEPS.length - 1 : i]
      : ZOOM_STEPS[Math.max(0, (i === -1 ? ZOOM_STEPS.length : i) - 2)];
  return next ?? current;
}

/* ------------------------------------------------------------------ */
/* Footer                                                              */
/* ------------------------------------------------------------------ */

function CanvasFooter({ scale, steps }: { scale: number; steps: number }) {
  const zoom = useZoom();
  const { previewStep, showGuides, snap } = useSessionUi();
  const { setZoom, setPreviewStep, toggleGuides, toggleSnap } = useSessionActions();

  return (
    // 32px row, 16px in from the bottom and the right. Three objects, one weight: the steps group,
    // the zoom control and the canvas options.
    <div
      data-canvas-footer
      className="pointer-events-none absolute right-4 bottom-4 flex h-8 items-center gap-2"
    >
      {steps > 0 ? (
        <IconGroup aria-label="Reveal step" className="pointer-events-auto bg-card">
          <IconButton
            label="Previous step"
            disabled={previewStep <= 0}
            onClick={() => setPreviewStep(Math.max(0, previewStep - 1))}
          >
            <Minus aria-hidden size={16} strokeWidth={1.5} />
          </IconButton>
          <span
            data-tabular
            className="inline-flex items-center px-2.5 text-ink-2 text-meta tabular-nums"
          >
            {previewStep === 0 ? "All steps" : `Step ${previewStep} of ${steps}`}
          </span>
          <IconButton
            label="Next step"
            disabled={previewStep >= steps}
            onClick={() => setPreviewStep(Math.min(steps, previewStep + 1))}
          >
            <Plus aria-hidden size={16} strokeWidth={1.5} />
          </IconButton>
        </IconGroup>
      ) : null}

      <ZoomControl
        className="pointer-events-auto"
        value={zoom}
        scale={scale}
        steps={ZOOM_STEPS}
        onChange={(z) => setZoom(z)}
        onFit={() => setZoom("fit")}
      />

      {/* A menu trigger never sits in an `IconGroup`: a standalone hairlined icon button. */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton
            label="Canvas options"
            className="pointer-events-auto bg-card shadow-[inset_0_0_0_1px_var(--border-control)]"
          >
            <MoreHorizontal aria-hidden size={16} strokeWidth={1.5} />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="end">
          <DropdownMenuCheckboxItem
            checked={showGuides}
            onSelect={(e) => {
              e.preventDefault();
              toggleGuides();
            }}
          >
            Smart guides
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem
            checked={snap}
            onSelect={(e) => {
              e.preventDefault();
              toggleSnap();
            }}
          >
            Snap to guides
          </DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
