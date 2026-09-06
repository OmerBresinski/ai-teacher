import type { LineElement, Theme } from "@tj/domain/documents";
import { DropdownMenuRadioItem } from "@tj/ui";
import { memo } from "react";
import { ColorPicker } from "../../kit/Color";
import { NumberInput } from "../../kit/NumberInput";
import { Panel, PanelSeparator } from "../../kit/Panel";
import { Segmented } from "../../kit/Segmented";
import { MoreDrawer } from "./MoreDrawer";
import { DropTrigger, useElementWrites, useThemePalette } from "./shared";

const ARROWS = [
  { id: "none", label: "No arrows", start: false, end: false },
  { id: "end", label: "Arrow at the end", start: false, end: true },
  { id: "start", label: "Arrow at the start", start: true, end: false },
  { id: "both", label: "Arrows at both ends", start: true, end: true },
] as const;

/** Arrow heads, dash, width, colour (TeachDeck `LineToolbar`). */
export const LineToolbar = memo(function LineToolbar({
  element,
  theme,
  slideId,
}: {
  element: LineElement;
  theme: Theme;
  slideId: string;
}) {
  const { update, scrub } = useElementWrites(slideId);
  const current =
    ARROWS.find((a) => a.start === !!element.arrowStart && a.end === !!element.arrowEnd) ??
    ARROWS[0];

  return (
    <Panel as="bar" role="toolbar" aria-label="Line" data-line-toolbar>
      <DropTrigger label="Arrows" value={current.id} text={current.label}>
        {ARROWS.map((a) => (
          <DropdownMenuRadioItem
            key={a.id}
            value={a.id}
            onSelect={() =>
              update<LineElement>(element.id, { arrowStart: a.start, arrowEnd: a.end })
            }
          >
            {a.label}
          </DropdownMenuRadioItem>
        ))}
      </DropTrigger>

      <PanelSeparator />

      <Segmented
        aria-label="Dash"
        value={element.dash ?? "solid"}
        onChange={(dash) => update<LineElement>(element.id, { dash })}
        options={[
          { value: "solid", label: "Solid" },
          { value: "dashed", label: "Dashed" },
          { value: "dotted", label: "Dotted" },
        ]}
      />

      <NumberInput
        value={element.strokeWidth ?? 3}
        onChange={(strokeWidth) => scrub(() => update<LineElement>(element.id, { strokeWidth }))}
        min={1}
        max={24}
        aria-label="Line width"
      />

      <ColorPicker
        label="Line colour"
        value={element.stroke ?? theme.colors.ink}
        palette={useThemePalette(theme)}
        onChange={(stroke) => update<LineElement>(element.id, { stroke })}
      />

      <PanelSeparator />
      <MoreDrawer slideId={slideId} elements={[element]} />
    </Panel>
  );
});
