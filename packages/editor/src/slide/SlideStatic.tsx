import { SLIDE_H, SLIDE_W, type Slide, type Theme } from "@tj/domain/documents";
import { SlideView } from "./SlideView";

export type SlideStaticProps = {
  slide: Slide;
  theme: Theme;
  /** Rendered width in px; height follows the 16:9 slide. */
  width: number;
  className?: string;
};

/**
 * A slide at thumbnail size. One renderer, every surface: this is the same `SlideView`, scaled,
 * with `mode="thumb"` so nothing inside it runs. Behavioural reference: TeachDeck
 * `components/present/SlideThumb.tsx`.
 */
export function SlideStatic({ slide, theme, width, className }: SlideStaticProps) {
  const scale = width / SLIDE_W;
  return (
    <div
      className={className}
      data-slide-static
      style={{
        position: "relative",
        width,
        height: Math.round(width * (SLIDE_H / SLIDE_W)),
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: SLIDE_W,
          height: SLIDE_H,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
        }}
      >
        <SlideView slide={slide} theme={theme} mode="thumb" />
      </div>
    </div>
  );
}

export type SlideFluidProps = {
  slide: Slide;
  theme: Theme;
  className?: string;
};

/**
 * `SlideStatic` for a box whose width the caller does not know: a card thumbnail, a list row, a
 * series stack. The wrapper is a 16:9 inline-size container and the slide scales with
 * `100cqw / 960` — pure CSS, no ResizeObserver, no effect (ADR 0022 §4, `vercel-react-best-practices`).
 */
export function SlideFluid({ slide, theme, className }: SlideFluidProps) {
  return (
    <div
      className={className}
      data-slide-fluid
      style={{
        position: "relative",
        width: "100%",
        aspectRatio: `${SLIDE_W} / ${SLIDE_H}`,
        overflow: "hidden",
        containerType: "inline-size",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: SLIDE_W,
          height: SLIDE_H,
          transform: `scale(calc(100cqw / ${SLIDE_W}))`,
          transformOrigin: "top left",
        }}
      >
        <SlideView slide={slide} theme={theme} mode="thumb" />
      </div>
    </div>
  );
}
