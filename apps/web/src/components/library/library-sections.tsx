import { Link } from "@tanstack/react-router";
import {
  Button,
  Card,
  EmptyState,
  ListSurface,
  ListSurfaceCell,
  ListSurfaceHeader,
  SectionHeading,
  Skeleton,
} from "@tj/ui";
import { Layers, LibraryBig } from "lucide-react";
import type { ReactNode } from "react";
import { LibraryCard, type LibraryCardProps } from "@/components/library-card";
import { SeriesCard, type SeriesCardProps } from "@/components/series-card";
import type { DocumentSummary, SeriesWithLessons } from "@/mocks/library-schema";
import type { LibraryMode, View } from "./library-model";

/** TeachDeck fixes four columns; the responsive grid keeps that density on wide screens. */
export const GRID = "grid grid-cols-2 gap-6 lg:grid-cols-3 xl:grid-cols-4";

export type DocumentCardCallbacks = Pick<LibraryCardProps, "now" | "onAction" | "onRename">;
export type SeriesCardCallbacks = Pick<SeriesCardProps, "now" | "onAction" | "onRename">;

const SERIES_ICON = <Layers strokeWidth={1.5} />;
const LIBRARY_ICON = <LibraryBig strokeWidth={1.5} />;
const SKELETON_KEYS = ["one", "two", "three", "four"] as const;
const NEW_LABEL: Record<LibraryMode, string> = {
  home: "New lesson",
  lesson: "New lesson",
  worksheet: "New worksheet",
  series: "New series",
};

const LIST_HEADER = (
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
);

export function HomeSection({
  title,
  count,
  to,
  children,
}: {
  title: string;
  count: number;
  to: "/lessons" | "/worksheets" | "/series";
  children: ReactNode;
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

export function DocumentGrid({
  documents,
  ...cardProps
}: { documents: DocumentSummary[] } & DocumentCardCallbacks) {
  return (
    <div className={GRID}>
      {documents.map((document) => (
        <LibraryCard key={document.id} doc={document} {...cardProps} />
      ))}
    </div>
  );
}

export function DocumentResults({
  documents,
  view,
  label,
  ...cardProps
}: { documents: DocumentSummary[]; view: View; label: string } & DocumentCardCallbacks) {
  if (view === "grid") return <DocumentGrid documents={documents} {...cardProps} />;
  return (
    <ListSurface aria-label={label} header={LIST_HEADER}>
      {documents.map((document) => (
        <LibraryCard key={document.id} doc={document} view="list" {...cardProps} />
      ))}
    </ListSurface>
  );
}

export function SeriesGrid({
  series,
  headingLevel = "h2",
  ...cardProps
}: { series: SeriesWithLessons[]; headingLevel?: "h2" | "h3" } & SeriesCardCallbacks) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {series.map((item) => (
        <SeriesCard key={item.series.id} item={item} headingLevel={headingLevel} {...cardProps} />
      ))}
    </div>
  );
}

export function EmptyLibrary({
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
      icon={series ? SERIES_ICON : LIBRARY_ICON}
      title={series ? "No series yet" : "Nothing here yet"}
      body={
        series
          ? "A series is a set of lessons in teaching order."
          : "Make a lesson or a worksheet. Everything you make is saved in your Workspace. If you made one somewhere else, import its file."
      }
      action={<Button onClick={onCreate}>{NEW_LABEL[mode]}</Button>}
      secondaryAction={
        <Button variant="ghost" onClick={onImport}>
          Import
        </Button>
      }
    />
  );
}

export function NoMatches({ onClear }: { onClear: () => void }) {
  return (
    <EmptyState
      title="No titles match that"
      action={<Button onClick={onClear}>Clear search</Button>}
    />
  );
}

export function LoadFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <EmptyState
      icon={LIBRARY_ICON}
      title="Your library could not be loaded"
      action={<Button onClick={onRetry}>Retry</Button>}
    />
  );
}

export function SkeletonGrid() {
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
