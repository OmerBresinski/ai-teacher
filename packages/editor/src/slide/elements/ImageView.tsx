import type { ImageElement } from "@tj/domain/documents";
import { useEffect, useRef, useState } from "react";
import { pictureStyle, renderedFit, type Size } from "../../lesson/image-adjust";
import type { ElementViewProps } from "./kit";

/**
 * Images are plain <img> so capture and print see a resolved bitmap.
 * `crop`, `focal` and `imageTransform` (TEACH-153) render as one inner transform from
 * `image-adjust.ts`: the picture box is over-sized inside an overflow-hidden element box, the
 * bitmap is turned, flipped and tilted about its centre, and `object-position` holds the focal
 * point so a re-cover after the box changes shape keeps the subject in view. `SlideStatic` and
 * the thumbnails render through the same view, so every surface agrees with the canvas.
 *
 * The bitmap's own size is read once it has loaded: a crop stored under another box shape (a plain
 * resize writes only the box) is re-derived from it at the same zoom round the focal point, the
 * window crop mode will open on. Until then the wrapper may not have the picture's aspect, and
 * `object-fit: cover` keeps the bitmap unstretched. Any adjustment renders as cover whatever `fit`
 * says (`renderedFit`): a crop implies Fill.
 */
export function ImageView({ element, theme, mode }: ElementViewProps<ImageElement>) {
  const radius = element.radius ?? 0;
  const ref = useRef<HTMLImageElement>(null);
  const [measured, setMeasured] = useState<(Size & { src: string }) | null>(null);
  const natural = measured?.src === element.src ? measured : undefined;
  const src = element.src;
  useEffect(() => {
    const img = ref.current;
    if (!img) return;
    const remember = () => {
      if (!img.naturalWidth || !img.naturalHeight) return;
      const next = { src, w: img.naturalWidth, h: img.naturalHeight };
      setMeasured((m) => (m && m.src === src && m.w === next.w && m.h === next.h ? m : next));
    };
    if (img.complete) remember();
    img.addEventListener("load", remember);
    return () => img.removeEventListener("load", remember);
  }, [src]);
  const style = pictureStyle(
    { w: element.w, h: element.h },
    element.crop,
    element.imageTransform,
    element.focal,
    natural,
  );

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        borderRadius: radius || undefined,
        background: theme.colors.surface,
      }}
    >
      <div style={{ position: "absolute", ...style.wrapper }}>
        <img
          ref={ref}
          src={element.src}
          alt={element.alt ?? ""}
          draggable={false}
          loading={mode === "thumb" ? "lazy" : "eager"}
          decoding={mode === "capture" ? "sync" : "async"}
          style={{
            display: "block",
            position: "absolute",
            left: "50%",
            top: "50%",
            width: style.img.width,
            height: style.img.height,
            transform: style.img.transform,
            objectFit: renderedFit(element),
            objectPosition: style.img.objectPosition,
          }}
        />
      </div>
    </div>
  );
}
