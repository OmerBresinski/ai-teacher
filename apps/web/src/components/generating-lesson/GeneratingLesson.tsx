import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Id, Lesson } from "@tj/domain/documents";
import { type ReactNode, useEffect } from "react";
import { useJobEvents } from "@/hooks/use-job-events";
import { api } from "@/lib/api";
import { libraryCache } from "@/lib/library";
import { apiErrorFromResponse, queryKeys } from "@/lib/query";
import { GeneratingShell } from "./GeneratingShell";

/**
 * `/l/$lessonId` while a `lesson.plan` job holds the generating lock (ADR 0024 §18, ADR 0025 §7):
 * the shell over SSE with the lesson read-only inside it. Every `progress` event that names a new
 * `documentUpdatedAt` refetches the body, debounced by `REFETCH_DEBOUNCE_MS` to match the worker's
 * emitter, so slides appear as they are written; the terminal event reads the finished row once
 * and writes the body with its released lock, which hands the page back to the editor in place.
 * `failed` and `cancelled`
 * keep the partial slides visible under their message with a way back to the library; Stop
 * cancels the job through `POST /jobs/:id/cancel`.
 */

/** The worker coalesces persist → progress at this cadence; a burst of events is one refetch. */
export const REFETCH_DEBOUNCE_MS = 250;

export function GeneratingLesson({
  lesson,
  jobId,
  estimate,
  onBack,
  onStopped,
  onViewSlide,
  exportSlot,
}: {
  lesson: Lesson;
  jobId: string;
  /** The estimate text for the top bar's slot (TEACH-201). */
  estimate?: ReactNode;
  /** The export control (TEACH-110): the locked lesson exports its current body. */
  exportSlot?: ReactNode;
  onBack: () => void;
  /** The job ended without completing; the page keeps this view for `jobId` once the lock clears. */
  onStopped: (jobId: string) => void;
  /** The slide the teacher is looking at (`null` = the newest), so the editor opens on it at Ready. */
  onViewSlide?: (slideId: Id | null) => void;
}) {
  const queryClient = useQueryClient();
  const stream = useJobEvents(jobId);
  // The last `documentUpdatedAt` the stream carried, whichever event it rode in on: a `progress`
  // without one (a message-only tick) must not reset the value and re-trigger a refetch.
  const documentUpdatedAt = lastDocumentUpdatedAt(stream.events);
  const terminal = stream.terminal;

  // The stream is the external subscription; these invalidations are its side effects on the
  // cache (ADR 0012), not derived state. The body refetch waits `REFETCH_DEBOUNCE_MS` so a burst
  // of persists is one request; the terminal refetch goes at once.
  useEffect(() => {
    if (documentUpdatedAt === undefined) return;
    const timer = window.setTimeout(
      () => void queryClient.invalidateQueries({ queryKey: queryKeys.libraryDocument(lesson.id) }),
      REFETCH_DEBOUNCE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [documentUpdatedAt, lesson.id, queryClient]);
  // The terminal event hands the page to the editor: `handOverDocument` reads the finished row
  // once and writes the body and its released lock together, so the editor mounts on the finished
  // document and never on the last debounced copy (TEACH-251 — the fit migration used to run on
  // that copy and be spent when the real body landed at `fitVersion: 0`). A `failed` /
  // `cancelled` outcome is reported to the page first, so it keeps this view — the message, the
  // partial slides, the way back — rather than opening the editor on the unlocked row; the next
  // visit reads the row afresh and edits what was written.
  useEffect(() => {
    if (terminal === null) return;
    if (terminal.type !== "completed") onStopped(jobId);
    void libraryCache
      .handOverDocument(queryClient, lesson.id)
      .then(() => queryClient.invalidateQueries({ queryKey: queryKeys.libraryDocuments }));
  }, [terminal, lesson.id, jobId, queryClient, onStopped]);

  const cancel = useMutation({
    mutationFn: async () => {
      const res = await api.jobs[":id"].cancel.$post({ param: { id: jobId } });
      if (res.status !== 202) throw await apiErrorFromResponse(res);
      return res.json();
    },
  });

  return (
    <GeneratingShell
      lesson={lesson}
      events={stream.events.map((record) => record.event)}
      estimate={estimate}
      onBack={onBack}
      onStop={() => {
        if (!cancel.isPending && !cancel.isSuccess) cancel.mutate();
      }}
      stop={{ pending: cancel.isPending, sent: cancel.isSuccess, error: cancel.isError }}
      onViewSlide={onViewSlide}
      exportSlot={exportSlot}
    />
  );
}

function lastDocumentUpdatedAt(events: ReturnType<typeof useJobEvents>["events"]) {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]?.event;
    if (event?.type === "progress" && event.progress.documentUpdatedAt !== undefined) {
      return event.progress.documentUpdatedAt;
    }
  }
  return undefined;
}
