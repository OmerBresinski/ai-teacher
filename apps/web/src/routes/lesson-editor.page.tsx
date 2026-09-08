import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import type { Lesson, LessonFacts } from "@tj/domain/documents";
import { LessonEditor, type LessonEditorHandle } from "@tj/editor/lesson";
import { Button, IconButton, Tooltip } from "@tj/ui";
import { ArrowLeft } from "lucide-react";
import { lazy, Suspense, useCallback, useRef, useState } from "react";
import { EmptyLesson } from "@/components/empty-lesson";
import { RoutePendingPage } from "@/components/route-pending-page";
import { WrongKindPage } from "@/components/wrong-kind-page";
import { useProposalJobs } from "@/hooks/use-proposal-jobs";
import { useSaveWithConflictToast } from "@/hooks/use-save-with-conflict-toast";
import { seedGeneratingLesson } from "@/lib/brief-form";
import { useShellReturn } from "@/lib/last-shell";
import { isFullDocument, kindOf, libraryQueries } from "@/lib/library";
import { queryKeys } from "@/lib/query";
import { lessonEditorRoute } from "./documents.route";
// The slide stylesheet (theme fonts, rich-text rules, reveal motion) travels with every route that
// paints a slide (ADR 0022 §7): a direct load of `/l/…` must not depend on the library chunk.
import "@tj/editor/styles/editor.css";

// The generating view renders the read-only viewer (`@tj/editor/present`), a chunk most editor
// loads never need: only a lesson still under its `lesson.plan` lock reaches it (bundle-conditional).
// The plan review (prototype, `proto/plan-review`): a lesson Plan has written but nobody has
// confirmed — `generation.stage === "planned"` with no lock — gets the review instead of the editor.
const PlanReview = lazy(() =>
  import("@/components/plan-review/plan-review").then(({ PlanReview }) => ({
    default: PlanReview,
  })),
);

const GeneratingLesson = lazy(() =>
  import("@/components/generating-lesson").then(({ GeneratingLesson }) => ({
    default: GeneratingLesson,
  })),
);

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
  // The body fetch writes the row state beside it, so this query only needs its own request when
  // the meta was invalidated later (a 409, the job's terminal event). Enabling it after the body
  // has arrived keeps the hover-preload path to one `GET /documents/:id`.
  const { data: meta } = useQuery({
    ...libraryQueries.documentMeta(lessonId),
    enabled: data != null && isFullDocument(data),
  });
  const save = useSaveWithConflictToast(lessonId);
  // A job that failed or was cancelled releases the lock, yet the page stays on the generating
  // view for it (the outcome, the partial slides, Back to library) until the teacher leaves.
  const [stoppedJobId, setStoppedJobId] = useState<string | null>(null);
  // The generated worksheet (ADR 0025 §4), so the editor's objective-coverage check sees both
  // halves (§10). Its own row; a lesson without the artefact never asks.
  const worksheetId =
    data && isFullDocument(data) && "artefacts" in data ? data.artefacts?.worksheetId : undefined;
  const { data: worksheetData } = useQuery({
    ...libraryQueries.document(worksheetId ?? "", queryClient),
    enabled: worksheetId !== undefined,
  });
  const worksheet =
    worksheetData && isFullDocument(worksheetData) && "blocks" in worksheetData
      ? worksheetData
      : undefined;
  // The proposal jobs (TEACH-134): the app enqueues and follows, the editor applies through the
  // handle as one undo step.
  const editorRef = useRef<LessonEditorHandle | null>(null);
  const proposals = useProposalJobs(lessonId, editorRef, worksheetId);

  const onBack = useCallback(() => void navigate({ to: shellReturn }), [navigate, shellReturn]);
  const onOpenWorksheet = useCallback(
    (id: string) => void navigate({ to: "/w/$worksheetId", params: { worksheetId: id } }),
    [navigate],
  );
  // Prototype: confirming the plan writes the edited facts into the cache and hands the page to
  // the generating view under a fake job id (`seedGeneratingLesson`, the brief's handoff), so the
  // pending skeletons follow `facts.outline`. No API call; the real contract needs Omer's job split.
  const onGenerate = useCallback(
    (facts: LessonFacts) => {
      const current = queryClient.getQueryData<Lesson>(queryKeys.libraryDocument(lessonId));
      if (!current?.brief) return;
      const jobId = `proto-${Date.now().toString(36)}`;
      seedGeneratingLesson(
        queryClient,
        {
          brief: current.brief,
          themeId: current.themeId,
          subject: current.subject,
          yearGroup: current.yearGroup,
        },
        { lessonId, jobId },
      );
      queryClient.setQueryData(queryKeys.libraryDocument(lessonId), { ...current, facts });
    },
    [queryClient, lessonId],
  );

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
  const generatingJobId = meta?.generatingJobId ?? stoppedJobId;
  if (generatingJobId) {
    return (
      <Suspense fallback={<RoutePendingPage />}>
        <GeneratingLesson
          lesson={data}
          jobId={generatingJobId}
          onBack={onBack}
          onStopped={setStoppedJobId}
          leading={
            <IconButton label="Back to the library" onClick={onBack}>
              <ArrowLeft aria-hidden size={16} strokeWidth={1.5} />
            </IconButton>
          }
        />
      </Suspense>
    );
  }

  if (data.generation?.stage === "planned" && data.facts && meta?.generatingJobId == null) {
    return (
      <Suspense fallback={<RoutePendingPage />}>
        <PlanReview
          lesson={data}
          facts={data.facts}
          onGenerate={onGenerate}
          leading={
            <IconButton label="Back to the library" onClick={onBack}>
              <ArrowLeft aria-hidden size={16} strokeWidth={1.5} />
            </IconButton>
          }
        />
      </Suspense>
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
      worksheet={worksheet}
      onOpenWorksheet={onOpenWorksheet}
      editorRef={editorRef}
      onFactsChanged={proposals.onFactsChanged}
      onRegenerate={proposals.onRegenerate}
      busySlideIds={proposals.busySlideIds}
      proposalsBusy={proposals.busy}
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
