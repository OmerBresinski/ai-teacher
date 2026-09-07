import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams, useSearch } from "@tanstack/react-router";
import { WorksheetPrint } from "@tj/editor/worksheet";
import { RoutePendingPage } from "@/components/route-pending-page";
import { WrongKindPage } from "@/components/wrong-kind-page";
import { isFullDocument, kindOf, libraryQueries } from "@/lib/library";
import { worksheetPrintRoute } from "./documents.route";
// The sheet's stylesheet (theme fonts, sheet rules, print layout) travels with this route only
// (ADR 0022 §8): Vite ships it with the lazy chunk, so it never reaches the initial bundle.
import "@tj/editor/styles/print.css";

/**
 * `/w/$worksheetId/print` (TEACH-108; ADR 0023 §2) — the paginated sheet at exact A4 or Letter, no
 * app chrome, under `authLayoutRoute` (which renders none). The loader has already resolved the
 * document (or 404ed); until the full body arrives the list placeholder is a summary, so the page
 * waits. A lesson id on a worksheet route shows `WrongKindPage`, as the lesson routes do for worksheets.
 */
export function WorksheetPrintPage() {
  const { worksheetId } = useParams({ from: worksheetPrintRoute.id });
  const { auto } = useSearch({ from: worksheetPrintRoute.id });
  const queryClient = useQueryClient();
  const { data } = useQuery(libraryQueries.document(worksheetId, queryClient));

  if (!data || !isFullDocument(data)) return <RoutePendingPage />;
  if (kindOf(data) !== "worksheet" || !("blocks" in data)) {
    return <WrongKindPage document={{ id: data.id, title: data.title, kind: "lesson" }} />;
  }

  return (
    <WorksheetPrint
      worksheet={data}
      auto={auto === "1"}
      backSlot={
        <Link to="/w/$worksheetId" params={{ worksheetId }}>
          Go back
        </Link>
      }
    />
  );
}
