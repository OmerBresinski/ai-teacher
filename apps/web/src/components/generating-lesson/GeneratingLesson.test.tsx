import { afterEach, describe, expect, it } from "bun:test";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import type { Lesson } from "@tj/domain/documents";
import { demoWorkspace } from "@tj/editor/starter";
import { TooltipProvider } from "@tj/ui";
import { isFullDocument, libraryQueries } from "@/lib/library";
import { queryKeys } from "@/lib/query";
import { installFakeApi } from "@/test/fake-api";
import { FakeEventSource, installFakeEventSource } from "@/test/fake-event-source";
import { bodyAt, generationRun, runEvent } from "@/test/play-run";
import { GeneratingLesson } from "./GeneratingLesson";

/*
 * The handoff at the terminal event (TEACH-251): `libraryCache.handOverDocument` reads the finished
 * row once and writes the body and its released lock in one batch, so the editor never mounts on
 * the last debounced copy of the lesson. The test slows the first `GET /documents/:id` so two
 * refetches side by side would land the row state before the body — the race that left generated
 * lessons at `fitVersion: 0` in production.
 */

const full = (() => {
  const found = demoWorkspace(new Date()).find((d) => d.key === generationRun.lesson);
  if (!found || !("slides" in found.body)) throw new Error("demo lesson missing");
  return found.body as Lesson;
})();

const noop = () => undefined;

/**
 * The page's two queries around the component, as `LessonEditorPage` mounts them. Every render
 * with the lock released reports the body it would hand the editor.
 */
function Harness({
  lessonId,
  jobId,
  client,
  onUnlocked,
}: {
  lessonId: string;
  jobId: string;
  client: QueryClient;
  onUnlocked: (slides: number) => void;
}) {
  const { data } = useQuery(libraryQueries.document(lessonId, client));
  const { data: meta } = useQuery({
    ...libraryQueries.documentMeta(lessonId),
    enabled: data != null,
  });
  if (!data || !isFullDocument(data) || !("slides" in data)) return null;
  if (meta && meta.generatingJobId === null) {
    onUnlocked(data.slides.length);
    return null;
  }
  return <GeneratingLesson lesson={data} jobId={jobId} onBack={noop} onStopped={noop} />;
}

afterEach(() => {
  cleanup();
});

describe("GeneratingLesson at the terminal event", () => {
  it("clears the lock only once the finished body is in the cache, however the two refetches race", async () => {
    const { fakeApi, restore } = installFakeApi();
    installFakeEventSource();
    const lessonId = generationRun.lesson;
    const jobId = generationRun.jobId;
    const row = fakeApi.get(lessonId);
    if (!row) throw new Error("fixture missing");

    // The worker's last debounced write: a prefix of the lesson, still locked.
    const partial = bodyAt(generationRun, 3, full);
    row.body = partial;
    fakeApi.setGenerating(lessonId, jobId);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(queryKeys.libraryDocument(lessonId), partial);
    client.setQueryData(queryKeys.libraryDocumentMeta(lessonId), {
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: null,
      generatingJobId: jobId,
    });

    // The first document read after the terminal event is slow; any later one is instant. Side by
    // side, the row state would have landed first.
    const fakeFetch = globalThis.fetch;
    let slowed = false;
    const slowFirstRead = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (
        !slowed &&
        url.includes(`/api/documents/${lessonId}`) &&
        (init?.method ?? "GET") === "GET"
      ) {
        slowed = true;
        await new Promise((r) => setTimeout(r, 40));
      }
      return fakeFetch(input, init);
    };
    globalThis.fetch = slowFirstRead as unknown as typeof fetch;

    // The body the page would hand the editor, per render with the lock released.
    const slidesWhenUnlocked: number[] = [];
    render(
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <Harness
            lessonId={lessonId}
            jobId={jobId}
            client={client}
            onUnlocked={(n) => slidesWhenUnlocked.push(n)}
          />
        </TooltipProvider>
      </QueryClientProvider>,
    );
    act(() => FakeEventSource.latest.open());

    // The worker finishes: the full lesson is on the row, the lock is released, then `completed`.
    row.body = full;
    fakeApi.touch(lessonId);
    fakeApi.setGenerating(lessonId, null);
    const completed = runEvent(generationRun, generationRun.events.length - 1);
    expect(completed.type).toBe("completed");
    act(() => FakeEventSource.latest.emit("completed", completed, "99"));

    await waitFor(() => expect(slidesWhenUnlocked.length).toBeGreaterThan(0));
    expect(slidesWhenUnlocked[0]).toBe(full.slides.length);
    expect(partial.slides.length).toBeLessThan(full.slides.length);

    globalThis.fetch = fakeFetch;
    restore();
  });
});
