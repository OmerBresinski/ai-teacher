import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { WorksheetEditor } from "@tj/editor/worksheet-editor";
import { Button, Tooltip } from "@tj/ui";
import { useCallback } from "react";
import { RoutePendingPage } from "@/components/route-pending-page";
import { WrongKindPage } from "@/components/wrong-kind-page";
import { useSaveWithConflictToast } from "@/hooks/use-save-with-conflict-toast";
import { useShellReturn } from "@/lib/last-shell";
import { isFullDocument, kindOf, libraryQueries } from "@/lib/library";
import { worksheetEditorRoute } from "./documents.route";
// The editor's stylesheet (theme fonts, the paper, the editing chrome) travels with this route
// only (ADR 0022 §8): Vite ships it with the lazy chunk, so none of it reaches the initial bundle.
import "@tj/editor/styles/worksheet-edit.css";

/** TeachDeck `worksheetPrintHref(id, { auto: true })`. */
export const worksheetPrintHref = (id: string) => `/w/${encodeURIComponent(id)}/print?auto=1`;

/**
 * `/w/$worksheetId` — the worksheet editor (TEACH-109). The loader has already resolved the
 * document (or 404ed); until the full body arrives the list placeholder is a summary, so the page
 * waits. The editor reads and writes the same query entry the loader filled (ADR 0022 §4) and saves
 * through the autosave mutation, which refreshes the library lists but leaves the working copy
 * alone. Print opens the print route in a new tab with `?auto=1`, after the autosave has flushed
 * (TeachDeck `openWorksheetPrintView`). A lesson id here shows `WrongKindPage`.
 */
export function WorksheetEditorPage() {
  const { worksheetId } = useParams({ from: worksheetEditorRoute.id });
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const shellReturn = useShellReturn();
  const options = libraryQueries.document(worksheetId, queryClient);
  const { data } = useQuery(options);
  const save = useSaveWithConflictToast(worksheetId);
  // The sheet's lesson, for the facts the "Add a block" sections are built from (TEACH-183). The
  // same document query the lesson editor uses; nothing is fetched until the sheet names a lesson.
  const lessonId = data && isFullDocument(data) && "lessonId" in data ? data.lessonId : undefined;
  const lessonOptions = libraryQueries.document(lessonId ?? "", queryClient);
  const { data: lesson } = useQuery({ ...lessonOptions, enabled: lessonId !== undefined });
  const facts =
    lesson && isFullDocument(lesson) && kindOf(lesson) === "lesson" && "facts" in lesson
      ? lesson.facts
      : undefined;

  const onBack = useCallback(() => void navigate({ to: shellReturn }), [navigate, shellReturn]);
  const onPrint = useCallback(() => {
    window.open(worksheetPrintHref(worksheetId), "_blank", "noopener");
  }, [worksheetId]);

  if (!data || !isFullDocument(data)) return <RoutePendingPage />;
  if (kindOf(data) !== "worksheet" || !("blocks" in data)) {
    return <WrongKindPage document={{ id: data.id, title: data.title, kind: "lesson" }} />;
  }

  return (
    <WorksheetEditor
      worksheetId={worksheetId}
      queryKey={options.queryKey}
      queryFn={() => queryClient.fetchQuery(options)}
      onSave={save}
      onBack={onBack}
      onPrint={onPrint}
      facts={facts}
      exportSlot={
        // `aria-disabled`, not `disabled`: a disabled button swallows pointer and focus events, so
        // its tooltip could never open (the viewer's pattern).
        <Tooltip label="Export arrives with the export phase">
          <Button variant="ghost" size="sm" aria-disabled="true" className="opacity-50">
            Export
          </Button>
        </Tooltip>
      }
    />
  );
}
