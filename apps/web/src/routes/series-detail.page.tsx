import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { Button, Card, EmptyState, PageTitle } from "@tj/ui";
import { Layers, Play } from "lucide-react";
import type * as React from "react";
import { lazy, Suspense, useCallback, useMemo, useRef, useState } from "react";
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
const EMPTY_IDS: string[] = [];

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
  const lessonIds = item?.series.lessonIds ?? EMPTY_IDS;
  const visibleIds = useMemo(() => lessons.map((lesson) => lesson.id), [lessons]);
  const slideCount = lessons.reduce((sum, lesson) => sum + lesson.count, 0);
  const [adding, setAdding] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const rows = useRef(new Map<string, HTMLLIElement>());
  const focusAfterMove = useRef<string | null>(null);
  // Row callbacks read the latest order through this ref so their identities stay stable and the
  // memoised rows skip the pointer-move re-renders (advanced-use-latest).
  const latest = useRef({ lessons, lessonIds, visibleIds, actions });
  latest.current = { lessons, lessonIds, visibleIds, actions };

  // Lessons the Add dialog offers: every lesson not already in this series, newest first.
  const { data: allLessons = EMPTY_LESSONS } = useQuery({
    ...libraryQueries.documents(),
    select: librarySelectors.byKind("lesson"),
  });
  const candidates = useMemo(() => {
    const inSeries = new Set(lessonIds);
    return allLessons.filter((lesson) => !inSeries.has(lesson.id));
  }, [allLessons, lessonIds]);

  const commitOrder = useCallback(
    (next: string[] | null, movedId: string | undefined, position: number): void => {
      if (!next) return;
      focusAfterMove.current = movedId ?? null;
      latest.current.actions.setOrder(next);
      setAnnouncement(`Moved to position ${position}`);
    },
    [],
  );

  const move = useCallback(
    (index: number, direction: -1 | 1): void => {
      const { lessonIds, visibleIds } = latest.current;
      const next = stepVisible(lessonIds, visibleIds, index, direction);
      commitOrder(next, visibleIds[index], index + direction + 1);
    },
    [commitOrder],
  );

  const drag = useRowDrag({
    rowHeight: ROW_H,
    count: lessons.length,
    onDrop: (from, insertion) => {
      const next = reorderVisible(lessonIds, visibleIds, from, insertion);
      commitOrder(next, visibleIds[from], insertion > from ? insertion : insertion + 1);
    },
  });

  // Callback refs, one per lesson id, kept across renders. The moved row keeps focus after a
  // reorder: rows are keyed by id, so the node persists and is re-attached here.
  const rowRefs = useRef(new Map<string, (node: HTMLLIElement | null) => void>());
  const rowRef = (id: string) => {
    let ref = rowRefs.current.get(id);
    if (!ref) {
      ref = (node) => {
        if (node) rows.current.set(id, node);
        else rows.current.delete(id);
        if (node && focusAfterMove.current === id) {
          node.focus();
          focusAfterMove.current = null;
        }
      };
      rowRefs.current.set(id, ref);
    }
    return ref;
  };

  const onRowKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLLIElement>, index: number): void => {
      if (event.target !== event.currentTarget) return;
      const direction = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
      if (direction === 0) return;
      event.preventDefault();
      if (event.metaKey || event.ctrlKey) {
        move(index, direction);
        return;
      }
      const nextId = latest.current.visibleIds[index + direction];
      if (nextId) rows.current.get(nextId)?.focus();
    },
    [move],
  );

  const onGripActivate = useCallback((index: number): void => {
    rows.current.get(latest.current.visibleIds[index] ?? "")?.focus();
  }, []);

  const onRemove = useCallback((index: number): void => {
    const lesson = latest.current.lessons[index];
    if (lesson) latest.current.actions.remove(lesson.id, lesson.title, index);
  }, []);

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
                  onGripActivate={onGripActivate}
                  onMove={move}
                  onRemove={onRemove}
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
