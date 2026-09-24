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
import {
  BriefStep,
  type IntakeBrief,
  type ObjectiveDraft,
  ObjectivesStep,
  type WorksheetDraft,
  WorksheetStep,
} from "@/components/lesson-creation/step-fields";
import { useLibraryActions } from "@/components/library/use-library-actions";
import { SourceDropZone } from "@/components/source-drop-zone/SourceDropZone";
import { useJobEvents } from "@/hooks/use-job-events";
import { api } from "@/lib/api";
import { readLastClass, writeLastClass } from "@/lib/brief-memory";
import {
  confirmLesson,
  objectiveEdits,
  replanLesson,
  seedConfirmedGeneration,
} from "@/lib/lesson-intake";
import { rememberGenerationOrigin, rememberWorksheetIntent } from "@/lib/lesson-worksheets";
import { libraryMutations, libraryQueries } from "@/lib/library";
import { ApiError, apiErrorFromResponse } from "@/lib/query";
import { sessionRequest } from "@/lib/session-boundary";
import { lessonBriefRoute } from "./lesson-brief.route";

const NewDocumentDialog = lazy(() =>
  import("@/components/new-document-dialog").then(({ NewDocumentDialog }) => ({
    default: NewDocumentDialog,
  })),
);

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
  useEffect(() => {
    if (!lesson) return;
    if (lesson.plan?.state === "confirmed") {
      void navigate({ to: "/l/$lessonId", params: { lessonId: lesson.id } });
      return;
    }
    if (initialized.current || jobId || !meta.isSuccess || lesson.generation?.stage !== "planned")
      return;
    initialized.current = true;
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
  }, [lesson, jobId, meta.isSuccess, navigate]);

  async function fail(cause: unknown) {
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
    try {
      const input = CreateLessonSchema.parse({
        brief: { topic: brief.topic.trim(), level: brief.level, slideCount: Number(slideCount) },
        yearGroup: brief.yearGroup,
        ...(last?.themeId ? { themeId: last.themeId } : {}),
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
          subject: lesson.brief?.topic === input.brief.topic ? lesson.subject : "",
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
      setBusy(false);
    }
  }
  async function generate(includeWorksheet: boolean) {
    if (!lesson || busy) return;
    const origin = character.current?.capture() ?? null;
    setBusy(true);
    setError("");
    try {
      const result = await confirmLesson(client, lesson.id, {
        expectedRevision: lesson.plan?.revision ?? 0,
        objectives: objectiveEdits(lesson, objectives),
        slideCount: Number(slideCount) as 6 | 8 | 10 | 12,
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
  const planning = !!lessonId && (!!jobId || !initialized.current);
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
    >
      {findNamePatterns(brief.topic).length > 0 ? <p role="status">{GUARD_MESSAGE}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
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
          ) : (
            <Spinner />
          )}
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
                onSkip={() => void plan(!lessonId)}
                filePicker={
                  <div className="creation-upload">
                    <Button
                      variant="link"
                      size="sm"
                      onClick={() => setSourcesOpen(!sourcesOpen)}
                      aria-expanded={sourcesOpen}
                    >
                      Add materials
                    </Button>
                    {sourcesOpen ? (
                      <SourceDropZone
                        sources={sources}
                        boundSourceIds={lesson?.sources?.map(({ id }) => id)}
                        onChange={setSources}
                        onBusyChange={setSourcesBusy}
                        disabled={busy}
                        focusChooseFiles={focusSources}
                      />
                    ) : null}
                  </div>
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
                onGenerate={() => setStep("worksheet")}
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
          {step === "brief" && !lessonId ? (
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
