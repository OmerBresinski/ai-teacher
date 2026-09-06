import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { EmptyState, PageTitle } from "@tj/ui";
import { Layers } from "lucide-react";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { libraryQueries } from "@/lib/library";
import { seriesDetailRoute } from "./library.route";

export function SeriesDetailPage() {
  const { seriesId } = useParams({ from: seriesDetailRoute.id });
  const series = useQuery(libraryQueries.series());
  const entry = series.data?.find((item) => item.series.id === seriesId);
  useDocumentTitle(`${entry?.series.title ?? "Series"} · Teaching Journey`);

  return (
    <main className="min-h-dvh px-6 py-8 lg:px-12">
      <PageTitle label="Series title" renameLabel="Rename series">
        {entry?.series.title ?? "Series"}
      </PageTitle>
      <div className="mt-8">
        <EmptyState
          icon={<Layers strokeWidth={1.5} />}
          title="Lessons in this series arrive with the next ticket"
        />
      </div>
    </main>
  );
}
