import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { DraftStore } from "@tj/editor/live-draft";
import { Button } from "@tj/ui";
import { useEffect } from "react";
import { useFeedDrafts, useJobEvents } from "@/hooks/use-job-events";
import { api } from "@/lib/api";
import { apiErrorFromResponse } from "@/lib/query";
import { sessionMutation, sessionRequest } from "@/lib/session-boundary";
import { JOB_POLL_MS, lastDocumentUpdatedAt, REFETCH_DEBOUNCE_MS } from "./job-sync";

/**
 * Whether the editor opens while the lesson still fills (ADR 0037). Never for a guest: a guest's
 * lesson is read-only anyway, and the generating view keeps its progress and its Stop. Never once
 * the job was stopped (the page opens the plain editor on what was written instead), for a
 * proposed plan, or before a slide's words are done.
 */
export function opensFillingEditor(state: {
  anonymous: boolean;
  stopped: boolean;
  proposed: boolean;
  editableSlides: boolean;
}): boolean {
  return !state.anonymous && !state.stopped && !state.proposed && state.editableSlides;
}

/**
 * The editor is open while the lesson still fills (ADR 0037, UX ruling 189). This follows the job
 * the way the generating view did, but never refetches into the editor's working copy: on each
 * persist the stream reports, on a poll, and at the job's end it asks the page to `fold` the
 * newest row into the open document (`receiveGenerated`, a three-way merge on the copy last
 * folded), so the teacher's typing survives every slide the job adds. The page owns the fold
 * because its saves fold first too: a save always carries the row it was merged onto. At the
 * job's end one last fold lands the finished row and the released lock together, which turns the
 * page into the plain editor without remounting it.
 */
export function FillingFollower({
  jobId,
  fold,
  onStopped,
  drafts,
}: {
  jobId: string;
  /** Read the newest row and fold it into the editor (the page's `fold`). */
  fold: () => Promise<unknown>;
  /**
   * The job failed or was cancelled: the page keeps the editor open on what was written and says
   * so (UX-A), after the last fold has landed the row the job left.
   */
  onStopped?: (jobId: string, outcome: "failed" | "cancelled") => void;
  /** Live writing (ADR 0039): the job's slide drafts go here, for the editor's canvas to show. */
  drafts?: DraftStore;
}) {
  const queryClient = useQueryClient();
  const stream = useJobEvents(jobId, queryClient);
  useFeedDrafts(drafts, stream.drafts, stream.terminal !== null);
  const documentUpdatedAt = lastDocumentUpdatedAt(stream.events);

  // Each persist the stream reports, debounced like the generating view's refetch.
  useEffect(() => {
    if (documentUpdatedAt === undefined) return;
    const timer = window.setTimeout(() => void fold().catch(() => undefined), REFETCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [documentUpdatedAt, fold]);
  // The end of the job, and a poll in case the stream missed it: the last fold carries the
  // released lock into the row state, which hands the page to the plain editor.
  const terminal = stream.terminal?.type;
  useEffect(() => {
    if (!terminal) return;
    void fold()
      .catch(() => undefined)
      .then(() => {
        if (terminal !== "completed")
          onStopped?.(jobId, terminal === "failed" ? "failed" : "cancelled");
      });
  }, [terminal, fold, onStopped, jobId]);
  useEffect(() => {
    const timer = window.setInterval(() => void fold().catch(() => undefined), JOB_POLL_MS);
    return () => window.clearInterval(timer);
  }, [fold]);
  return null;
}

/**
 * Stop, while the editor is open on a lesson that still fills (ADR 0037): the generating view's
 * Stop moves into the editor's top bar, so the teacher can end the job from either view. What was
 * written is kept; the follower's last fold releases the page into the plain editor.
 */
export function StopFillingButton({ jobId }: { jobId: string }) {
  const queryClient = useQueryClient();
  const cancel = useMutation(
    sessionMutation(queryClient, {
      mutationFn: async () => {
        const res = await api.jobs[":id"].cancel.$post(
          { param: { id: jobId } },
          sessionRequest(queryClient),
        );
        if (res.status !== 202) throw await apiErrorFromResponse(res);
        return res.json();
      },
    }),
  );
  const sent = cancel.isPending || cancel.isSuccess;
  return (
    <Button
      variant="ghost"
      size="sm"
      data-filling-stop
      disabled={sent}
      onClick={() => {
        if (!sent) cancel.mutate();
      }}
    >
      {sent ? "Stopping" : "Stop"}
    </Button>
  );
}
