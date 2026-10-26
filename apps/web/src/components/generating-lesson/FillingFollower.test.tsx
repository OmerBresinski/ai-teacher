import { afterEach, describe, expect, it } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { installFakeApi } from "@/test/fake-api";
import { FakeEventSource, installFakeEventSource } from "@/test/fake-event-source";
import { generationRun } from "@/test/play-run";
import { FillingFollower, opensFillingEditor, SLIDES_DRAFTED } from "./FillingFollower";

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
    it(`a ${type} job folds the last row, then tells the page it stopped`, async () => {
      const { restore } = installFakeApi();
      installFakeEventSource();
      const jobId = generationRun.jobId;
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      let folds = 0;
      const fold = async () => {
        folds += 1;
        return undefined;
      };
      const stopped: string[] = [];
      try {
        render(
          <QueryClientProvider client={client}>
            <FillingFollower
              jobId={jobId}
              fold={fold}
              onStopped={(id, outcome) => stopped.push(`${id}:${outcome}`)}
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
        await waitFor(() => expect(stopped).toEqual([`${jobId}:${type}`]));
        // The last fold lands the row the job left before the page is told.
        expect(folds).toBeGreaterThan(0);
      } finally {
        restore();
      }
    });
  }
});

describe("FillingFollower when the writer's stream ends (TEACH-202 part o)", () => {
  it("tells the page once the job reports the slides drafted, not before", async () => {
    const { restore } = installFakeApi();
    installFakeEventSource();
    const jobId = generationRun.jobId;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const drafted: string[] = [];
    const progress = (percent: number, message: string) => ({
      type: "progress",
      jobId,
      workspaceId: generationRun.workspaceId,
      at: "2026-10-26T10:00:00.000Z",
      progress: { percent, message, stage: "generate" },
    });
    try {
      render(
        <QueryClientProvider client={client}>
          <FillingFollower
            jobId={jobId}
            fold={async () => undefined}
            onDrafted={(id) => drafted.push(id)}
          />
        </QueryClientProvider>,
      );
      const source = FakeEventSource.latest;
      act(() => {
        source.open();
        source.emit("progress", progress(40, "Writing slide 4 of 10"), "1");
      });
      expect(drafted).toEqual([]);
      act(() => source.emit("progress", progress(66, SLIDES_DRAFTED), "2"));
      await waitFor(() => expect(drafted).toEqual([jobId]));
    } finally {
      restore();
    }
  });
});
