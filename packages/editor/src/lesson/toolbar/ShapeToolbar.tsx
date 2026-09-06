import type { ShapeElement, Theme } from "@tj/domain/documents";
import { Input, Label, Popover, PopoverContent, PopoverTrigger } from "@tj/ui";
import { memo, useId } from "react";
import { ColorPicker } from "../../kit/Color";
import { NumberInput } from "../../kit/NumberInput";
import { Panel, PanelSeparator } from "../../kit/Panel";
import { docFromText } from "../../model/factories";
import { MoreDrawer } from "./MoreDrawer";
import { BarButton, useElementWrites, useThemePalette } from "./shared";

/** Fill, stroke, stroke width, corner radius, label (TeachDeck `ShapeToolbar`). */
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

  return (
    <Panel as="bar" role="toolbar" aria-label="Shape" data-shape-toolbar>
      <ColorPicker
        label="Fill"
        value={element.fill ?? theme.colors.accent2}
        palette={palette}
        onChange={(fill) => update<ShapeElement>(element.id, { fill })}
      />
      <ColorPicker
        label="Stroke"
        value={element.stroke ?? theme.colors.ink}
        palette={palette}
        onChange={(stroke) => update<ShapeElement>(element.id, { stroke })}
      />
      <NumberInput
        value={element.strokeWidth ?? 0}
        onChange={(strokeWidth) => scrub(() => update<ShapeElement>(element.id, { strokeWidth }))}
        min={0}
        max={24}
        aria-label="Stroke width"
      />

      <PanelSeparator />

      <NumberInput
        value={element.radius ?? 0}
        onChange={(radius) => scrub(() => update<ShapeElement>(element.id, { radius }))}
        min={0}
        max={200}
        aria-label="Corner radius"
      />

      <Popover onOpenChange={(open) => !open && end()}>
        <PopoverTrigger asChild>
          <BarButton>Label</BarButton>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-60 p-3" aria-label="Label">
          <div className="flex items-center justify-between gap-3">
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
        </PopoverContent>
      </Popover>

      <PanelSeparator />
      <MoreDrawer slideId={slideId} elements={[element]} />
    </Panel>
  );
});

function plainLabel(el: ShapeElement): string {
  const first = el.doc?.content?.[0]?.content?.[0];
  return typeof first?.text === "string" ? first.text : "";
}
