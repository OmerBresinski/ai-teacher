import type { ImageElement } from "@tj/domain/documents";
import { accentTint, isOpenPhotoSlot } from "@tj/slides";
import { Camera } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useResolvedImageSrc } from "../../images/image-origin";
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
 *
 * Capture mode alone asks for `crossorigin="use-credentials"` (TEACH-272 §1): a `/files/:key`
 * picture then arrives as a CORS response the canvas may read, so a PNG capture is not tainted
 * and the print route paints the same bytes. Edit, present and thumb keep the plain `<img>` so
 * their cache entries are not split by credentials mode.
 */
export function ImageView(props: ElementViewProps<ImageElement>) {
  // A photo slot no photograph has filled (look/image-slot): drawn as what it should show. Present
  // and export lay it out away (`withoutDiagramSlot`) unless the demo switch is on.
  if (isOpenPhotoSlot(props.element)) return <PhotoPlaceholder {...props} />;
  return <Picture {...props} />;
}

/** "Photo: <subject> — <mustShow>" in small muted type on a tinted box, a camera at its corner. */
function PhotoPlaceholder({ element, theme }: ElementViewProps<ImageElement>) {
  return (
    <div
      data-photo-placeholder=""
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        borderRadius: element.radius || undefined,
        background: accentTint(theme),
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        boxSizing: "border-box",
        textAlign: "center",
      }}
    >
      <Camera
        aria-hidden
        size={22}
        strokeWidth={1.75}
        color={theme.colors.muted}
        style={{ position: "absolute", left: 14, top: 14 }}
      />
      <span
        style={{
          fontFamily: theme.fonts.body,
          fontSize: theme.sizes.caption,
          lineHeight: 1.35,
          color: theme.colors.muted,
        }}
      >
        Photo: {element.alt}
      </span>
    </div>
  );
}

function Picture({ element, theme, mode }: ElementViewProps<ImageElement>) {
  const radius = element.radius ?? 0;
  const ref = useRef<HTMLImageElement>(null);
  const [measured, setMeasured] = useState<(Size & { src: string }) | null>(null);
  const natural = measured?.src === element.src ? measured : undefined;
  // The stored `/files/<key>` path, resolved against the api origin (TEACH-275); `measured` keys
  // on the stored value so a re-resolve is not a new picture.
  const src = element.src;
  const resolved = useResolvedImageSrc(src);
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
          src={resolved}
          alt={element.alt ?? ""}
          draggable={false}
          loading={mode === "thumb" ? "lazy" : "eager"}
          decoding={mode === "capture" ? "sync" : "async"}
          crossOrigin={mode === "capture" ? "use-credentials" : undefined}
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
