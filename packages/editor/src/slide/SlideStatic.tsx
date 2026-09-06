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
