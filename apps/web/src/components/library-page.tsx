import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Button,
  Card,
  Display,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  EmptyState,
  IconButton,
  IconGroup,
  ListSurface,
  ListSurfaceCell,
  ListSurfaceHeader,
  SearchInput,
  SectionHeading,
  Skeleton,
  Tile,
  toast,
} from "@tj/ui";
import {
  ArrowDownUp,
  FileText,
  Layers,
  LayoutGrid,
  LibraryBig,
  List,
  Presentation,
} from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { LibraryCard, type LibraryCardProps } from "@/components/library-card";
import { useLibraryShell } from "@/components/library-shell-context";
import type { NewDocumentValues } from "@/components/new-document-dialog";
import { SeriesCard, type SeriesCardProps } from "@/components/series-card";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useNow } from "@/hooks/use-now";
import { libraryMutations, libraryQueries, sortDocuments } from "@/lib/library";
import type { DocumentSummary, SeriesWithLessons } from "@/mocks/library-schema";

export type LibraryMode = "home" | "lesson" | "worksheet" | "series";

type Sort = "edited" | "created" | "title";
type View = "grid" | "list";

const TITLES: Record<LibraryMode, string> = {
  home: "Home",
  lesson: "Lessons",
  worksheet: "Worksheets",
  series: "Series",
};
const SORT_LABELS: Record<Sort, string> = {
  edited: "Edited",
  created: "Created",
  title: "Title A–Z",
};
const HOME_CARDS = 4;
const HOME_BANDS = 3;
const SPLIT_AT = 8;
const RECENT_MS = 7 * 24 * 60 * 60 * 1000;
const GRID = "grid grid-cols-2 gap-6 lg:grid-cols-3 xl:grid-cols-4";
const SKELETON_KEYS = ["one", "two", "three", "four"] as const;
const NewDocumentDialog = lazy(() =>
  import("./new-document-dialog").then(({ NewDocumentDialog }) => ({ default: NewDocumentDialog })),
);
const NewSeriesDialog = lazy(() =>
  import("./new-series-dialog").then(({ NewSeriesDialog }) => ({ default: NewSeriesDialog })),
);

function readPreference<T extends string>(key: string, values: readonly T[], fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return values.includes(value as T) ? (value as T) : fallback;
  } catch {
    return fallback;
  }
}

function subscribePreference(key: string, onChange: () => void): () => void {
  const event = `tj:${key}`;
  const onStorage = (storageEvent: StorageEvent) => {
    if (storageEvent.key === key) onChange();
  };
  window.addEventListener(event, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(event, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

function writePreference(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Preferences remain at their defaults when browser storage is disabled.
  }
  window.dispatchEvent(new Event(`tj:${key}`));
}

function usePreference<T extends string>(
  key: string,
  values: readonly T[],
  fallback: T,
): [T, (value: T) => void] {
  const value = useSyncExternalStore(
    (onChange) => subscribePreference(key, onChange),
    () => readPreference(key, values, fallback),
    () => fallback,
  );
  return [value, (next) => writePreference(key, next)];
}

function isRecent(updatedAt: string): boolean {
  return Date.now() - Date.parse(updatedAt) < RECENT_MS;
}

export function LibraryPage({ mode }: { mode: LibraryMode }) {
  useDocumentTitle(`${TITLES[mode]} · Teaching Journey`);
  const { openImport } = useLibraryShell();
  const documents = useQuery(libraryQueries.documents());
  const series = useQuery(libraryQueries.series());
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const now = useNow();
  const duplicateDocument = useMutation(libraryMutations.duplicateDocument(queryClient));
  const renameDocument = useMutation(libraryMutations.renameDocument(queryClient));
  const softDeleteDocument = useMutation(libraryMutations.softDeleteDocument(queryClient));
  const restoreDocument = useMutation(libraryMutations.restoreDocument(queryClient));
  const duplicateSeries = useMutation(libraryMutations.duplicateSeries(queryClient));
  const renameSeries = useMutation(libraryMutations.renameSeries(queryClient));
  const softDeleteSeries = useMutation(libraryMutations.softDeleteSeries(queryClient));
  const restoreSeries = useMutation(libraryMutations.restoreSeries(queryClient));
  const createDocument = useMutation(libraryMutations.createDocument(queryClient));
  const createSeries = useMutation(libraryMutations.createSeries(queryClient));
  const [newKind, setNewKind] = useState<"lesson" | "worksheet" | null>(null);
  const [newSeries, setNewSeries] = useState(false);
  const search = useRouterState({ select: (state) => state.location.search });
  const query = typeof search.q === "string" ? search.q : "";
  const [sort, setSort] = usePreference<Sort>(
    "tj:library:sort",
    ["edited", "created", "title"],
    "edited",
  );
  const [view, setView] = usePreference<View>("tj:library:view", ["grid", "list"], "grid");
  const searchRef = useRef<HTMLInputElement>(null);
  const isHome = mode === "home";
  const isSeries = mode === "series";
  const kind = mode === "lesson" || mode === "worksheet" ? mode : undefined;
  const allDocuments = documents.data ?? [];
  const allSeries = series.data ?? [];
  const kindDocuments = useMemo(
    () => (kind ? allDocuments.filter((document) => document.kind === kind) : allDocuments),
    [allDocuments, kind],
  );
  const matchedDocuments = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return sortDocuments(
      kindDocuments.filter(
        (document) => !normalized || document.title.toLowerCase().includes(normalized),
      ),
      sort,
    );
  }, [kindDocuments, query, sort]);
  const matchedSeries = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const matches = allSeries.filter(
      (item) => !normalized || item.series.title.toLowerCase().includes(normalized),
    );
    const byId = new Map(matches.map((item) => [item.series.id, item]));
    return sortDocuments(
      matches.map((item) => item.series),
      sort,
    ).flatMap((entry) => {
      const item = byId.get(entry.id);
      return item ? [item] : [];
    });
  }, [allSeries, query, sort]);
  const sortedDocuments = useMemo(() => sortDocuments(allDocuments, sort), [allDocuments, sort]);
  const lessons = sortedDocuments.filter((document) => document.kind === "lesson");
  const worksheets = sortedDocuments.filter((document) => document.kind === "worksheet");
  const recent = useMemo(() => sortDocuments(allDocuments, "edited"), [allDocuments]);
  const hero = recent.find((document) => document.kind === "lesson");
  const beside = recent.filter((document) => document.id !== hero?.id).slice(0, hero ? 2 : 4);
  const splitRecent = matchedDocuments.filter((document) => isRecent(document.updatedAt));
  const splitEarlier = matchedDocuments.filter((document) => !isRecent(document.updatedAt));
  const split =
    !isHome &&
    !isSeries &&
    matchedDocuments.length > SPLIT_AT &&
    splitRecent.length > 0 &&
    splitEarlier.length > 0;
  const loading = documents.isPending || series.isPending;
  const error = documents.isError || series.isError;
  const empty = isSeries ? matchedSeries.length === 0 : matchedDocuments.length === 0;
  const searching = query.trim().length > 0;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey)
        return;
      const target = event.target as HTMLElement | null;
      if (
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable
      )
        return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  function setSearch(next: string): void {
    const search = next ? { q: next } : {};
    if (mode === "lesson") void navigate({ to: "/lessons", search, replace: true });
    if (mode === "worksheet") void navigate({ to: "/worksheets", search, replace: true });
    if (mode === "series") void navigate({ to: "/series", search, replace: true });
  }

  async function createNewDocument(values: NewDocumentValues): Promise<void> {
    if (!newKind) return;
    const document = await createDocument.mutateAsync({ kind: newKind, ...values });
    setNewKind(null);
    if (document.kind === "lesson") {
      await navigate({ to: "/l/$lessonId", params: { lessonId: document.id } });
    } else {
      await navigate({ to: "/w/$worksheetId", params: { worksheetId: document.id } });
    }
  }

  async function createNewSeries(title: string): Promise<void> {
    const series = await createSeries.mutateAsync([title]);
    setNewSeries(false);
    await navigate({ to: "/series/$seriesId", params: { seriesId: series.id } });
  }

  function openEmptyStateCreation(): void {
    if (mode === "series") setNewSeries(true);
    else setNewKind(mode === "worksheet" ? "worksheet" : "lesson");
  }

  function onDocumentAction(
    action: Parameters<LibraryCardProps["onAction"]>[0],
    doc: DocumentSummary,
  ): void {
    if (action === "open") {
      if (doc.kind === "lesson")
        void navigate({ to: "/l/$lessonId", params: { lessonId: doc.id } });
      else void navigate({ to: "/w/$worksheetId", params: { worksheetId: doc.id } });
      return;
    }
    if (action === "present") {
      void navigate({ to: "/l/$lessonId/present", params: { lessonId: doc.id } });
      return;
    }
    if (action === "duplicate") {
      duplicateDocument.mutate([doc.id], { onSuccess: () => toast(`Duplicated “${doc.title}”`) });
      return;
    }
    if (action === "delete") {
      softDeleteDocument.mutate(doc.id, {
        onSuccess: () =>
          toast(`Deleted “${doc.title}”`, {
            duration: 6000,
            action: { label: "Undo", onClick: () => restoreDocument.mutate(doc.id) },
          }),
      });
    }
  }

  function onSeriesAction(
    action: Parameters<SeriesCardProps["onAction"]>[0],
    item: SeriesWithLessons,
  ): void {
    if (action === "present") {
      const firstLesson = item.lessons[0];
      if (firstLesson) {
        void navigate({
          to: "/l/$lessonId/present",
          params: { lessonId: firstLesson.id },
          search: { series: item.series.id },
        });
      }
      return;
    }
    if (action === "duplicate") {
      duplicateSeries.mutate([item.series.id], {
        onSuccess: () => toast(`Duplicated “${item.series.title}”`),
      });
      return;
    }
    softDeleteSeries.mutate(item.series.id, {
      onSuccess: () =>
        toast(`Deleted “${item.series.title}”`, {
          duration: 6000,
          action: { label: "Undo", onClick: () => restoreSeries.mutate(item.series.id) },
        }),
    });
  }

  const documentCardProps = {
    now,
    onAction: onDocumentAction,
    onRename: (doc: DocumentSummary, title: string) => renameDocument.mutate([doc.id, title]),
  };
  const seriesCardProps = {
    now,
    onAction: onSeriesAction,
    onRename: (item: SeriesWithLessons, title: string) =>
      renameSeries.mutate([item.series.id, title]),
  };

  const titleCount = isSeries ? allSeries.length : kindDocuments.length;

  return (
    <main className="min-h-dvh px-6 py-8 lg:px-12">
      <div className="flex min-h-9 flex-wrap items-center justify-between gap-4">
        <div className="flex items-baseline gap-3">
          <Display as="h1" size="lg">
            {TITLES[mode]}
          </Display>
          {!isHome && !loading ? <span className="text-meta text-ink-3">{titleCount}</span> : null}
        </div>
        {!isHome && !error ? (
          <div className="flex flex-wrap items-center gap-2">
            <SearchInput
              ref={searchRef}
              label="Search by title"
              placeholder="Search titles"
              value={query}
              onChange={(event) => setSearch(event.target.value)}
              onClear={() => setSearch("")}
              width={320}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <ArrowDownUp aria-hidden size={16} strokeWidth={1.5} />
                  Sort: {SORT_LABELS[sort]}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuRadioGroup
                  value={sort}
                  onValueChange={(value) => setSort(value as Sort)}
                >
                  <DropdownMenuRadioItem value="edited">Edited</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="created">Created</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="title">Title A–Z</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            {isSeries ? null : (
              <IconGroup aria-label="View">
                <IconButton
                  label="Grid"
                  size="sm"
                  active={view === "grid"}
                  onClick={() => setView("grid")}
                >
                  <LayoutGrid aria-hidden size={16} strokeWidth={1.5} />
                </IconButton>
                <IconButton
                  label="List"
                  size="sm"
                  active={view === "list"}
                  onClick={() => setView("list")}
                >
                  <List aria-hidden size={16} strokeWidth={1.5} />
                </IconButton>
              </IconGroup>
            )}
          </div>
        ) : null}
      </div>

      {isHome && !error ? (
        <div className={`${GRID} mt-6`}>
          <Tile
            tone="primary"
            icon={<Presentation size={24} strokeWidth={1.5} />}
            className="col-span-2"
            onClick={() => setNewKind("lesson")}
          >
            New lesson
          </Tile>
          <Tile
            icon={<FileText size={24} strokeWidth={1.5} />}
            onClick={() => setNewKind("worksheet")}
          >
            New worksheet
          </Tile>
          <Tile icon={<Layers size={24} strokeWidth={1.5} />} onClick={() => setNewSeries(true)}>
            New series
          </Tile>
        </div>
      ) : null}

      <div className="mt-8">
        {error ? (
          <EmptyState
            icon={<LibraryBig strokeWidth={1.5} />}
            title="Your library could not be loaded"
            action={
              <Button onClick={() => void Promise.all([documents.refetch(), series.refetch()])}>
                Retry
              </Button>
            }
          />
        ) : loading ? (
          <SkeletonGrid />
        ) : isHome && allDocuments.length + allSeries.length === 0 ? (
          <EmptyLibrary mode={mode} onCreate={openEmptyStateCreation} onImport={openImport} />
        ) : isHome ? (
          <>
            {hero || beside.length > 0 ? (
              <section className="mb-8" aria-label="Recent">
                <SectionHeading className="mb-4">Recent</SectionHeading>
                {hero ? (
                  <div className={GRID}>
                    <LibraryCard doc={hero} hero className="col-span-2" {...documentCardProps} />
                    {beside.map((document) => (
                      <LibraryCard key={document.id} doc={document} {...documentCardProps} />
                    ))}
                  </div>
                ) : (
                  <DocumentGrid documents={beside} {...documentCardProps} />
                )}
              </section>
            ) : null}
            <HomeSection title="Lessons" count={lessons.length} to="/lessons">
              <DocumentGrid documents={lessons.slice(0, HOME_CARDS)} {...documentCardProps} />
            </HomeSection>
            <HomeSection title="Worksheets" count={worksheets.length} to="/worksheets">
              <DocumentGrid documents={worksheets.slice(0, HOME_CARDS)} {...documentCardProps} />
            </HomeSection>
            <HomeSection title="Series" count={allSeries.length} to="/series">
              <SeriesGrid
                series={matchedSeries.slice(0, HOME_BANDS)}
                headingLevel="h3"
                {...seriesCardProps}
              />
            </HomeSection>
          </>
        ) : empty ? (
          searching ? (
            <NoMatches onClear={() => setSearch("")} />
          ) : (
            <EmptyLibrary mode={mode} onCreate={openEmptyStateCreation} onImport={openImport} />
          )
        ) : isSeries ? (
          <SeriesGrid series={matchedSeries} {...seriesCardProps} />
        ) : split ? (
          <>
            <section className="mb-8">
              <SectionHeading className="mb-4" count={splitRecent.length}>
                Recent
              </SectionHeading>
              <DocumentResults
                documents={splitRecent}
                view={view}
                label="Recent"
                {...documentCardProps}
              />
            </section>
            <section>
              <SectionHeading className="mb-4" count={splitEarlier.length}>
                Earlier
              </SectionHeading>
              <DocumentResults
                documents={splitEarlier}
                view={view}
                label="Earlier"
                {...documentCardProps}
              />
            </section>
          </>
        ) : view === "list" ? (
          <DocumentResults
            documents={matchedDocuments}
            view={view}
            label={TITLES[mode]}
            {...documentCardProps}
          />
        ) : (
          <DocumentGrid documents={matchedDocuments} {...documentCardProps} />
        )}
      </div>
      <Suspense fallback={null}>
        {newKind ? (
          <NewDocumentDialog
            open
            onOpenChange={(open) => {
              if (!open) setNewKind(null);
            }}
            kind={newKind}
            onCreate={createNewDocument}
          />
        ) : null}
        {newSeries ? (
          <NewSeriesDialog open onOpenChange={setNewSeries} onCreate={createNewSeries} />
        ) : null}
      </Suspense>
    </main>
  );
}

function HomeSection({
  title,
  count,
  to,
  children,
}: {
  title: string;
  count: number;
  to: "/lessons" | "/worksheets" | "/series";
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <section className="mb-8">
      <SectionHeading
        className="mb-4"
        count={count}
        action={
          <Link to={to} className="text-sm font-medium text-brand-text hover:underline">
            See all
          </Link>
        }
      >
        {title}
      </SectionHeading>
      {children}
    </section>
  );
}

type DocumentCardCallbacks = Pick<LibraryCardProps, "now" | "onAction" | "onRename">;
type SeriesCardCallbacks = Pick<SeriesCardProps, "now" | "onAction" | "onRename">;

function DocumentGrid({
  documents,
  ...cardProps
}: { documents: DocumentSummary[] } & DocumentCardCallbacks) {
  // The reference fixed four columns; this responsive grid keeps the same density on wide screens.
  return (
    <div className={GRID}>
      {documents.map((document) => (
        <LibraryCard key={document.id} doc={document} {...cardProps} />
      ))}
    </div>
  );
}

function DocumentResults({
  documents,
  view,
  label,
  ...cardProps
}: {
  documents: DocumentSummary[];
  view: View;
  label: string;
} & DocumentCardCallbacks) {
  if (view === "grid") return <DocumentGrid documents={documents} {...cardProps} />;
  return (
    <ListSurface
      aria-label={label}
      header={
        <ListSurfaceHeader>
          <ListSurfaceCell header className="w-16">
            Thumbnail
          </ListSurfaceCell>
          <ListSurfaceCell header>Title</ListSurfaceCell>
          <ListSurfaceCell header className="w-32">
            Year and subject
          </ListSurfaceCell>
          <ListSurfaceCell header className="w-[152px]">
            Size
          </ListSurfaceCell>
          <ListSurfaceCell header className="w-24">
            Edited
          </ListSurfaceCell>
          <ListSurfaceCell header className="w-[104px] text-right">
            Actions
          </ListSurfaceCell>
        </ListSurfaceHeader>
      }
    >
      {documents.map((document) => (
        <LibraryCard key={document.id} doc={document} view="list" {...cardProps} />
      ))}
    </ListSurface>
  );
}

function SeriesGrid({
  series,
  headingLevel = "h2",
  ...cardProps
}: {
  series: SeriesWithLessons[];
  headingLevel?: "h2" | "h3";
} & SeriesCardCallbacks) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {series.map((item) => (
        <SeriesCard key={item.series.id} item={item} headingLevel={headingLevel} {...cardProps} />
      ))}
    </div>
  );
}

function EmptyLibrary({
  mode,
  onCreate,
  onImport,
}: {
  mode: LibraryMode;
  onCreate: () => void;
  onImport: () => void;
}) {
  const series = mode === "series";
  return (
    <EmptyState
      stacked
      icon={series ? <Layers strokeWidth={1.5} /> : <LibraryBig strokeWidth={1.5} />}
      title={series ? "No series yet" : "Nothing here yet"}
      body={
        series
          ? "A series is a set of lessons in teaching order."
          : "Make a lesson or a worksheet. Everything you make is saved in your Workspace. If you made one somewhere else, import its file."
      }
      action={
        <Button onClick={onCreate}>
          {series ? "New series" : mode === "worksheet" ? "New worksheet" : "New lesson"}
        </Button>
      }
      secondaryAction={
        <Button variant="ghost" onClick={onImport}>
          Import
        </Button>
      }
    />
  );
}

function NoMatches({ onClear }: { onClear: () => void }) {
  return (
    <EmptyState
      title="No titles match that"
      action={<Button onClick={onClear}>Clear search</Button>}
    />
  );
}

function SkeletonGrid() {
  return (
    <div className={GRID} aria-busy="true">
      {SKELETON_KEYS.map((key) => (
        <Card key={key} className="gap-3 overflow-hidden p-0">
          <Skeleton className="aspect-video w-full" />
          <div className="space-y-2 p-4">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-5/6" />
          </div>
        </Card>
      ))}
    </div>
  );
}
