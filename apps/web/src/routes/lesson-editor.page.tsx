import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { LessonEditor } from "@tj/editor/lesson";
import { Button, Tooltip } from "@tj/ui";
import { useCallback } from "react";
import { RoutePendingPage } from "@/components/route-pending-page";
import { useShellReturn } from "@/lib/last-shell";
import { isFullDocument, kindOf, libraryMutations, libraryQueries } from "@/lib/library";
import { lessonEditorRoute } from "./documents.route";
import { EditorStubPage } from "./editor-stubs.page";
// The slide stylesheet (theme fonts, rich-text rules, reveal motion) travels with every route that
// paints a slide (ADR 0022 §7): a direct load of `/l/…` must not depend on the library chunk.
import "@tj/editor/styles/editor.css";

/**
 * `/l/$lessonId` — the lesson editor (TEACH-103). The loader has already resolved the document (or
 * 404ed); until the full body arrives the list placeholder is a summary, so the page waits. The
 * editor reads and writes the same query entry the loader filled (ADR 0022 §4) and saves through
 * the autosave mutation, which refreshes the library lists but leaves the working copy alone. A
 * worksheet id on a lesson route shows the stub, as before.
 */
export function LessonEditorPage() {
  const { lessonId } = useParams({ from: lessonEditorRoute.id });
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const shellReturn = useShellReturn();
  const options = libraryQueries.document(lessonId, queryClient);
  const { data } = useQuery(options);
  const { mutateAsync: save } = useMutation(libraryMutations.autosaveDocument(queryClient));

  const onBack = useCallback(() => void navigate({ to: shellReturn }), [navigate, shellReturn]);
  const onPresent = useCallback(
    () =>
      void navigate({
        to: "/l/$lessonId/present",
        params: { lessonId },
        search: { series: undefined, from: "edit" },
      }),
    [navigate, lessonId],
  );

  if (!data || !isFullDocument(data)) return <RoutePendingPage />;
  if (kindOf(data) !== "lesson" || !("slides" in data)) return <EditorStubPage />;

  return (
    <LessonEditor
      lessonId={lessonId}
      queryKey={options.queryKey}
      queryFn={() => queryClient.fetchQuery(options)}
      onSave={save}
      onBack={onBack}
      onPresent={onPresent}
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
