import type { ImageElement } from "@tj/domain/documents";
import { isOpenPhotoSlot } from "@tj/slides";
import { builtSvgDataUrl, svgAtBuild, svgOfDataUrl } from "@tj/slides/diagram-builds";
import { useEffect, useMemo, useRef, useState } from "react";
import { useResolvedImageSrc } from "../../images/image-origin";
import { pictureStyle, renderedFit, type Size } from "../../lesson/image-adjust";
import { useReducedMotion } from "../../present/use-fullscreen";
import type { ElementViewProps } from "./kit";
import { SlotPlaceholder } from "./SlotPlaceholder";

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
  // and export lay it out away (`withoutDiagramSlot`); the brief is the teacher's alone, so outside
  // the editor an open slot draws nothing.
  if (isOpenPhotoSlot(props.element)) {
    if (props.mode !== "edit") return null;
    const { element, theme } = props;
    return (
      <SlotPlaceholder
        kind="photo"
        theme={theme}
        radius={element.radius}
        height={element.h}
        text={`Photo: ${element.alt ?? ""}`}
      />
    );
  }
  return <Picture {...props} />;
}

/**
 * A drawn diagram in Present at its current build (TEACH-247 part b, ruling 180): the stored SVG
 * with a style that hides later builds (and, on a question slide, the answer part until it is
 * revealed). The newest build rises in unless the teacher stepped back or asked for reduced
 * motion; then each frame is static. Every other surface, and any element without builds, shows
 * `element.src` as stored: the last build.
 */
function useBuiltSrc(element: ImageElement, build: number | undefined, answer: boolean): string {
  const reduced = useReducedMotion();
  // Which way the build index last moved, latched until it moves again: a re-render for any other
  // reason (a resize) keeps a stepped-back frame static.
  const [moved, setMoved] = useState({ build, back: false });
  let back = moved.back;
  if (moved.build !== build) {
    back = build !== undefined && moved.build !== undefined && build < moved.build;
    setMoved({ build, back });
  }
  return useMemo(() => {
    if (build === undefined || !element.builds) return element.src;
    const svg = svgOfDataUrl(element.src);
    if (!svg) return element.src;
    return builtSvgDataUrl(svgAtBuild(svg, build, { answer, motion: !reduced && !back }));
  }, [element.src, element.builds, build, answer, reduced, back]);
}

function Picture({
  element,
  theme,
  mode,
  diagramBuild,
  diagramAnswer,
  question,
  revealAnswer,
}: ElementViewProps<ImageElement>) {
  const radius = element.radius ?? 0;
  const ref = useRef<HTMLImageElement>(null);
  const [measured, setMeasured] = useState<(Size & { src: string }) | null>(null);
  const natural = measured?.src === element.src ? measured : undefined;
  // The stored `/files/<key>` path, resolved against the api origin (TEACH-275); `measured` keys
  // on the stored value so a re-resolve is not a new picture.
  const src = element.src;
  // A question slide holds a drawing's answer part back until the answer is revealed.
  // A question slide holds the drawing's answer back until the reveal, unless it has no answer
  // reveal at all (then nothing would ever show it).
  const built = useBuiltSrc(element, diagramBuild, diagramAnswer ?? (!question || revealAnswer));
  const shown = useResolvedImageSrc(src);
  const resolved = built === src ? shown : built;
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
