import type { ImageElement } from "@tj/domain/documents";
import type { CSSProperties } from "react";
import type { ElementViewProps } from "./kit";

/**
 * Images are plain <img> so capture and print see a resolved bitmap.
 * A fractional `crop` is applied by over-sizing the image inside an overflow-hidden box.
 */
export function ImageView({ element, theme, mode }: ElementViewProps<ImageElement>) {
  const crop = element.crop;
  const radius = element.radius ?? 0;

  const inner: CSSProperties = crop
    ? {
        position: "absolute",
        left: `${(-crop.x / crop.w) * 100}%`,
        top: `${(-crop.y / crop.h) * 100}%`,
        width: `${(1 / crop.w) * 100}%`,
        height: `${(1 / crop.h) * 100}%`,
        objectFit: element.fit,
      }
    : { width: "100%", height: "100%", objectFit: element.fit };

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
      <img
        src={element.src}
        alt={element.alt ?? ""}
        draggable={false}
        loading={mode === "thumb" ? "lazy" : "eager"}
        decoding={mode === "capture" ? "sync" : "async"}
        style={{ display: "block", ...inner }}
      />
    </div>
  );
}
