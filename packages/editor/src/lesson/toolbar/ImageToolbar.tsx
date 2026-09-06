import type { ImageElement } from "@tj/domain/documents";
import { IconButton, Input, Label, Popover, PopoverContent, PopoverTrigger, Tooltip } from "@tj/ui";
import { Crop, Replace } from "lucide-react";
import { memo, useId } from "react";
import { NumberInput } from "../../kit/NumberInput";
import { Panel, PanelSeparator } from "../../kit/Panel";
import { Segmented } from "../../kit/Segmented";
import { normaliseHref } from "../../text/links";
import { MoreDrawer } from "./MoreDrawer";
import { BarButton, ICON, ICON_SM, useElementWrites } from "./shared";

/**
 * Replace, fit, crop, corner radius, alt text, credit (TeachDeck `ImageToolbar`). Replace and
 * crop are off until the images ticket (TEACH-107) brings the file pipeline.
 */
export const ImageToolbar = memo(function ImageToolbar({
  element,
  slideId,
}: {
  element: ImageElement;
  slideId: string;
}) {
  const { update, scrub, end } = useElementWrites(slideId);
  const altId = useId();
  // An imported lesson is untrusted JSON and could carry `javascript:` here, so the address goes
  // through the same gate as a typed link. No href, no anchor.
  const creditHref = element.creditUrl ? normaliseHref(element.creditUrl) : null;

  return (
    <Panel as="bar" role="toolbar" aria-label="Image" data-image-toolbar>
      <Tooltip label="Replacing an image arrives with a later release">
        <BarButton aria-disabled="true" className="opacity-50 hover:bg-transparent">
          <Replace aria-hidden {...ICON_SM} />
          Replace
        </BarButton>
      </Tooltip>

      <PanelSeparator />

      <Segmented
        aria-label="Fit"
        value={element.fit}
        onChange={(fit) => update<ImageElement>(element.id, { fit })}
        options={[
          { value: "contain", label: "Fit" },
          { value: "cover", label: "Fill" },
        ]}
      />

      <Tooltip label="Coming soon">
        <span className="inline-flex">
          <IconButton label="Crop" noTooltip aria-disabled="true" className="opacity-50">
            <Crop aria-hidden {...ICON} />
          </IconButton>
        </span>
      </Tooltip>

      <PanelSeparator />

      <NumberInput
        value={element.radius ?? 0}
        onChange={(radius) => scrub(() => update<ImageElement>(element.id, { radius }))}
        min={0}
        max={200}
        aria-label="Corner radius"
      />

      <Popover onOpenChange={(open) => !open && end()}>
        <PopoverTrigger asChild>
          <BarButton>Alt</BarButton>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-60 p-3" aria-label="Alt text">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor={altId} className="text-ink-3 text-meta">
              Alt text
            </Label>
            <Input
              id={altId}
              value={element.alt ?? ""}
              placeholder="What the picture shows"
              onChange={(e) =>
                scrub(() => update<ImageElement>(element.id, { alt: e.target.value }))
              }
              onBlur={end}
              className="h-8 w-32"
            />
          </div>
        </PopoverContent>
      </Popover>

      <PanelSeparator />
      <MoreDrawer
        slideId={slideId}
        elements={[element]}
        extra={
          element.credit ? (
            <div className="flex flex-col gap-1">
              <span className="text-eyebrow text-ink-3">Credit</span>
              <p className="m-0 break-words text-ink-2 text-meta">{element.credit}</p>
              {creditHref ? (
                <a
                  href={creditHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-meta text-primary hover:underline"
                >
                  View the original
                </a>
              ) : null}
            </div>
          ) : undefined
        }
      />
    </Panel>
  );
});
