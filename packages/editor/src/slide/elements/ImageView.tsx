import type { ImageElement } from "@tj/domain/documents";
import { isOpenPhotoSlot } from "@tj/slides";
import { DIAGRAM_DRAWN_NAME } from "@tj/slides/diagrams";
import { useEffect, useMemo, useRef, useState } from "react";
import { useResolvedImageSrc } from "../../images/image-origin";
import { pictureStyle, renderedFit, type Size } from "../../lesson/image-adjust";
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
  // the editor an open slot draws nothing (layout audit, 30 Sep 2026).
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
  const inline = inlineDiagram(props.element);
  if (inline !== undefined) return <DrawnDiagram {...props} markup={inline} />;
  return <Picture {...props} />;
}

const SVG_DATA = /^data:image\/svg\+xml(;[^,]*)?,/;

/**
 * A drawn diagram (`diagramElement`: an SVG data URL named `Diagram`) as sanitised SVG markup to
 * render inline, or `undefined` for any other picture. Inline, its text takes the page's loaded
 * theme fonts (the families the renderer names and measures with); inside an `<img>` an SVG cannot
 * load a web font and its words fall back to a generic sans. A diagram the teacher has cropped,
 * turned or refocused keeps the `<img>` path, which knows those adjustments.
 */
export function inlineDiagram(el: ImageElement): string | undefined {
  if (el.name !== DIAGRAM_DRAWN_NAME || el.crop || el.imageTransform || el.focal) return undefined;
  const m = SVG_DATA.exec(el.src);
  if (!m || typeof DOMParser === "undefined") return undefined;
  try {
    const raw = el.src.slice(m[0].length);
    const xml = m[1]?.includes("base64") ? atob(raw) : decodeURIComponent(raw);
    const doc = new DOMParser().parseFromString(xml, "image/svg+xml");
    const svg = doc.documentElement;
    if (svg.nodeName.toLowerCase() !== "svg") return undefined;
    // Our renderer writes shapes and text only; anything that could run or fetch is dropped.
    for (const bad of Array.from(svg.querySelectorAll("script, foreignObject, iframe, use")))
      bad.remove();
    for (const node of [svg, ...Array.from(svg.querySelectorAll("*"))])
      for (const a of Array.from(node.attributes))
        if (/^on/i.test(a.name) || /href$/i.test(a.name)) node.removeAttribute(a.name);
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    return new XMLSerializer().serializeToString(svg);
  } catch {
    return undefined;
  }
}

/** A drawn diagram as inline SVG. */
function DrawnDiagram({
  element,
  theme,
  markup,
}: ElementViewProps<ImageElement> & { markup: string }) {
  const html = useMemo(() => ({ __html: markup }), [markup]);
  return (
    <div
      role="img"
      aria-label={element.alt ?? ""}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        borderRadius: element.radius || undefined,
        background: theme.colors.surface,
      }}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: our own renderer's SVG, sanitised by `inlineDiagram`
      dangerouslySetInnerHTML={html}
    />
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
