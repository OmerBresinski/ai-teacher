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
 * outside the lesson's undo stack (TEACH-170 records the gap). One job at a time per lesson; see
 * `useProposalJobs` for the lane and how the API's singleton `409` is retried.
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

/** A request, held while another job is in flight or sent when the lane is free. */
type Request =
  | { kind: "cascade"; changedFactIds: string[] }
  | { kind: "regenerate"; target: RegenerateTarget; instruction: string | undefined };

/** How long to wait before re-sending a request the API's singleton slot refused. */
export const SINGLETON_RETRY_MS = 5_500;

export type ProposalJobs = {
  onFactsChanged: (changedFactIds: string[]) => void;
  onRegenerate: (target: RegenerateTarget, instruction: string | undefined) => void;
  busySlideIds: ReadonlySet<string>;
  busy: boolean;
};

/**
 * One lane per lesson. `busyRef` is taken the moment a request is sent (before the response, so a
 * second gesture during the round trip is held too) and released once the terminal event has been
 * applied — including the worksheet save, so the next job reads what this one wrote. Held requests
 * are the latest of each kind (cascade ids unioned); the regenerate goes first (a teacher's
 * gesture), the cascade waits for its terminal event. A send refused by the singleton slot is
 * re-held and retried after `SINGLETON_RETRY_MS`; any other failure toasts and hands the lane on.
 */
export function useProposalJobs(
  lessonId: string,
  editorRef: RefObject<LessonEditorHandle | null>,
  worksheetId: string | undefined,
): ProposalJobs {
  const queryClient = useQueryClient();
  const { mutateAsync: saveWorksheet } = useMutation(libraryMutations.saveDocument(queryClient));
  const [pending, setPending] = useState<Pending | null>(null);
  const stream = useJobEvents(pending?.jobId);
  const terminal = stream.terminal;
  const busyRef = useRef(false);
  const held = useRef<Partial<Record<Request["kind"], Request>>>({});
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null);
  // `send` and `release` call each other; the ref breaks the cycle without a stale closure.
  const releaseRef = useRef<() => void>(() => {});
  // Cleared on unmount: a response or terminal event landing afterwards must not send a held
  // request, since nothing would follow its job any more.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      held.current = {};
      if (retry.current) clearTimeout(retry.current);
      retry.current = null;
    };
  }, []);

  const readLesson = useCallback((): Lesson | undefined => {
    const data = queryClient.getQueryData(libraryQueries.document(lessonId).queryKey);
    return data && isFullDocument(data) && "slides" in data ? data : undefined;
  }, [queryClient, lessonId]);

  const hold = useCallback((request: Request) => {
    if (request.kind === "regenerate") {
      held.current.regenerate = request;
      return;
    }
    const prior = held.current.cascade;
    const ids = prior?.kind === "cascade" ? prior.changedFactIds : [];
    held.current.cascade = {
      kind: "cascade",
      changedFactIds: [...new Set([...ids, ...request.changedFactIds])],
    };
  }, []);

  const send = useCallback(
    async (request: Request): Promise<void> => {
      busyRef.current = true;
      const lesson = readLesson();
      const slideIds =
        request.kind === "cascade"
          ? lesson
            ? slidesReferencing(lesson, request.changedFactIds)
            : []
          : [request.target.slideId];
      try {
        const res =
          request.kind === "cascade"
            ? await api.lessons[":id"].cascade.$post({
                param: { id: lessonId },
                json: { changedFactIds: request.changedFactIds },
              })
            : await api.lessons[":id"].regenerate.$post({
                param: { id: lessonId },
                json: {
                  targets: [request.target],
                  ...(request.instruction ? { instruction: request.instruction } : {}),
                },
              });
        if (res.status !== 202) throw await apiErrorFromResponse(res);
        const { jobId } = (await res.json()) as { jobId: string };
        if (alive.current) setPending({ jobId, kind: request.kind, slideIds });
      } catch (error) {
        if (!alive.current) return;
        if (error instanceof ApiError && error.status === 409 && error.reason !== "generating") {
          // The singleton slot: an identical job was sent inside the last few seconds. Hold this
          // one and try again once the slot has passed, so a handoff is never dropped.
          hold(request);
          retry.current = setTimeout(() => {
            retry.current = null;
            releaseRef.current();
          }, SINGLETON_RETRY_MS);
          return;
        }
        if (error instanceof ApiError && error.status === 409) toast(STILL_GENERATING_MESSAGE);
        else toast(error instanceof Error ? error.message : PROPOSALS_FAILED_MESSAGE);
        releaseRef.current();
      }
    },
    [lessonId, readLesson, hold],
  );

  /** Free the lane and send the next held request, if any. */
  const release = useCallback(() => {
    busyRef.current = false;
    if (!alive.current) return;
    const next = held.current.regenerate ?? held.current.cascade;
    if (!next) return;
    delete held.current[next.kind];
    void send(next);
  }, [send]);
  releaseRef.current = release;

  const submit = useCallback(
    (request: Request) => {
      if (busyRef.current || retry.current) hold(request);
      else void send(request);
    },
    [hold, send],
  );

  const onFactsChanged = useCallback(
    (changedFactIds: string[]) => submit({ kind: "cascade", changedFactIds }),
    [submit],
  );
  const onRegenerate = useCallback(
    (target: RegenerateTarget, instruction: string | undefined) =>
      submit({ kind: "regenerate", target, instruction }),
    [submit],
  );

  // The stream is the external subscription; applying its result is the side effect (ADR 0012).
  useEffect(() => {
    if (!pending || terminal === null) return;
    setPending(null);
    void applyTerminal({
      terminal,
      kind: pending.kind,
      lesson: readLesson(),
      editor: editorRef.current,
      worksheetId,
      queryClient,
      saveWorksheet,
    }).finally(release);
  }, [terminal, pending, readLesson, editorRef, worksheetId, queryClient, saveWorksheet, release]);

  const busySlideIds = useMemo(() => new Set(pending?.slideIds ?? []), [pending]);

  return { onFactsChanged, onRegenerate, busySlideIds, busy: pending !== null };
}

type TerminalEvent = NonNullable<ReturnType<typeof useJobEvents>["terminal"]>;

/** Apply one terminal event: proposals into the editor and the worksheet, then the toast. */
async function applyTerminal(args: {
  terminal: TerminalEvent;
  kind: Pending["kind"];
  lesson: Lesson | undefined;
  editor: LessonEditorHandle | null;
  worksheetId: string | undefined;
  queryClient: QueryClient;
  saveWorksheet: (worksheet: Worksheet) => Promise<unknown>;
}): Promise<void> {
  const { terminal, kind, lesson, editor, worksheetId, queryClient, saveWorksheet } = args;
  if (terminal.type !== "completed") {
    toast(terminal.type === "failed" ? terminal.error.message : PROPOSALS_FAILED_MESSAGE);
    return;
  }
  const result = terminal.result;
  if (!result || !isProposalResult(result) || !lesson || !editor) return;
  const slideProposals = result.proposals.filter((p) => p.target.slideId !== undefined);
  const blockProposals = result.proposals.filter((p) => p.target.blockId !== undefined);
  const touched = slideProposals.length > 0 ? editor.applyProposals(slideProposals) : [];
  const numbers = touched.map((id) => lesson.slides.findIndex((s) => s.id === id) + 1);
  const first = touched[0];
  // Undo is offered only when the lesson's history gained an entry: a worksheet-only or
  // flagged-only result has nothing of the teacher's to put back (TEACH-170 for the worksheet).
  const undo = touched.length > 0 ? { label: "Undo", onClick: () => editor.undo() } : undefined;
  const worksheetChanged = blockProposals.length > 0 && worksheetId !== undefined;
  if (kind === "regenerate") {
    toast(
      touched.length > 0
        ? `Regenerated ${slideList(numbers)}`
        : "Nothing could be regenerated this time.",
      undo ? { action: undo } : {},
    );
  } else if (touched.length > 0 || worksheetChanged || result.flagged.length > 0) {
    toast(cascadeToast(numbers, result.flagged.length, worksheetChanged), {
      duration: 12_000,
      ...(undo ? { action: undo } : {}),
      ...(first ? { cancel: { label: "View", onClick: () => editor.goToSlide(first) } } : {}),
    });
  }
  if (worksheetChanged) {
    await applyToWorksheet(queryClient, worksheetId, blockProposals, saveWorksheet);
  }
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
  save: (worksheet: Worksheet) => Promise<unknown>,
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
