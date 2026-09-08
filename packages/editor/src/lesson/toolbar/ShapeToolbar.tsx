import type { ShapeElement, Theme } from "@tj/domain/documents";
import { Input, Label, Popover, PopoverContent, PopoverTrigger, Tooltip } from "@tj/ui";
import { memo, useId } from "react";
import { ColorPicker } from "../../kit/Color";
import { Panel, PanelSeparator } from "../../kit/Panel";
import { docFromText } from "../../model/factories";
import { shapeRadius } from "../../slide/elements/ShapeView";
import { LabelTextControls } from "./LabelTextControls";
import { MoreDrawer } from "./MoreDrawer";
import {
  BarButton,
  BorderWidthMenu,
  borderWidthOf,
  CORNERED,
  CornersMenu,
  OpacityControl,
  useElementWrites,
  useThemePalette,
} from "./shared";

/**
 * Fill, border, border width, corners (rectangles only), opacity, label, and once the shape has a
 * label its text controls (TeachDeck `ShapeToolbar`). Every control is a 32px ghost button at
 * weight 500; the two colours are a filled circle and a ring so the bar reads as fill-then-border
 * without a caption.
 */
export const ShapeToolbar = memo(function ShapeToolbar({
  element,
  theme,
  slideId,
}: {
  element: ShapeElement;
  theme: Theme;
  slideId: string;
}) {
  const { update, scrub, end } = useElementWrites(slideId);
  const palette = useThemePalette(theme);
  const labelId = useId();

  // Mirror ShapeView's defaults so the menu marks what is actually drawn.
  const borderWidth = borderWidthOf(element);
  const radius = shapeRadius(element, theme);

  return (
    <Panel as="bar" role="toolbar" aria-label="Shape" data-shape-toolbar>
      <ColorPicker
        label="Fill"
        swatch="circle"
        tooltip
        value={element.fill ?? theme.colors.accent2}
        palette={palette}
        onChange={(fill) => update<ShapeElement>(element.id, { fill })}
      />
      <ColorPicker
        label="Border"
        swatch="ring"
        tooltip
        value={element.stroke ?? theme.colors.ink}
        palette={palette}
        onChange={(stroke) => update<ShapeElement>(element.id, { stroke })}
      />
      <BorderWidthMenu
        value={borderWidth}
        // A width with no colour would draw nothing: seed the theme ink the first time.
        onPick={(strokeWidth) =>
          update<ShapeElement>(element.id, {
            strokeWidth,
            ...(element.stroke || strokeWidth === 0 ? null : { stroke: theme.colors.ink }),
          })
        }
      />
      {CORNERED.has(element.shape) ? (
        <CornersMenu
          value={radius}
          onPick={(radius) => update<ShapeElement>(element.id, { radius })}
        />
      ) : null}

      <PanelSeparator />

      <OpacityControl slideId={slideId} elements={[element]} />

      <Popover onOpenChange={(open) => !open && end()}>
        <Tooltip label="Label">
          <PopoverTrigger asChild>
            <BarButton className="font-medium">Label</BarButton>
          </PopoverTrigger>
        </Tooltip>
        {/*
         * Rows are 32px controls with `gap-3` between them and the kit's `p-3` around: every
         * control's 4px focus band (2px gap + 2px accent) fits inside the row gap and the padding
         * without touching the input row above or the popover edge. Nothing here sets
         * `overflow`, so the band, drawn as a box-shadow, is never clipped.
         */}
        <PopoverContent
          align="end"
          className="flex w-auto min-w-60 flex-col gap-3 p-3"
          aria-label="Label"
        >
          <div className="flex h-8 items-center justify-between gap-3">
            <Label htmlFor={labelId} className="text-ink-3 text-meta">
              Label
            </Label>
            <Input
              id={labelId}
              value={plainLabel(element)}
              placeholder="Optional"
              onChange={(e) =>
                scrub(() => update<ShapeElement>(element.id, { doc: docFromText(e.target.value) }))
              }
              onBlur={end}
              className="h-8 w-32"
            />
          </div>
          {/* Second row, once there is a label to style. */}
          <LabelTextControls element={element} theme={theme} slideId={slideId} />
        </PopoverContent>
      </Popover>

      <PanelSeparator />
      <MoreDrawer slideId={slideId} elements={[element]} theme={theme} />
    </Panel>
  );
});

function plainLabel(el: ShapeElement): string {
  const first = el.doc?.content?.[0]?.content?.[0];
  return typeof first?.text === "string" ? first.text : "";
}
