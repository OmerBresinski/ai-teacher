import { type QueryClient, useMutation, useQueryClient } from "@tanstack/react-query";
import type { JobResult, Proposal } from "@tj/domain";
import type { Lesson, Worksheet } from "@tj/domain/documents";
import type { LessonEditorHandle, RegenerateTarget } from "@tj/editor/lesson";
import { slidesReferencing } from "@tj/editor/lesson";
import { toast } from "@tj/ui";
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { isFullDocument, libraryMutations, libraryQueries } from "@/lib/library";
import { ApiError, apiErrorFromResponse } from "@/lib/query";
import { useJobEvents } from "./use-job-events";

/*
 * The proposal jobs from the editor's side (TEACH-134, ADR 0025 §18, §19): enqueue a
 * `lesson.cascade` for changed facts or a `lesson.regenerate` for one target, follow the job over
 * SSE (`useJobEvents`, the one consumer), and on `completed` hand `result.proposals` to the open
 * editor (`LessonEditorHandle.applyProposals`, one undo step) with a toast that names the slides
 * and offers Undo and View. Block proposals go to the worksheet row through the ordinary save —
 * outside the lesson's undo stack (a Tech debt ticket records the gap). One job at a time per
 * lesson: the API's singleton `409` while one is queued is expected and ignored.
 */

export const STILL_GENERATING_MESSAGE = "Still generating — try again in a moment";
export const PROPOSALS_FAILED_MESSAGE = "The slides could not be updated. Your edit is kept.";

type Pending = {
  jobId: string;
  kind: "cascade" | "regenerate";
  /** The slides the job will touch, for the busy overlay until the proposals say for sure. */
  slideIds: string[];
};

/** "slides 3 and 5" / "slides 2, 3 and 5" / "slide 4". */
export function slideList(numbers: number[]): string {
  if (numbers.length === 0) return "no slides";
  if (numbers.length === 1) return `slide ${numbers[0]}`;
  const head = numbers.slice(0, -1).join(", ");
  return `slides ${head} and ${numbers.at(-1)}`;
}

export function cascadeToast(numbers: number[], flagged: number, worksheet = false): string {
  const changed =
    numbers.length > 0
      ? `Auto changed on ${slideList(numbers)}${worksheet ? " and the worksheet" : ""} to match`
      : worksheet
        ? "Auto changed the worksheet to match"
        : "Nothing on the slides needed changing";
  if (flagged === 0) return changed;
  return `${changed} · ${flagged} ${flagged === 1 ? "needs" : "need"} your OK`;
}

/** A request held while another job is in flight: the latest of its kind. */
type Deferred =
  | { kind: "cascade"; changedFactIds: string[] }
  | { kind: "regenerate"; target: RegenerateTarget; instruction: string | undefined };

export function useProposalJobs(
  lessonId: string,
  editorRef: RefObject<LessonEditorHandle | null>,
  worksheetId: string | undefined,
) {
  const queryClient = useQueryClient();
  const { mutateAsync: saveWorksheet } = useMutation(libraryMutations.saveDocument(queryClient));
  const [pending, setPending] = useState<Pending | null>(null);
  const stream = useJobEvents(pending?.jobId);
  const terminal = stream.terminal;
  // Held requests, by kind, while a job is in flight; read when the terminal event lands.
  const deferred = useRef<Partial<Record<Deferred["kind"], Deferred>>>({});
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  const readLesson = useCallback((): Lesson | undefined => {
    const data = queryClient.getQueryData(libraryQueries.document(lessonId).queryKey);
    return data && isFullDocument(data) && "slides" in data ? data : undefined;
  }, [queryClient, lessonId]);

  const enqueue = useCallback(
    async (
      kind: Pending["kind"],
      request: () => Promise<{ status: number; json(): Promise<unknown> }>,
      slideIds: string[],
    ) => {
      try {
        const res = await request();
        if (res.status !== 202) throw await apiErrorFromResponse(res);
        const { jobId } = (await res.json()) as { jobId: string };
        setPending({ jobId, kind, slideIds });
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          // `generating`: the pipeline still holds the lock. Anything else at 409 is the singleton
          // — a job for this lesson is already queued and will see the same document.
          if (error.reason === "generating") toast(STILL_GENERATING_MESSAGE);
          return;
        }
        toast(error instanceof Error ? error.message : PROPOSALS_FAILED_MESSAGE);
      }
    },
    [],
  );

  const onFactsChanged = useCallback(
    (changedFactIds: string[]) => {
      if (pendingRef.current) {
        const held = deferred.current.cascade;
        const ids = held?.kind === "cascade" ? held.changedFactIds : [];
        deferred.current.cascade = {
          kind: "cascade",
          changedFactIds: [...new Set([...ids, ...changedFactIds])],
        };
        return;
      }
      const lesson = readLesson();
      void enqueue(
        "cascade",
        () =>
          api.lessons[":id"].cascade.$post({ param: { id: lessonId }, json: { changedFactIds } }),
        lesson ? slidesReferencing(lesson, changedFactIds) : [],
      );
    },
    [enqueue, lessonId, readLesson],
  );

  const onRegenerate = useCallback(
    (target: RegenerateTarget, instruction: string | undefined) => {
      if (pendingRef.current) {
        deferred.current.regenerate = { kind: "regenerate", target, instruction };
        return;
      }
      void enqueue(
        "regenerate",
        () =>
          api.lessons[":id"].regenerate.$post({
            param: { id: lessonId },
            json: { targets: [target], ...(instruction ? { instruction } : {}) },
          }),
        [target.slideId],
      );
    },
    [enqueue, lessonId],
  );

  /** Send whatever was held while the last job ran: the regenerate first (a teacher's gesture). */
  const runDeferred = useCallback(() => {
    const held = deferred.current;
    deferred.current = {};
    const next = held.regenerate ?? held.cascade;
    if (!next) return;
    if (next.kind === "regenerate") onRegenerate(next.target, next.instruction);
    else onFactsChanged(next.changedFactIds);
    // The other kind, if any, waits for this one's terminal event.
    const other = next.kind === "regenerate" ? held.cascade : undefined;
    if (other) deferred.current.cascade = other;
  }, [onRegenerate, onFactsChanged]);

  // The stream is the external subscription; applying its result is the side effect (ADR 0012).
  useEffect(() => {
    if (!pending || terminal === null) return;
    setPending(null);
    pendingRef.current = null;
    try {
      if (terminal.type !== "completed") {
        toast(terminal.type === "failed" ? terminal.error.message : PROPOSALS_FAILED_MESSAGE);
        return;
      }
      const result = terminal.result;
      if (!result || !isProposalResult(result)) return;
      const lesson = readLesson();
      const editor = editorRef.current;
      if (!lesson || !editor) return;
      const slideProposals = result.proposals.filter((p) => p.target.slideId !== undefined);
      const blockProposals = result.proposals.filter((p) => p.target.blockId !== undefined);
      const touched = slideProposals.length > 0 ? editor.applyProposals(slideProposals) : [];
      const worksheetChanged = blockProposals.length > 0 && worksheetId !== undefined;
      if (worksheetChanged) {
        void applyToWorksheet(queryClient, worksheetId, blockProposals, saveWorksheet);
      }
      const numbers = touched.map((id) => lesson.slides.findIndex((s) => s.id === id) + 1);
      const first = touched[0];
      // Undo is offered only when the lesson's history gained an entry: a worksheet-only or
      // flagged-only result has nothing of the teacher's to put back (TEACH-170 for the worksheet).
      const undo = touched.length > 0 ? { label: "Undo", onClick: () => editor.undo() } : undefined;
      if (pending.kind === "regenerate") {
        toast(
          touched.length > 0
            ? `Regenerated ${slideList(numbers)}`
            : "Nothing could be regenerated this time.",
          undo ? { action: undo } : {},
        );
        return;
      }
      if (touched.length === 0 && !worksheetChanged && result.flagged.length === 0) return;
      toast(cascadeToast(numbers, result.flagged.length, worksheetChanged), {
        duration: 12_000,
        ...(undo ? { action: undo } : {}),
        ...(first ? { cancel: { label: "View", onClick: () => editor.goToSlide(first) } } : {}),
      });
    } finally {
      runDeferred();
    }
  }, [
    terminal,
    pending,
    readLesson,
    editorRef,
    worksheetId,
    queryClient,
    saveWorksheet,
    runDeferred,
  ]);

  const busySlideIds = useMemo(() => new Set(pending?.slideIds ?? []), [pending]);

  return { onFactsChanged, onRegenerate, busySlideIds, busy: pending !== null };
}

const isProposalResult = (
  result: JobResult,
): result is Extract<JobResult, { job: "lesson.cascade" | "lesson.regenerate" }> =>
  result.job === "lesson.cascade" || result.job === "lesson.regenerate";

/**
 * Block proposals land on the worksheet row through the ordinary whole-document save: the
 * worksheet is read from the cache or fetched (the row may not have loaded yet), the reducer loads
 * on demand (the lesson page never carries the worksheet chunk), the result is written over the
 * cached worksheet and PUT. Not part of the lesson's undo step (TEACH-170).
 */
async function applyToWorksheet(
  queryClient: QueryClient,
  worksheetId: string,
  proposals: Proposal[],
  save: (worksheet: Worksheet) => Promise<void>,
): Promise<void> {
  const current = await queryClient
    .fetchQuery(libraryQueries.document(worksheetId, queryClient))
    .catch(() => undefined);
  if (!current || !isFullDocument(current) || !("blocks" in current)) {
    toast(PROPOSALS_FAILED_MESSAGE);
    return;
  }
  const { worksheetReducers } = await import("@tj/editor/worksheet");
  const next = worksheetReducers.applyBlockProposals(current, proposals);
  if (next === current) return;
  queryClient.setQueryData(libraryQueries.document(worksheetId).queryKey, next);
  try {
    await save(next);
  } catch (error) {
    toast(error instanceof Error ? error.message : PROPOSALS_FAILED_MESSAGE);
  }
}
