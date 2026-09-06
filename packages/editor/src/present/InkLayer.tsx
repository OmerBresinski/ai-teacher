import { type Id, SLIDE_H, SLIDE_W } from "@tj/domain/documents";
import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  beginStroke,
  extendStroke,
  HIGHLIGHTER_ALPHA,
  type InkPath,
  type InkPoint,
  type InkTool,
  inkDefaults,
  pathD,
  type StrokeBuilder,
  simplify,
  strokeD,
} from "./ink";
import { usePresent } from "./use-present-session";

/**
 * Annotation over the slide, in slide coordinates, so a stroke lands in the same
 * place on any projector. Ink is a separate layer from slide content: clearing it
 * never touches the lesson (SPEC §8).
 *
 * The live stroke never goes through React. It is built one segment at a time in
 * a ref and written to a single `<path>` from a rAF, so a long stroke over a
 * slide that already carries a dozen annotations costs one `setAttribute` a
 * frame rather than re-serialising every path on the slide per pointer event.
 *
 * Highlighter ink multiplies with the slide, which means the blend has to happen
 * against the slide's own backdrop: the layer is mounted inside the slide layer
 * (see `Stage`) and carries `mix-blend-mode` on the `<svg>` itself. On a `<path>`
 * inside a positioned `<svg>` it would only ever blend with its siblings.
 */

type Props = {
  slideId: Id;
  /** False for the outgoing slide mid-transition: it travels, it does not draw. */
  interactive?: boolean;
};

const strokeProps = (path: Pick<InkPath, "tool" | "color" | "width">) => ({
  stroke: path.color,
  strokeWidth: path.width,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  fill: "none",
  ...(path.tool === "highlighter" ? { strokeOpacity: HIGHLIGHTER_ALPHA } : null),
});

/**
 * Committed strokes are immutable, so their serialised `d` is worth keeping:
 * keyed by the path object itself, it is dropped with the path.
 */
const D_CACHE = new WeakMap<InkPath, string>();

function dOf(path: InkPath): string {
  let d = D_CACHE.get(path);
  if (d === undefined) {
    d = pathD(path.points);
    D_CACHE.set(path, d);
  }
  return d;
}

const SVG_BOX = {
  width: SLIDE_W,
  height: SLIDE_H,
  viewBox: `0 0 ${SLIDE_W} ${SLIDE_H}`,
} as const;

export function InkLayer({ slideId, interactive = true }: Props) {
  const { state, ink } = usePresent();
  const tool = state.tool;
  // `ink` is a new object whenever `inkVersion` bumps (see use-present-session), so reading through
  // it re-runs this memo on every committed stroke without a separate version dependency.
  const paths = useMemo(() => ink.pathsFor(slideId), [ink, slideId]);
  const { addPath, eraseAt } = ink;

  const svgRef = useRef<SVGSVGElement>(null);
  const penDraft = useRef<SVGPathElement>(null);
  const highlighterDraft = useRef<SVGPathElement>(null);
  const stroke = useRef<StrokeBuilder | null>(null);
  const drawingWith = useRef<InkTool | null>(null);
  const frame = useRef(0);

  const active = interactive && tool !== "none";
  const inking: InkTool | null = tool === "pen" || tool === "highlighter" ? tool : null;

  const { pen, highlighter } = useMemo(() => {
    const pen: InkPath[] = [];
    const highlighter: InkPath[] = [];
    for (const path of paths) (path.tool === "highlighter" ? highlighter : pen).push(path);
    return { pen, highlighter };
  }, [paths]);

  const draftEl = useCallback(
    () => (drawingWith.current === "highlighter" ? highlighterDraft.current : penDraft.current),
    [],
  );

  const paint = useCallback(() => {
    frame.current = 0;
    const el = draftEl();
    if (!el) return;
    el.setAttribute("d", stroke.current ? strokeD(stroke.current) : "");
  }, [draftEl]);

  const clearDraft = useCallback(() => {
    if (frame.current) cancelAnimationFrame(frame.current);
    frame.current = 0;
    penDraft.current?.setAttribute("d", "");
    highlighterDraft.current?.setAttribute("d", "");
    stroke.current = null;
    drawingWith.current = null;
  }, []);

  // A slide change mid-stroke drops the draft rather than committing something the teacher
  // cannot see any more: the cleanup runs when `slideId` changes, which is the point of it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `slideId` is the trigger, not a read
  useEffect(() => clearDraft, [clearDraft, slideId]);

  const toSlide = useCallback((e: { clientX: number; clientY: number }): InkPoint | null => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return null;
    return {
      x: ((e.clientX - rect.left) / rect.width) * SLIDE_W,
      y: ((e.clientY - rect.top) / rect.height) * SLIDE_H,
    };
  }, []);

  const schedule = () => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(paint);
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!active || e.button !== 0) return;
    const at = toSlide(e);
    if (!at) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    if (inking) {
      drawingWith.current = inking;
      stroke.current = beginStroke(at);
      paint();
    } else {
      drawingWith.current = null;
      eraseAt(slideId, at);
    }
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!active) return;
    if (drawingWith.current) {
      const b = stroke.current;
      if (!b) return;
      // Coalesced events keep a fast stroke smooth without raising the cost:
      // they are appended, not re-serialised.
      const events =
        typeof e.nativeEvent.getCoalescedEvents === "function"
          ? e.nativeEvent.getCoalescedEvents()
          : [];
      for (const point of events.length > 0 ? events : [e]) {
        const at = toSlide(point);
        if (at) extendStroke(b, at);
      }
      schedule();
      return;
    }
    if (tool === "eraser" && e.buttons === 1) {
      const at = toSlide(e);
      if (at) eraseAt(slideId, at);
    }
  };

  const commit = useCallback(() => {
    const b = stroke.current;
    const tool = drawingWith.current;
    clearDraft();
    if (!tool || !b || b.points.length === 0) return;
    const preset = inkDefaults(tool);
    addPath(slideId, {
      tool,
      color: preset.color,
      width: preset.width,
      points: simplify(b.points),
    });
  }, [addPath, clearDraft, slideId]);

  const finish = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
    commit();
  };

  const cursor = tool === "eraser" ? "cell" : inking ? "crosshair" : "default";

  return (
    <>
      {/* Its own layer so the blend has the slide, not the pen strokes, as its
          backdrop — and so highlighter always sits under pen, as it does on a
          whiteboard. */}
      <svg
        {...SVG_BOX}
        aria-hidden
        focusable="false"
        data-ink-layer="highlighter"
        className="pointer-events-none absolute inset-0 z-[395]"
        style={{ mixBlendMode: "multiply" }}
      >
        {highlighter.map((path) => (
          <path key={path.id} d={dOf(path)} {...strokeProps(path)} />
        ))}
        <path
          ref={highlighterDraft}
          d=""
          {...strokeProps({ ...inkDefaults("highlighter"), tool: "highlighter" })}
        />
      </svg>

      <svg
        {...SVG_BOX}
        ref={svgRef}
        aria-hidden
        focusable="false"
        data-ink-layer="pen"
        className="absolute inset-0 z-[400]"
        style={{ pointerEvents: active ? "auto" : "none", cursor, touchAction: "none" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={finish}
        // Capture can be taken away mid-stroke (a system gesture, a pen leaving
        // range); the stroke the teacher drew is still a stroke.
        onLostPointerCapture={commit}
      >
        {pen.map((path) => (
          <path key={path.id} d={dOf(path)} {...strokeProps(path)} />
        ))}
        <path ref={penDraft} d="" {...strokeProps({ ...inkDefaults("pen"), tool: "pen" })} />
      </svg>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Laser                                                               */
/* ------------------------------------------------------------------ */

/**
 * Green rather than the pen's red: this is the one mark on the stage that is not
 * ink, and it has to read on a white slide and a dark one without becoming a
 * second annotation colour. The core is dark enough for cream paper — 3.1:1 on
 * the lightest theme ground — and the glow light enough to carry on black.
 */
const LASER_CORE = "#0E9F5C";
const LASER_GLOW = "#3EE08F";
/** Slide points, so 6px at 1x and the same gesture on any projector. */
const LASER_W = 6;

/** Fade after the hand lifts: long enough to finish reading, short enough to go. */
const LASER_HOLD = 400;
const LASER_FADE = 600;

/** The two node pairs: the live mark and the one still fading behind it. */
const LASER_PAIRS = ["live", "retired"] as const;

/**
 * One drawn mark: the two `<path>` nodes and the head that make it up, plus the
 * timers running its own fade. There are two of these, so a press that lands
 * while the last mark is still on screen does not snap it away.
 */
type LaserSlot = {
  group: SVGGElement | null;
  glow: SVGPathElement | null;
  core: SVGPathElement | null;
  head: SVGCircleElement | null;
  hold: number;
  done: number;
  /** Something is drawn in it: the live stroke, or one still fading out. */
  alive: boolean;
};

const emptySlot = (): LaserSlot => ({
  group: null,
  glow: null,
  core: null,
  head: null,
  hold: 0,
  done: 0,
  alive: false,
});

/**
 * The pointer, drawn as a stroke rather than a trail of dots: a teacher circling
 * a word wants the circle to stay on screen while they talk about it. It fades
 * on its own a moment after the hand lifts, and it is never ink — nothing here
 * touches the ink store, so it does not export, does not appear in the overview,
 * and cannot be erased because there is nothing to erase.
 *
 * The live stroke is written straight to two `<path>` nodes from a rAF, the same
 * way `InkLayer` draws, so a long sweep costs one `setAttribute` a frame.
 *
 * Two pairs of those nodes, not one. Circling a word and then underlining the
 * next one is a single gesture as far as the teacher is concerned, and with one
 * pair the second press wiped the circle off mid-fade — the class watched the
 * mark they were still looking at disappear. The fading mark is handed to the
 * other pair instead, keeps the timers it already has, and dies on its own
 * clock. One retired mark is enough: a third press takes it with it.
 */
export function LaserLayer() {
  const on = usePresent().state.laser;
  const svgRef = useRef<SVGSVGElement>(null);
  const slots = useRef<[LaserSlot, LaserSlot]>([emptySlot(), emptySlot()]);
  /** Which pair the live stroke goes to. The other one holds the retired mark. */
  const live = useRef<0 | 1>(0);
  const stroke = useRef<StrokeBuilder | null>(null);
  /** The stroke outlives the press, so "is there a stroke" is not "is the hand down". */
  const down = useRef(false);
  const frame = useRef(0);

  /** Cancel a pair's fade where it stands and put it back to full opacity. */
  const stopFade = useCallback((slot: LaserSlot) => {
    window.clearTimeout(slot.hold);
    window.clearTimeout(slot.done);
    slot.hold = 0;
    slot.done = 0;
    const g = slot.group;
    if (g) {
      g.style.transition = "none";
      g.style.opacity = "1";
    }
  }, []);

  /** Take one pair off the screen. It never touches `stroke`: the live stroke
      may well be the *other* pair's. */
  const clearSlot = useCallback((slot: LaserSlot) => {
    slot.alive = false;
    slot.glow?.setAttribute("d", "");
    slot.core?.setAttribute("d", "");
    slot.head?.setAttribute("opacity", "0");
    const g = slot.group;
    if (g) {
      g.style.transition = "none";
      g.style.opacity = "1";
    }
  }, []);

  const wipe = useCallback(() => {
    if (frame.current) cancelAnimationFrame(frame.current);
    frame.current = 0;
    stroke.current = null;
    down.current = false;
    for (const slot of slots.current) {
      stopFade(slot);
      clearSlot(slot);
    }
  }, [clearSlot, stopFade]);

  const paint = useCallback(() => {
    frame.current = 0;
    const b = stroke.current;
    if (!b) return;
    const slot = slots.current[live.current];
    const d = strokeD(b);
    slot.glow?.setAttribute("d", d);
    slot.core?.setAttribute("d", d);
    const head = slot.head;
    if (head) {
      head.setAttribute("cx", String(b.last.x));
      head.setAttribute("cy", String(b.last.y));
      head.setAttribute("opacity", "1");
    }
  }, []);

  // Putting the tool away takes both marks with it, mid-gesture or not.
  useEffect(() => {
    if (on) return;
    wipe();
  }, [on, wipe]);

  useEffect(() => {
    const pairs = slots.current;
    return () => {
      for (const slot of pairs) {
        window.clearTimeout(slot.hold);
        window.clearTimeout(slot.done);
      }
      if (frame.current) cancelAnimationFrame(frame.current);
    };
  }, []);

  const toSlide = (e: { clientX: number; clientY: number }): InkPoint | null => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return null;
    return {
      x: ((e.clientX - rect.left) / rect.width) * SLIDE_W,
      y: ((e.clientY - rect.top) / rect.height) * SLIDE_H,
    };
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const at = toSlide(e);
    if (!at) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);

    const pairs = slots.current;
    const current = pairs[live.current];
    if (current.alive && !down.current) {
      // Retire it: it keeps the hold and fade timers it was already running.
      // The pair we move to may hold an older retired mark — that one goes.
      const next = live.current === 0 ? 1 : 0;
      stopFade(pairs[next]);
      clearSlot(pairs[next]);
      live.current = next;
    } else {
      stopFade(current);
      clearSlot(current);
    }

    down.current = true;
    stroke.current = beginStroke(at);
    pairs[live.current].alive = true;
    paint();
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const b = stroke.current;
    if (!down.current || !b) return;
    const events =
      typeof e.nativeEvent.getCoalescedEvents === "function"
        ? e.nativeEvent.getCoalescedEvents()
        : [];
    for (const point of events.length > 0 ? events : [e]) {
      const at = toSlide(point);
      if (at) extendStroke(b, at);
    }
    if (!frame.current) frame.current = requestAnimationFrame(paint);
  };

  const finish = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
    if (!down.current || !stroke.current) return;
    down.current = false;
    // The timers belong to this pair, not to the layer, so a later press can
    // walk away from the mark without having to know how far through it was.
    const slot = slots.current[live.current];
    slot.hold = window.setTimeout(() => {
      slot.hold = 0;
      const g = slot.group;
      if (g) {
        g.style.transition = `opacity ${LASER_FADE}ms linear`;
        g.style.opacity = "0";
      }
      slot.done = window.setTimeout(() => {
        slot.done = 0;
        clearSlot(slot);
      }, LASER_FADE);
    }, LASER_HOLD);
  };

  if (!on) return null;

  const pairs = slots.current;

  return (
    <svg
      {...SVG_BOX}
      ref={svgRef}
      aria-hidden
      focusable="false"
      className="absolute inset-0 z-[420] overflow-hidden"
      style={{ cursor: "crosshair", touchAction: "none" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
    >
      {LASER_PAIRS.map((name, i) => (
        <g
          key={name}
          ref={(node) => {
            const slot = pairs[i];
            if (slot) slot.group = node;
          }}
        >
          <path
            ref={(node) => {
              const slot = pairs[i];
              if (slot) slot.glow = node;
            }}
            d=""
            fill="none"
            stroke={LASER_GLOW}
            strokeOpacity={0.3}
            strokeWidth={LASER_W * 3}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            ref={(node) => {
              const slot = pairs[i];
              if (slot) slot.core = node;
            }}
            d=""
            fill="none"
            stroke={LASER_CORE}
            strokeWidth={LASER_W}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* Where the hand is, so a stroke that has stopped moving still points. */}
          <circle
            ref={(node) => {
              const slot = pairs[i];
              if (slot) slot.head = node;
            }}
            cx={0}
            cy={0}
            r={4}
            opacity={0}
            fill="#FFFFFF"
            stroke={LASER_CORE}
            strokeWidth={3}
          />
        </g>
      ))}
    </svg>
  );
}
