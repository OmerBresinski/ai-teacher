import {
  answerStepsTaken,
  SLIDE_H,
  SLIDE_W,
  type Slide,
  type SlideElement,
  slideStepCount,
  type Theme,
} from "@tj/domain/documents";
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
import type { ImageSearchClient } from "../images/image-search";
import { nextStep, ZoomControl } from "../kit/ZoomControl";
import { SlideScaler } from "../slide/SlideScaler";
import { SlideView } from "../slide/SlideView";
import { applySlideClip } from "../slide/slide-clip";
import { type CanvasMenuState, ElementContextMenu } from "./canvas/ElementContextMenu";
import { SlideActions } from "./canvas/SlideActions";
import { SlideTabs } from "./canvas/SlideTabs";
import { pointOnSlide, useImageDrop } from "./canvas/use-image-drop";
import { useLesson } from "./document-context";
import { isInTextField } from "./keys";
import { ResidualBadge } from "./ResidualBadge";
import { CANVAS_GUTTER_X, CANVAS_GUTTER_Y } from "./shell-layout";
import { ContextualToolbar } from "./toolbar/ContextualToolbar";
import { boxesOf, hitTest } from "./transform/hit-test";
import { type MarginHandle, type PreviewMap, SelectionLayer } from "./transform/SelectionLayer";
import { useCanvasKeys } from "./transform/use-canvas-keys";
import { useCompactChrome } from "./use-compact-chrome";
import {
  useAnswerShowing,
  useSessionActions,
  useSessionRead,
  useSessionUi,
  useZoom,
} from "./use-editor-session";
import { useMobileEditor } from "./use-mobile-editor";

/*
 * The editor canvas (TeachDeck `components/v2/editor/Canvas.tsx`): a scroll region holding the
 * 960x540 slide at the session's zoom, with the transform layer as a sibling of `SlideView` inside
 * the same `SlideScaler`, the slide's own floating chrome (actions pill, Question / Answer tabs) in
 * screen space over it, and the zoom cluster bottom-right. A pasted or dropped image file becomes
 * an element through `useImageDrop` (TEACH-107).
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
  /** Add an element to this slide and select it — the shell's `insert`, for paste and drop. */
  onInsert: (el: SlideElement) => void;
  /** Report action on the credit badge; hidden without a client. */
  images?: ImageSearchClient;
  /** Travels as the report context for a placed picture. */
  lessonId?: string;
  /**
   * How many px at the canvas's right edge something lies over (the Dayback pane at 1280 px or
   * less, ruling 186). The slide keeps its fitted size and moves left into its own margin, as far
   * as the margin allows, to stay clear of it.
   */
  clearRight?: number;
  /** False while the Dayback pane is open: no bubble at the bottom right, so the zoom row moves in. */
  bubble?: boolean;
  /**
   * Px at the right the slide is fitted clear of even while nothing lies there: the Dayback pane's
   * reserved width (`shell-layout.ts`, rule 3), so opening the pane only recentres the slide.
   */
  fitInset?: number;
};

/** Air kept between the slide and a pane lying over the canvas. */
const CLEAR_AIR = 16;

/**
 * How far the slide moves left to clear `clearRight` px at the right edge of a `viewW`-wide canvas,
 * never more than the slack beside a `contentW`-wide slide (gutters included), so it is never cut
 * off on the left and never re-fitted.
 */
export function clearShift(viewW: number, contentW: number, gutterX: number, clearRight: number) {
  if (clearRight <= 0) return 0;
  const slack = Math.max(0, (viewW - contentW) / 2);
  const needed = clearRight + CLEAR_AIR - (slack + gutterX);
  return Math.round(Math.max(0, Math.min(needed, slack)));
}

export function Canvas({
  slide,
  theme,
  onFocusChange,
  onScaleChange,
  onInsert,
  images,
  lessonId,
  clearRight = 0,
  bubble = true,
  fitInset = 0,
}: CanvasProps) {
  const lesson = useLesson();
  const zoom = useZoom();
  const { previewStep, editingTextId } = useSessionUi();
  const { setZoom, select, clearSelection } = useSessionActions();
  const read = useSessionRead();
  // The Answer tab and the last reveal step are the same state (SPEC §6), decided once.
  const showingAnswer = useAnswerShowing(slide);

  const [scale, setScale] = useState(1);
  /** What 'fit' resolves to: the scroll region minus the gutter, measured on the region itself. */
  const [fitScale, setFitScale] = useState(1);
  /** The scroll region's width, for moving the slide clear of a pane over the canvas. */
  const [viewW, setViewW] = useState(0);
  const [focused, setFocused] = useState(false);
  /** The in-flight geometry of a drag, painted by `SlideView` instead of the cache (ADR 0022 §4). */
  const [preview, setPreview] = useState<PreviewMap | null>(null);

  const scroller = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  /** The box that clips the slide to its 960x540 edge. */
  const clip = useRef<HTMLDivElement>(null);
  /** The selection layer's entry point for a press on the margin round the slide. */
  const layer = useRef<MarginHandle | null>(null);
  // The Question / Answer tabs' wrapper: the pill hangs off the other end of the same band, and at
  // a low zoom the two ends meet, so the pill measures the tabs and gives way.
  const tabs = useRef<HTMLDivElement>(null);
  // The contextual toolbar's wrapper: it owns the middle of the same band. With a side panel open
  // the slide toolbar reaches the pill's corner, so the pill measures it and stacks above.
  const toolbar = useRef<HTMLDivElement>(null);

  useCanvasKeys({ enabled: focused, lesson, slide });
  const dropping = useImageDrop({ scroller, stage, onInsert });

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

  /**
   * The slide never scrolls inside its own frame. Typing past the bottom of a text box made
   * Chromium caret-scroll the frame and the slide root (both `overflow: hidden`, which is still a
   * scroll container), so the slide's top rows slid up under the frame edge and stayed there
   * after Escape. Both are now `overflow: clip`, which no caret, wheel or script can scroll; this
   * snap-back covers an engine that still treats them as scrollable — on any scroll they report,
   * and once more when editing ends.
   */
  const snapBack = useCallback(() => {
    const frame = clip.current;
    if (!frame) return;
    for (const el of [frame, frame.querySelector<HTMLElement>("[data-slide-root]")]) {
      if (el && (el.scrollTop !== 0 || el.scrollLeft !== 0)) {
        el.scrollTop = 0;
        el.scrollLeft = 0;
      }
    }
  }, []);
  /**
   * Where the scroll region stood when editing began. Following the caret through it is the one
   * scroll the editor makes on the teacher's behalf, and it can leave the slide's top rows above
   * the viewport; when editing ends the region goes back exactly there, so a pan or zoom the
   * teacher set up before editing is kept. Nothing is scrolled into view on our own account: a
   * region the caret never moved is left alone.
   */
  const regionAtEditStart = useRef<{ top: number; left: number } | null>(null);
  useEffect(() => {
    const region = scroller.current;
    if (editingTextId !== null) {
      if (regionAtEditStart.current === null && region) {
        regionAtEditStart.current = { top: region.scrollTop, left: region.scrollLeft };
      }
      return;
    }
    snapBack();
    const start = regionAtEditStart.current;
    regionAtEditStart.current = null;
    if (region && start && (region.scrollTop !== start.top || region.scrollLeft !== start.left)) {
      region.scrollTop = start.top;
      region.scrollLeft = start.left;
    }
  }, [editingTextId, snapBack]);

  /**
   * While a text box is being typed into, the slide's bottom edge opens so the lines that run
   * off it stay in sight (the scroll region follows the caret as usual); the moment editing ends
   * the slide clips again. Sideways overflow is clipped throughout, and no other surface
   * (thumbnails, present, export) mounts this frame. The rule itself, with its `hidden`
   * fallback for engines without `clip`, is `applySlideClip`; it is written before paint.
   */
  const spill = editingTextId !== null;
  useLayoutEffect(() => {
    if (clip.current) applySlideClip(clip.current, spill);
  }, [spill]);

  const compactChrome = useCompactChrome();
  const mobile = useMobileEditor();
  const gutter = compactChrome ? 16 : GUTTER;
  // Ruling 186: the filmstrip sits under the canvas, so the slide is bounded by height; a narrow
  // side gutter lets the Dayback pane take the width the old slide column used. The top and bottom
  // gutters keep the contextual toolbar and the canvas footer off the slide.
  const gutterX = mobile ? gutter : CANVAS_GUTTER_X;
  const gutterY = mobile ? gutter : CANVAS_GUTTER_Y;

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
      setViewW(width);
      setFitScale(
        Math.max(
          0.05,
          Math.min((width - fitInset - gutterX * 2) / SLIDE_W, (height - gutterY * 2) / SLIDE_H),
        ),
      );
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [gutterX, gutterY, fitInset]);
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

  /* ---- context menu ----------------------------------------------------- */
  const [menu, setMenu] = useState<CanvasMenuState>(null);
  // Hit-tested in slide space rather than read off the DOM: the transform layer sits over the slide
  // and would otherwise be the target. A right-click on an unselected element selects it first; on
  // empty ground it deselects. Outside the slide, and inside a text being edited, the browser's own
  // menu is left alone.
  const onContextMenu = (e: React.MouseEvent) => {
    const st = stage.current;
    if (!st || spaceDown || isInTextField(e.target)) return;
    const p = pointOnSlide(st, e.clientX, e.clientY);
    if (!p || p.x < 0 || p.y < 0 || p.x > SLIDE_W || p.y > SLIDE_H) return;
    e.preventDefault();
    const hit = hitTest(boxesOf(slide.elements), p);
    if (hit) {
      if (!read().selection.includes(hit.id)) select([hit.id]);
    } else clearSelection();
    setMenu({ x: e.clientX, y: e.clientY, kind: hit ? "element" : "ground" });
  };

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

  /**
   * Space held: pan. Otherwise a primary press on the grey margin (anything in the scroll region
   * that is not the stage) is slide ground: the selection layer starts its marquee from there, and
   * a plain click clears the selection. Presses on the stage are the layer's own; the floating
   * toolbars live outside the scroller and never arrive here; the right button leaves the press
   * to `onContextMenu`.
   */
  const onScrollerDown = (e: React.PointerEvent) => {
    if (spaceDown) {
      onPanDown(e);
      return;
    }
    if (e.button !== 0 || isInTextField(e.target)) return;
    const st = stage.current;
    if (!st || (e.target instanceof Node && st.contains(e.target))) return;
    // Like the pan: otherwise the browser starts selecting the slide's text under the sweep.
    e.preventDefault();
    layer.current?.pointerDown(e);
  };

  /* ---- layout ----------------------------------------------------------- */
  const contentW = SLIDE_W * scale + gutterX * 2;
  const contentH = SLIDE_H * scale + gutterY * 2;
  // Padding on the right moves the centred slide left by `shift` without re-fitting it; the slack
  // bound keeps the region from growing a scrollbar.
  const shift = clearShift(viewW, contentW, gutterX, clearRight);
  const steps = slideStepCount(slide);

  return (
    <main className="relative min-w-0 flex-1 bg-canvas" data-canvas data-clear-right={clearRight}>
      {/* A labelled scroll region, not a control and not a tab stop: the pointer handlers are pan
          (space plus drag), and the keys that act on the canvas are bound by `useCanvasKeys` while
          focus is anywhere inside it. Tab lands on the slide stage (`SelectionLayer`), so the focus
          band wraps the slide card rather than the whole editing zone; a click in the gutter still
          focuses the region (tabIndex -1), so the keys keep working. */}
      {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: pan and focus tracking on the scroll region; every activation inside is a real control */}
      {/* biome-ignore lint/a11y/useSemanticElements: a fieldset is not a scroll region; the group role names the region for a screen reader */}
      <div
        ref={scroller}
        data-canvas-scroller
        tabIndex={-1}
        role="group"
        aria-label="Slide canvas"
        className={cn("absolute inset-0 overflow-auto outline-none", spaceDown && "cursor-grab")}
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
        onPointerDown={onScrollerDown}
        onPointerMove={onPanMove}
        onPointerUp={onPanUp}
        onContextMenu={onContextMenu}
      >
        <div
          data-canvas-content
          className="transition-[padding] duration-(--duration-base) ease-(--ease-standard) motion-reduce:transition-none"
          style={{
            minWidth: "100%",
            minHeight: "100%",
            width: contentW + shift * 2,
            height: contentH,
            paddingRight: shift * 2,
          }}
        >
          <SlideScaler zoom={effectiveZoom} gutter={gutter} onScale={onScale}>
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
                // The drop ring is a second shadow rather than a border so the frame never moves.
                boxShadow: dropping
                  ? `var(--shadow-slide), 0 0 0 ${3 / Math.max(scale, 0.05)}px var(--border-strong)`
                  : "var(--shadow-slide)",
              }}
            >
              {/* `isolation` contains the slide's own z-indices so the selection layer stays above them. */}
              <div
                ref={clip}
                data-slide-clip
                // Scroll does not bubble, so the capture phase is what hears the slide root too.
                onScrollCapture={(e) => {
                  const t = e.target as HTMLElement;
                  if (t === clip.current || t.hasAttribute?.("data-slide-root")) snapBack();
                }}
                style={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: "inherit",
                  // `overflow` is written by `applySlideClip` above, not here.
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
                  answerProgress={answerStepsTaken(slide, previewStep)}
                  transformOverride={preview ?? undefined}
                  spill={spill}
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
              <SelectionLayer
                slide={slide}
                theme={theme}
                preview={preview}
                onPreview={setPreview}
                disabled={spaceDown}
                marginRef={layer}
                images={images}
                lessonId={lessonId}
              />
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
        {/* Wrapped so the pill can measure the toolbar's own floating box. */}
        <div ref={toolbar}>
          <ContextualToolbar
            slide={slide}
            theme={theme}
            stageRef={stage}
            scale={scale}
            mobileActions={
              mobile ? (
                <>
                  <SlideActions inline slide={slide} stageRef={stage} scale={scale} />
                  <SlideTabs
                    inline
                    slide={slide}
                    stageRef={stage}
                    stageId={STAGE_ID}
                    scale={scale}
                  />
                </>
              ) : undefined
            }
          />
        </div>
        {!mobile ? (
          <>
            <SlideActions
              slide={slide}
              stageRef={stage}
              toolbarRef={toolbar}
              tabsRef={tabs}
              scale={scale}
            />
            {/* Wrapped so the pill can measure the tabs' own floating box. */}
            <div ref={tabs}>
              <SlideTabs slide={slide} stageRef={stage} stageId={STAGE_ID} scale={scale} />
            </div>
          </>
        ) : null}
      </div>
      <CanvasFooter clearRight={clearRight} bubble={bubble} scale={scale} steps={steps} />
      <ElementContextMenu
        slide={slide}
        menu={menu}
        onClose={() => setMenu(null)}
        // Back to the stage (the canvas tab stop), or the region when the stage is not mounted.
        returnFocus={() =>
          (
            scroller.current?.querySelector<HTMLElement>("[data-selection-layer]") ??
            scroller.current
          )?.focus({ preventScroll: true })
        }
      />
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
 * 'fit' has no fixed percentage — step from what is actually on screen to the nearest stop in
 * that direction, so a 72% fit steps up to 75% and down to 50% (never skipping a stop).
 */
export const stepZoom = (current: number, dir: 1 | -1): number =>
  nextStep(ZOOM_STEPS, current, dir);

/* ------------------------------------------------------------------ */
/* Footer                                                              */
/* ------------------------------------------------------------------ */

function CanvasFooter({
  scale,
  steps,
  clearRight,
  bubble,
}: {
  scale: number;
  steps: number;
  clearRight: number;
  bubble: boolean;
}) {
  const mobile = useMobileEditor();
  const zoom = useZoom();
  const { previewStep, showGuides, snap } = useSessionUi();
  const { setZoom, setPreviewStep, toggleGuides, toggleSnap } = useSessionActions();

  return (
    // 32px row, 16px in from the bottom and the right. Three objects, one weight: the steps group,
    // the zoom control and the canvas options — plus the residual entry when there is one.
    <div
      data-canvas-footer
      className={cn(
        "pointer-events-none absolute bottom-4 flex h-8 items-center gap-2",
        // Clear of the Dayback bubble at the bottom right (ruling 186).
        mobile || !bubble ? "right-4" : "right-20",
      )}
      // Clear of a pane lying over the canvas (ruling 186, 1280 px or less).
      style={clearRight > 0 ? { right: clearRight + 16 } : undefined}
    >
      <ResidualBadge className="pointer-events-auto" />
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
