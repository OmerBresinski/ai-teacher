import type { ImageElement } from "@tj/domain/documents";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  toast,
} from "@tj/ui";
import { Info } from "lucide-react";
import { ImageCreditText } from "../../images/ImageCreditText";
import { REPORT_FAILED_MESSAGE, REPORTED_MESSAGE } from "../../images/ImagePicker";
import type { ImageSearchClient, ReportReason } from "../../images/image-search";
import type { Rect } from "../../model/geometry";

const REPORT_REASONS: { value: ReportReason; label: string }[] = [
  { value: "unsuitable", label: "Unsuitable" },
  { value: "wrong-subject", label: "Wrong subject" },
  { value: "other", label: "Other" },
];

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
  images,
  lessonId,
}: {
  element: ImageElement;
  rect: Rect;
  rotation?: number;
  scale: number;
  /** Report action: hidden without a client; the lesson id travels as report context. */
  images?: ImageSearchClient;
  lessonId?: string;
}) {
  const report = async (reason: ReportReason) => {
    if (!images || !element.source) return;
    try {
      await images.report({
        photo: { provider: "pexels", id: element.source.id },
        reason,
        context: "placed",
        ...(lessonId === undefined ? {} : { lessonId }),
      });
      toast(REPORTED_MESSAGE);
    } catch {
      toast(REPORT_FAILED_MESSAGE);
    }
  };
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
            <ImageCreditText
              source={element.source}
              credit={element.credit}
              creditUrl={element.creditUrl}
            />
            {element.source && images ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" className="mt-1 text-meta text-primary hover:underline">
                    Report this image
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" aria-label="Report this image">
                  {REPORT_REASONS.map((reason) => (
                    <DropdownMenuItem key={reason.value} onSelect={() => void report(reason.value)}>
                      {reason.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
