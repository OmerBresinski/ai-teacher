import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { EmptyState, PageTitle } from "@tj/ui";
import { Layers } from "lucide-react";
import { libraryQueries } from "@/lib/library";
import { seriesDetailRoute } from "./library.route";

const SERIES_ICON = <Layers strokeWidth={1.5} />;

/** Placeholder until TEACH-92; the loader already resolved the series (or 404'd). */
export function SeriesDetailPage() {
  const { seriesId } = useParams({ from: seriesDetailRoute.id });
  const queryClient = useQueryClient();
  const { data } = useQuery(libraryQueries.seriesDetail(seriesId, queryClient));

  return (
    <main className="min-h-dvh px-6 py-8 lg:px-12">
      <PageTitle label="Series title" renameLabel="Rename series">
        {data?.series.title ?? "Series"}
      </PageTitle>
      <div className="mt-8">
        <EmptyState icon={SERIES_ICON} title="Lessons in this series arrive with the next ticket" />
      </div>
    </main>
  );
}
