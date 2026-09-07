import { useQueryClient } from "@tanstack/react-query";
import type { Lesson } from "@tj/domain/documents";
import { LessonViewer } from "@tj/editor/present";
import { EmptyState, Spinner } from "@tj/ui";
import { Sparkles } from "lucide-react";
import { type ReactNode, useEffect } from "react";
import { useJobEvents } from "@/hooks/use-job-events";
import { queryKeys } from "@/lib/query";

/**
 * `/l/$lessonId` while a `lesson.plan` job holds the generating lock (ADR 0024 §18, ADR 0025 §7):
 * a banner with the job's progress over SSE and the lesson read-only underneath. Every `progress`
 * event that names a new `documentUpdatedAt` refetches the body, so slides appear as the worker
 * writes them; the terminal event refetches the row state, which clears the lock and hands the
 * page back to the editor. TEACH-133 replaces this with the full generating view.
 */
export function GeneratingLesson({
  lesson,
  jobId,
  leading,
}: {
  lesson: Lesson;
  jobId: string;
  leading?: ReactNode;
}) {
  const queryClient = useQueryClient();
  const stream = useJobEvents(jobId);
  const latest = stream.events.at(-1)?.event;
  const message = latest?.type === "progress" ? latest.progress.message : undefined;
  const documentUpdatedAt =
    latest?.type === "progress" ? latest.progress.documentUpdatedAt : undefined;
  const terminal = stream.terminal;

  // The stream is the external subscription; these invalidations are its side effects on the
  // cache (ADR 0012), not derived state.
  useEffect(() => {
    if (documentUpdatedAt === undefined) return;
    void queryClient.invalidateQueries({ queryKey: queryKeys.libraryDocument(lesson.id) });
  }, [documentUpdatedAt, lesson.id, queryClient]);
  useEffect(() => {
    if (terminal === null) return;
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.libraryDocument(lesson.id) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.libraryDocumentMeta(lesson.id) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.libraryDocuments }),
    ]);
  }, [terminal, lesson.id, queryClient]);

  const failed = terminal !== null && terminal.type !== "completed";

  return (
    <div className="flex min-h-dvh flex-col">
      <output
        aria-live="polite"
        data-testid="generating-banner"
        className="flex flex-wrap items-center gap-3 border-b border-border bg-card px-6 py-3 text-body"
      >
        {failed ? null : <Spinner size={16} />}
        <span className="font-medium">
          {failed
            ? "Generation stopped before the lesson was finished."
            : `Generating your lesson…${stream.percent === null ? "" : ` ${stream.percent}%`}`}
        </span>
        {message && !failed ? <span className="text-ink-3">{message}</span> : null}
        {stream.percent !== null && !failed ? (
          <progress className="ml-auto h-1.5 w-40" max={100} value={stream.percent} />
        ) : null}
      </output>
      {lesson.slides.length > 0 ? (
        <LessonViewer
          lesson={lesson}
          leading={leading}
          onPresent={() => undefined}
          onDuplicate={() => Promise.resolve()}
        />
      ) : (
        <main className="flex flex-1 items-center justify-center px-6 py-12">
          <EmptyState
            icon={<Sparkles strokeWidth={1.5} />}
            title={lesson.title}
            body="The first slides appear here as they are written."
            action={leading}
          />
        </main>
      )}
    </div>
  );
}
