import { useQuery } from "@tanstack/react-query";
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
  SearchInput,
  SectionHeading,
  Skeleton,
  Stack,
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
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { libraryQueries, sortDocuments } from "@/lib/library";
import { LIBRARY_THEMES } from "@/mocks/library-fixtures";
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
const FALLBACK_THEME = { swatch: "#F2EFE8", ink: "#1F2328" };
const SKELETON_KEYS = ["one", "two", "three", "four"] as const;

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

function documentHref(document: DocumentSummary): "/l/$lessonId" | "/w/$worksheetId" {
  return document.kind === "lesson" ? "/l/$lessonId" : "/w/$worksheetId";
}

function themeFor(themeId: string): { swatch: string; ink: string } {
  return LIBRARY_THEMES.find((theme) => theme.id === themeId) ?? FALLBACK_THEME;
}

function isRecent(updatedAt: string): boolean {
  return Date.now() - Date.parse(updatedAt) < RECENT_MS;
}

export function LibraryPage({ mode }: { mode: LibraryMode }) {
  useDocumentTitle(`${TITLES[mode]} · Teaching Journey`);
  const documents = useQuery(libraryQueries.documents());
  const series = useQuery(libraryQueries.series());
  const navigate = useNavigate();
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
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
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

  function announceCreation(): void {
    toast("Creation dialogs arrive in the next ticket");
  }

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
            onClick={announceCreation}
          >
            New lesson
          </Tile>
          <Tile icon={<FileText size={24} strokeWidth={1.5} />} onClick={announceCreation}>
            New worksheet
          </Tile>
          <Tile icon={<Layers size={24} strokeWidth={1.5} />} onClick={announceCreation}>
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
          <EmptyLibrary mode={mode} onCreate={announceCreation} />
        ) : isHome ? (
          <>
            {hero || beside.length > 0 ? (
              <section className="mb-8">
                <SectionHeading className="mb-4">Recent</SectionHeading>
                {hero ? (
                  <div className={GRID}>
                    <DocumentCard document={hero} className="col-span-2" />
                    {beside.map((document) => (
                      <DocumentCard key={document.id} document={document} />
                    ))}
                  </div>
                ) : (
                  <DocumentGrid documents={beside} />
                )}
              </section>
            ) : null}
            <HomeSection title="Lessons" count={lessons.length} to="/lessons">
              <DocumentGrid documents={lessons.slice(0, HOME_CARDS)} />
            </HomeSection>
            <HomeSection title="Worksheets" count={worksheets.length} to="/worksheets">
              <DocumentGrid documents={worksheets.slice(0, HOME_CARDS)} />
            </HomeSection>
            <HomeSection title="Series" count={allSeries.length} to="/series">
              <SeriesGrid series={matchedSeries.slice(0, HOME_BANDS)} headingLevel="h3" />
            </HomeSection>
          </>
        ) : empty ? (
          searching ? (
            <NoMatches onClear={() => setSearch("")} />
          ) : (
            <EmptyLibrary mode={mode} onCreate={announceCreation} />
          )
        ) : isSeries ? (
          <SeriesGrid series={matchedSeries} />
        ) : split ? (
          <>
            <section className="mb-8">
              <SectionHeading className="mb-4" count={splitRecent.length}>
                Recent
              </SectionHeading>
              <DocumentResults documents={splitRecent} view={view} label="Recent" />
            </section>
            <section>
              <SectionHeading className="mb-4" count={splitEarlier.length}>
                Earlier
              </SectionHeading>
              <DocumentResults documents={splitEarlier} view={view} label="Earlier" />
            </section>
          </>
        ) : view === "list" ? (
          <DocumentResults documents={matchedDocuments} view={view} label={TITLES[mode]} />
        ) : (
          <DocumentGrid documents={matchedDocuments} />
        )}
      </div>
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

function DocumentGrid({ documents }: { documents: DocumentSummary[] }) {
  // The reference fixed four columns; this responsive grid keeps the same density on wide screens.
  return (
    <div className={GRID}>
      {documents.map((document) => (
        <DocumentCard key={document.id} document={document} />
      ))}
    </div>
  );
}

function DocumentResults({
  documents,
  view,
  label,
}: {
  documents: DocumentSummary[];
  view: View;
  label: string;
}) {
  if (view === "grid") return <DocumentGrid documents={documents} />;
  return (
    <ul aria-label={label} className="space-y-3">
      {documents.map((document) => (
        <li key={document.id}>
          <DocumentCard document={document} list />
        </li>
      ))}
    </ul>
  );
}

function DocumentCard({
  document,
  className,
  list = false,
}: {
  document: DocumentSummary;
  className?: string;
  list?: boolean;
}) {
  const theme = themeFor(document.themeId);
  const href = documentHref(document);
  const meta = `${document.count} ${document.kind === "lesson" ? "slides" : "blocks"}${document.subject ? ` · ${document.subject}` : ""}`;
  return (
    <Card
      className={`${list ? "flex-row items-center gap-0 py-0" : "gap-0 overflow-hidden py-0"} ${className ?? ""}`}
    >
      <Link
        to={href}
        params={
          document.kind === "lesson" ? { lessonId: document.id } : { worksheetId: document.id }
        }
        className={list ? "flex min-w-0 flex-1 items-center gap-4 p-4" : "block"}
      >
        <div
          aria-hidden
          className={list ? "size-16 shrink-0 rounded-control" : "aspect-video w-full"}
          style={{ backgroundColor: theme.swatch }}
        />
        <div className={list ? "min-w-0" : "p-4"}>
          <h3 className="truncate font-semibold">{document.title}</h3>
          <p className="mt-1 text-meta text-ink-3">{meta}</p>
        </div>
      </Link>
    </Card>
  );
}

function SeriesGrid({
  series,
  headingLevel = "h2",
}: {
  series: SeriesWithLessons[];
  headingLevel?: "h2" | "h3";
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {series.map((item) => (
        <SeriesBand key={item.series.id} item={item} headingLevel={headingLevel} />
      ))}
    </div>
  );
}

function SeriesBand({
  item,
  headingLevel,
}: {
  item: SeriesWithLessons;
  headingLevel: "h2" | "h3";
}) {
  const Title = headingLevel;
  return (
    <Card className="gap-3 p-4">
      <Link to="/series/$seriesId" params={{ seriesId: item.series.id }} className="block">
        <Stack
          sheets={item.lessons
            .slice(0, 3)
            .map((lesson) => (
              <span
                key={lesson.id}
                aria-hidden
                className="block size-full"
                style={{ backgroundColor: themeFor(lesson.themeId).swatch }}
              />
            ))}
          width={120}
        />
        <Title className="mt-4 font-semibold">{item.series.title}</Title>
        <p className="mt-1 text-meta text-ink-3">{item.lessons.length} lessons</p>
      </Link>
    </Card>
  );
}

function EmptyLibrary({ mode, onCreate }: { mode: LibraryMode; onCreate: () => void }) {
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
      secondaryAction={<Button variant="ghost">Import</Button>}
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
