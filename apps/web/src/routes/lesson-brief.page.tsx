import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import {
  CreateLessonSchema,
  findNamePatterns,
  GUARD_MESSAGE,
  type Lesson,
  type SourceRef,
} from "@tj/domain/documents";
import { Button, Spinner } from "@tj/ui";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
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
 * The longest the plan screen waits for Plan to finish reading once the objectives are ready.
 * Plan's animation normally hands over in a second or two; if it never does (its chunk failed to
 * load after a deploy, or the animation stalled), the page moves on anyway.
 */
export const REVEAL_MAX_MS = 4000;
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
  return (
    <LessonIntake
      key={search.lesson ?? "new"}
      lessonId={search.lesson}
      topic={search.topic}
      focusSources={search.source === "1"}
    />
  );
}

function LessonIntake({
  lessonId,
  topic,
  focusSources,
}: {
  lessonId?: string;
  topic?: string;
  focusSources: boolean;
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
  const [brief, setBrief] = useState<IntakeBrief>({
    topic: topic ?? "",
    yearGroup: last?.yearGroup || "Year 4",
    level: "standard",
    files: [],
  });
  const [sources, setSources] = useState<SourceRef[]>([]);
  const [sourcesBusy, setSourcesBusy] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(focusSources);
  const [blank, setBlank] = useState(false);
  const [step, setStep] = useState<"brief" | "objectives" | "worksheet">("brief");
  const [objectives, setObjectives] = useState<ObjectiveDraft[]>([]);
  const [slideCount, setSlideCount] = useState("8");
  const [worksheets, setWorksheets] = useState<WorksheetDraft[]>([
    { id: "initial", recipe: "knowledge-check", minutes: "10" },
  ]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
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
  // The planning stage: whether this tab watched the job run (then Plan finishes reading before the
  // page moves on), and the objectives it is waiting to hand over.
  const watched = useRef(false);
  if (jobId) watched.current = true;
  const [reveal, setReveal] = useState<string[] | null>(null);
  // Leaves the planning stage once: from Plan's hand-over or, failing that, the timer below.
  const finishReveal = () =>
    leaveStage(() => {
      setReveal(null);
      if (lesson) land(lesson);
    });
  const finishRef = useRef(finishReveal);
  finishRef.current = finishReveal;
  useEffect(() => {
    if (!reveal) return;
    const timer = setTimeout(() => finishRef.current(), REVEAL_MAX_MS);
    return () => clearTimeout(timer);
  }, [reveal]);
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
    const recheck = () =>
      void client.invalidateQueries({ queryKey: ["library", "document", lessonId] });
    if (stream.status === "open") recheck();
    const timer = setInterval(recheck, JOB_POLL_MS);
    return () => clearInterval(timer);
  }, [running, stream.status, lessonId, client]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: land only writes state setters.
  useEffect(() => {
    if (!lesson) return;
    if (lesson.plan?.state === "confirmed") {
      void navigate({ to: "/l/$lessonId", params: { lessonId: lesson.id } });
      return;
    }
    if (initialized.current || jobId || !meta.isSuccess || lesson.generation?.stage !== "planned")
      return;
    const ready = (lesson.facts?.objectives ?? []).map(({ text }) => text);
    initialized.current = true;
    if (watched.current) {
      // Plan lowers the brief with a nod before the page moves on (onDone below).
      if (ready.length) setReveal(ready);
      else leaveStage(() => land(lesson));
      return;
    }
    land(lesson);
  }, [lesson, jobId, meta.isSuccess, navigate]);

  function land(lesson: Lesson) {
    setBrief({
      topic: lesson.brief?.topic ?? lesson.title,
      yearGroup: lesson.yearGroup ?? "Year 4",
      level: lesson.brief?.level ?? "standard",
      files: [],
    });
    setSources(lesson.sources ?? []);
    setObjectives((lesson.facts?.objectives ?? []).map(({ id, text }) => ({ id, text })));
    setSlideCount(String(lesson.brief?.slideCount ?? 8));
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
    setBusy(true);
    setError("");
    setSignInPrompt("");
    try {
      const input = CreateLessonSchema.parse({
        brief: { topic: brief.topic.trim(), level: brief.level, slideCount: Number(slideCount) },
        yearGroup: brief.yearGroup,
        // Ruling 116: no theme question; the teacher's last theme, else the class default.
        themeId: startingTheme(last?.themeId, undefined, brief.yearGroup),
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
        if (request.current.input.skipPlanning)
          await navigate({ to: "/l/$lessonId", params: { lessonId: ids.lessonId } });
        else
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
    setBusy(true);
    setError("");
    setSignInPrompt("");
    try {
      const result = await confirmLesson(client, lesson.id, {
        expectedRevision: lesson.plan?.revision ?? 0,
        objectives: objectiveEdits(lesson, objectives),
        slideCount: Number(slideCount) as 6 | 8 | 10 | 12,
        // Plan knows the subject now, so the class default can use it.
        themeId: startingTheme(last?.themeId, lesson.subject, lesson.yearGroup ?? brief.yearGroup),
      });
      const worksheet = worksheets[0];
      rememberWorksheetIntent(
        client,
        lesson.id,
        includeWorksheet && worksheet
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
      await fail(cause);
    } finally {
      setBusy(false);
    }
  }
  const planning = (!!lessonId && (!!jobId || !initialized.current)) || !!reveal;
  const failed = terminal?.type === "failed" || terminal?.type === "cancelled";
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
      planning={
        planning && !failed
          ? {
              objectives: reveal,
              onDone: () => {
                if (reveal) finishReveal();
              },
            }
          : undefined
      }
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
                  : reveal
                    ? `Your ${reveal.length} learning objectives are ready.`
                    : "Finding the key ideas and checking the facts."}
          </p>
          {failed || loadingError || (!jobId && document.isSuccess && !lesson?.facts) ? (
            <Button
              onClick={() => {
                if (lesson) {
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
              {lesson ? "Review the brief" : "Try again"}{" "}
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
          <fieldset disabled={busy || sourcesBusy} className="min-w-0 border-0 p-0 m-0">
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
                slideCount={slideCount}
                onSlideCount={setSlideCount}
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
          </fieldset>
          {busy ? (
            <p role="status">
              <Spinner /> Saving your choices…
            </p>
          ) : null}
          {/* Turnstile's interactive challenge, when Cloudflare asks for one (signed out only). */}
          {signedOut ? <div ref={turnstile.containerRef} /> : null}
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
