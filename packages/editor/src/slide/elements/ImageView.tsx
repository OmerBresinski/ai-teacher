import type { ImageElement } from "@tj/domain/documents";
import { pictureStyle } from "../../lesson/image-adjust";
import type { ElementViewProps } from "./kit";

/**
 * Images are plain <img> so capture and print see a resolved bitmap.
 * `crop`, `focal` and `imageTransform` (TEACH-153) render as one inner transform from
 * `image-adjust.ts`: the picture box is over-sized inside an overflow-hidden element box, the
 * bitmap is turned, flipped and tilted about its centre, and `object-position` holds the focal
 * point so a re-cover after the box changes shape keeps the subject in view. `SlideStatic` and
 * the thumbnails render through the same view, so every surface agrees with the canvas.
 */
export function ImageView({ element, theme, mode }: ElementViewProps<ImageElement>) {
  const radius = element.radius ?? 0;
  const style = pictureStyle(
    { w: element.w, h: element.h },
    element.crop,
    element.imageTransform,
    element.focal,
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
            objectFit: element.fit,
            objectPosition: style.img.objectPosition,
          }}
        />
      </div>
    </div>
  );
}
