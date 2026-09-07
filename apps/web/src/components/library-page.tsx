import { useInfiniteQuery } from "@tanstack/react-query";
import { useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import {
  Button,
  Display,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  IconButton,
  IconGroup,
  SearchInput,
  SectionHeading,
  Tile,
} from "@tj/ui";
import { ArrowDownUp, FileText, Layers, LayoutGrid, List, Presentation } from "lucide-react";
import { lazy, Suspense, useMemo, useRef, useState } from "react";
import { LibraryCard } from "@/components/library-card";
import { useLibraryShell } from "@/components/library-shell-context";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useNow } from "@/hooks/use-now";
import { useSlashToFocus } from "@/hooks/use-slash-to-focus";
import { libraryQueries, librarySelectors } from "@/lib/library";
import { usePreference } from "@/lib/use-preference";
import {
  EMPTY_DOCUMENTS,
  EMPTY_SERIES,
  HOME_BANDS,
  homeShelves,
  type LibraryMode,
  SEARCH_DEBOUNCE_MS,
  SORT_LABELS,
  SORTS,
  type Sort,
  splitByRecency,
  TITLES,
  VIEWS,
  type View,
} from "./library/library-model";
import {
  DocumentGrid,
  DocumentResults,
  EmptyLibrary,
  GRID,
  HomeSection,
  LoadFailed,
  NoMatches,
  SeriesGrid,
  SkeletonGrid,
} from "./library/library-sections";
import { LoadMore } from "./library/load-more";
import { useLibraryActions } from "./library/use-library-actions";

export type { LibraryMode } from "./library/library-model";

// One import promise per chunk: `lazy` and the hover/focus preload below share it, so warming the
// chunk on intent makes the first open instant instead of a Suspense gap (bundle-preload). A failed
// warm-up is silent; the click still goes through `lazy`, whose failure reaches the error boundary.
const loadNewDocumentDialog = () => import("./new-document-dialog");
const loadNewSeriesDialog = () => import("./new-series-dialog");
const warmNewDocumentDialog = () => void loadNewDocumentDialog().catch(() => {});
const warmNewSeriesDialog = () => void loadNewSeriesDialog().catch(() => {});
const NewDocumentDialog = lazy(() =>
  loadNewDocumentDialog().then(({ NewDocumentDialog }) => ({ default: NewDocumentDialog })),
);
const NewSeriesDialog = lazy(() =>
  loadNewSeriesDialog().then(({ NewSeriesDialog }) => ({ default: NewSeriesDialog })),
);

const LESSON_TILE_ICON = <Presentation size={24} strokeWidth={1.5} />;
const WORKSHEET_TILE_ICON = <FileText size={24} strokeWidth={1.5} />;
const SERIES_TILE_ICON = <Layers size={24} strokeWidth={1.5} />;
const SORT_ICON = <ArrowDownUp aria-hidden size={16} strokeWidth={1.5} />;
const GRID_ICON = <LayoutGrid aria-hidden size={16} strokeWidth={1.5} />;
const LIST_ICON = <List aria-hidden size={16} strokeWidth={1.5} />;

type CreateTarget = "lesson" | "worksheet" | "series";

/**
 * Which create dialog is showing. `target` survives `open: false` so the dialog can play its exit
 * animation with the right copy; `session` bumps on every open and is the dialog's `key`, which
 * remounts it with fresh form state without a reset effect. Neither dialog is mounted (or its
 * chunk requested) before the first open.
 */
type CreateState = { target: CreateTarget; open: boolean; session: number };
const CREATE_IDLE: CreateState = { target: "lesson", open: false, session: 0 };

export function LibraryPage({ mode }: { mode: LibraryMode }) {
  const isHome = mode === "home";
  const isSeries = mode === "series";
  const kind = mode === "lesson" || mode === "worksheet" ? mode : null;

  const { openImport } = useLibraryShell();
  const actions = useLibraryActions();
  const navigate = useNavigate();
  const router = useRouter();
  // The brief is its own chunk: warm it on intent so the click is instant (bundle-preload), the
  // way the dialogs are warmed below. A failed warm-up is silent; the navigation still loads it.
  const warmBrief = () => void router.preloadRoute({ to: "/lessons/new" }).catch(() => {});
  // The page reads the clock for the Recent / Earlier split; cards read it in `EditedTime`.
  const now = useNow();
  // Subscribe to the string, not the search object: a new object arrives on every navigation.
  const query = useRouterState({
    select: (state) => (typeof state.location.search.q === "string" ? state.location.search.q : ""),
  });
  const [sort, setSort] = usePreference<Sort>("tj:library:sort", SORTS, "edited");
  const [view, setView] = usePreference<View>("tj:library:view", VIEWS, "grid");
  const [creating, setCreating] = useState<CreateState>(CREATE_IDLE);
  const searchRef = useRef<HTMLInputElement>(null);
  useSlashToFocus(searchRef);

  // Every list is one server query per kind (ADR 0024 §17): Home reads the first page of each,
  // a kind page pages through its own with the search term after the debounce.
  const q = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);
  const lessonsQuery = useInfiniteQuery({
    ...libraryQueries.documents("lesson", { sort, q: isHome ? "" : q }),
    select: librarySelectors.items,
    enabled: isHome || kind === "lesson",
  });
  const worksheetsQuery = useInfiniteQuery({
    ...libraryQueries.documents("worksheet", { sort, q: isHome ? "" : q }),
    select: librarySelectors.items,
    enabled: isHome || kind === "worksheet",
  });
  const seriesQuery = useInfiniteQuery({
    ...libraryQueries.series({ sort, q: isHome ? "" : q }),
    select: librarySelectors.items,
    enabled: isHome || isSeries,
  });
  const kindQuery = kind === "worksheet" ? worksheetsQuery : lessonsQuery;
  const pagedQuery = isSeries ? seriesQuery : kindQuery;
  // Stable empties keep the memos below from recomputing while a query is pending.
  const lessons = lessonsQuery.data ?? EMPTY_DOCUMENTS;
  const worksheets = worksheetsQuery.data ?? EMPTY_DOCUMENTS;
  const series = seriesQuery.data ?? EMPTY_SERIES;
  const shelf = kind ? (kindQuery.data ?? EMPTY_DOCUMENTS) : EMPTY_DOCUMENTS;

  const home = useMemo(
    () => (isHome ? homeShelves(lessons, worksheets) : null),
    [isHome, lessons, worksheets],
  );
  const split = useMemo(() => (kind ? splitByRecency(shelf, now) : null), [kind, shelf, now]);

  const active = isHome ? [lessonsQuery, worksheetsQuery, seriesQuery] : [pagedQuery];
  const loading = active.some((entry) => entry.isPending);
  const failed = active.some((entry) => entry.isError);
  const searching = query.trim().length > 0;
  const empty = isSeries ? series.length === 0 : shelf.length === 0;
  const titleCount = isSeries ? series.length : shelf.length;

  const documentCardProps = {
    onAction: actions.onDocumentAction,
    onRename: actions.onDocumentRename,
  };
  const seriesCardProps = {
    onAction: actions.onSeriesAction,
    onRename: actions.onSeriesRename,
  };

  function setSearch(next: string): void {
    if (!kind && !isSeries) return;
    const to = mode === "lesson" ? "/lessons" : mode === "worksheet" ? "/worksheets" : "/series";
    void navigate({ to, search: next ? { q: next } : {}, replace: true });
  }

  function retry(): void {
    void Promise.all(active.map((entry) => entry.refetch()));
  }

  /** New lesson is the brief screen (F01, TEACH-122); worksheets and series keep their dialogs. */
  function openCreate(target: CreateTarget = isSeries ? "series" : (kind ?? "lesson")): void {
    if (target === "lesson") {
      void navigate({ to: "/lessons/new" });
      return;
    }
    setCreating((current) => ({ target, open: true, session: current.session + 1 }));
  }

  function closeCreate(open: boolean): void {
    if (!open) setCreating((current) => ({ ...current, open: false }));
  }

  const createTarget = creating.target;
  const documentDialogTarget = createTarget === "series" ? null : createTarget;

  return (
    <main className="min-h-dvh px-6 py-8 lg:px-12">
      <div className="flex min-h-9 flex-wrap items-center justify-between gap-4">
        <div className="flex items-baseline gap-3">
          <Display as="h1" size="lg">
            {TITLES[mode]}
          </Display>
          {!isHome && !loading ? <span className="text-meta text-ink-3">{titleCount}</span> : null}
        </div>
        {!isHome && !failed ? (
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
                  {SORT_ICON}
                  Sort: {SORT_LABELS[sort]}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuRadioGroup
                  value={sort}
                  onValueChange={(value) => setSort(value as Sort)}
                >
                  {SORTS.map((value) => (
                    <DropdownMenuRadioItem key={value} value={value}>
                      {SORT_LABELS[value]}
                    </DropdownMenuRadioItem>
                  ))}
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
                  {GRID_ICON}
                </IconButton>
                <IconButton
                  label="List"
                  size="sm"
                  active={view === "list"}
                  onClick={() => setView("list")}
                >
                  {LIST_ICON}
                </IconButton>
              </IconGroup>
            )}
          </div>
        ) : null}
      </div>

      {isHome && !failed ? (
        <div className={`${GRID} mt-6`}>
          <Tile
            tone="primary"
            icon={LESSON_TILE_ICON}
            className="col-span-2"
            onPointerEnter={warmBrief}
            onFocus={warmBrief}
            onClick={() => openCreate("lesson")}
          >
            New lesson
          </Tile>
          <Tile
            icon={WORKSHEET_TILE_ICON}
            onPointerEnter={warmNewDocumentDialog}
            onFocus={warmNewDocumentDialog}
            onClick={() => openCreate("worksheet")}
          >
            New worksheet
          </Tile>
          <Tile
            icon={SERIES_TILE_ICON}
            onPointerEnter={warmNewSeriesDialog}
            onFocus={warmNewSeriesDialog}
            onClick={() => openCreate("series")}
          >
            New series
          </Tile>
        </div>
      ) : null}

      <div className="mt-8">
        {failed ? (
          <LoadFailed onRetry={retry} />
        ) : loading ? (
          <SkeletonGrid />
        ) : home ? (
          lessons.length + worksheets.length + series.length === 0 ? (
            <EmptyLibrary mode={mode} onCreate={() => openCreate()} onImport={openImport} />
          ) : (
            <>
              {home.hero || home.beside.length > 0 ? (
                <section className="mb-8" aria-label="Recent">
                  <SectionHeading className="mb-4">Recent</SectionHeading>
                  {home.hero ? (
                    <div className={GRID}>
                      <LibraryCard doc={home.hero} hero {...documentCardProps} />
                      {home.beside.map((document) => (
                        <LibraryCard key={document.id} doc={document} {...documentCardProps} />
                      ))}
                    </div>
                  ) : (
                    <DocumentGrid documents={home.beside} {...documentCardProps} />
                  )}
                </section>
              ) : null}
              <HomeSection title="Lessons" count={home.lessonCount} to="/lessons">
                <DocumentGrid documents={home.lessons} {...documentCardProps} />
              </HomeSection>
              <HomeSection title="Worksheets" count={home.worksheetCount} to="/worksheets">
                <DocumentGrid documents={home.worksheets} {...documentCardProps} />
              </HomeSection>
              <HomeSection title="Series" count={series.length} to="/series">
                <SeriesGrid
                  series={series.slice(0, HOME_BANDS)}
                  headingLevel="h3"
                  {...seriesCardProps}
                />
              </HomeSection>
            </>
          )
        ) : empty ? (
          searching ? (
            <NoMatches onClear={() => setSearch("")} />
          ) : (
            <EmptyLibrary mode={mode} onCreate={() => openCreate()} onImport={openImport} />
          )
        ) : isSeries ? (
          <SeriesGrid series={series} {...seriesCardProps} />
        ) : split ? (
          <>
            <section className="mb-8">
              <SectionHeading className="mb-4" count={split.recent.length}>
                Recent
              </SectionHeading>
              <DocumentResults
                documents={split.recent}
                view={view}
                label="Recent"
                {...documentCardProps}
              />
            </section>
            <section>
              <SectionHeading className="mb-4" count={split.earlier.length}>
                Earlier
              </SectionHeading>
              <DocumentResults
                documents={split.earlier}
                view={view}
                label="Earlier"
                {...documentCardProps}
              />
            </section>
          </>
        ) : (
          <DocumentResults
            documents={shelf}
            view={view}
            label={TITLES[mode]}
            {...documentCardProps}
          />
        )}
        {!isHome && !failed && !loading ? (
          <LoadMore
            hasNextPage={pagedQuery.hasNextPage}
            isFetchingNextPage={pagedQuery.isFetchingNextPage}
            onLoadMore={() => void pagedQuery.fetchNextPage()}
          />
        ) : null}
      </div>

      {/*
        Mounted from the first open onwards and remounted through `key` on every open, so each
        dialog starts from fresh state and still stays in the tree while its close animation plays.
      */}
      <Suspense fallback={null}>
        {creating.session > 0 && documentDialogTarget ? (
          <NewDocumentDialog
            key={creating.session}
            open={creating.open}
            kind={documentDialogTarget}
            onOpenChange={closeCreate}
            onCreate={(values) => actions.createNewDocument(documentDialogTarget, values)}
          />
        ) : null}
        {creating.session > 0 && createTarget === "series" ? (
          <NewSeriesDialog
            key={creating.session}
            open={creating.open}
            onOpenChange={closeCreate}
            onCreate={actions.createNewSeries}
          />
        ) : null}
      </Suspense>
    </main>
  );
}
