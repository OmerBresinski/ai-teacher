import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { ExportControl } from "@tj/editor/export";
import {
  displayInTheme,
  GeneratingThemeDialog,
  LessonEditor,
  type LessonEditorHandle,
  ThemeCallout,
} from "@tj/editor/lesson";
import { Button, IconButton } from "@tj/ui";
import { ArrowLeft, FileText, LockKeyhole } from "lucide-react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { stageOf } from "@/components/generating-lesson/stage";
import { generationHandoff, lessonWorksheetsQuery } from "@/lib/lesson-worksheets";
import { sessionBoundary } from "@/lib/session-boundary";
import "@/components/lesson-creation/creation.css";
import { EmptyLesson } from "@/components/empty-lesson";
import { RoutePendingPage } from "@/components/route-pending-page";
import { forgetPreviewLesson, rememberPreviewLesson } from "@/components/sign-in/preview-lesson";
import { SIGN_IN_TO_EDIT } from "@/components/sign-in/sign-in-copy";
import { WrongKindPage } from "@/components/wrong-kind-page";
import { env } from "@/env";
import { usePromptEdit } from "@/hooks/use-prompt-edit";
import { useProposalJobs } from "@/hooks/use-proposal-jobs";
import { useSaveWithConflictToast } from "@/hooks/use-save-with-conflict-toast";
import { rememberTheme } from "@/lib/brief-memory";
import { imageSearchFor } from "@/lib/images";
import { useShellReturn } from "@/lib/last-shell";
import { isFullDocument, kindOf, libraryQueries } from "@/lib/library";
import { openPrintTab } from "@/lib/print-tab";
import { meQueryOptions } from "@/lib/query";
import { lessonEditorRoute } from "./documents.route";

// Both are off the editor's first paint (and its chunk budget): the worksheets dialog pulls the
// worksheet recipes, the companion the creation motion. Each mounts only when it is needed.
const LessonWorksheets = lazy(() =>
  import("@/components/generating-lesson/LessonWorksheets").then((m) => ({
    default: m.LessonWorksheets,
  })),
);
const GenerationCompanion = lazy(() =>
  import("@/components/lesson-creation/generation-companion").then((m) => ({
    default: m.GenerationCompanion,
  })),
);

// A signed-out visitor's read-only body and sign-in sheet (TEACH-245): off a teacher's editor
// chunk, loaded only for an anonymous session (the sheet only once it is opened).
const LessonViewer = lazy(() =>
  import("@tj/editor/present").then((m) => ({ default: m.LessonViewer })),
);
const SignInSheet = lazy(() =>
  import("@/components/sign-in/SignInSheet").then((m) => ({ default: m.SignInSheet })),
);

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
 *
 * A signed-out visitor's lesson (an anonymous session, TEACH-245, UX ruling 109) is read-only: the
 * generating view as usual, then the viewer body (page through, Present). Export, the worksheet
 * action, autosave, facts and regenerate are never mounted; one "Sign in to edit, export and save"
 * action takes their place and opens `SignInSheet` over the lesson, which returns here.
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
  // The route guard has just fetched `me`; read that entry rather than asking again.
  const { data: me } = useQuery({ ...meQueryOptions, staleTime: Number.POSITIVE_INFINITY });
  const anonymous = me?.user.isAnonymous === true;
  const [signInOpen, setSignInOpen] = useState(false);
  const title = data?.title;
  const openSignIn = useCallback(() => {
    // Kept for the tab the link opens in: if the claim is declined this is the topic it offers.
    rememberPreviewLesson(lessonId, title ?? "");
    setSignInOpen(true);
  }, [lessonId, title]);
  // Signed in and the lesson opened: it is theirs now, so nothing is left to offer again.
  const owned = me != null && !anonymous && data != null;
  useEffect(() => {
    if (owned) forgetPreviewLesson();
  }, [owned]);
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
  const saveDocument = useSaveWithConflictToast(lessonId);
  // Ruling 116: a theme the teacher picks in the editor becomes the next lesson's starting theme.
  // The theme the lesson opened with is not a choice (it may be the automatic default).
  const openedTheme = useRef<string | undefined>(undefined);
  if (openedTheme.current === undefined && data && isFullDocument(data) && "slides" in data)
    openedTheme.current = data.themeId;
  const save = useCallback(
    (lesson: Parameters<typeof saveDocument>[0]) => {
      if ("themeId" in lesson && lesson.themeId && lesson.themeId !== openedTheme.current) {
        openedTheme.current = lesson.themeId;
        rememberTheme(lesson.themeId);
      }
      return saveDocument(lesson);
    },
    [saveDocument],
  );
  const [destination, setDestination] = useState<HTMLDivElement | null>(null);
  const [storyStarted, setStoryStarted] = useState(false);
  const [storyFinished, setStoryFinished] = useState(false);
  const [stage, setStage] = useState(() => stageOf([]));
  const checkingSeen = useRef(false);
  if (stage.stage === "checking") checkingSeen.current = true;
  const [worksheetsOpen, setWorksheetsOpen] = useState(false);
  const [worksheetsLabel, setWorksheetsLabel] = useState("Worksheet");
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
  const onPromptEdit = usePromptEdit(lessonId);

  // Ruling 123: a theme picked while the lesson is being made. The lesson is locked until Ready
  // (ADR 0024 §18), so the pick is shown on the slides here, kept across a reload for this tab,
  // and applied by the editor at Ready as one re-fitted, saved undo step.
  const [pickedTheme, setPickedTheme] = useState<string | null>(() => readPickedTheme(lessonId));
  const [themeOpen, setThemeOpen] = useState(false);
  const pickTheme = useCallback(
    (themeId: string) => {
      setPickedTheme(themeId);
      writePickedTheme(lessonId, themeId);
    },
    [lessonId],
  );
  const editing = !!data && isFullDocument(data) && !!meta && !meta.generatingJobId;
  // A layout effect, so the editor's first paint is already in the picked theme.
  useLayoutEffect(() => {
    if (!editing || stoppedJobId || !pickedTheme || !editorRef.current) return;
    editorRef.current.retheme(pickedTheme);
    writePickedTheme(lessonId, null);
    setPickedTheme(null);
  }, [editing, stoppedJobId, pickedTheme, lessonId]);

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
  // Present opens on the slide the teacher is on (ruling 104); the editor has already asked for
  // fullscreen inside the click.
  const onPresent = useCallback(
    (slide?: number) =>
      void navigate({
        to: "/l/$lessonId/present",
        params: { lessonId },
        // `edit`, also from the read-only body: exit comes back here, not to `/view`.
        search: { series: undefined, slide, from: "edit" },
      }),
    [navigate, lessonId],
  );
  // The read-only body has nothing to edit: a double-click on the slide asks to sign in instead.
  const readOnlyBody = anonymous && !!data && isFullDocument(data) && !meta?.generatingJobId;
  useEffect(() => {
    if (!readOnlyBody) return;
    const onDoubleClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest("[data-lesson-viewer] main") || target.closest("button")) return;
      window.getSelection()?.removeAllRanges();
      openSignIn();
    };
    document.addEventListener("dblclick", onDoubleClick);
    return () => document.removeEventListener("dblclick", onDoubleClick);
  }, [readOnlyBody, openSignIn]);

  if (!data || !isFullDocument(data) || !meta) return <RoutePendingPage />;
  if (kindOf(data) !== "lesson" || !("slides" in data)) {
    return <WrongKindPage document={{ id: data.id, title: data.title, kind: "worksheet" }} />;
  }
  // The export dialog reads the document from the same cache entry the editor writes (ADR 0023
  // amendment 2026-09-12), so it exports what is on screen — including a locked lesson's partial
  // body while `lesson.plan` runs; the app opens the print tab.
  const worksheetsSlot =
    data.plan?.state === "confirmed" ? (
      <Suspense fallback={null}>
        <LessonWorksheets
          lesson={data}
          open={worksheetsOpen}
          onOpenChange={setWorksheetsOpen}
          onOpenWorksheet={onOpenWorksheet}
        />
      </Suspense>
    ) : null;
  // In the editor the entry sits in the top bar's ⋯ menu, which unmounts when it closes; the dialog
  // is mounted beside the editor instead, so opening it from the menu keeps it open.
  const worksheetsMenuEntry =
    data.plan?.state === "confirmed" ? (
      <Button
        variant="ghost"
        size="sm"
        data-lesson-worksheets
        onClick={() => setWorksheetsOpen(true)}
      >
        <FileText aria-hidden size={16} strokeWidth={1.5} />
        {worksheetsLabel}
      </Button>
    ) : null;
  const worksheetsDialog =
    data.plan?.state === "confirmed" ? (
      <Suspense fallback={null}>
        <LessonWorksheets
          lesson={data}
          trigger={false}
          onLabel={setWorksheetsLabel}
          open={worksheetsOpen}
          onOpenChange={setWorksheetsOpen}
          onOpenWorksheet={onOpenWorksheet}
        />
      </Suspense>
    ) : null;
  const exportControl = (
    <ExportControl document={data} imageOrigin={env.VITE_API_URL} onOpenPrint={openPrintTab} />
  );
  // While the lesson is being made, the generating shell shows both side by side; the editor's
  // top bar keeps Export visible and lists the Worksheets control in its ⋯ (ruling 186).
  const exportSlot = anonymous ? (
    <Button
      variant="default"
      size="sm"
      onClick={openSignIn}
      aria-label={SIGN_IN_TO_EDIT}
      data-sign-in-to-edit=""
    >
      <LockKeyhole aria-hidden size={16} strokeWidth={1.5} />
      {/* A phone's bar has room for the verb only; the name stays the whole label. */}
      <span className="hidden sm:inline">{SIGN_IN_TO_EDIT}</span>
      <span className="sm:hidden">Sign in</span>
    </Button>
  ) : (
    <>
      {worksheetsSlot}
      {exportControl}
    </>
  );

  const generatingJobId = meta?.generatingJobId ?? stoppedJobId;
  const showStory = storyStarted && !storyFinished && data.plan?.state !== "proposed";
  const companionSlot = showStory ? (
    <div ref={setDestination} className="creation-generation-anchor" />
  ) : undefined;
  const shownLesson = displayInTheme(data, pickedTheme);
  const content = generatingJobId ? (
    <Suspense fallback={<RoutePendingPage />}>
      <GeneratingThemeDialog
        open={themeOpen}
        lesson={shownLesson}
        onChange={pickTheme}
        onClose={() => setThemeOpen(false)}
      />
      <GeneratingLesson
        key={generatingJobId}
        lesson={shownLesson}
        canvasCompanion={companionSlot}
        themeCallout={
          <ThemeCallout themeId={shownLesson.themeId} onClick={() => setThemeOpen(true)} />
        }
        onStage={setStage}
        jobId={generatingJobId}
        onBack={onBack}
        onStopped={setStoppedJobId}
        onViewSlide={setViewedSlideId}
        exportSlot={exportSlot}
      />
    </Suspense>
  ) : anonymous ? (
    <Suspense fallback={<RoutePendingPage />}>
      <LessonViewer
        lesson={data}
        companion={companionSlot}
        leading={
          <IconButton label="Back" onClick={onBack}>
            <ArrowLeft aria-hidden size={16} strokeWidth={1.5} />
          </IconButton>
        }
        exportSlot={exportSlot}
        onPresent={onPresent}
      />
    </Suspense>
  ) : data.slides.length === 0 ? (
    <EmptyLesson lesson={data} onBack={onBack} />
  ) : (
    <>
      {worksheetsDialog}
      <LessonEditor
        companion={companionSlot}
        lessonId={lessonId}
        userId={sessionBoundary.getSnapshot().identity ?? undefined}
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
        onPromptEdit={onPromptEdit}
        busySlideIds={proposals.busySlideIds}
        proposalsBusy={proposals.busy}
        images={images}
        exportSlot={exportControl}
        worksheetsSlot={worksheetsMenuEntry}
      />
    </>
  );
  const paused = stage.terminal === "failed" || stage.terminal === "cancelled";
  const ready = !generatingJobId && data.slides.length > 0;
  return (
    <div className="creation-editor-preview" data-story-finished={storyFinished}>
      {content}
      {anonymous && signInOpen ? (
        <Suspense fallback={null}>
          <SignInSheet open onOpenChange={setSignInOpen} redirect={`/l/${lessonId}`} />
        </Suspense>
      ) : null}
      {showStory && destination ? (
        <Suspense fallback={null}>
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
                    : // A confirmed plan already has its facts; the generate job's first events
                      // still read as Planning, which is not what the teacher is waiting for.
                      stage.stage === "planning" && !data.facts
                      ? "Planning your lesson…"
                      : "Making your slides…"
            }
            onExited={() => setStoryFinished(true)}
          />
        </Suspense>
      ) : null}
    </div>
  );
}

/** The theme picked while `lessonId` was being made, for this tab (ruling 123). */
const pickedThemeKey = (lessonId: string) => `tj:generating-theme:${lessonId}`;

function readPickedTheme(lessonId: string): string | null {
  try {
    return window.sessionStorage.getItem(pickedThemeKey(lessonId));
  } catch {
    return null;
  }
}

function writePickedTheme(lessonId: string, themeId: string | null) {
  try {
    if (themeId) window.sessionStorage.setItem(pickedThemeKey(lessonId), themeId);
    else window.sessionStorage.removeItem(pickedThemeKey(lessonId));
  } catch {
    /* Storage can be blocked; the pick then lives for this visit only. */
  }
}
