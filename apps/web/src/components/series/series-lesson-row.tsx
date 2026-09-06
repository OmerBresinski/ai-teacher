import { Link } from "@tanstack/react-router";
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
  IconButton,
} from "@tj/ui";
import { ChevronDown, ChevronUp, GripVertical, MoreHorizontal, X } from "lucide-react";
import type * as React from "react";
import { memo } from "react";
import { LessonThumb } from "@/components/lesson-thumb";
import { sizeOf, yearAndSubject } from "@/lib/format";
import { modKeyLabel } from "@/lib/platform";
import type { DocumentSummary } from "@/mocks/library-schema";

/** Row height in px; the drag hook maps pointer offset to gaps with it (TeachDeck `ROW_H`). */
export const ROW_H = 56;

const MOD = modKeyLabel();
const GRIP_ICON = <GripVertical aria-hidden size={16} strokeWidth={1.5} />;
const MORE_ICON = <MoreHorizontal aria-hidden size={16} strokeWidth={1.5} />;

export type SeriesLessonRowProps = {
  lesson: DocumentSummary;
  index: number;
  total: number;
  dragging: boolean;
  /** Pointer + Escape handlers from `useRowDrag().gripProps(index)`. */
  gripProps: React.HTMLAttributes<HTMLElement> & { style: React.CSSProperties };
  /** Enter/Space on the grip: keyboard users get the row focused, where ⌘/Ctrl+arrows reorder. */
  onGripActivate: (index: number) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  onRemove: (index: number) => void;
  onRowKeyDown: (event: React.KeyboardEvent<HTMLLIElement>, index: number) => void;
  rowRef: (node: HTMLLIElement | null) => void;
};

function SeriesLessonRowImpl({
  lesson,
  index,
  total,
  dragging,
  gripProps,
  onMove,
  onRemove,
  onRowKeyDown,
  onGripActivate,
  rowRef,
}: SeriesLessonRowProps) {
  const meta = [sizeOf(lesson), yearAndSubject(lesson)].filter(Boolean).join(" · ");
  return (
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: the row is a focus stop; arrows move between rows and ⌘/Ctrl+arrows reorder (spec).
    <li
      ref={rowRef}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the row is the keyboard reorder target (⌘/Ctrl+arrows), announced with its position.
      tabIndex={0}
      aria-label={`${lesson.title}, lesson ${index + 1} of ${total}`}
      data-lesson-id={lesson.id}
      onKeyDown={(event) => onRowKeyDown(event, index)}
      style={{ height: ROW_H }}
      className={cn(
        "group/row relative flex items-center gap-3 border-b border-border-faint px-3 outline-none last:border-b-0 hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        dragging && "opacity-40",
      )}
    >
      <IconButton
        label="Reorder"
        size="sm"
        noTooltip
        className="cursor-grab text-ink-4 active:cursor-grabbing"
        {...gripProps}
        onClick={() => onGripActivate(index)}
      >
        {GRIP_ICON}
      </IconButton>
      <span className="w-6 text-right text-meta tabular-nums text-ink-3">{index + 1}</span>
      <div className="h-6 w-[42px] shrink-0 overflow-hidden rounded-chip">
        <LessonThumb lesson={lesson} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-body font-medium text-foreground">{lesson.title}</p>
        <p className="truncate text-meta text-ink-3">{meta}</p>
      </div>
      <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100 pointer-coarse:opacity-100">
        <Button asChild variant="ghost" size="sm">
          <Link to="/l/$lessonId" params={{ lessonId: lesson.id }}>
            Open
          </Link>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton label="More actions" noTooltip size="sm">
              {MORE_ICON}
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem disabled={index === 0} onSelect={() => onMove(index, -1)}>
              <ChevronUp aria-hidden />
              Move up
              <DropdownMenuShortcut>{MOD}↑</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem disabled={index === total - 1} onSelect={() => onMove(index, 1)}>
              <ChevronDown aria-hidden />
              Move down
              <DropdownMenuShortcut>{MOD}↓</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onSelect={() => onRemove(index)}>
              <X aria-hidden />
              Remove from series
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}

export const SeriesLessonRow = memo(SeriesLessonRowImpl);
