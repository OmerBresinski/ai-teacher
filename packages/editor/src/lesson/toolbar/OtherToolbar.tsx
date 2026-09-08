import type {
  EmbedElement,
  IconElement,
  SlideElement,
  TableElement,
  Theme,
  TimerElement,
} from "@tj/domain/documents";
import { IconButton, Input, Switch, Tooltip } from "@tj/ui";
import { Ungroup } from "lucide-react";
import { memo, useId } from "react";
import { ColorPicker } from "../../kit/Color";
import { NumberInput } from "../../kit/NumberInput";
import { Panel, PanelLabel, PanelSeparator } from "../../kit/Panel";
import * as reducers from "../../model/reducers";
import { hint } from "../keys";
import { useSessionActions } from "../use-editor-session";
import { MoreDrawer } from "./MoreDrawer";
import { ICON, OpacityControl, useElementWrites, useThemePalette } from "./shared";

/**
 * Everything else, one control apiece (TeachDeck `OtherToolbar`): icon, embed, timer, table, and a
 * group's Ungroup (TEACH-175: the key binding existed, no control showed it).
 */
export const OtherToolbar = memo(function OtherToolbar({
  element,
  theme,
  slideId,
}: {
  element: SlideElement;
  theme: Theme;
  slideId: string;
}) {
  const { history, update, scrub, end } = useElementWrites(slideId);
  const { select } = useSessionActions();
  const palette = useThemePalette(theme);
  const id = useId();

  return (
    <Panel as="bar" role="toolbar" aria-label="Element" data-other-toolbar>
      {element.type === "group" ? (
        <>
          <Tooltip label="Ungroup" shortcut={hint("$mod+Shift+g")}>
            <IconButton
              label="Ungroup"
              noTooltip
              onClick={() => {
                const made = history.dispatch(reducers.ungroup, slideId, element.id);
                if (made?.ids.length) select(made.ids);
              }}
            >
              <Ungroup aria-hidden {...ICON} />
            </IconButton>
          </Tooltip>
          <PanelSeparator />
        </>
      ) : null}
      {element.type === "icon" ? (
        <>
          <ColorPicker
            label="Icon colour"
            value={element.color ?? theme.colors.accent}
            palette={palette}
            onChange={(color) => update<IconElement>(element.id, { color })}
          />
          <NumberInput
            value={element.strokeWidth ?? 3}
            onChange={(strokeWidth) =>
              scrub(() => update<IconElement>(element.id, { strokeWidth }))
            }
            min={1}
            max={8}
            aria-label="Icon weight"
          />
          <PanelSeparator />
        </>
      ) : null}

      {element.type === "embed" ? (
        <>
          <Input
            value={element.url}
            aria-label="Video URL"
            placeholder="Paste a YouTube or Vimeo link"
            onChange={(e) => scrub(() => update<EmbedElement>(element.id, { url: e.target.value }))}
            onBlur={end}
            className="h-8 w-64"
          />
          <PanelSeparator />
        </>
      ) : null}

      {element.type === "timer" ? (
        <>
          <PanelLabel id={`${id}-min`}>Minutes</PanelLabel>
          <NumberInput
            value={Math.round(element.seconds / 60)}
            onChange={(m) =>
              scrub(() => update<TimerElement>(element.id, { seconds: Math.max(1, m) * 60 }))
            }
            min={1}
            max={60}
            aria-label="Minutes"
          />
          <PanelSeparator />
        </>
      ) : null}

      {element.type === "table" ? (
        <>
          <PanelLabel id={`${id}-header`}>Header row</PanelLabel>
          <Switch
            checked={!!element.header}
            onCheckedChange={(header) => update<TableElement>(element.id, { header })}
            aria-labelledby={`${id}-header`}
          />
          <PanelLabel id={`${id}-stripe`}>Stripes</PanelLabel>
          <Switch
            checked={!!element.stripe}
            onCheckedChange={(stripe) => update<TableElement>(element.id, { stripe })}
            aria-labelledby={`${id}-stripe`}
          />
          <PanelSeparator />
        </>
      ) : null}

      <OpacityControl slideId={slideId} elements={[element]} />
      <PanelSeparator />
      <MoreDrawer slideId={slideId} elements={[element]} />
    </Panel>
  );
});
