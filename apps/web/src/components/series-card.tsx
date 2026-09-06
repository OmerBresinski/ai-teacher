import { Link } from "@tanstack/react-router";
import {
  Button,
  Card,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
  IconButton,
  Stack,
  useInlineRename,
} from "@tj/ui";
import { Copy, MoreHorizontal, Pencil, Play, Trash2 } from "lucide-react";
import { memo } from "react";
import type { SeriesWithLessons } from "@/mocks/library-schema";
import { EditedTime } from "./edited-time";
import { LessonThumb } from "./lesson-thumb";

type SeriesAction = "present" | "duplicate" | "delete";

export type SeriesCardProps = {
  item: SeriesWithLessons;
  headingLevel?: "h2" | "h3";
  onAction: (action: SeriesAction, item: SeriesWithLessons) => void;
  onRename: (item: SeriesWithLessons, title: string) => void;
};

function SeriesMenu({
  item,
  onAction,
  onRename,
}: {
  item: SeriesWithLessons;
  onAction: SeriesCardProps["onAction"];
  onRename: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label="More actions" noTooltip size="sm">
          <MoreHorizontal aria-hidden size={16} strokeWidth={1.5} />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          disabled={item.lessons.length === 0}
          onSelect={() => onAction("present", item)}
        >
          <Play aria-hidden />
          Present series
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onRename}>
          <Pencil aria-hidden />
          Rename
          <DropdownMenuShortcut>F2</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAction("duplicate", item)}>
          <Copy aria-hidden />
          Duplicate
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive onSelect={() => onAction("delete", item)}>
          <Trash2 aria-hidden />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Memoised for the same reason as `LibraryCard`: a stable `item` and handlers skip the re-render. */
export const SeriesCard = memo(function SeriesCard({
  item,
  headingLevel = "h2",
  onAction,
  onRename,
}: SeriesCardProps) {
  const rename = useInlineRename(item.series.title, { onCommit: (title) => onRename(item, title) });
  const Title = headingLevel;
  const firstLesson = item.lessons[0];

  return (
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: the focusable cover link bubbles F2 from every series control.
    <article
      className="group/card relative col-span-2"
      onKeyDown={rename.onCardKeyDown}
      onDoubleClick={rename.start}
    >
      <Link
        to="/series/$seriesId"
        params={{ seriesId: item.series.id }}
        hidden={rename.editing}
        aria-label={`Open ${item.series.title}`}
        className="absolute inset-0 z-1 rounded-face outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <Card className="grid gap-0 overflow-hidden p-0 md:grid-cols-[220px_minmax(0,1fr)]">
        <div className="pt-4 pl-2.5">
          <Stack
            width={196}
            radius={8}
            sheets={item.lessons
              .slice(0, 3)
              .map((lesson) => <LessonThumb key={lesson.id} lesson={lesson} />)}
          />
        </div>
        <div className="min-w-0 px-4 py-4 md:pl-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              {rename.editing ? (
                <input
                  aria-label={`Rename ${item.series.title}`}
                  className="relative z-2 h-7 w-full rounded-control border border-ring bg-card px-2 text-lead font-semibold text-foreground outline-none"
                  {...rename.inputProps}
                />
              ) : (
                <Title className="truncate text-lead font-semibold text-foreground">
                  {item.series.title}
                </Title>
              )}
              <p className="mt-1 truncate text-meta tabular-nums text-ink-3">
                {firstLesson?.yearGroup ? `${firstLesson.yearGroup} · ` : ""}
                {item.lessons.length} lesson{item.lessons.length === 1 ? "" : "s"} ·{" "}
                <EditedTime updatedAt={item.series.updatedAt} />
              </p>
            </div>
            <div className="relative z-2 flex items-center gap-1 opacity-0 motion-safe:transition-opacity motion-safe:duration-(--duration-fast) group-hover/card:opacity-100 group-focus-within/card:opacity-100 pointer-coarse:opacity-100">
              {firstLesson ? (
                <Button size="sm" onClick={() => onAction("present", item)}>
                  <Play aria-hidden size={16} />
                  Present series
                </Button>
              ) : null}
              <SeriesMenu item={item} onAction={onAction} onRename={rename.start} />
            </div>
          </div>
          <ol className="mt-4 flex flex-col gap-2">
            {item.lessons.map((lesson, index) => (
              <li key={lesson.id} className="flex min-w-0 items-center gap-2 text-sm">
                <span
                  aria-hidden
                  className="w-4 shrink-0 text-right text-meta tabular-nums text-ink-3"
                >
                  {index + 1}
                </span>
                <div className="h-6 w-10 shrink-0 overflow-hidden rounded-chip">
                  <LessonThumb lesson={lesson} />
                </div>
                <Link
                  to="/l/$lessonId"
                  params={{ lessonId: lesson.id }}
                  className="relative z-2 flex min-h-6 items-center truncate font-medium text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {lesson.title}
                </Link>
              </li>
            ))}
          </ol>
        </div>
      </Card>
    </article>
  );
});
