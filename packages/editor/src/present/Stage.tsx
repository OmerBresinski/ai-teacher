import type { Lesson, Slide, SlideElement, Theme, TransitionId } from "@tj/domain/documents";
import { hasRevealableAnswer, SLIDE_H, SLIDE_W, slideStepCount } from "@tj/domain/documents";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { SlideScaler } from "../slide/SlideScaler";
import { SlideView } from "../slide/SlideView";
import { InkLayer, LaserLayer } from "./InkLayer";
import { TimerReadout } from "./TimerReadout";
import { useReducedMotion } from "./use-fullscreen";
import { usePresent } from "./use-present-session";

/**
 * The stage: the warm ink ground, one slide scaled to fit, the ink layer over
 * it, and the transition between slides. Nothing here is chrome — the controls
 * float above it and fade away (SPEC §8).
 *
 * The letterbox is `--v2-stage-ground`, not black: a slide sitting in a band a
 * shade warmer than itself reads as a picture on a surface, which is what
 * V2-DESIGN §5.6 asks for, and pure black in a lit classroom is a mirror.
 */

const DURATION = 320;

type LayerSpec = { index: number; step: number };

export type StageProps = {
  lesson: Lesson;
  theme: Theme;
};

export function Stage({ lesson, theme }: StageProps) {
  const { index, step, direction, blackout } = usePresent().state;
  const reduced = useReducedMotion();

  const slides = lesson.slides;
  const slide = slides[Math.min(index, slides.length - 1)];

  // The letterbox band, so the timer readout can sit in it rather than on the
  // slide. Both numbers are already being computed for the scale; this only
  // reads them back.
  const rootRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  const [stageH, setStageH] = useState(0);

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setStageH(entry.contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const [outgoing, setOutgoing] = useState<
    (LayerSpec & { kind: TransitionId; dir: 1 | -1 }) | null
  >(null);
  /** Where the deck was on the last render — i.e. what the outgoing layer shows. */
  const [seen, setSeen] = useState<LayerSpec>({ index, step });
  const incomingRef = useRef<HTMLDivElement>(null);

  // Start the transition during the render that first sees the new slide, so the
  // outgoing layer is painted in the same frame as the incoming one and there is
  // never a flash of the new slide on its own. Steps within a slide animate
  // themselves, inside SlideView.
  if (seen.index !== index) {
    const kind: TransitionId = reduced ? "none" : (slides[index]?.transition ?? "fade");
    setOutgoing(kind === "none" ? null : { ...seen, kind, dir: direction });
    setSeen({ index, step });
  } else if (seen.step !== step) {
    setSeen({ index, step });
  }

  useEffect(() => {
    if (!outgoing) return;
    const timer = setTimeout(() => setOutgoing(null), DURATION);
    return () => clearTimeout(timer);
  }, [outgoing]);

  // Morph: tween the elements the two slides share by `morphKey`. FLIP straight
  // from the model — every rect is already known in slide points, so nothing is
  // measured and nothing can be measured mid-animation.
  useLayoutEffect(() => {
    if (outgoing?.kind !== "morph") return;
    const layer = incomingRef.current;
    const from = slides[outgoing.index];
    const to = slides[index];
    if (!layer || !from || !to) return;
    const before = morphRects(from);
    if (before.size === 0) return;

    const animations: Animation[] = [];
    for (const el of to.elements) {
      const key = el.morphKey;
      if (!key) continue;
      const start = before.get(key);
      if (!start) continue;
      const node = layer.querySelector<HTMLElement>(`[data-element-id="${CSS.escape(el.id)}"]`);
      if (!node || el.w === 0 || el.h === 0) continue;
      const dx = start.x + start.w / 2 - (el.x + el.w / 2);
      const dy = start.y + start.h / 2 - (el.y + el.h / 2);
      const sx = start.w / el.w;
      const sy = start.h / el.h;
      animations.push(
        node.animate(
          [
            {
              transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy}) rotate(${start.rotation}deg)`,
            },
            { transform: `rotate(${el.rotation ?? 0}deg)` },
          ],
          { duration: DURATION, easing: "cubic-bezier(.20, 0, 0, 1)", fill: "backwards" },
        ),
      );
    }
    return () => {
      for (const a of animations) a.cancel();
    };
  }, [outgoing, index, slides]);

  if (!slide) return <div className="h-full w-full bg-background" />;

  const morphing = outgoing?.kind === "morph";
  // A morph with nothing in common is just a fade — silently, rather than
  // snapping, which is what the presenter would read as a bug.
  const kind: TransitionId =
    morphing && sharedMorphKeys(slides[outgoing.index], slide) === 0
      ? "fade"
      : (outgoing?.kind ?? "none");

  return (
    <div
      ref={rootRef}
      className="relative h-full w-full overflow-hidden bg-background"
      data-present-stage
    >
      <SlideScaler zoom="fit" onScale={setScale}>
        <div style={{ position: "relative", width: SLIDE_W, height: SLIDE_H }}>
          {outgoing ? (
            <div
              key={`out-${outgoing.index}`}
              className={`td-present-layer td-out-${kind}`}
              style={{ ["--td-push-to" as string]: outgoing.dir === 1 ? "-100%" : "100%" }}
            >
              {slides[outgoing.index] ? (
                <SlideLayer
                  slide={slides[outgoing.index] as Slide}
                  theme={theme}
                  step={outgoing.step}
                />
              ) : null}
              {/* Annotations belong to the slide they were drawn on, so they
                  travel with it through the transition. */}
              <InkLayer slideId={slides[outgoing.index]?.id ?? ""} interactive={false} />
            </div>
          ) : null}

          <div
            key={`in-${index}`}
            ref={incomingRef}
            className={outgoing ? `td-present-layer td-in-${kind}` : "td-present-layer"}
            style={{ ["--td-push-from" as string]: outgoing?.dir === 1 ? "100%" : "-100%" }}
          >
            <SlideLayer slide={slide} theme={theme} step={step} />
            <InkLayer slideId={slide.id} />
          </div>

          {/* The laser is the teacher's pointer, not slide content: it stays
              where the hand is rather than sliding away with the old slide. */}
          <LaserLayer />
        </div>
      </SlideScaler>

      <TimerReadout letterbox={Math.max(0, (stageH - SLIDE_H * scale) / 2)} />

      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-[500] motion-safe:transition-opacity"
        style={{
          // A blackout is the projector off; a whiteout is the board lit.
          background: blackout === "white" ? "#FFFFFF" : "#000000",
          opacity: blackout === "none" ? 0 : 1,
        }}
      />
    </div>
  );
}

function SlideLayer({ slide, theme, step }: { slide: Slide; theme: Theme; step: number }) {
  const reveal = hasRevealableAnswer(slide) && step >= slideStepCount(slide);
  return <SlideView slide={slide} theme={theme} mode="present" step={step} revealAnswer={reveal} />;
}

/* ------------------------------------------------------------------ */
/* Morph helpers                                                       */
/* ------------------------------------------------------------------ */

type MorphRect = { x: number; y: number; w: number; h: number; rotation: number };

function morphRects(slide: Slide | undefined): Map<string, MorphRect> {
  const out = new Map<string, MorphRect>();
  if (!slide) return out;
  for (const el of slide.elements) {
    if (!el.morphKey) continue;
    out.set(el.morphKey, { x: el.x, y: el.y, w: el.w, h: el.h, rotation: el.rotation ?? 0 });
  }
  return out;
}

const keysOf = (els: SlideElement[]) =>
  new Set(els.map((e) => e.morphKey).filter(Boolean) as string[]);

function sharedMorphKeys(from: Slide | undefined, to: Slide | undefined): number {
  if (!from || !to) return 0;
  const a = keysOf(from.elements);
  let n = 0;
  for (const key of keysOf(to.elements)) if (a.has(key)) n++;
  return n;
}
