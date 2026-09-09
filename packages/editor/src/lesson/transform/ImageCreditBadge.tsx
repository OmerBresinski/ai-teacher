import type { ImageElement } from "@tj/domain/documents";
import { IconButton, Popover, PopoverContent, PopoverTrigger } from "@tj/ui";
import { Info } from "lucide-react";
import type { Rect } from "../../model/geometry";
import { normaliseHref } from "../../text/links";

/**
 * The "i" attribution badge on a selected image (Images project, editor only).
 *
 * A Popover, not a Tooltip: the content carries two links and must be reachable by keyboard,
 * which a hover tooltip cannot do. Like the frame's lock glyph it is zoom-invariant (`/ scale`)
 * and lives inside the frame's top-right corner. `SelectionLayer` mounts it, so present, viewer,
 * thumb, capture and print never render it.
 */
export function ImageCreditBadge({
  element,
  rect,
  rotation = 0,
  scale,
}: {
  element: ImageElement;
  rect: Rect;
  rotation?: number;
  scale: number;
}) {
  const size = 20 / scale;
  const inset = 8 / scale;
  return (
    <div
      style={{
        position: "absolute",
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.h,
        transform: rotation ? `rotate(${rotation}deg)` : undefined,
        transformOrigin: "50% 50%",
        pointerEvents: "none",
      }}
    >
      {/* The layer is pointer-transparent; the badge opts back in, and a press on it must not
          start a canvas drag. The div itself is not interactive — the button inside is. */}
      <div
        style={{ position: "absolute", right: inset, top: inset, pointerEvents: "auto" }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <Popover>
          <PopoverTrigger asChild>
            <IconButton
              label="Image credit"
              noTooltip
              size="sm"
              style={{ width: size, height: size }}
            >
              <Info aria-hidden size={12 / scale} strokeWidth={1.5} />
            </IconButton>
          </PopoverTrigger>
          <PopoverContent side="top" align="end" className="w-auto max-w-[260px]">
            <CreditBody element={element} />
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}

function CreditBody({ element }: { element: ImageElement }) {
  const source = element.source;
  if (source) {
    // Imported lessons are untrusted JSON: both addresses go through the same gate as a
    // typed link, and a refused one renders as plain text. No href, no anchor.
    const photographerHref = normaliseHref(source.photographerUrl);
    const pageHref = normaliseHref(source.pageUrl);
    return (
      <p className="m-0 text-body text-ink-2">
        Photo by{" "}
        {photographerHref ? (
          <a href={photographerHref} target="_blank" rel="noopener noreferrer">
            {source.photographer}
          </a>
        ) : (
          source.photographer
        )}{" "}
        on{" "}
        {pageHref ? (
          <a href={pageHref} target="_blank" rel="noopener noreferrer">
            Pexels
          </a>
        ) : (
          "Pexels"
        )}
      </p>
    );
  }
  const href = element.creditUrl ? normaliseHref(element.creditUrl) : null;
  return (
    <div className="flex flex-col gap-1">
      <p className="m-0 break-words text-ink-2 text-meta">{element.credit}</p>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-meta text-primary hover:underline"
        >
          View the original
        </a>
      ) : null}
    </div>
  );
}
