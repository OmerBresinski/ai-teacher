import type { SlideElement } from "@tj/domain/documents";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
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
import { Panel, PanelSeparator } from "../../kit/Panel";
import * as reducers from "../../model/reducers";
import type { Align } from "../../model/reducers/arrange";
import { useHistory } from "../document-context";
import { useSessionActions } from "../use-editor-session";
import { MoreDrawer } from "./MoreDrawer";
import { BarButton, ICON, ICON_SM } from "./shared";

const ALIGNMENTS: { id: Align; label: string; icon: typeof AlignStartVertical }[] = [
  { id: "left", label: "Align left", icon: AlignStartVertical },
  { id: "hcenter", label: "Align centre", icon: AlignCenterVertical },
  { id: "right", label: "Align right", icon: AlignEndVertical },
  { id: "top", label: "Align top", icon: AlignStartHorizontal },
  { id: "vcenter", label: "Align middle", icon: AlignCenterHorizontal },
  { id: "bottom", label: "Align bottom", icon: AlignEndHorizontal },
];

/** Align, distribute, group (TeachDeck `MultiToolbar`). */
export const MultiToolbar = memo(function MultiToolbar({
  elements,
  slideId,
}: {
  elements: SlideElement[];
  slideId: string;
}) {
  const history = useHistory();
  const { select } = useSessionActions();
  const ids = elements.map((e) => e.id);

  return (
    <Panel as="bar" role="toolbar" aria-label="Selection" data-multi-toolbar>
      <span data-tabular className="px-1.5 text-ink-3 text-meta">
        {elements.length} selected
      </span>
      <PanelSeparator />
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
      <IconButton
        label="Group"
        onClick={() => {
          const made = history.dispatch(reducers.group, slideId, ids);
          if (made?.id) select([made.id]);
        }}
      >
        <Group aria-hidden {...ICON} />
      </IconButton>
      <PanelSeparator />
      <MoreDrawer slideId={slideId} elements={elements} />
    </Panel>
  );
});
