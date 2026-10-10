import { afterEach, describe, expect, it } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import type { Lesson } from "@tj/domain/documents";
import type { LessonEditorHandle } from "@tj/editor/lesson";
import { createRef } from "react";
import { installFakeApi } from "@/test/fake-api";
import { FakeEventSource, installFakeEventSource } from "@/test/fake-event-source";
import { generationRun } from "@/test/play-run";
import { FillingFollower, type FillingFollowerHandle, opensFillingEditor } from "./FillingFollower";

afterEach(() => cleanup());

describe("opensFillingEditor (ADR 0037)", () => {
  const ready = { anonymous: false, stopped: false, proposed: false, editableSlides: true };
  it("opens the editor for a signed-in teacher once a slide is done", () => {
    expect(opensFillingEditor(ready)).toBe(true);
    expect(opensFillingEditor({ ...ready, editableSlides: false })).toBe(false);
  });
  it("never for a guest: the generating view keeps its progress and Stop", () => {
    expect(opensFillingEditor({ ...ready, anonymous: true })).toBe(false);
  });
  it("never once the job was stopped, or for a proposed plan", () => {
    expect(opensFillingEditor({ ...ready, stopped: true })).toBe(false);
    expect(opensFillingEditor({ ...ready, proposed: true })).toBe(false);
  });
});

describe("FillingFollower at the job's end", () => {
  for (const type of ["failed", "cancelled"] as const) {
    it(`a ${type} job hands the page its stopped view; completed does not`, async () => {
      const { fakeApi, restore } = installFakeApi();
      installFakeEventSource();
      const lessonId = generationRun.lesson;
      const jobId = generationRun.jobId;
      const row = fakeApi.get(lessonId);
      if (!row) throw new Error("fixture missing");
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const editorRef = createRef<LessonEditorHandle | null>() as {
        current: LessonEditorHandle | null;
      };
      const received: Lesson[] = [];
      editorRef.current = {
        receiveGenerated: (_base: Lesson, theirs: Lesson) => {
          received.push(theirs);
          return theirs;
        },
      } as unknown as LessonEditorHandle;
      const followerRef = createRef<FillingFollowerHandle | null>() as {
        current: FillingFollowerHandle | null;
      };
      const stopped: string[] = [];
      try {
        render(
          <QueryClientProvider client={client}>
            <FillingFollower
              lessonId={lessonId}
              jobId={jobId}
              base={row.body as Lesson}
              editorRef={editorRef}
              followerRef={followerRef}
              onStopped={(id) => stopped.push(id)}
            />
          </QueryClientProvider>,
        );
        const source = FakeEventSource.latest;
        act(() => {
          source.open();
          source.emit(
            type,
            {
              type,
              jobId,
              workspaceId: generationRun.workspaceId,
              at: "2026-10-09T10:00:00.000Z",
              ...(type === "failed" ? { error: { message: "Stopped", retryable: false } } : {}),
            },
            "1",
          );
        });
        await waitFor(() => expect(stopped).toEqual([jobId]));
        expect(received.length).toBeGreaterThan(0);
      } finally {
        restore();
      }
    });
  }
});
