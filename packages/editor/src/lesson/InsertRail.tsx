import type { SlideElement, Theme } from "@tj/domain/documents";
import { cn, IconButton, Tooltip } from "@tj/ui";
import { CircleHelp, Image as ImageIcon, Minus, Square, Type } from "lucide-react";
import { makeLine, makeShape, makeText } from "../model/insert";
import { hint } from "./keys";

/*
 * The insert rail (TeachDeck `components/v2/editor/InsertRail.tsx`): a 56px icon-only column
 * (`--rail-width`) with a hairline on its right, over the app ground. This ticket ships the shell
 * of it — text, shape and line insert straight from their default presets, image is off until
 * TEACH-107 — and the help button at the foot; the preset menus, icon picker, table, timer, embed
 * and question kinds arrive with TEACH-105.
 */

const ICON = { size: 20, strokeWidth: 1.5 } as const;

export function InsertRail({
  theme,
  onInsert,
  onHelp,
}: {
  theme: Theme;
  onInsert: (el: SlideElement) => void;
  onHelp: () => void;
}) {
  return (
    <nav
      aria-label="Insert"
      data-insert-rail
      className="flex w-(--rail-width) shrink-0 flex-col items-center gap-1 border-border border-r bg-background py-1.5"
    >
      <RailButton
        label="Text"
        shortcut={hint("t")}
        onClick={() => onInsert(makeText("body", theme))}
      >
        <Type aria-hidden {...ICON} />
      </RailButton>
      <Tooltip label="Images arrive with a later release">
        <IconButton
          label="Image"
          noTooltip
          aria-disabled="true"
          className="size-10 cursor-default opacity-50 hover:bg-transparent hover:text-ink-2"
        >
          <ImageIcon aria-hidden {...ICON} />
        </IconButton>
      </Tooltip>
      <RailButton
        label="Shape"
        shortcut={hint("r")}
        onClick={() => onInsert(makeShape("rect", theme))}
      >
        <Square aria-hidden {...ICON} />
      </RailButton>
      <RailButton
        label="Line"
        shortcut={hint("l")}
        onClick={() => onInsert(makeLine("line", theme))}
      >
        <Minus aria-hidden {...ICON} />
      </RailButton>

      <div className="mt-auto flex flex-col items-center gap-1 pt-1.5">
        <RailButton label="Keyboard shortcuts" shortcut="?" onClick={onHelp}>
          <CircleHelp aria-hidden {...ICON} />
        </RailButton>
      </div>
    </nav>
  );
}

function RailButton({
  label,
  shortcut,
  onClick,
  children,
  className,
}: {
  label: string;
  shortcut?: string;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Tooltip label={label} shortcut={shortcut} side="right">
      <IconButton label={label} noTooltip onClick={onClick} className={cn("size-10", className)}>
        {children}
      </IconButton>
    </Tooltip>
  );
}
