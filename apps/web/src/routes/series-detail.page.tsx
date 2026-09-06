import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { Button, Card, EmptyState, PageTitle } from "@tj/ui";
import { Layers, Play } from "lucide-react";
import type * as React from "react";
import { lazy, Suspense, useRef, useState } from "react";
import { ROW_H, SeriesLessonRow } from "@/components/series/series-lesson-row";
import { useSeriesActions } from "@/components/series/use-series-actions";
import { useRowDrag } from "@/hooks/use-row-drag";
import { useShellReturn } from "@/lib/last-shell";
import { libraryQueries, librarySelectors } from "@/lib/library";
import { reorderVisible, stepVisible } from "@/lib/reorder";
import type { SeriesWithLessons } from "@/mocks/library-schema";
import { seriesDetailRoute } from "./library.route";

const AddLessonsDialog = lazy(() =>
  import("@/components/add-lessons-dialog").then(({ AddLessonsDialog }) => ({
    default: AddLessonsDialog,
  })),
);

const SERIES_ICON = <Layers strokeWidth={1.5} />;
const PLAY_ICON = <Play aria-hidden size={16} />;
const EMPTY_LESSONS: SeriesWithLessons["lessons"] = [];

export function SeriesDetailPage() {
  const { seriesId } = useParams({ from: seriesDetailRoute.id });
  const queryClient = useQueryClient();
  const detail = useQuery(libraryQueries.seriesDetail(seriesId, queryClient));
  const navigate = useNavigate();
  const shellReturn = useShellReturn();

  if (detail.data === null) {
    return (
      <main className="min-h-dvh px-6 py-8 lg:px-12">
        <EmptyState
          icon={SERIES_ICON}
          title="This series is somewhere else"
          body="This series was deleted or never existed."
          action={
            <Button onClick={() => void navigate({ to: shellReturn })}>Back to the library</Button>
          }
        />
      </main>
    );
  }

  return <SeriesDetail item={detail.data} />;
}

function SeriesDetail({ item }: { item: SeriesWithLessons | undefined }) {
  const actions = useSeriesActions(item);
  const lessons = item?.lessons ?? EMPTY_LESSONS;
  const lessonIds = item?.series.lessonIds ?? [];
  const visibleIds = lessons.map((lesson) => lesson.id);
  const slideCount = lessons.reduce((sum, lesson) => sum + lesson.count, 0);
  const [adding, setAdding] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const rows = useRef(new Map<string, HTMLLIElement>());
  const focusAfterMove = useRef<string | null>(null);

  // Lessons the Add dialog offers: every lesson not already in this series, newest first.
  const { data: allLessons = EMPTY_LESSONS } = useQuery({
    ...libraryQueries.documents(),
    select: librarySelectors.byKind("lesson"),
  });
  const inSeries = new Set(lessonIds);
  const candidates = allLessons.filter((lesson) => !inSeries.has(lesson.id));

  function commitOrder(next: string[] | null, movedId: string | undefined, position: number): void {
    if (!next) return;
    focusAfterMove.current = movedId ?? null;
    actions.setOrder(next);
    setAnnouncement(`Moved to position ${position}`);
  }

  function move(index: number, direction: -1 | 1): void {
    const next = stepVisible(lessonIds, visibleIds, index, direction);
    commitOrder(next, visibleIds[index], index + direction + 1);
  }

  const drag = useRowDrag({
    rowHeight: ROW_H,
    count: lessons.length,
    onDrop: (from, insertion) => {
      const next = reorderVisible(lessonIds, visibleIds, from, insertion);
      commitOrder(next, visibleIds[from], insertion > from ? insertion : insertion + 1);
    },
  });

  // The moved row keeps focus across the re-render: rows are keyed by id, so the node persists.
  const rowRef = (id: string) => (node: HTMLLIElement | null) => {
    if (node) rows.current.set(id, node);
    else rows.current.delete(id);
    if (node && focusAfterMove.current === id && visibleIds.indexOf(id) !== -1) {
      node.focus();
      focusAfterMove.current = null;
    }
  };

  function onRowKeyDown(event: React.KeyboardEvent<HTMLLIElement>, index: number): void {
    if (event.target !== event.currentTarget) return;
    const direction = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    if (direction === 0) return;
    event.preventDefault();
    if (event.metaKey || event.ctrlKey) {
      move(index, direction);
      return;
    }
    const nextId = visibleIds[index + direction];
    if (nextId) rows.current.get(nextId)?.focus();
  }

  return (
    <main className="min-h-dvh px-6 py-8 lg:px-12">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <PageTitle label="Series name" renameLabel="Rename series" onCommit={actions.rename}>
            {item?.series.title ?? "Series"}
          </PageTitle>
          <p className="mt-1 text-meta tabular-nums text-ink-3">
            {lessons.length === 0
              ? "No lessons yet"
              : `${lessons.length} lesson${lessons.length === 1 ? "" : "s"} · ${slideCount} slide${slideCount === 1 ? "" : "s"}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setAdding(true)}>
            Add lesson
          </Button>
          {lessons.length > 0 ? (
            <Button size="sm" onClick={actions.presentFirst}>
              {PLAY_ICON}
              Present series
            </Button>
          ) : null}
        </div>
      </div>

      <div className="mt-8">
        {lessons.length === 0 ? (
          <EmptyState
            icon={SERIES_ICON}
            title="No lessons in this series"
            action={<Button onClick={() => setAdding(true)}>Add lesson</Button>}
          />
        ) : (
          <Card className="relative gap-0 overflow-hidden p-0">
            <ol ref={drag.listRef} className="relative" aria-label="Lessons in teaching order">
              {lessons.map((lesson, index) => (
                <SeriesLessonRow
                  key={lesson.id}
                  lesson={lesson}
                  index={index}
                  total={lessons.length}
                  dragging={drag.drag.from === index}
                  gripProps={drag.gripProps(index)}
                  onGripActivate={(i) => rows.current.get(visibleIds[i] ?? "")?.focus()}
                  onMove={move}
                  onRemove={(i) => {
                    const lesson = lessons[i];
                    if (lesson) actions.remove(lesson.id, lesson.title, i);
                  }}
                  onRowKeyDown={onRowKeyDown}
                  rowRef={rowRef(lesson.id)}
                />
              ))}
            </ol>
            {drag.drag.insertion !== null ? (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-3 h-0.5 bg-primary"
                style={{ top: drag.drag.insertion * ROW_H - 1 }}
              />
            ) : null}
          </Card>
        )}
        {drag.drag.from !== null && lessons[drag.drag.from] ? (
          <div
            aria-hidden
            className="pointer-events-none fixed left-1/2 z-50 w-[min(560px,80vw)] -translate-x-1/2 rounded-control bg-card px-4 py-3 text-body font-medium shadow-3"
            style={{ top: drag.drag.pointerY - ROW_H / 2 }}
          >
            {lessons[drag.drag.from]?.title}
          </div>
        ) : null}
      </div>

      <output aria-live="polite" className="sr-only">
        {announcement}
      </output>

      <Suspense fallback={null}>
        {adding ? (
          <AddLessonsDialog
            open
            onOpenChange={(open) => {
              if (!open) setAdding(false);
            }}
            candidates={candidates}
            hasLessons={allLessons.length > 0}
            onAdd={async (ids) => {
              await actions.add(ids);
              setAdding(false);
            }}
          />
        ) : null}
      </Suspense>
    </main>
  );
}
