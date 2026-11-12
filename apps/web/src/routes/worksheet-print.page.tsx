import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams, useSearch } from "@tanstack/react-router";
import { isUnfinishedWorksheet } from "@tj/domain/documents";
import { UNFINISHED_PRINT_BLOCKED, UNFINISHED_TITLE, WorksheetPrint } from "@tj/editor/worksheet";
import { Button, EmptyState } from "@tj/ui";
import { FileText } from "lucide-react";
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
 * An unfinished sheet (`isUnfinishedWorksheet`) never reaches the printer, `?auto=1` or not: the
 * page says why and links back to the editor, where the bar offers what to do.
 */
export function WorksheetPrintPage() {
  const { worksheetId } = useParams({ from: worksheetPrintRoute.id });
  const { auto, part } = useSearch({ from: worksheetPrintRoute.id });
  const queryClient = useQueryClient();
  const { data } = useQuery(libraryQueries.document(worksheetId, queryClient));

  if (!data || !isFullDocument(data)) return <RoutePendingPage />;
  if (kindOf(data) !== "worksheet" || !("blocks" in data)) {
    return (
      <WrongKindPage document={{ id: data.id, title: data.title, kind: "lesson" }} chrome="none" />
    );
  }

  if (isUnfinishedWorksheet(data)) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-2xl items-center bg-background p-6">
        <EmptyState
          icon={<FileText strokeWidth={1.5} />}
          title={UNFINISHED_TITLE}
          body={UNFINISHED_PRINT_BLOCKED}
          action={
            <Button variant="primary" asChild>
              <Link to="/w/$worksheetId" params={{ worksheetId }}>
                Open the worksheet
              </Link>
            </Button>
          }
        />
      </main>
    );
  }

  return (
    <WorksheetPrint
      worksheet={data}
      auto={auto === "1"}
      part={part ?? "pupil"}
      backSlot={
        <Link to="/w/$worksheetId" params={{ worksheetId }}>
          Go back
        </Link>
      }
    />
  );
}
