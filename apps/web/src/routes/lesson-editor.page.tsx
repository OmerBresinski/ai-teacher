import { type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { isBudgetStopMessage } from "@tj/domain";
import {
  hasEditableSlides,
  isStartingJob,
  type Lesson,
  startingJobBase,
  writingSlideIds,
} from "@tj/domain/documents";
import { SaveDeferredError, SaveHeldError } from "@tj/editor/autosave";
import { ExportControl } from "@tj/editor/export";
import {
  displayInTheme,
  GeneratingThemeDialog,
  LessonEditor,
  type LessonEditorHandle,
  ThemeCallout,
} from "@tj/editor/lesson";
import { type DraftStore, draftStoreFor } from "@tj/editor/live-draft";
import { Button, IconButton, toast } from "@tj/ui";
import { ArrowLeft, Download, FileText, LockKeyhole } from "lucide-react";
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
import {
  FillingFollower,
  opensFillingEditor,
  StopFillingButton,
} from "@/components/generating-lesson/FillingFollower";
import { StoppedNotice } from "@/components/generating-lesson/StoppedNotice";
import { stageOf } from "@/components/generating-lesson/stage";
import { generationHandoff, lessonWorksheetsQuery } from "@/lib/lesson-worksheets";
import { sessionBoundary } from "@/lib/session-boundary";
import "@/components/lesson-creation/creation.css";
import { EmptyLesson } from "@/components/empty-lesson";
import { EditorShellPending } from "@/components/shell-pending";
import {
  forgetPreviewLesson,
  previewLesson,
  rememberPreviewLesson,
} from "@/components/sign-in/preview-lesson";
import {
  SAVED_TO_YOUR_LESSONS,
  SIGN_IN_TO_EDIT,
  SIGN_IN_TO_EXPORT,
} from "@/components/sign-in/sign-in-copy";
import { WrongKindPage } from "@/components/wrong-kind-page";
import { env } from "@/env";
import { useHeldSave } from "@/hooks/use-held-save";
import { usePromptEdit } from "@/hooks/use-prompt-edit";
import { useProposalJobs } from "@/hooks/use-proposal-jobs";
import { useSaveWithConflictToast } from "@/hooks/use-save-with-conflict-toast";
import { rememberTheme } from "@/lib/brief-memory";
import { imageSearchFor } from "@/lib/images";
import { useShellReturn } from "@/lib/last-shell";
import { GeneratingLesson, GenerationCompanion } from "@/lib/lesson-editor-preload";
import { resumeLesson } from "@/lib/lesson-intake";
import { isFullDocument, kindOf, libraryCache, libraryQueries } from "@/lib/library";
import { openPrintTab } from "@/lib/print-tab";
import { meQueryOptions } from "@/lib/query";
import { sessionIsCurrent } from "@/lib/session-boundary";
import {
  forgetUnsavedChange,
  keepUnsavedChange,
  RESTORED_UNSAVED_CHANGE,
  readUnsavedChange,
  type UnsavedChange,
} from "@/lib/unsaved-change";
import { lessonEditorRoute } from "./documents.route";

// Off the editor's first paint (and its chunk budget): the worksheets dialog pulls the worksheet
// recipes. It mounts only when it is needed. The companion and the generating view are in
// `lesson-editor-preload.ts`, which the intake warms before it hands over.
const LessonWorksheets = lazy(() =>
  import("@/components/generating-lesson/LessonWorksheets").then((m) => ({
    default: m.LessonWorksheets,
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
  // Back from signing in on Export (`?export=1`): the export dialog mounts open, then the flag leaves
  // the URL, so a reload or Back does not open it again. Read from the router: it re-serialises the
  // value, so the raw query string is not a reliable place to look.
  const exportOnArrival = useSearch({ strict: false }).export === "1";
  const signedInWithData = !anonymous && data != null;
  useEffect(() => {
    if (!exportOnArrival || !signedInWithData) return;
    void navigate({ to: "/l/$lessonId", params: { lessonId }, search: {}, replace: true });
  }, [exportOnArrival, signedInWithData, lessonId, navigate]);
  const [signInOpen, setSignInOpen] = useState(false);
  // What the sheet resumes after sign-in (ruling 127): the editor, or Export's print view.
  const [signInFor, setSignInFor] = useState<"edit" | "export">("edit");
  const title = data?.title;
  const askSignIn = useCallback(
    (intent: "edit" | "export") => {
      // Kept for the tab the link opens in: if the move fails this is the topic it offers.
      rememberPreviewLesson(lessonId, title ?? "");
      setSignInFor(intent);
      setSignInOpen(true);
    },
    [lessonId, title],
  );
  const openSignIn = useCallback(() => askSignIn("edit"), [askSignIn]);
  const openExportSignIn = useCallback(() => askSignIn("export"), [askSignIn]);
  // Signed in and the lesson opened: it is theirs now (ruling 127), so say so once and forget it.
  const owned = me != null && !anonymous && data != null;
  useEffect(() => {
    if (!owned) return;
    if (previewLesson(lessonId)) toast(SAVED_TO_YOUR_LESSONS);
    forgetPreviewLesson();
  }, [owned, lessonId]);
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
  // The proposal jobs (TEACH-134) apply through it; while the lesson fills, each newer row is folded
  // into the open document through it (ADR 0037).
  const editorRef = useRef<LessonEditorHandle | null>(null);
  // Live writing (ADR 0039): the job this editor follows while the lesson fills, and for
  // `FOLD_GRACE_MS` after it ends (the row settles: the last fold, a save already on the wire).
  // Under it a refused save is the job's own writing racing the editor's, never the teacher's
  // conflict: it is deferred and tried again (`useSaveWithConflictToast`), never toasted.
  const followed = useRef<{ jobId: string; until: number } | null>(null);
  const handoffFocused = useRef(false);
  const ownJob = useCallback(() => {
    const f = followed.current;
    return f && Date.now() < f.until ? f.jobId : undefined;
  }, []);
  // ADR 0037: the row last folded into the editor (the base of the next three-way merge) and its
  // version. `fold` reads the newest row and merges it in; a save while the job owns the lesson
  // folds first and sends the merged copy at that row's version, so it never carries an older
  // body under a newer version, and a fold never applies a row older than the one it holds.
  const folded = useRef<{ jobId: string; body: Lesson; at: string } | null>(null);
  const foldRun = useRef<Promise<Lesson | undefined> | null>(null);
  const fold = useCallback(async (): Promise<Lesson | undefined> => {
    // One read at a time, and never a read that began before this call.
    while (foldRun.current) await foldRun.current.catch(() => undefined);
    const run = (async () => {
      const row = await libraryCache.readFilling(queryClient, lessonId);
      const base = folded.current;
      const editor = editorRef.current;
      if (!row || !base || !editor || !sessionIsCurrent(queryClient)) return undefined;
      if (row.meta.updatedAt < base.at) return undefined;
      const merged = editor.receiveGenerated(base.body, row.body);
      // A row the job has not marked yet is all the job's (`startingJobBase`).
      folded.current = {
        jobId: base.jobId,
        body: startingJobBase(row.body),
        at: row.meta.updatedAt,
      };
      libraryCache.setMetaIfNewer(queryClient, lessonId, row.meta);
      return merged;
    })();
    foldRun.current = run;
    try {
      return await run;
    } finally {
      if (foldRun.current === run) foldRun.current = null;
    }
  }, [queryClient, lessonId]);
  // A stale save under the followed job folds the row in and saves the merged copy once more.
  const onStale = useCallback(async () => (ownJob() ? fold() : undefined), [ownJob, fold]);
  const saveDocument = useSaveWithConflictToast(lessonId, onStale, ownJob);
  const saveFolded = useCallback(
    async (lesson: Parameters<typeof saveDocument>[0]) => {
      if (!ownJob() || !folded.current) {
        // A job holds the row and this editor is not folding it in: its copy may be from any
        // point in the run, and the save would carry the row's newest `updatedAt` (the meta the
        // page polls), so it would pass as current and replace what the job wrote since (P0,
        // 25 Oct 2026). It waits; the editor that follows the job saves the merged copy.
        // With no meta cached it is read, never assumed free: a raw save during a job is the P0.
        if (await generatingLock(queryClient, lessonId))
          throw new SaveDeferredError("The lesson is still being written.");
        return saveDocument(lesson);
      }
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const merged = await fold();
        const base = folded.current;
        const at = queryClient.getQueryData(
          libraryQueries.documentMeta(lessonId).queryKey,
        )?.updatedAt;
        if (!merged || !base || at !== base.at) continue;
        // Nothing of the teacher's that the row lacks: there is nothing to write.
        if (merged === base.body) return;
        // The editor's fit stamp (`fitVersion`, set when it opens) is not the teacher's: a copy
        // that differs from the row only there waits while the job still writes (still "Unsaved
        // changes", tried again), then saves as usual once the job has let the lesson go.
        const lock = queryClient.getQueryData(
          libraryQueries.documentMeta(lessonId).queryKey,
        )?.generatingJobId;
        // Not the teacher's content: held quietly ("Saved" stays), written once the job ends.
        if (holdsFitStamp(merged, base.body, lock, base.jobId))
          throw new SaveHeldError("The fit stamp waits for the job to end.");
        return saveDocument(merged);
      }
      throw new SaveDeferredError("The lesson is still being written.");
    },
    [ownJob, fold, saveDocument, queryClient, lessonId],
  );
  // A teacher's change the editor could not write before it went (a job held the row, or the
  // network failed) is kept on this browser and merged back in on the next open, with a notice.
  const keepChange = useCallback(
    (
      lesson: Parameters<typeof saveDocument>[0],
      base: Parameters<typeof saveDocument>[0] | null,
    ) => {
      if (!("slides" in lesson)) return;
      const lessonBase = folded.current?.body ?? (base && "slides" in base ? base : null);
      if (!lessonBase) return;
      const meta = queryClient.getQueryData(libraryQueries.documentMeta(lessonId).queryKey);
      const change: UnsavedChange = {
        lessonId,
        lesson,
        base: lessonBase,
        baseAt: folded.current?.at ?? meta?.updatedAt ?? null,
        jobId: meta?.generatingJobId ?? null,
        keptAt: Date.now(),
      };
      keepUnsavedChange(change);
      // The next editor on this page (the view flips back) picks it up as well as the next visit.
      setKept(change);
    },
    [queryClient, lessonId],
  );
  const [kept, setKept] = useState(() => readUnsavedChange(lessonId));
  const onRestored = useCallback(
    (applied: boolean) => {
      forgetUnsavedChange(lessonId);
      setKept(undefined);
      if (applied) toast(RESTORED_UNSAVED_CHANGE);
    },
    [lessonId],
  );
  // Ruling 116: a theme the teacher picks in the editor becomes the next lesson's starting theme.
  // The theme the lesson opened with is not a choice (it may be the automatic default).
  const openedTheme = useRef<string | undefined>(undefined);
  if (openedTheme.current === undefined && data && isFullDocument(data) && "slides" in data)
    openedTheme.current = data.themeId;
  /** The row and job as the page last read them: whose slides are whose while a job fills. */
  /** The job's draft store, kept past the job's end for the last slide's hand-over. */
  const rowRef = useRef<{ drafts?: DraftStore }>({});
  // Live writing (ADR 0039): a save while every slide is still the job's waits for the first done
  // slide, then the editor's copy is saved (`useHeldSave`).
  const heldSave = useHeldSave<Parameters<typeof saveDocument>[0]>({
    save: saveFolded,
    row:
      data && isFullDocument(data) ? (data as Parameters<typeof useHeldSave>[0]["row"]) : undefined,
    generating: !!meta?.generatingJobId,
    pull: onStale,
  });
  const save = useCallback(
    (lesson: Parameters<typeof saveDocument>[0]) => {
      if ("themeId" in lesson && lesson.themeId && lesson.themeId !== openedTheme.current) {
        openedTheme.current = lesson.themeId;
        rememberTheme(lesson.themeId);
      }
      return heldSave(lesson);
    },
    [heldSave],
  );
  const [destination, setDestination] = useState<HTMLDivElement | null>(null);
  const [storyStarted, setStoryStarted] = useState(false);
  const [storyFinished, setStoryFinished] = useState(false);
  const [stage, setStage] = useState(() => stageOf([]));
  /** The job whose writer has finished every slide's words (TEACH-202 part o). */
  const [draftedJobId, setDraftedJobId] = useState<string | null>(null);
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
  // A job that failed or was cancelled (UX-A): the teacher stays in the editor with every slide
  // written so far and one line saying so; a failure offers Try again for the rest. A guest's
  // read-only lesson keeps the generating view's stopped state instead.
  const [stopped, setStopped] = useState<{
    jobId: string;
    outcome: "failed" | "cancelled";
    budget?: boolean;
    dismissed?: boolean;
  } | null>(null);
  const stoppedJobId = stopped?.jobId ?? null;
  const onStopped = useCallback(
    (jobId: string, outcome: "failed" | "cancelled", message?: string) =>
      setStopped({ jobId, outcome, budget: isBudgetStopMessage(message) }),
    [],
  );
  const keepEditing = !!stopped && !anonymous;
  const [retry, setRetry] = useState<"idle" | "trying" | "error">("idle");
  // The job the generating view is following (TEACH-202 part j). The body and the job's events
  // reach the page on two channels with no order between them, so a refetch can show the lock gone
  // while the view has not yet learnt how the job ended; the view stays until it has
  // (`onCompleted` / `onStopped`), or a cancelled run would open the editor instead of saying it
  // stopped. A completed job is let go even if the row the page holds still names it.
  const [watchedJobId, setWatchedJobId] = useState<string | null>(null);
  const [completedJobId, setCompletedJobId] = useState<string | null>(null);
  const [unlocked, setUnlocked] = useState<{ jobId: string; base: Lesson } | null>(null);
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
    if (!editing || (stoppedJobId && !keepEditing) || !pickedTheme || !editorRef.current) return;
    editorRef.current.retheme(pickedTheme);
    writePickedTheme(lessonId, null);
    setPickedTheme(null);
  }, [editing, stoppedJobId, keepEditing, pickedTheme, lessonId]);

  const onBack = useCallback(() => void navigate({ to: shellReturn }), [navigate, shellReturn]);
  // Try again (UX-A): a new job writes the rest. The row it starts from is read first, so the next
  // fold merges onto the stored copy (the teacher's saved edits) and never onto unsaved ones.
  const stoppedJob = stopped?.jobId;
  const onTryAgain = useCallback(async () => {
    setRetry("trying");
    try {
      const row = await libraryCache.readFilling(queryClient, lessonId);
      if (!stoppedJob) {
        setRetry("idle");
        return;
      }
      const { jobId } = await resumeLesson(queryClient, lessonId, stoppedJob);
      if (row) folded.current = { jobId, body: row.body, at: row.meta.updatedAt };
      const metaKey = libraryQueries.documentMeta(lessonId).queryKey;
      queryClient.setQueryData(metaKey, (meta) =>
        meta ? { ...meta, generatingJobId: jobId } : meta,
      );
      setStopped(null);
      setRetry("idle");
    } catch {
      setRetry("error");
    }
  }, [queryClient, lessonId, stoppedJob]);
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
  // A React handler on the page's own element, not a document listener added in an effect: it is
  // live in the same commit that renders the read-only body, so a double-click can never land in
  // the gap before an effect runs (and `data-guest-read-only` marks exactly that state).
  const onReadOnlyDoubleClick = useCallback(
    (event: React.MouseEvent) => {
      if (!readOnlyBody) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest("[data-lesson-viewer] main") || target.closest("button")) return;
      window.getSelection()?.removeAllRanges();
      openSignIn();
    },
    [readOnlyBody, openSignIn],
  );

  // UX audit polish 1: when the editor takes over from the lesson being made, focus would be left
  // on the page body (the button the teacher pressed is gone). It lands on a hidden line naming the
  // lesson, just before the editor (so Tab goes on to its bar), once, and only when nothing
  // else holds focus. A control would show its tooltip; the line shows nothing.
  // It runs once per editor session, when the filling job unlocks the editor (`unlocked`), and
  // never for an anonymous visitor, whose editor has no anchor.
  const handoffJob = unlocked?.jobId;
  const slideCount = data && "slides" in data ? data.slides.length : 0;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `slideCount` re-runs it when the first slide arrives, which is when the anchor mounts.
  useEffect(() => {
    if (!handoffJob || anonymous || handoffFocused.current) return;
    const name = document.querySelector<HTMLElement>("[data-editor-anchor]");
    if (!name) return;
    handoffFocused.current = true;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    name.focus({ preventScroll: true });
  }, [handoffJob, anonymous, slideCount]);
  if (!data || !isFullDocument(data) || !meta) return <EditorShellPending />;
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
    <ExportControl
      document={data}
      imageOrigin={env.VITE_API_URL}
      onOpenPrint={openPrintTab}
      defaultOpen={!anonymous && exportOnArrival}
    />
  );
  // While the lesson is being made, the generating shell shows both side by side; the editor's
  // top bar keeps Export visible and lists the Worksheets control in its ⋯ (ruling 186).
  const exportSlot = anonymous ? (
    <>
      {/* Export is behind sign-in too (ruling 109); after it the export dialog opens (ruling 127). */}
      <Button variant="ghost" size="sm" onClick={openExportSignIn} data-sign-in-to-export="">
        <Download aria-hidden size={16} strokeWidth={1.5} />
        Export
      </Button>
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
    </>
  ) : (
    <>
      {worksheetsSlot}
      {exportControl}
    </>
  );

  // ADR 0037, UX ruling 189: once a slide's words are done the editor opens while the lesson
  // keeps filling. The first done slide latches it for this job; slides still being written are
  // read-only inside it, and the follower folds each newer row into the open document.
  const fillingJobId =
    meta?.generatingJobId && meta.generatingJobId !== completedJobId ? meta.generatingJobId : null;
  // Greg's answer 66 (UX audit J2): a confirmed plan opens the editor at once, before the job has
  // marked any slide, so the teacher sees one bar from Continue on rather than the generating
  // shell's bar giving way to the editor's. Until the job says which slides it owns, it owns them
  // all: every slide is read-only and marked "Writing" (ruling 189).
  const starting = !!fillingJobId && isStartingJob(data);
  if (
    fillingJobId &&
    unlocked?.jobId !== fillingJobId &&
    opensFillingEditor({
      anonymous,
      stopped: !!stoppedJobId,
      proposed: data.plan?.state === "proposed",
      // Live writing (ADR 0039): the editor opens as soon as the job owns the deck (its slides
      // `writing`), not at the first done slide, so the lesson is watched taking shape in it.
      editableSlides: hasEditableSlides(data) || writingSlideIds(data).size > 0 || starting,
    })
  ) {
    setUnlocked({ jobId: fillingJobId, base: startingJobBase(data) });
    // The first merge's base: the row the editor opens on, unless Try again already read it.
    if (folded.current?.jobId !== fillingJobId)
      folded.current = { jobId: fillingJobId, body: startingJobBase(data), at: meta.updatedAt };
  }
  const filling = !!fillingJobId && unlocked?.jobId === fillingJobId;
  // The filling editor follows the job's end itself (`FillingFollower`), so it needs no latch.
  if (fillingJobId && !filling && watchedJobId !== fillingJobId) setWatchedJobId(fillingJobId);
  if (filling && watchedJobId !== null) setWatchedJobId(null);
  const generatingJobId =
    fillingJobId ??
    (keepEditing ? null : stoppedJobId) ??
    (watchedJobId !== completedJobId && watchedJobId !== stoppedJobId ? watchedJobId : null);
  // Live writing (ADR 0039): one store of slide drafts per job, fed by whichever view follows it.
  const draftStore = generatingJobId ? draftStoreFor(generatingJobId) : undefined;
  // The job's store outlives its end by a moment: the last slide finishes typing over the hand-over
  // (the store empties itself shortly after the job ends).
  if (draftStore) rowRef.current.drafts = draftStore;
  if (filling && fillingJobId) followed.current = { jobId: fillingJobId, until: Infinity };
  else if (followed.current?.until === Infinity)
    followed.current = { jobId: followed.current.jobId, until: Date.now() + FOLD_GRACE_MS };
  const editorOpen = !generatingJobId || filling;
  const writing = filling
    ? starting
      ? new Set(data.slides.map((slide) => slide.id))
      : writingSlideIds(data)
    : undefined;
  const showStory = storyStarted && !storyFinished && data.plan?.state !== "proposed";
  // The slot outlives the story: on a phone it keeps its place (faded) so the companion leaving
  // moves no slide (creation.css, "The phone's companion leaves…").
  const companionSlot =
    showStory || (storyStarted && storyFinished) ? (
      <div ref={setDestination} className="creation-generation-anchor" />
    ) : undefined;
  const shownLesson = displayInTheme(data, pickedTheme);
  const content = !editorOpen ? (
    <Suspense fallback={<EditorShellPending />}>
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
        onStopped={onStopped}
        onCompleted={setCompletedJobId}
        onViewSlide={setViewedSlideId}
        exportSlot={exportSlot}
        drafts={draftStore}
      />
    </Suspense>
  ) : anonymous ? (
    <Suspense fallback={<EditorShellPending />}>
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
        onAbandon={keepChange}
        restore={kept}
        onRestored={onRestored}
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
        writingSlideIds={writing}
        writingFinished={filling && draftedJobId === fillingJobId}
        drafts={rowRef.current.drafts}
        proposalsBusy={proposals.busy}
        images={images}
        exportSlot={
          filling && unlocked ? (
            <>
              <StopFillingButton jobId={unlocked.jobId} />
              {exportControl}
            </>
          ) : (
            exportControl
          )
        }
        worksheetsSlot={worksheetsMenuEntry}
      />
      {filling && unlocked ? (
        <FillingFollower
          jobId={unlocked.jobId}
          fold={fold}
          onStopped={onStopped}
          drafts={draftStore}
          onDrafted={setDraftedJobId}
        />
      ) : null}
    </>
  );
  const paused = stage.terminal === "failed" || stage.terminal === "cancelled";
  const ready = !generatingJobId && data.slides.length > 0;
  return (
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: a pointer shortcut only; the sign-in button is the keyboard path
    // biome-ignore lint/a11y/noStaticElementInteractions: a pointer shortcut only; the sign-in button is the keyboard path
    <div
      className="creation-editor-preview"
      data-story-finished={storyFinished}
      data-guest-read-only={readOnlyBody ? "" : undefined}
      onDoubleClick={onReadOnlyDoubleClick}
    >
      {editorOpen && !anonymous && data.slides.length > 0 ? (
        <p className="sr-only" tabIndex={-1} data-editor-anchor="">
          {`Editing ${data.title}`}
        </p>
      ) : null}
      {content}
      {keepEditing && stopped && !stopped.dismissed && editorOpen ? (
        <StoppedNotice
          outcome={stopped.outcome}
          budget={stopped.budget}
          onTryAgain={() => void onTryAgain()}
          trying={retry === "trying"}
          error={retry === "error"}
          onDismiss={() => setStopped({ ...stopped, dismissed: true })}
        />
      ) : null}
      {anonymous && signInOpen ? (
        <Suspense fallback={null}>
          <SignInSheet
            open
            onOpenChange={setSignInOpen}
            redirect={signInFor === "export" ? `/l/${lessonId}?export=1` : `/l/${lessonId}`}
            title={signInFor === "export" ? SIGN_IN_TO_EXPORT : SIGN_IN_TO_EDIT}
            description={
              signInFor === "export"
                ? "Your lesson stays here. Once you are signed in, it opens with the export options."
                : undefined
            }
          />
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

/**
 * Whether `mine` differs from the job's row only in the editor's fit stamp. Every other field,
 * slide and element still counts, so a real teacher edit is always written.
 */
export function onlyFitStampDiffers(mine: Lesson, row: Lesson): boolean {
  if ((mine.fitVersion ?? 0) === (row.fitVersion ?? 0)) return false;
  return sameValue({ ...mine, fitVersion: 0 }, { ...row, fitVersion: 0 });
}

/**
 * Whether a save of `mine` is held (`SaveHeldError`, the indicator stays "Saved"): it differs from the job's
 * row only in the fit stamp, and `jobId` still holds the lesson. Once the lock is gone the stamp
 * saves like any change, so it is never left unwritten behind a "Saved".
 */
/**
 * The job holding the lesson's row, if any. Read from the cached meta, or fetched when there is
 * none: a save never treats a missing entry as "no job" (it would go out raw over the job's work).
 */
export async function generatingLock(
  queryClient: QueryClient,
  lessonId: string,
): Promise<string | null | undefined> {
  const options = libraryQueries.documentMeta(lessonId);
  const meta =
    queryClient.getQueryData(options.queryKey) ?? (await queryClient.fetchQuery(options));
  return meta?.generatingJobId;
}

export function holdsFitStamp(
  mine: Lesson,
  row: Lesson,
  lockedBy: string | null | undefined,
  jobId: string,
): boolean {
  return !!lockedBy && lockedBy === jobId && onlyFitStampDiffers(mine, row);
}

/** Deep equality of JSON values, key order ignored; an `undefined` field counts as absent. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((v, i) => sameValue(v, b[i]));
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(ra), ...Object.keys(rb)]);
  for (const k of keys) if (!sameValue(ra[k], rb[k])) return false;
  return true;
}

/**
 * How long after the followed job ends a refused save is still the job's own last write racing
 * the editor's (the final fold, a save already on the wire), not another tab's.
 */
const FOLD_GRACE_MS = 20_000;

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
