import { useQuery } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
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
import { useNow } from "@/hooks/use-now";
import { useSlashToFocus } from "@/hooks/use-slash-to-focus";
import { libraryQueries } from "@/lib/library";
import { usePreference } from "@/lib/use-preference";
import {
  EMPTY_DOCUMENTS,
  EMPTY_SERIES,
  HOME_BANDS,
  homeShelves,
  kindShelf,
  type LibraryMode,
  SORT_LABELS,
  SORTS,
  type Sort,
  seriesShelf,
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
import { useLibraryActions } from "./library/use-library-actions";

export type { LibraryMode } from "./library/library-model";

const NewDocumentDialog = lazy(() =>
  import("./new-document-dialog").then(({ NewDocumentDialog }) => ({ default: NewDocumentDialog })),
);
const NewSeriesDialog = lazy(() =>
  import("./new-series-dialog").then(({ NewSeriesDialog }) => ({ default: NewSeriesDialog })),
);

const LESSON_TILE_ICON = <Presentation size={24} strokeWidth={1.5} />;
const WORKSHEET_TILE_ICON = <FileText size={24} strokeWidth={1.5} />;
const SERIES_TILE_ICON = <Layers size={24} strokeWidth={1.5} />;
const SORT_ICON = <ArrowDownUp aria-hidden size={16} strokeWidth={1.5} />;
const GRID_ICON = <LayoutGrid aria-hidden size={16} strokeWidth={1.5} />;
const LIST_ICON = <List aria-hidden size={16} strokeWidth={1.5} />;

type CreateTarget = "lesson" | "worksheet" | "series" | null;

export function LibraryPage({ mode }: { mode: LibraryMode }) {
  const isHome = mode === "home";
  const isSeries = mode === "series";
  const kind = mode === "lesson" || mode === "worksheet" ? mode : null;

  const { openImport } = useLibraryShell();
  const actions = useLibraryActions();
  const navigate = useNavigate();
  const now = useNow();
  // Subscribe to the string, not the search object: a new object arrives on every navigation.
  const query = useRouterState({
    select: (state) => (typeof state.location.search.q === "string" ? state.location.search.q : ""),
  });
  const [sort, setSort] = usePreference<Sort>("tj:library:sort", SORTS, "edited");
  const [view, setView] = usePreference<View>("tj:library:view", VIEWS, "grid");
  const [creating, setCreating] = useState<CreateTarget>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  useSlashToFocus(searchRef);

  const documentsQuery = useQuery(libraryQueries.documents());
  const seriesQuery = useQuery(libraryQueries.series());
  // Stable empties keep the memos below from recomputing while a query is pending.
  const documents = documentsQuery.data ?? EMPTY_DOCUMENTS;
  const series = seriesQuery.data ?? EMPTY_SERIES;

  const home = useMemo(
    () => (isHome ? homeShelves(documents, sort) : null),
    [isHome, documents, sort],
  );
  const shelf = useMemo(
    () => (kind ? kindShelf(documents, kind, query, sort) : EMPTY_DOCUMENTS),
    [documents, kind, query, sort],
  );
  const seriesItems = useMemo(
    () => (isSeries || isHome ? seriesShelf(series, isHome ? "" : query, sort) : EMPTY_SERIES),
    [series, isSeries, isHome, query, sort],
  );
  const split = useMemo(() => (kind ? splitByRecency(shelf, now) : null), [kind, shelf, now]);

  const loading = documentsQuery.isPending || seriesQuery.isPending;
  const failed = documentsQuery.isError || seriesQuery.isError;
  const searching = query.trim().length > 0;
  const empty = isSeries ? seriesItems.length === 0 : shelf.length === 0;
  const titleCount = isSeries ? series.length : kind ? countKind(documents, kind) : 0;

  const documentCardProps = {
    now,
    onAction: actions.onDocumentAction,
    onRename: actions.onDocumentRename,
  };
  const seriesCardProps = {
    now,
    onAction: actions.onSeriesAction,
    onRename: actions.onSeriesRename,
  };

  function setSearch(next: string): void {
    if (!kind && !isSeries) return;
    const to = mode === "lesson" ? "/lessons" : mode === "worksheet" ? "/worksheets" : "/series";
    void navigate({ to, search: next ? { q: next } : {}, replace: true });
  }

  function retry(): void {
    void Promise.all([documentsQuery.refetch(), seriesQuery.refetch()]);
  }

  function openCreate(): void {
    setCreating(isSeries ? "series" : (kind ?? "lesson"));
  }

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
            onClick={() => setCreating("lesson")}
          >
            New lesson
          </Tile>
          <Tile icon={WORKSHEET_TILE_ICON} onClick={() => setCreating("worksheet")}>
            New worksheet
          </Tile>
          <Tile icon={SERIES_TILE_ICON} onClick={() => setCreating("series")}>
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
          documents.length + series.length === 0 ? (
            <EmptyLibrary mode={mode} onCreate={openCreate} onImport={openImport} />
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
                  series={seriesItems.slice(0, HOME_BANDS)}
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
            <EmptyLibrary mode={mode} onCreate={openCreate} onImport={openImport} />
          )
        ) : isSeries ? (
          <SeriesGrid series={seriesItems} {...seriesCardProps} />
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
      </div>

      {/* Mounted only while open, so each dialog starts from fresh state without a reset effect. */}
      <Suspense fallback={null}>
        {creating === "lesson" || creating === "worksheet" ? (
          <NewDocumentDialog
            open
            kind={creating}
            onOpenChange={(open) => {
              if (!open) setCreating(null);
            }}
            onCreate={(values) => actions.createNewDocument(creating, values)}
          />
        ) : null}
        {creating === "series" ? (
          <NewSeriesDialog
            open
            onOpenChange={(open) => {
              if (!open) setCreating(null);
            }}
            onCreate={actions.createNewSeries}
          />
        ) : null}
      </Suspense>
    </main>
  );
}

function countKind(documents: readonly { kind: string }[], kind: string): number {
  let count = 0;
  for (const document of documents) if (document.kind === kind) count += 1;
  return count;
}
