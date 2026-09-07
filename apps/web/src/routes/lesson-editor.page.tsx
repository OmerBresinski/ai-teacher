import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { LessonEditor } from "@tj/editor/lesson";
import { Button, IconButton, Tooltip } from "@tj/ui";
import { ArrowLeft } from "lucide-react";
import { useCallback } from "react";
import { EmptyLesson } from "@/components/empty-lesson";
import { GeneratingLesson } from "@/components/generating-lesson";
import { RoutePendingPage } from "@/components/route-pending-page";
import { WrongKindPage } from "@/components/wrong-kind-page";
import { useSaveWithConflictToast } from "@/hooks/use-save-with-conflict-toast";
import { useShellReturn } from "@/lib/last-shell";
import { isFullDocument, kindOf, libraryQueries } from "@/lib/library";
import { lessonEditorRoute } from "./documents.route";
// The slide stylesheet (theme fonts, rich-text rules, reveal motion) travels with every route that
// paints a slide (ADR 0022 §7): a direct load of `/l/…` must not depend on the library chunk.
import "@tj/editor/styles/editor.css";

/**
 * `/l/$lessonId` — the lesson editor (TEACH-103). The loader has already resolved the document (or
 * 404ed); until the full body arrives the list placeholder is a summary, so the page waits. The
 * editor reads and writes the same query entry the loader filled (ADR 0022 §4) and saves through
 * the autosave mutation, which refreshes the library lists but leaves the working copy alone. A
 * worksheet id on a lesson route shows `WrongKindPage`. While a `lesson.plan` job holds the row's
 * generating lock (ADR 0024 §18) the page shows `GeneratingLesson` instead of the editor; a lesson
 * the job left without slides shows `EmptyLesson`, which adds the first one.
 */
export function LessonEditorPage() {
  const { lessonId } = useParams({ from: lessonEditorRoute.id });
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const shellReturn = useShellReturn();
  const options = libraryQueries.document(lessonId, queryClient);
  const { data } = useQuery(options);
  const { data: meta } = useQuery(libraryQueries.documentMeta(lessonId));
  const save = useSaveWithConflictToast(lessonId);

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
  if (kindOf(data) !== "lesson" || !("slides" in data)) {
    return <WrongKindPage document={{ id: data.id, title: data.title, kind: "worksheet" }} />;
  }
  if (meta?.generatingJobId) {
    return (
      <GeneratingLesson
        lesson={data}
        jobId={meta.generatingJobId}
        leading={
          <IconButton label="Back to the library" onClick={onBack}>
            <ArrowLeft aria-hidden size={16} strokeWidth={1.5} />
          </IconButton>
        }
      />
    );
  }

  if (data.slides.length === 0) return <EmptyLesson lesson={data} onBack={onBack} />;

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
