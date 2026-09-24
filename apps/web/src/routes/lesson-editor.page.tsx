import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { ExportControl } from "@tj/editor/export";
import { LessonEditor, type LessonEditorHandle } from "@tj/editor/lesson";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LessonWorksheets } from "@/components/generating-lesson/LessonWorksheets";
import { stageOf } from "@/components/generating-lesson/stage";
import { GenerationCompanion } from "@/components/lesson-creation/generation-companion";
import { generationHandoff, lessonWorksheetsQuery } from "@/lib/lesson-worksheets";
import "@/components/lesson-creation/creation.css";
import { EmptyLesson } from "@/components/empty-lesson";
import { RoutePendingPage } from "@/components/route-pending-page";
import { WrongKindPage } from "@/components/wrong-kind-page";
import { env } from "@/env";
import { useProposalJobs } from "@/hooks/use-proposal-jobs";
import { useSaveWithConflictToast } from "@/hooks/use-save-with-conflict-toast";
import { imageSearchFor } from "@/lib/images";
import { useShellReturn } from "@/lib/last-shell";
import { isFullDocument, kindOf, libraryQueries } from "@/lib/library";
import { openPrintTab } from "@/lib/print-tab";
import { lessonEditorRoute } from "./documents.route";
// The slide stylesheet (theme fonts, rich-text rules, reveal motion) travels with every route that
// paints a slide (ADR 0022 §7): a direct load of `/l/…` must not depend on the library chunk.
import "@tj/editor/styles/editor.css";

// The generating view renders the editor's shell geometry with the slide renderer, a chunk most
// editor loads never need: only a lesson still under its `lesson.plan` lock reaches it (bundle-conditional).
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
  return <LessonEditorSession key={lessonId} lessonId={lessonId} />;
}

function LessonEditorSession({ lessonId }: { lessonId: string }) {
  const queryClient = useQueryClient();
  const images = useMemo(() => imageSearchFor(queryClient), [queryClient]);
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
  useEffect(() => {
    if (data && isFullDocument(data) && "slides" in data && data.plan?.state === "proposed") {
      void navigate({ to: "/lessons/new", search: { lesson: lessonId }, replace: true });
    }
  }, [data, lessonId, navigate]);
  const save = useSaveWithConflictToast(lessonId);
  const [destination, setDestination] = useState<HTMLDivElement | null>(null);
  const [storyStarted, setStoryStarted] = useState(false);
  const [storyFinished, setStoryFinished] = useState(false);
  const [stage, setStage] = useState(() => stageOf([]));
  const checkingSeen = useRef(false);
  if (stage.stage === "checking") checkingSeen.current = true;
  const [worksheetsOpen, setWorksheetsOpen] = useState(false);
  const [handoff] = useState(() => generationHandoff(queryClient, lessonId));
  const [includedWorksheet] = useState(() => !!handoff.intent);
  useEffect(() => {
    if (meta?.generatingJobId) setStoryStarted(true);
  }, [meta?.generatingJobId]);
  const linkedSheets = useQuery({
    ...lessonWorksheetsQuery(queryClient, lessonId),
    enabled: !!data && isFullDocument(data) && "slides" in data,
  });
  // A job that failed or was cancelled releases the lock, yet the page stays on the generating
  // view for it (the outcome, the partial slides, Back to library) until the teacher leaves.
  const [stoppedJobId, setStoppedJobId] = useState<string | null>(null);
  // The slide the teacher was looking at in the generating view (TEACH-252), so the editor opens
  // on it at Ready; `null` while the canvas followed the newest, which opens on the first slide.
  const [viewedSlideId, setViewedSlideId] = useState<string | null>(null);
  // The generated worksheet (ADR 0025 §4), so the editor's objective-coverage check sees both
  // halves (§10). Its own row; a lesson without the artefact never asks.
  const worksheetId =
    linkedSheets.data?.find((sheet) => !sheet.generatingJobId && sheet.generation?.completedAt)
      ?.id ??
    (data && isFullDocument(data) && "artefacts" in data ? data.artefacts?.worksheetId : undefined);
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
  // The top bar's Worksheet action (TEACH-184): the creation flow, open on Kind for this lesson.
  const onNewWorksheet = useCallback(() => {
    if (data && isFullDocument(data) && "slides" in data && data.plan?.state === "confirmed") {
      setWorksheetsOpen(true);
    } else {
      void navigate({ to: "/worksheets/new", search: { lesson: lessonId } });
    }
  }, [data, navigate, lessonId]);
  const onPresent = useCallback(
    () =>
      void navigate({
        to: "/l/$lessonId/present",
        params: { lessonId },
        search: { series: undefined, from: "edit" },
      }),
    [navigate, lessonId],
  );

  if (!data || !isFullDocument(data) || !meta) return <RoutePendingPage />;
  if (kindOf(data) !== "lesson" || !("slides" in data)) {
    return <WrongKindPage document={{ id: data.id, title: data.title, kind: "worksheet" }} />;
  }
  // The export dialog reads the document from the same cache entry the editor writes (ADR 0023
  // amendment 2026-09-12), so it exports what is on screen — including a locked lesson's partial
  // body while `lesson.plan` runs; the app opens the print tab.
  const exportSlot = (
    <>
      {data.plan?.state === "confirmed" ? (
        <LessonWorksheets
          lesson={data}
          open={worksheetsOpen}
          onOpenChange={setWorksheetsOpen}
          onOpenWorksheet={onOpenWorksheet}
        />
      ) : null}
      <ExportControl document={data} imageOrigin={env.VITE_API_URL} onOpenPrint={openPrintTab} />
    </>
  );
  const generatingJobId = meta?.generatingJobId ?? stoppedJobId;
  const showStory = storyStarted && !storyFinished && data.plan?.state !== "proposed";
  const companionSlot = showStory ? (
    <div ref={setDestination} className="creation-generation-anchor" />
  ) : undefined;
  const content = generatingJobId ? (
    <Suspense fallback={<RoutePendingPage />}>
      <GeneratingLesson
        key={generatingJobId}
        lesson={data}
        canvasCompanion={companionSlot}
        onStage={setStage}
        jobId={generatingJobId}
        onBack={onBack}
        onStopped={setStoppedJobId}
        onViewSlide={setViewedSlideId}
        exportSlot={exportSlot}
      />
    </Suspense>
  ) : data.slides.length === 0 ? (
    <EmptyLesson lesson={data} onBack={onBack} />
  ) : (
    <LessonEditor
      companion={companionSlot}
      lessonId={lessonId}
      queryKey={options.queryKey}
      queryFn={() => queryClient.fetchQuery(options)}
      onSave={save}
      onBack={onBack}
      onPresent={onPresent}
      worksheet={worksheet}
      onOpenWorksheet={onOpenWorksheet}
      onNewWorksheet={onNewWorksheet}
      editorRef={editorRef}
      initialSlideId={viewedSlideId ?? undefined}
      onFactsChanged={proposals.onFactsChanged}
      onRegenerate={proposals.onRegenerate}
      busySlideIds={proposals.busySlideIds}
      proposalsBusy={proposals.busy}
      images={images}
      exportSlot={exportSlot}
    />
  );
  const paused = stage.terminal === "failed" || stage.terminal === "cancelled";
  const ready = !generatingJobId && data.slides.length > 0;
  return (
    <div className="creation-editor-preview" data-story-finished={storyFinished}>
      {content}
      {showStory && destination ? (
        <GenerationCompanion
          destination={destination}
          origin={handoff.origin}
          skipIntro={!handoff.origin}
          includedWorksheet={includedWorksheet}
          progress={
            stage.stage === "checking"
              ? 1
              : Math.min(0.74, data.slides.length / Math.max(1, data.facts?.outline.length ?? 1))
          }
          checking={checkingSeen.current || stage.stage === "checking"}
          ready={ready}
          paused={paused}
          statusText={
            paused
              ? "Generation stopped"
              : ready
                ? "Slides ready"
                : stage.stage === "checking"
                  ? "Checking your slides…"
                  : stage.stage === "planning"
                    ? "Planning your lesson…"
                    : "Making your slides…"
          }
          onExited={() => setStoryFinished(true)}
        />
      ) : null}
    </div>
  );
}
