import { useQueryClient } from "@tanstack/react-query";
import type { Lesson } from "@tj/domain/documents";
import type { LessonEditorHandle } from "@tj/editor/lesson";
import { type RefObject, useCallback, useEffect, useImperativeHandle, useRef } from "react";
import { useJobEvents } from "@/hooks/use-job-events";
import { libraryCache } from "@/lib/library";
import { sessionIsCurrent } from "@/lib/session-boundary";
import { JOB_POLL_MS, lastDocumentUpdatedAt, REFETCH_DEBOUNCE_MS } from "./GeneratingLesson";

/** What the page may ask of the follower: fold the job's newest row in now (a save went stale). */
export type FillingFollowerHandle = { pull: () => Promise<Lesson | undefined> };

/**
 * The editor is open while the lesson still fills (ADR 0037, UX ruling 189). This follows the job
 * the way the generating view did, but never refetches into the editor's working copy: each newer
 * row is read on the side and folded into the open document by `receiveGenerated`, a three-way
 * merge on the copy last received, so the teacher's typing survives every slide the job adds. At
 * the job's end one last pull lands the finished row and the released lock together, which turns
 * the page into the plain editor without remounting it.
 */
export function FillingFollower({
  lessonId,
  jobId,
  base,
  editorRef,
  followerRef,
}: {
  lessonId: string;
  jobId: string;
  /** The row the editor opened on: the base of the first merge. */
  base: Lesson;
  editorRef: RefObject<LessonEditorHandle | null>;
  followerRef: RefObject<FillingFollowerHandle | null>;
}) {
  const queryClient = useQueryClient();
  const stream = useJobEvents(jobId, queryClient);
  const documentUpdatedAt = lastDocumentUpdatedAt(stream.events);
  const baseRef = useRef(base);
  const inFlight = useRef<Promise<Lesson | undefined> | null>(null);

  const pull = useCallback((): Promise<Lesson | undefined> => {
    if (inFlight.current) return inFlight.current;
    const run = (async () => {
      const row = await libraryCache.readFilling(queryClient, lessonId);
      if (!row || !sessionIsCurrent(queryClient)) return undefined;
      const merged = editorRef.current?.receiveGenerated(baseRef.current, row.body);
      baseRef.current = row.body;
      libraryCache.setMetaIfNewer(queryClient, lessonId, row.meta);
      return merged;
    })().finally(() => {
      inFlight.current = null;
    });
    inFlight.current = run;
    return run;
  }, [queryClient, lessonId, editorRef]);
  useImperativeHandle(followerRef, () => ({ pull }), [pull]);

  // Each persist the stream reports, debounced like the generating view's refetch.
  useEffect(() => {
    if (documentUpdatedAt === undefined) return;
    const timer = window.setTimeout(() => void pull().catch(() => undefined), REFETCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [documentUpdatedAt, pull]);
  // The end of the job, and a poll in case the stream missed it: the last pull carries the
  // released lock into the row state, which hands the page to the plain editor.
  const terminal = stream.terminal?.type;
  useEffect(() => {
    if (terminal) void pull().catch(() => undefined);
  }, [terminal, pull]);
  useEffect(() => {
    const timer = window.setInterval(() => void pull().catch(() => undefined), JOB_POLL_MS);
    return () => window.clearInterval(timer);
  }, [pull]);
  return null;
}
