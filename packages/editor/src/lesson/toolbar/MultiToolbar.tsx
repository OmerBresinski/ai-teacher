import type { ShapeElement, SlideElement, Theme } from "@tj/domain/documents";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  Tooltip,
} from "@tj/ui";
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  ChevronDown,
  Group,
  MoveHorizontal,
  MoveVertical,
} from "lucide-react";
import { memo } from "react";
import { ColorPicker } from "../../kit/Color";
import { Panel, PanelSeparator } from "../../kit/Panel";
import * as reducers from "../../model/reducers";
import type { Align } from "../../model/reducers/arrange";
import { hint } from "../keys";
import { useSessionActions } from "../use-editor-session";
import { MoreDrawer } from "./MoreDrawer";
import {
  BarButton,
  BorderWidthMenu,
  borderWidthOf,
  CornersMenu,
  commonValue,
  firstTwoDistinct,
  hasCorners,
  ICON,
  ICON_SM,
  OpacityControl,
  radiusOf,
  setRadiusOn,
  useElementWrites,
  useThemePalette,
} from "./shared";

const ALIGNMENTS: { id: Align; label: string; icon: typeof AlignStartVertical }[] = [
  { id: "left", label: "Align left", icon: AlignStartVertical },
  { id: "hcenter", label: "Align centre", icon: AlignCenterVertical },
  { id: "right", label: "Align right", icon: AlignEndVertical },
  { id: "top", label: "Align top", icon: AlignStartHorizontal },
  { id: "vcenter", label: "Align middle", icon: AlignCenterHorizontal },
  { id: "bottom", label: "Align bottom", icon: AlignEndHorizontal },
];

const isShape = (el: SlideElement): el is ShapeElement => el.type === "shape";

/**
 * Every control the selection shares, then align, distribute, group (TeachDeck `MultiToolbar`;
 * TEACH-175). All shapes → Fill, Border, Border width, and Corners when every one has corners to
 * round; any mix of image, text and cornered shape → Corners alone; always Opacity. Each control reads the
 * common value, or "mixed" when the elements disagree, and each write reaches every element in one
 * undo step.
 */
export const MultiToolbar = memo(function MultiToolbar({
  elements,
  theme,
  slideId,
}: {
  elements: SlideElement[];
  theme: Theme;
  slideId: string;
}) {
  const { history, updateMany } = useElementWrites(slideId);
  const { select } = useSessionActions();
  const palette = useThemePalette(theme);
  const ids = elements.map((e) => e.id);

  const shapes = elements.every(isShape) ? elements : null;
  // Corners: every element has corners to round (a star does not, whatever it sits next to).
  const cornered = elements.every(hasCorners);

  const fills = shapes?.map((s) => s.fill ?? theme.colors.accent2);
  const strokes = shapes?.map((s) => s.stroke ?? theme.colors.ink);
  const fill = fills && commonValue(fills);
  const stroke = strokes && commonValue(strokes);
  const width = shapes && commonValue(shapes.map(borderWidthOf));
  const radius = commonValue(elements.map((el) => radiusOf(el, theme)));

  return (
    <Panel as="bar" role="toolbar" aria-label="Selection" data-multi-toolbar>
      <span
        data-tabular
        data-selection-count
        className="whitespace-nowrap px-1.5 text-ink-3 text-meta"
      >
        {elements.length} selected
      </span>
      <PanelSeparator />

      {shapes ? (
        <>
          <ColorPicker
            label="Fill"
            swatch="circle"
            tooltip
            value={fill?.value ?? theme.colors.accent2}
            mixed={fill?.mixed}
            mixedColors={fills && firstTwoDistinct(fills)}
            palette={palette}
            onChange={(fill) => updateMany(ids, { fill })}
          />
          <ColorPicker
            label="Border"
            swatch="ring"
            tooltip
            value={stroke?.value ?? theme.colors.ink}
            mixed={stroke?.mixed}
            mixedColors={strokes && firstTwoDistinct(strokes)}
            palette={palette}
            onChange={(stroke) => updateMany(ids, { stroke })}
          />
          <BorderWidthMenu
            value={width?.mixed ? null : (width?.value ?? 0)}
            // A width with no colour would draw nothing: seed the theme ink where it is missing.
            onPick={(strokeWidth) =>
              updateMany(ids, (draft) => {
                if (draft.type !== "shape") return;
                draft.strokeWidth = strokeWidth;
                if (!draft.stroke && strokeWidth > 0) draft.stroke = theme.colors.ink;
              })
            }
          />
        </>
      ) : null}
      {cornered ? (
        <CornersMenu
          value={radius.mixed ? null : (radius.value ?? 0)}
          onPick={(r) => updateMany(ids, (draft) => setRadiusOn(draft, r))}
        />
      ) : null}
      {shapes || cornered ? <PanelSeparator /> : null}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <BarButton>
            Align
            <ChevronDown aria-hidden size={14} strokeWidth={1.5} className="text-ink-3" />
          </BarButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" aria-label="Align">
          {ALIGNMENTS.map((a) => (
            <DropdownMenuItem
              key={a.id}
              onSelect={() => history.dispatch(reducers.align, slideId, ids, a.id)}
            >
              <a.icon aria-hidden {...ICON_SM} />
              {a.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <BarButton>
            Distribute
            <ChevronDown aria-hidden size={14} strokeWidth={1.5} className="text-ink-3" />
          </BarButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" aria-label="Distribute">
          <DropdownMenuItem
            disabled={elements.length < 3}
            onSelect={() => history.dispatch(reducers.distribute, slideId, ids, "h")}
          >
            <MoveHorizontal aria-hidden {...ICON_SM} />
            Horizontally
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={elements.length < 3}
            onSelect={() => history.dispatch(reducers.distribute, slideId, ids, "v")}
          >
            <MoveVertical aria-hidden {...ICON_SM} />
            Vertically
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Tooltip label="Group" shortcut={hint("$mod+g")}>
        <IconButton
          label="Group"
          noTooltip
          onClick={() => {
            const made = history.dispatch(reducers.group, slideId, ids);
            if (made?.id) select([made.id]);
          }}
        >
          <Group aria-hidden {...ICON} />
        </IconButton>
      </Tooltip>
      <OpacityControl slideId={slideId} elements={elements} />
      <PanelSeparator />
      <MoreDrawer slideId={slideId} elements={elements} theme={theme} />
    </Panel>
  );
});
