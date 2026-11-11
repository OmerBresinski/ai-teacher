import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Lesson } from "@tj/domain/documents";
import { demoWorkspace } from "@tj/editor/starter";
import { TooltipProvider } from "@tj/ui";
import { installFakeApi } from "@/test/fake-api";
import { installFakeEventSource } from "@/test/fake-event-source";
import { LessonWorksheets } from "./LessonWorksheets";

/*
 * WS2: the lesson's Worksheet dialog shows a failed sheet with the reason its job saved and a Try
 * again that asks for the same sheet, and the entry's label says how the newest sheet stands.
 */

const { fakeApi, restore } = installFakeApi();

const demo = demoWorkspace(new Date()).find((row) => "slides" in row.body)?.body as Lesson;
const lesson: Lesson = {
  ...demo,
  id: "lesson-ws2",
  plan: { state: "confirmed", revision: 2, jobId: "plan-job" },
  // Planned and written: the dialog only offers a request then (`ready`).
  generation: {
    jobId: "gen-job",
    stage: "repaired",
    startedAt: "2026-11-11T09:00:00.000Z",
    completedAt: "2026-11-11T09:01:00.000Z",
    promptVersions: {},
    usage: { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
    findings: [],
  },
};

const failedItem = {
  id: "sheet-1",
  kind: "worksheet",
  title: "Water cycle exit ticket",
  createdAt: "2026-11-11T09:00:00.000Z",
  updatedAt: "2026-11-11T10:00:00.000Z",
  deletedAt: null,
  generatingJobId: null,
  unfinished: true,
  generation: {
    jobId: "job-1",
    stage: "failed",
    startedAt: "2026-11-11T09:59:00.000Z",
    promptVersions: {},
    usage: { calls: 2, inputTokens: 0, outputTokens: 0, costUsd: 0 },
    findings: [],
    recipeId: "exit-ticket",
    practiceMinutes: 15,
    failure: {
      code: "could-not-write",
      message: "We couldn’t write this sheet. Try again, or choose another type.",
    },
  },
};

function serveList(items: unknown[], times = 6) {
  for (let i = 0; i < times; i++) {
    fakeApi.failNext(
      (request) => request.method === "GET" && request.path === `/lessons/${lesson.id}/worksheets`,
      () =>
        new Response(JSON.stringify({ items }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
  }
}

function renderDialog(onLabel = mock((_label: string) => {})) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <LessonWorksheets
          lesson={lesson}
          open
          onOpenChange={() => {}}
          onOpenWorksheet={() => {}}
          trigger={false}
          onLabel={onLabel}
        />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return { onLabel };
}

describe("LessonWorksheets (WS2)", () => {
  beforeEach(() => {
    cleanup();
    fakeApi.reset();
    sessionStorage.clear();
    installFakeEventSource();
  });
  afterAll(() => restore());

  it("a failed sheet reads Didn’t finish with its reason; Try again asks for the same sheet", async () => {
    serveList([failedItem]);
    let posted: unknown;
    fakeApi.failNext(
      (request) => request.method === "POST" && request.path === `/lessons/${lesson.id}/worksheet`,
      () => {
        posted = fakeApi.requests.at(-1)?.body;
        return new Response(JSON.stringify({ worksheetId: "sheet-1", jobId: "job-2" }), {
          status: 202,
          headers: { "content-type": "application/json" },
        });
      },
    );
    const { onLabel } = renderDialog();
    const row = await waitFor(() => {
      const el = document.querySelector<HTMLElement>('[data-worksheet-row="Didn’t finish"]');
      if (!el) throw new Error("no failed row yet");
      return el;
    });
    expect(row).toHaveTextContent("Water cycle exit ticket");
    expect(row).toHaveTextContent(
      "We couldn’t write this sheet. Try again, or choose another type.",
    );
    await waitFor(() =>
      expect(onLabel).toHaveBeenCalledWith("Worksheet didn’t finish · Try again"),
    );
    fireEvent.click(within(row).getByRole("button", { name: "Try again" }));
    await waitFor(() =>
      expect(posted).toEqual({ expectedRevision: 2, recipeId: "exit-ticket", practiceMinutes: 15 }),
    );
  });

  it("a sheet its job holds reads Making… and the entry says making", async () => {
    serveList([
      { ...failedItem, generatingJobId: "job-2", generation: undefined, unfinished: true },
    ]);
    const { onLabel } = renderDialog();
    expect(await screen.findByText("Making…")).toBeVisible();
    await waitFor(() => expect(onLabel).toHaveBeenCalledWith("Worksheet: making…"));
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("a finished sheet reads Ready with no reason and no Try again", async () => {
    serveList([
      {
        ...failedItem,
        unfinished: false,
        generation: {
          ...failedItem.generation,
          stage: "checked",
          completedAt: "2026-11-11T10:00:00.000Z",
          failure: undefined,
        },
      },
    ]);
    const { onLabel } = renderDialog();
    expect(await screen.findByText("Ready")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    await waitFor(() => expect(onLabel).toHaveBeenCalledWith("Worksheet"));
  });
});
