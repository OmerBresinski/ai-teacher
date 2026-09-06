import { SLIDE_H, SLIDE_W } from "@tj/domain/documents";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

const ScaleContext = createContext(1);
/** Current slide scale (screen px per slide pt). */
export const useSlideScale = () => useContext(ScaleContext);

type Props = {
  /** 'fit' scales to the container minus gutter; a number is an absolute zoom (1 = 100%). */
  zoom?: number | "fit";
  gutter?: number;
  className?: string;
  /** Rendered inside the 960x540 frame; overlays receive the same scale via context. */
  children: ReactNode;
  onScale?: (scale: number) => void;
};

/**
 * Fits a 960x540 slide into its container with a single transform: scale().
 * The outer element takes the scaled size so layout around it is correct.
 */
export function SlideScaler({ zoom = "fit", gutter = 0, className, children, onScale }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(1);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || zoom !== "fit") return;
    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      const s = Math.max(
        0.05,
        Math.min((width - gutter * 2) / SLIDE_W, (height - gutter * 2) / SLIDE_H),
      );
      setFit(s);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [zoom, gutter]);

  const scale = zoom === "fit" ? fit : zoom;
  useEffect(() => onScale?.(scale), [scale, onScale]);

  return (
    <div
      ref={ref}
      className={className}
      style={{ position: "relative", width: "100%", height: "100%" }}
    >
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: SLIDE_W * scale,
          height: SLIDE_H * scale,
          transform: "translate(-50%, -50%)",
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
          <ScaleContext.Provider value={scale}>{children}</ScaleContext.Provider>
        </div>
      </div>
    </div>
  );
}
