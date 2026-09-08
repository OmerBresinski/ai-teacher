import { SLIDE_H, SLIDE_W, type SlideElement, type Theme } from "@tj/domain/documents";
import { Button, IconButton, Input, Popover, PopoverContent, PopoverTrigger, Switch } from "@tj/ui";
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpToLine,
  MoreHorizontal,
  RotateCcw,
  RotateCw,
  Sparkles,
} from "lucide-react";
import { type ReactNode, useId } from "react";
import { NumberInput } from "../../kit/NumberInput";
import { PanelRow } from "../../kit/Panel";
import * as reducers from "../../model/reducers";
import { useProposals } from "../proposals-context";
import { useSessionActions } from "../use-editor-session";
import {
  hasCorners,
  ICON,
  ICON_SM,
  OpacityField,
  opacityOf,
  PanelSection,
  radiusOf,
  setRadiusOn,
  useElementWrites,
} from "./shared";

/**
 * Everything the seven visible controls could not hold, behind one trigger (TeachDeck
 * `toolbar/drawers.tsx`): Position, Effects and Advanced, named as research/01 §12 names them.
 * Scrubs and typing runs are one undo step each (SPEC §7); the opacity slider commits on release.
 */
export function MoreDrawer({
  slideId,
  elements,
  extra,
  theme,
}: {
  slideId: string;
  elements: SlideElement[];
  /** The slide's theme, so a shape's readout matches the Shape bar (theme radius when unset). */
  theme?: Theme;
  /** The toolbar's own rows (line height, credit, …), shown first under "Options". */
  extra?: ReactNode;
}) {
  const { history, update, updateMany, scrub, end } = useElementWrites(slideId);
  const rowId = useId();
  const ids = elements.map((e) => e.id);
  const one = elements.length === 1 ? elements[0] : null;
  const { onRegenerate } = useProposals();
  const { openRegenerate } = useSessionActions();
  const opacity = opacityOf(elements);

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

          {/* One AI-derived element, rewritten from the facts (TEACH-134, ADR 0025 §18). */}
          {one && onRegenerate ? (
            <PanelSection title="AI">
              <Button
                variant="ghost"
                size="sm"
                className="justify-start"
                onClick={() => openRegenerate({ slideId, elementId: one.id })}
              >
                <Sparkles aria-hidden {...ICON_SM} />
                Regenerate element…
              </Button>
            </PanelSection>
          ) : null}

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
            <PanelRow label="Opacity" htmlFor={`${rowId}-opacity`}>
              <OpacityField
                id={`${rowId}-opacity`}
                value={opacity.value}
                mixed={opacity.mixed}
                onChange={(v) => scrub(() => updateMany(ids, { opacity: v / 100 }))}
                onCommit={end}
                className="w-52"
              />
            </PanelRow>
            {one && hasCorners(one) ? (
              <PanelRow label="Corner radius" htmlFor={`${rowId}-radius`}>
                <NumberInput
                  id={`${rowId}-radius`}
                  value={radiusOf(one, theme)}
                  onChange={(r) => scrub(() => update(one.id, (draft) => setRadiusOn(draft, r)))}
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
