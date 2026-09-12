import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useSearch } from "@tanstack/react-router";
import { LessonPrint } from "@tj/editor/lesson-print";
import { RoutePendingPage } from "@/components/route-pending-page";
import { WrongKindPage } from "@/components/wrong-kind-page";
import { isFullDocument, kindOf, libraryQueries } from "@/lib/library";
import { lessonPrintRoute } from "./documents.route";
// The print stylesheet (theme fonts, the slide renderer, the page layout) travels with this route
// only (ADR 0022 §8): Vite ships it with the lazy chunk, so it never reaches the initial bundle.
import "@tj/editor/styles/lesson-print.css";

/**
 * `/l/$lessonId/print` (TEACH-110; ADR 0023 §2) — the deck as printed pages, no app chrome, under
 * `authLayoutRoute` (which renders none). Opened by the export dialog's PDF tab in a new tab, so the
 * session cookie the `<img>` requests to `/files/:key` need is already there. `?auto=1` prints once
 * the slides have painted. A worksheet id here shows `WrongKindPage`, as the worksheet print route
 * does for lessons.
 */
export function LessonPrintPage() {
  const { lessonId } = useParams({ from: lessonPrintRoute.id });
  const search = useSearch({ from: lessonPrintRoute.id });
  const queryClient = useQueryClient();
  const { data } = useQuery(libraryQueries.document(lessonId, queryClient));

  if (!data || !isFullDocument(data)) return <RoutePendingPage />;
  if (kindOf(data) !== "lesson" || !("slides" in data)) {
    return (
      <WrongKindPage
        document={{ id: data.id, title: data.title, kind: "worksheet" }}
        chrome="none"
      />
    );
  }

  return (
    <LessonPrint
      lesson={data}
      options={{
        auto: search.auto === "1",
        answers: search.answers === "1",
        notes: search.notes === "1",
        handout3: search.handout === "3",
        slides: search.slides ?? "",
      }}
    />
  );
}
