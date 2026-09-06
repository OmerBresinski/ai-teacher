import {
  type ImageElement,
  type ShapeElement,
  SLIDE_H,
  SLIDE_W,
  type SlideElement,
  type TextElement,
} from "@tj/domain/documents";
import { IconButton, Input, Popover, PopoverContent, PopoverTrigger, Slider, Switch } from "@tj/ui";
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpToLine,
  MoreHorizontal,
  RotateCcw,
  RotateCw,
} from "lucide-react";
import { type ReactNode, useId } from "react";
import { NumberInput } from "../../kit/NumberInput";
import { PanelRow } from "../../kit/Panel";
import * as reducers from "../../model/reducers";
import { ICON, ICON_SM, PanelSection, useElementWrites } from "./shared";

const ROUNDABLE = new Set<SlideElement["type"]>(["image", "shape", "text"]);

/**
 * Everything the seven visible controls could not hold, behind one trigger (TeachDeck
 * `toolbar/drawers.tsx`): Position, Effects and Advanced, named as research/01 §12 names them.
 * Scrubs and typing runs are one undo step each (SPEC §7); the opacity slider commits on release.
 */
export function MoreDrawer({
  slideId,
  elements,
  extra,
}: {
  slideId: string;
  elements: SlideElement[];
  /** The toolbar's own rows (line height, credit, …), shown first under "Options". */
  extra?: ReactNode;
}) {
  const { history, update, updateMany, scrub, end } = useElementWrites(slideId);
  const rowId = useId();
  const ids = elements.map((e) => e.id);
  const one = elements.length === 1 ? elements[0] : null;

  return (
    <Popover onOpenChange={(open) => !open && end()}>
      <PopoverTrigger asChild>
        <IconButton label="More">
          <MoreHorizontal aria-hidden {...ICON} />
        </IconButton>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-3" aria-label="More">
        <div className="flex flex-col gap-2.5">
          {extra ? <PanelSection title="Options">{extra}</PanelSection> : null}

          {one ? (
            <PanelSection title="Position">
              <div className="grid grid-cols-2 gap-x-3">
                <PanelRow label="X" htmlFor={`${rowId}-x`}>
                  <NumberInput
                    id={`${rowId}-x`}
                    value={Math.round(one.x)}
                    onChange={(x) => scrub(() => update(one.id, { x }))}
                    min={-SLIDE_W}
                    max={SLIDE_W}
                    aria-label="X"
                    width={5}
                  />
                </PanelRow>
                <PanelRow label="Y" htmlFor={`${rowId}-y`}>
                  <NumberInput
                    id={`${rowId}-y`}
                    value={Math.round(one.y)}
                    onChange={(y) => scrub(() => update(one.id, { y }))}
                    min={-SLIDE_H}
                    max={SLIDE_H}
                    aria-label="Y"
                    width={5}
                  />
                </PanelRow>
                <PanelRow label="W" htmlFor={`${rowId}-w`}>
                  <NumberInput
                    id={`${rowId}-w`}
                    value={Math.round(one.w)}
                    onChange={(w) => scrub(() => update(one.id, { w }))}
                    min={16}
                    max={SLIDE_W * 2}
                    aria-label="Width"
                    width={5}
                  />
                </PanelRow>
                <PanelRow label="H" htmlFor={`${rowId}-h`}>
                  <NumberInput
                    id={`${rowId}-h`}
                    value={Math.round(one.h)}
                    onChange={(h) => scrub(() => update(one.id, { h }))}
                    min={16}
                    max={SLIDE_H * 2}
                    aria-label="Height"
                    width={5}
                  />
                </PanelRow>
              </div>
              <PanelRow label="Rotation">
                <span className="flex items-center gap-1">
                  <IconButton
                    label="Rotate 90° left"
                    size="sm"
                    onClick={() =>
                      update(one.id, { rotation: ((one.rotation ?? 0) - 90 + 360) % 360 })
                    }
                  >
                    <RotateCcw aria-hidden {...ICON_SM} />
                  </IconButton>
                  <NumberInput
                    value={Math.round(one.rotation ?? 0)}
                    onChange={(rotation) => scrub(() => update(one.id, { rotation }))}
                    min={-180}
                    max={360}
                    unit="°"
                    aria-label="Rotation"
                  />
                  <IconButton
                    label="Rotate 90° right"
                    size="sm"
                    onClick={() => update(one.id, { rotation: ((one.rotation ?? 0) + 90) % 360 })}
                  >
                    <RotateCw aria-hidden {...ICON_SM} />
                  </IconButton>
                </span>
              </PanelRow>
              <PanelRow label="Lock" htmlFor={`${rowId}-lock`}>
                <Switch
                  id={`${rowId}-lock`}
                  checked={!!one.locked}
                  onCheckedChange={(locked) => update(one.id, { locked })}
                  aria-label="Lock element"
                />
              </PanelRow>
            </PanelSection>
          ) : null}

          <PanelSection title="Effects">
            <PanelRow label="Opacity">
              <Slider
                value={[Math.round((one?.opacity ?? 1) * 100)]}
                onValueChange={([v]) => scrub(() => updateMany(ids, { opacity: (v ?? 100) / 100 }))}
                onValueCommit={end}
                min={0}
                max={100}
                aria-label="Opacity"
                className="w-28"
              />
            </PanelRow>
            {one && ROUNDABLE.has(one.type) ? (
              <PanelRow label="Corner radius" htmlFor={`${rowId}-radius`}>
                <NumberInput
                  id={`${rowId}-radius`}
                  value={radiusOf(one)}
                  onChange={(r) => scrub(() => setRadius(update, one, r))}
                  min={0}
                  max={200}
                  aria-label="Corner radius"
                />
              </PanelRow>
            ) : null}
            <PanelRow
              label={one?.revealStep ? `Appears on step ${one.revealStep}` : "Reveal step"}
              htmlFor={`${rowId}-reveal`}
            >
              <NumberInput
                id={`${rowId}-reveal`}
                value={one?.revealStep ?? 0}
                onChange={(revealStep) => scrub(() => updateMany(ids, { revealStep }))}
                min={0}
                max={12}
                aria-label="Reveal step"
              />
            </PanelRow>
          </PanelSection>

          <PanelSection title="Advanced">
            {one ? (
              <PanelRow label="Name" htmlFor={`${rowId}-name`}>
                <Input
                  id={`${rowId}-name`}
                  value={one.name ?? ""}
                  placeholder={one.type}
                  aria-label="Element name"
                  onChange={(e) => scrub(() => update(one.id, { name: e.target.value }))}
                  onBlur={end}
                  className="h-8 w-32"
                />
              </PanelRow>
            ) : null}
            <PanelRow label="Layer">
              <span className="flex items-center gap-1">
                {(
                  [
                    ["Bring to front", "front", ArrowUpToLine],
                    ["Bring forward", "forward", ArrowUp],
                    ["Send backward", "backward", ArrowDown],
                    ["Send to back", "back", ArrowDownToLine],
                  ] as const
                ).map(([label, how, Glyph]) => (
                  <IconButton
                    key={how}
                    label={label}
                    size="sm"
                    onClick={() => history.dispatch(reducers.reorder, slideId, ids, how)}
                  >
                    <Glyph aria-hidden {...ICON_SM} />
                  </IconButton>
                ))}
              </span>
            </PanelRow>
          </PanelSection>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function radiusOf(el: SlideElement): number {
  if (el.type === "image" || el.type === "shape") return el.radius ?? 0;
  if (el.type === "text") return el.style.radius ?? 0;
  return 0;
}

function setRadius(
  update: ReturnType<typeof useElementWrites>["update"],
  el: SlideElement,
  radius: number,
) {
  if (el.type === "text") {
    update<TextElement>(el.id, (draft) => {
      draft.style.radius = radius;
    });
  } else if (el.type === "image") update<ImageElement>(el.id, { radius });
  else if (el.type === "shape") update<ShapeElement>(el.id, { radius });
}
