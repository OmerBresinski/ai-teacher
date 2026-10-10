import type { useJobEvents } from "@/hooks/use-job-events";

// The job-sync cadence shared by the generating view and the editor's filling follower. It lives
// apart from `GeneratingLesson` so the follower, which the editor loads statically, does not drag
// the lazy generating shell into the editor's first paint.

/** The worker coalesces persist → progress at this cadence; a burst of events is one refetch. */
export const REFETCH_DEBOUNCE_MS = 250;

/** How often the generating view re-reads the lesson in case the stream missed the job's end. */
export const JOB_POLL_MS = 3000;

export function lastDocumentUpdatedAt(events: ReturnType<typeof useJobEvents>["events"]) {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]?.event;
    if (event?.type === "progress" && event.progress.documentUpdatedAt !== undefined) {
      return event.progress.documentUpdatedAt;
    }
  }
  return undefined;
}
