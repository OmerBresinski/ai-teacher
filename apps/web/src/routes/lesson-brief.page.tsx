import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import {
  CreateLessonSchema,
  DEFAULT_SLIDE_TIER,
  findNamePatterns,
  GUARD_MESSAGE,
  type Lesson,
  type SlideTier,
  type SourceRef,
  slideTierOf,
} from "@tj/domain/documents";
import { Button, Spinner } from "@tj/ui";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { lastDocumentUpdatedAt } from "@/components/generating-lesson/job-sync";
import type { CharacterCapture } from "@/components/lesson-creation/character-origin";
import { CreationShell } from "@/components/lesson-creation/creation-shell";
import { leaveStage } from "@/components/lesson-creation/planning-stage";
import {
  BriefStep,
  type IntakeBrief,
  type ObjectiveDraft,
  ObjectivesStep,
  type WorksheetDraft,
  WorksheetStep,
} from "@/components/lesson-creation/step-fields";
import { useLibraryActions } from "@/components/library/use-library-actions";
import { SIGN_IN_SHEET_BACK_HERE } from "@/components/sign-in/sign-in-copy";
import { SourceDropZone } from "@/components/source-drop-zone/SourceDropZone";
import { useTurnstileToken } from "@/components/turnstile";
import { useJobEvents } from "@/hooks/use-job-events";
import { AnonymousSignInError, ensureAnonymousSession } from "@/lib/anonymous-session";
import { api } from "@/lib/api";
import { readLastClass, writeLastClass } from "@/lib/brief-memory";
import { startingTheme } from "@/lib/default-theme";
import { preloadLessonEditor } from "@/lib/lesson-editor-preload";
import {
  confirmLesson,
  objectiveEdits,
  replanLesson,
  seedConfirmedGeneration,
} from "@/lib/lesson-intake";
import { rememberGenerationOrigin, rememberWorksheetIntent } from "@/lib/lesson-worksheets";
import { libraryMutations, libraryQueries } from "@/lib/library";
import { ApiError, apiErrorFromResponse, meQueryOptions } from "@/lib/query";
import { sessionRequest } from "@/lib/session-boundary";
import { briefRedirect, lessonBriefRoute } from "./lesson-brief.route";

const NewDocumentDialog = lazy(() =>
  import("@/components/new-document-dialog").then(({ NewDocumentDialog }) => ({
    default: NewDocumentDialog,
  })),
);

/** How often the plan screen re-reads a running job's lesson in case the stream missed its end. */
const JOB_POLL_MS = 3000;
/**
 * The longest a skipped plan waits on the planning stage for its first slides (jank audit F1);
 * after it the editor opens anyway and shows the lesson being made. An object so a test can
 * shorten it.
 */
export const skipPlanningWait = { ms: 60_000 };

/**
 * A skipped plan that failed with no slides cannot be planned again; Try again starts a fresh
 * intake carrying the whole brief (topic, year group, level, length, materials). Set just before
 * that navigation and taken once by the fresh intake's first render.
 */
let retryBrief: { brief: IntakeBrief; sources: SourceRef[]; slideTier: SlideTier } | null = null;
// The sign-in sheet (TEACH-245) loads only when a signed-out visitor hits a limit.
const SignInSheet = lazy(() =>
  import("@/components/sign-in/SignInSheet").then((m) => ({ default: m.SignInSheet })),
);
/** API refusals that mean "no preview for you right now": today's sign-in flow (TEACH-244 FR5). */
const FALLBACK_CODES = new Set(["anonymous_capacity", "rate_limited"]);
/** API refusals that ask an anonymous visitor to sign in, with the plan kept on screen. */
const PROMPT_CODES: Record<string, string> = {
  anonymous_limit: "Sign in to make more lessons.",
  sign_in_required: "Sign in to keep changing the plan.",
};

/** Shared production intake. The URL and stored plan own resume; local state owns unsaved edits. */
export function LessonBriefPage() {
  const search = useSearch({ from: lessonBriefRoute.id });
  // The intake that has just created a lesson stays mounted when the URL gains `?lesson=` (jank
  // audit F4): the page, its character and its heading carry on into the planning stage rather
  // than being rebuilt for a frame. Any other change of lesson starts a fresh intake.
  const created = useRef<string | null>(null);
  const shown = useRef({ lesson: search.lesson, key: search.lesson ?? "new" });
  if (shown.current.lesson !== search.lesson) {
    const kept = search.lesson !== undefined && search.lesson === created.current;
    shown.current = {
      lesson: search.lesson,
      key: kept ? shown.current.key : (search.lesson ?? `new-${Date.now()}`),
    };
  }
  return (
    <LessonIntake
      key={shown.current.key}
      onCreated={(id) => {
        created.current = id;
      }}
      lessonId={search.lesson}
      topic={search.topic}
      focusSources={search.source === "1"}
    />
  );
}

function LessonIntake({
  onCreated,
  lessonId,
  topic,
  focusSources,
}: {
  lessonId?: string;
  topic?: string;
  focusSources: boolean;
  /** The lesson this intake created, just before the URL gains its `?lesson=`. */
  onCreated?: (lessonId: string) => void;
}) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const actions = useLibraryActions();
  // `undefined` while loading, `null` signed out, `isAnonymous` after the first submit (TEACH-244).
  const me = useQuery(meQueryOptions).data;
  const signedOut = me === null;
  const guest = signedOut || !!me?.user.isAnonymous;
  const turnstile = useTurnstileToken();
  const [signInPrompt, setSignInPrompt] = useState("");
  const [last] = useState(readLastClass);
  const [retried] = useState(() => {
    const taken = lessonId ? null : retryBrief;
    retryBrief = null;
    return taken;
  });
  const [brief, setBrief] = useState<IntakeBrief>(
    () =>
      retried?.brief ?? {
        topic: topic ?? "",
        yearGroup: last?.yearGroup || "Year 4",
        level: "standard",
        files: [],
      },
  );
  const [sources, setSources] = useState<SourceRef[]>(() => retried?.sources ?? []);
  const [sourcesBusy, setSourcesBusy] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(focusSources);
  const [blank, setBlank] = useState(false);
  const [step, setStep] = useState<"brief" | "objectives" | "worksheet">("brief");
  const [objectives, setObjectives] = useState<ObjectiveDraft[]>([]);
  const [slideTier, setSlideTier] = useState<SlideTier>(
    () => retried?.slideTier ?? DEFAULT_SLIDE_TIER,
  );
  const [worksheets, setWorksheets] = useState<WorksheetDraft[]>([
    { id: "initial", recipe: "knowledge-check", minutes: "10" },
  ]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // The objectives are confirmed and the lesson job is starting: the page goes to the lesson, so
  // the generate job's lock must not bring the planning stage back for a moment (UX audit J10).
  const [leaving, setLeaving] = useState(false);
  // The lesson is created and the planning stage is up, before the URL has its `?lesson=`.
  const [entering, setEntering] = useState(false);
  const request = useRef<{ id: string; input: ReturnType<typeof CreateLessonSchema.parse> } | null>(
    null,
  );
  const initialized = useRef(false);
  const character = useRef<CharacterCapture>(null);
  const document = useQuery({
    ...libraryQueries.document(lessonId ?? "", client),
    enabled: !!lessonId,
  });
  const meta = useQuery({ ...libraryQueries.documentMeta(lessonId ?? ""), enabled: !!lessonId });
  const lesson = document.data && "slides" in document.data ? (document.data as Lesson) : undefined;
  const jobId = meta.data?.generatingJobId ?? undefined;
  const stream = useJobEvents(
    jobId ?? (initialized.current ? undefined : lesson?.plan?.jobId),
    client,
  );
  const create = useMutation(libraryMutations.createLesson(client));
  // Whether this tab watched the plan job run (then the page leaves the planning stage with a view
  // transition rather than landing on the objectives directly).
  const watched = useRef(false);
  if (jobId) watched.current = true;
  // The wait for a skipped plan's first slides is bounded (`skipPlanningWait`).
  const [waitedOut, setWaitedOut] = useState(false);
  const refresh = async () => {
    await document.refetch();
    await meta.refetch();
  };
  // SSE provides the truth; terminal events release the stored lock before objectives are offered.
  const terminal = stream.terminal;
  useEffect(() => {
    if (!terminal || !lessonId) return;
    void client.invalidateQueries({ queryKey: ["library", "document", lessonId] });
    void client.invalidateQueries({ queryKey: ["library", "document-meta", lessonId] });
  }, [terminal, lessonId, client]);
  // Backup for a missed terminal event (the stream can drop and reconnect): while the job runs,
  // re-read the lesson every few seconds and on every (re)connect. A read without the lock means
  // the job ended, and the page moves on exactly as it would after the terminal event.
  const running = !!lessonId && !!jobId && !terminal;
  useEffect(() => {
    if (!running) return;
    // The meta too: a missed terminal event is seen as the lock gone from the row state.
    const recheck = () => {
      void client.invalidateQueries({ queryKey: ["library", "document", lessonId] });
      void client.invalidateQueries({ queryKey: ["library", "document-meta", lessonId] });
    };
    if (stream.status === "open") recheck();
    const timer = setInterval(recheck, JOB_POLL_MS);
    return () => clearInterval(timer);
  }, [running, stream.status, lessonId, client]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: land only writes state setters.
  useEffect(() => {
    if (!lesson) return;
    if (lesson.plan?.state === "confirmed") {
      // Skip planning (jank audit F1): the plan is confirmed up front but the job still has to plan
      // it. Plan reads the brief here until the job has put slides on the lesson (or ended), then the
      // editor takes over with them, the character flying across as it does after Continue.
      // It never waits past `skipPlanningWait`, and a job that ended with no slides stays here
      // with the failed state (`skipFailed`) rather than opening an empty editor.
      if (!leaving && lesson.slides.length === 0 && (!jobId || !waitedOut)) return;
      preloadLessonEditor();
      if (!leaving)
        rememberGenerationOrigin(client, lesson.id, character.current?.capture() ?? null);
      void navigate({ to: "/l/$lessonId", params: { lessonId: lesson.id }, replace: !leaving });
      return;
    }
    if (initialized.current || jobId || !meta.isSuccess || lesson.generation?.stage !== "planned")
      return;
    initialized.current = true;
    // The plan's state moves the page on, once (`initialized` above), never Plan's animation: a
    // tab that watched the job run leaves the planning stage with a view transition, and Plan
    // greets the objectives step with a nod there.
    if (watched.current) leaveStage(() => land(lesson));
    else land(lesson);
  }, [lesson, jobId, meta.isSuccess, navigate, waitedOut]);
  // While a skip-planning job plans, re-read the lesson whenever the job says it changed, so the
  // editor opens as soon as the first slides are stored (the poll above is only a backup).
  const confirmedRunning = lesson?.plan?.state === "confirmed" && !!jobId;
  const waitingForSlides = confirmedRunning && lesson?.slides.length === 0;
  useEffect(() => {
    if (!waitingForSlides) return;
    const timer = setTimeout(() => setWaitedOut(true), skipPlanningWait.ms);
    return () => clearTimeout(timer);
  }, [waitingForSlides]);
  const changedAt = confirmedRunning ? lastDocumentUpdatedAt(stream.events) : undefined;
  useEffect(() => {
    if (!changedAt || !lessonId) return;
    void client.invalidateQueries({ queryKey: ["library", "document", lessonId] });
  }, [changedAt, lessonId, client]);

  function land(lesson: Lesson) {
    setBrief({
      topic: lesson.brief?.topic ?? lesson.title,
      yearGroup: lesson.yearGroup ?? "Year 4",
      level: lesson.brief?.level ?? "standard",
      files: [],
    });
    setSources(lesson.sources ?? []);
    setObjectives((lesson.facts?.objectives ?? []).map(({ id, text }) => ({ id, text })));
    setSlideTier(slideTierOf(lesson.brief));
    setStep("objectives");
  }

  /** Where sign-in returns to: this plan once there is a lesson, else the brief with its topic. */
  function signInRedirect(source = false) {
    return lessonId && !source
      ? `/lessons/new?lesson=${lessonId}`
      : briefRedirect(brief.topic, source);
  }
  function signIn(source = false) {
    void navigate({ to: "/sign-in", search: { redirect: signInRedirect(source) } });
  }
  async function fail(cause: unknown) {
    if (cause instanceof AnonymousSignInError && cause.kind === "fallback") return signIn();
    if (cause instanceof ApiError && FALLBACK_CODES.has(cause.code)) return signIn();
    if (cause instanceof ApiError && cause.code in PROMPT_CODES) {
      setSignInPrompt(
        cause.code === "sign_in_required" ? cause.message : (PROMPT_CODES[cause.code] ?? ""),
      );
      if (lessonId) await refresh().catch(() => undefined);
      return;
    }
    setError(
      cause instanceof Error ? cause.message : "Something went wrong. Your choices are still here.",
    );
    if (lessonId) {
      if (cause instanceof ApiError && cause.reason === "stale") {
        initialized.current = false;
        await refresh().catch(() => undefined);
        setError(
          "This plan changed elsewhere. The latest plan has been loaded. Please review it before continuing.",
        );
      } else await refresh().catch(() => undefined);
    }
  }
  async function plan(skip: boolean) {
    if (busy || sourcesBusy || findNamePatterns(brief.topic).length > 0) return;
    // The planning stage's character and, after it, the editor: loaded while the teacher waits.
    preloadLessonEditor();
    setBusy(true);
    setError("");
    setSignInPrompt("");
    try {
      const input = CreateLessonSchema.parse({
        brief: { topic: brief.topic.trim(), level: brief.level, slideTier },
        yearGroup: brief.yearGroup,
        // Rulings 116, 202: no theme question; the teacher's last theme, else the planner picks.
        themeId: startingTheme(last?.themeId),
        sourceIds: sources.map(({ id }) => id),
        skipPlanning: skip,
      });
      if (lessonId && lesson) {
        const unchanged =
          lesson.generation?.stage === "planned" &&
          lesson.brief?.topic === input.brief.topic &&
          lesson.yearGroup === input.yearGroup &&
          (lesson.brief?.level ?? "standard") === input.brief.level &&
          JSON.stringify((lesson.sources ?? []).map(({ id }) => id)) ===
            JSON.stringify(input.sourceIds);
        if (unchanged) {
          setStep("objectives");
          return;
        }
        const replanned = await replanLesson(client, lessonId, {
          expectedRevision: lesson.plan?.revision ?? 0,
          brief: input.brief,
          yearGroup: input.yearGroup,
          subject: lesson.brief?.topic === input.brief.topic ? lesson.subject : undefined,
          sourceIds: input.sourceIds,
        });
        client.setQueryData(["library", "document-meta", lessonId], {
          ...meta.data,
          generatingJobId: replanned.jobId,
        });
        initialized.current = false;
        await refresh();
      } else {
        // Keep the exact payload and request id on an uncertain response; never create a second paid job.
        request.current ??= { id: crypto.randomUUID(), input };
        // Signed out: Turnstile, then an anonymous session, then the same create (FLOW.md §7.4).
        // The request id lives in a ref, so a retry after any of the three steps reuses it.
        await ensureAnonymousSession(client, turnstile.getToken);
        const ids = await create.mutateAsync({
          ...request.current.input,
          requestId: request.current.id,
        });
        writeLastClass({
          subject: last?.subject ?? "",
          subjectOther: last?.subjectOther ?? "",
          yearGroup: brief.yearGroup,
          themeId: last?.themeId ?? "",
        });
        // Both go to the planning stage; a skipped plan moves on to the editor by itself.
        onCreated?.(ids.lessonId);
        // Plan moves to centre stage in place (the same view transition that brings it back).
        leaveStage(() => setEntering(true));
        await navigate({ to: "/lessons/new", search: { lesson: ids.lessonId }, replace: true });
      }
    } catch (cause) {
      if (cause instanceof ApiError && cause.status < 500) request.current = null;
      await fail(cause);
    } finally {
      turnstile.reset();
      setBusy(false);
    }
  }
  async function generate(includeWorksheet: boolean) {
    if (!lesson || busy) return;
    const origin = character.current?.capture() ?? null;
    preloadLessonEditor();
    setBusy(true);
    setError("");
    setSignInPrompt("");
    const worksheet = includeWorksheet ? worksheets[0] : undefined;
    setLeaving(true);
    try {
      const result = await confirmLesson(client, lesson.id, {
        expectedRevision: lesson.plan?.revision ?? 0,
        objectives: objectiveEdits(lesson, objectives),
        slideTier,
        // Ruling 201: no worksheet queued puts the exit ticket on the last slide.
        worksheet: worksheet !== undefined,
        // Ruling 202: only the teacher's own theme is sent; the planner's pick stands otherwise.
        themeId: startingTheme(last?.themeId),
      });
      rememberWorksheetIntent(
        client,
        lesson.id,
        worksheet
          ? {
              recipeId: worksheet.recipe,
              practiceMinutes: Number(worksheet.minutes),
              expectedRevision: result.revision,
            }
          : null,
      );
      rememberGenerationOrigin(client, lesson.id, origin);
      await seedConfirmedGeneration(client, lesson, result);
      await navigate({ to: "/l/$lessonId", params: { lessonId: lesson.id } });
    } catch (cause) {
      setLeaving(false);
      await fail(cause);
    } finally {
      setBusy(false);
    }
  }
  const planning =
    !leaving &&
    ((entering && !initialized.current) || (!!lessonId && (!!jobId || !initialized.current)));
  // A skipped plan whose job ended (its terminal event, or the lock gone on a re-read) with no
  // slides: the planning stage says so, as for a failed plan, instead of opening an empty editor.
  const skipFailed =
    lesson?.plan?.state === "confirmed" && !jobId && meta.isSuccess && lesson.slides.length === 0;
  const failed = terminal?.type === "failed" || terminal?.type === "cancelled" || skipFailed;
  const loadingError = document.isError || meta.isError;
  const title = planning
    ? "Planning your lesson"
    : step === "brief"
      ? "Let’s start with your idea."
      : step === "objectives"
        ? "Learning objectives"
        : "Add a worksheet?";
  return (
    <CreationShell
      stage={planning ? "planning" : step}
      characterRef={character}
      title={title}
      working={planning && !failed}
      layout={planning ? "plan" : "column"}
      planning={planning && !failed}
    >
      {findNamePatterns(brief.topic).length > 0 ? <p role="status">{GUARD_MESSAGE}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {signInPrompt ? (
        // A limit (anonymous_limit, the re-plan cap) opens the sign-in sheet over the brief; the
        // plan below stays on screen, and closing the sheet leaves it as it was (TEACH-245).
        <Suspense fallback={null}>
          <SignInSheet
            open
            onOpenChange={(open) => (open ? undefined : setSignInPrompt(""))}
            redirect={signInRedirect()}
            title={signInPrompt.replace(/\.$/, "")}
            description={SIGN_IN_SHEET_BACK_HERE}
          />
        </Suspense>
      ) : null}
      {request.current && error && !lessonId ? (
        <p>
          Your last request will be checked again when you choose Next. Your edited brief will not
          create a second lesson.
        </p>
      ) : null}
      {planning ? (
        <div className="creation-form">
          <p role="status">
            {terminal?.type === "failed"
              ? terminal.error.message
              : failed
                ? "Planning stopped. You can try again with the same brief."
                : loadingError
                  ? "We couldn’t load your plan."
                  : "Finding the key ideas and checking the facts."}
          </p>
          {failed || loadingError || (!jobId && document.isSuccess && !lesson?.facts) ? (
            <Button
              onClick={() => {
                if (lesson?.plan?.state === "confirmed") {
                  // A confirmed plan cannot be planned again: a fresh intake with the whole brief.
                  retryBrief = {
                    brief: {
                      topic: lesson.brief?.topic ?? lesson.title,
                      yearGroup: lesson.yearGroup ?? "Year 4",
                      level: lesson.brief?.level ?? "standard",
                      files: [],
                    },
                    sources: lesson.sources ?? [],
                    slideTier: slideTierOf(lesson.brief),
                  };
                  void navigate({ to: "/lessons/new", search: {}, replace: true });
                } else if (lesson) {
                  initialized.current = true;
                  setBrief({
                    topic: lesson.brief?.topic ?? lesson.title,
                    yearGroup: lesson.yearGroup ?? "Year 4",
                    level: lesson.brief?.level ?? "standard",
                    files: [],
                  });
                  setSources(lesson.sources ?? []);
                  setStep("brief");
                } else void refresh();
              }}
            >
              {" "}
              {lesson && lesson.plan?.state !== "confirmed" ? "Review the brief" : "Try again"}{" "}
            </Button>
          ) : null}
          {jobId && !failed ? (
            <Button
              variant="link"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const response = await api.jobs[":id"].cancel.$post(
                    { param: { id: jobId } },
                    sessionRequest(client),
                  );
                  if (response.status !== 202) throw await apiErrorFromResponse(response);
                } catch (cause) {
                  await fail(cause);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Stop planning
            </Button>
          ) : null}
        </div>
      ) : (
        <>
          <fieldset disabled={busy || sourcesBusy} className="relative min-w-0 border-0 p-0 m-0">
            {step === "brief" ? (
              <BriefStep
                brief={brief}
                onChange={setBrief}
                onNext={() => void plan(false)}
                onSkip={lessonId ? undefined : () => void plan(true)}
                filePicker={
                  guest ? (
                    // Uploads are account-only (UX ruling 110): no drop zone before sign-in.
                    <div className="creation-upload">
                      <Button variant="link" size="sm" onClick={() => signIn(true)}>
                        Add materials
                      </Button>
                    </div>
                  ) : (
                    <div className="creation-upload">
                      <Button
                        variant="link"
                        size="sm"
                        onClick={() => setSourcesOpen(!sourcesOpen)}
                        aria-expanded={sourcesOpen}
                      >
                        Add materials
                      </Button>
                      <SourceDropZone
                        open={sourcesOpen}
                        onOpenChange={setSourcesOpen}
                        sources={sources}
                        boundSourceIds={lesson?.sources?.map(({ id }) => id)}
                        onChange={setSources}
                        onBusyChange={setSourcesBusy}
                        disabled={busy}
                        focusChooseFiles={focusSources}
                      />
                    </div>
                  )
                }
              />
            ) : step === "objectives" ? (
              <ObjectivesStep
                brief={brief}
                objectives={objectives}
                onChange={setObjectives}
                slideTier={slideTier}
                onSlideTier={setSlideTier}
                duration=""
                onDuration={() => {}}
                onBack={() => setStep("brief")}
                // Worksheets are account-only (UX ruling 109): a guest goes straight to generating.
                onGenerate={() => (guest ? void generate(false) : setStep("worksheet"))}
              />
            ) : (
              <WorksheetStep
                worksheets={worksheets}
                onChange={setWorksheets}
                maxWorksheets={1}
                onBack={() => setStep("objectives")}
                onMake={() => void generate(true)}
                onSkip={() => void generate(false)}
              />
            )}
            {/* UX audit J11: one line, spinner beside its words, drawn under the step's last row
                without taking room in the page, so nothing below it moves while the choices save.
                The live region is always mounted so the words are announced when they appear. */}
            <p role="status" className="creation-saving">
              {busy ? (
                <>
                  <Spinner /> Saving your choices…
                </>
              ) : null}
            </p>
          </fieldset>
          {/* Turnstile's interactive challenge, when Cloudflare asks for one (signed out only). Once it
              has content it starts below the saving line, which never covers it. */}
          {signedOut ? <div ref={turnstile.containerRef} data-turnstile /> : null}
          {step === "brief" && !lessonId && !guest ? (
            <Button variant="link" size="sm" onClick={() => setBlank(true)}>
              Blank lesson
            </Button>
          ) : null}
        </>
      )}
      <Suspense fallback={null}>
        {blank ? (
          <NewDocumentDialog
            open
            onOpenChange={setBlank}
            onCreate={(values) => actions.createNewDocument("lesson", values)}
          />
        ) : null}
      </Suspense>
    </CreationShell>
  );
}
