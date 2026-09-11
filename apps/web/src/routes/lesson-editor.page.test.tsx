import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Lesson } from "@tj/domain/documents";
import { generatedLesson } from "@tj/domain/documents/fixtures";
import { TooltipProvider } from "@tj/ui";
import type { ReactNode } from "react";
import { installFakeApi } from "@/test/fake-api";
import { FakeEventSource, installFakeEventSource } from "@/test/fake-event-source";

const { fakeApi, restore: restoreFetch } = installFakeApi();

let lessonId = "demo-water-cycle";
const navigate = mock();
const actualRouter = await import("@tanstack/react-router");
mock.module("@tanstack/react-router", () => ({
  ...actualRouter,
  Link: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a>,
  useNavigate: () => navigate,
  useParams: () => ({ lessonId }),
}));

const actualUi = await import("@tj/ui");
const toastSpy = mock();
mock.module("@tj/ui", () => ({ ...actualUi, toast: toastSpy }));

const { LessonEditorPage } = await import("./lesson-editor.page");
const { GENERATION_CANCELLED_MESSAGE, GENERATION_FAILED_MESSAGE, REFETCH_DEBOUNCE_MS } =
  await import("@/components/generating-lesson");
const { SINGLETON_RETRY_MS, STILL_GENERATING_MESSAGE } = await import("@/hooks/use-proposal-jobs");
const { RELOAD_LABEL } = await import("@/hooks/use-save-with-conflict-toast");

const JOB_ID = "01a06a15-1849-7000-ac6a-c07e27fe308b";
const WORKSPACE_ID = "01a06a15-1849-7000-ac6a-c07e27fe3000";
const originalEventSource = globalThis.EventSource;
const jobEvent = (type: string, extra: Record<string, unknown> = {}) => ({
  type,
  jobId: JOB_ID,
  workspaceId: WORKSPACE_ID,
  at: "2026-09-04T10:00:00.000Z",
  ...extra,
});

// happy-dom has no layout: give the navigator's scroll region a height so react-virtual renders rows.
Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
  configurable: true,
  get(this: HTMLElement) {
    return this.getAttribute("role") === "listbox" ? 800 : 0;
  },
});

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <LessonEditorPage />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return { ...utils, queryClient };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const DOCUMENT_KEY = ["library", "document", "demo-water-cycle"];
/** Every `invalidateQueries` on the working copy (not the meta or the lists). */
const documentInvalidations = (spy: ReturnType<typeof mock>) =>
  spy.mock.calls.filter(
    (call) =>
      JSON.stringify((call[0] as { queryKey: unknown }).queryKey) === JSON.stringify(DOCUMENT_KEY),
  ).length;

/** `GET /documents/demo-water-cycle` calls served so far. */
const documentReads = () =>
  fakeApi.requests.filter((r) => r.method === "GET" && r.path === "/documents/demo-water-cycle")
    .length;

describe("LessonEditorPage", () => {
  beforeEach(async () => {
    lessonId = "demo-water-cycle";
    navigate.mockReset();
    toastSpy.mockReset();
    cleanup();
    fakeApi.reset();
    globalThis.EventSource = originalEventSource;
  });
  afterAll(() => {
    mock.restore();
    restoreFetch();
    globalThis.EventSource = originalEventSource;
  });

  it("row 1: mounts the editor with the title, N navigator thumbs, slide 1 on the canvas and Saved", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { level: 1, name: "The water cycle" })).toBeVisible();
    const lesson = fakeApi.loadDocument("demo-water-cycle");
    const count = lesson && "slides" in lesson ? lesson.slides.length : 0;
    expect(count).toBeGreaterThan(1);
    const rail = screen.getByRole("listbox", { name: "Slides" });
    await waitFor(() => expect(rail.querySelectorAll('[role="option"]').length).toBe(count));
    // Exactly one full-size slide on the canvas: the first.
    const frame = document.querySelector('[data-slide-frame] [data-slide-mode="edit"]');
    expect(frame?.getAttribute("data-slide-id")).toBe(
      lesson && "slides" in lesson ? lesson.slides[0]?.id : "",
    );
    expect(screen.getByText("Saved")).toBeVisible();
    expect(screen.getByRole("button", { name: "Export" })).toHaveAttribute("aria-disabled", "true");
  });

  it("row 11: an inline rename autosaves to the store and the library list follows", async () => {
    renderPage();
    await screen.findByRole("heading", { level: 1, name: "The water cycle" });
    fireEvent.click(screen.getByRole("button", { name: "Rename lesson" }));
    const input = screen.getByRole("textbox", { name: "Lesson title" });
    fireEvent.change(input, { target: { value: "Rain, rivers and seas" } });
    fireEvent.blur(input);
    expect(screen.getByText("Unsaved changes")).toBeVisible();
    await waitFor(() => expect(screen.getByText("Saved")).toBeVisible(), { timeout: 3_000 });
    const saved = fakeApi.loadDocument("demo-water-cycle");
    expect(saved?.title).toBe("Rain, rivers and seas");
    expect(fakeApi.listDocuments().find((d) => d.id === "demo-water-cycle")?.title).toBe(
      "Rain, rivers and seas",
    );
  });

  it("Present navigates to present mode with from=edit; Back returns to the shell", async () => {
    renderPage();
    await screen.findByRole("heading", { level: 1, name: "The water cycle" });
    fireEvent.click(screen.getByRole("button", { name: "Present" }));
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({
        to: "/l/$lessonId/present",
        params: { lessonId: "demo-water-cycle" },
        search: { series: undefined, from: "edit" },
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Back to library" }));
    expect(navigate).toHaveBeenCalledWith({ to: "/" });
  });

  it("a worksheet id on the lesson route shows WrongKindPage rather than crashing", async () => {
    lessonId = "fraction-practice";
    renderPage();
    expect(await screen.findByText("This is a worksheet")).toBeVisible();
  });

  it("a save another tab beat to it toasts Reload, which refetches the stored copy", async () => {
    renderPage();
    await screen.findByRole("heading", { level: 1, name: "The water cycle" });
    // Another tab saved: the row's clock moved on and the stored title changed.
    fakeApi.touch("demo-water-cycle");
    const row = fakeApi.get("demo-water-cycle");
    if (row) row.body = { ...row.body, title: "Saved elsewhere" };

    fireEvent.click(screen.getByRole("button", { name: "Rename lesson" }));
    const input = screen.getByRole("textbox", { name: "Lesson title" });
    fireEvent.change(input, { target: { value: "Mine" } });
    fireEvent.blur(input);
    await waitFor(() => expect(toastSpy).toHaveBeenCalled(), { timeout: 3_000 });
    const [message, options] = toastSpy.mock.calls.at(-1) as [
      string,
      { action?: { label: string; onClick: () => void } },
    ];
    expect(message).toBe("This document changed elsewhere. Reload to continue.");
    expect(options.action?.label).toBe(RELOAD_LABEL);
    expect(fakeApi.get("demo-water-cycle")?.body.title).toBe("Saved elsewhere");

    act(() => options.action?.onClick());
    expect(await screen.findByRole("heading", { level: 1, name: "Saved elsewhere" })).toBeVisible();
  });

  it("a locked lesson shows the generating banner, follows the job and unlocks on completion", async () => {
    installFakeEventSource();
    fakeApi.setGenerating("demo-water-cycle", JOB_ID);
    renderPage();

    const banner = await screen.findByTestId("generating-shell");
    expect(screen.getByTestId("generating-stage")).toHaveTextContent("Planning");
    expect(screen.queryByRole("button", { name: "Rename lesson" })).toBeNull();
    const source = FakeEventSource.latest;
    expect(source.url).toBe(`/api/jobs/${JOB_ID}/events`);

    act(() => {
      source.open();
      source.emit(
        "progress",
        jobEvent("progress", { progress: { percent: 40, message: "Planning" } }),
        "1",
      );
    });
    // 40 is inside Writing; the strip ticks Planning and the stage line says where the run is.
    expect(screen.getByTestId("generating-stage")).toHaveTextContent("Writing the slides");
    expect(banner.querySelector('[data-stage="planning"]')).toHaveAttribute("data-status", "done");
    expect(banner.querySelector('[data-stage="writing"]')).toHaveAttribute("data-status", "live");

    fakeApi.setGenerating("demo-water-cycle", null);
    act(() => {
      source.emit("completed", jobEvent("completed"), "2");
    });
    expect(await screen.findByRole("button", { name: "Rename lesson" })).toBeVisible();
    expect(screen.queryByTestId("generating-shell")).toBeNull();
  });

  it("a locked lesson shows a skeleton per slide to come and fades each thumb in as it lands", async () => {
    installFakeEventSource();
    fakeApi.setGenerating("demo-water-cycle", JOB_ID);
    const row = fakeApi.get("demo-water-cycle");
    if (!row || !("slides" in row.body)) throw new Error("fixture missing");
    const written = row.body.slides;
    // Plan has persisted the outline (four slides) with the first two slides written.
    const kinds = ["title", "objectives", "content", "plenary"] as const;
    row.body.facts = {
      objectives: [],
      vocabulary: [],
      workedExamples: [],
      questions: [],
      misconceptions: [],
      outline: kinds.map((kind, i) => ({ id: `s${i + 1}`, kind, minutes: 15, factRefs: [] })),
      durationMin: 60,
    };
    row.body.slides = written.slice(0, 2);
    renderPage();

    await screen.findByTestId("generating-shell");
    const skeletons = () =>
      document.querySelectorAll('nav[aria-label="Slides"] li[aria-hidden="true"]');
    const thumbs = () => Array.from(document.querySelectorAll("[data-slide-thumb]"));
    await waitFor(() => expect(skeletons()).toHaveLength(2));
    expect(thumbs()).toHaveLength(2);

    // The worker writes the third slide and says so.
    row.body.slides = written.slice(0, 3);
    const source = FakeEventSource.latest;
    act(() => {
      source.open();
      source.emit(
        "progress",
        jobEvent("progress", {
          progress: { percent: 60, documentUpdatedAt: "2026-09-04T10:00:01.000Z" },
        }),
        "1",
      );
    });
    await waitFor(() => expect(thumbs()).toHaveLength(3));
    expect(skeletons()).toHaveLength(1);
    expect(thumbs()[2]).toHaveClass("motion-safe:animate-arrive");
    expect(thumbs()[0]).not.toHaveClass("motion-safe:animate-arrive");
    // The canvas follows the newest finished slide.
    expect(document.querySelector("[data-canvas] [data-slide-root]")).toHaveAttribute(
      "data-slide-id",
      written[2]?.id ?? "",
    );

    // A stopped run promises nothing more; what was written stays.
    act(() => {
      source.emit("cancelled", jobEvent("cancelled"), "2");
    });
    await waitFor(() => expect(skeletons()).toHaveLength(0));
    expect(thumbs()).toHaveLength(3);
  });

  it("row 1: three progress events with distinct documentUpdatedAt refetch the body 3 times; the terminal event reads it once more and the editor mounts on it", async () => {
    installFakeEventSource();
    fakeApi.setGenerating("demo-water-cycle", JOB_ID);
    const { queryClient } = renderPage();
    await screen.findByTestId("generating-shell");
    const spy = mock(queryClient.invalidateQueries.bind(queryClient));
    queryClient.invalidateQueries = spy as typeof queryClient.invalidateQueries;
    const source = FakeEventSource.latest;
    act(() => source.open());
    act(() => source.emit("started", jobEvent("started"), "1"));
    for (const [i, at] of [
      "2026-09-04T10:00:01.000Z",
      "2026-09-04T10:00:02.000Z",
      "2026-09-04T10:00:03.000Z",
    ].entries()) {
      act(() =>
        source.emit(
          "progress",
          jobEvent("progress", {
            progress: { percent: 20 * (i + 1), message: `Slide ${i + 1}`, documentUpdatedAt: at },
          }),
          String(i + 2),
        ),
      );
      // The emitter's cadence: each stamp gets its own debounce window.
      await act(() => wait(REFETCH_DEBOUNCE_MS + 50));
    }
    expect(documentInvalidations(spy)).toBe(3);

    fakeApi.setGenerating("demo-water-cycle", null);
    const readsBefore = documentReads();
    act(() => source.emit("completed", jobEvent("completed"), "5"));
    expect(await screen.findByRole("button", { name: "Rename lesson" })).toBeVisible();
    // The handoff is one direct read written with the released lock (TEACH-251), not a refetch.
    expect(documentInvalidations(spy)).toBe(3);
    expect(documentReads()).toBe(readsBefore + 1);
  });

  it("row 2: two progress events with the same documentUpdatedAt are one refetch", async () => {
    installFakeEventSource();
    fakeApi.setGenerating("demo-water-cycle", JOB_ID);
    const { queryClient } = renderPage();
    await screen.findByTestId("generating-shell");
    const spy = mock(queryClient.invalidateQueries.bind(queryClient));
    queryClient.invalidateQueries = spy as typeof queryClient.invalidateQueries;
    const source = FakeEventSource.latest;
    act(() => source.open());
    const at = "2026-09-04T10:00:01.000Z";
    act(() =>
      source.emit(
        "progress",
        jobEvent("progress", { progress: { percent: 10, message: "a", documentUpdatedAt: at } }),
        "1",
      ),
    );
    await act(() => wait(REFETCH_DEBOUNCE_MS + 50));
    act(() =>
      source.emit(
        "progress",
        jobEvent("progress", { progress: { percent: 20, message: "b", documentUpdatedAt: at } }),
        "2",
      ),
    );
    // A message-only tick does not count as a new document either.
    act(() =>
      source.emit(
        "progress",
        jobEvent("progress", { progress: { percent: 30, message: "c" } }),
        "3",
      ),
    );
    await act(() => wait(REFETCH_DEBOUNCE_MS + 50));
    expect(documentInvalidations(spy)).toBe(1);
  });

  it("row 3: a failed job shows the error and Back to library, keeps the slides and never mounts the editor", async () => {
    installFakeEventSource();
    fakeApi.setGenerating("demo-water-cycle", JOB_ID);
    renderPage();
    const banner = await screen.findByTestId("generating-shell");
    const source = FakeEventSource.latest;
    act(() => source.open());
    // The api releases the lock on the terminal event; the view must not hand over regardless.
    fakeApi.setGenerating("demo-water-cycle", null);
    act(() =>
      source.emit(
        "failed",
        jobEvent("failed", { error: { message: "The model timed out.", retryable: true } }),
        "1",
      ),
    );
    expect(banner).toHaveTextContent(GENERATION_FAILED_MESSAGE);
    expect(banner).toHaveTextContent("The model timed out.");
    expect(banner).toHaveAttribute("data-state", "failed");
    fireEvent.click(within(banner).getByRole("button", { name: "Back to library" }));
    expect(navigate).toHaveBeenCalledWith({ to: "/" });
    // The partial deck is still on screen, read-only: the viewer's slide list, no rename.
    expect(document.querySelector("[data-slide-frame], [data-slide-id]")).not.toBeNull();
    await wait(50);
    expect(screen.queryByRole("button", { name: "Rename lesson" })).toBeNull();
  });

  it("a cancelled job says so", async () => {
    installFakeEventSource();
    fakeApi.setGenerating("demo-water-cycle", JOB_ID);
    renderPage();
    const banner = await screen.findByTestId("generating-shell");
    const source = FakeEventSource.latest;
    act(() => source.open());
    act(() => source.emit("cancelled", jobEvent("cancelled"), "1"));
    expect(banner).toHaveTextContent(GENERATION_CANCELLED_MESSAGE);
    expect(within(banner).getByRole("button", { name: "Back to library" })).toBeVisible();
  });

  it("row 4: Stop posts one cancel for the job", async () => {
    installFakeEventSource();
    fakeApi.setGenerating("demo-water-cycle", JOB_ID);
    renderPage();
    const banner = await screen.findByTestId("generating-shell");
    fireEvent.click(within(banner).getByRole("button", { name: "Stop" }));
    await waitFor(() =>
      expect(
        fakeApi.requests.filter((r) => r.method === "POST" && r.path === `/jobs/${JOB_ID}/cancel`),
      ).toHaveLength(1),
    );
    // Sent once: the button is off while the request runs and after it succeeds.
    await waitFor(() =>
      expect(within(banner).getByRole("button", { name: "Stop" })).toBeDisabled(),
    );
    fireEvent.click(within(banner).getByRole("button", { name: "Stop" }));
    expect(
      fakeApi.requests.filter((r) => r.method === "POST" && r.path === `/jobs/${JOB_ID}/cancel`),
    ).toHaveLength(1);
  });

  it("a lesson with a worksheet artefact fetches it and Worksheet opens /w/:id", async () => {
    const lesson = fakeApi.loadDocument("demo-water-cycle") as Lesson;
    const row = fakeApi.get("demo-water-cycle");
    if (row) row.body = { ...lesson, artefacts: { worksheetId: "fraction-practice" } };
    renderPage();
    await screen.findByRole("heading", { level: 1, name: "The water cycle" });
    fireEvent.click(await screen.findByRole("button", { name: "Worksheet" }));
    expect(navigate).toHaveBeenCalledWith({
      to: "/w/$worksheetId",
      params: { worksheetId: "fraction-practice" },
    });
    await waitFor(() =>
      expect(
        fakeApi.requests.some(
          (r) => r.method === "GET" && r.path === "/documents/fraction-practice",
        ),
      ).toBe(true),
    );
  });

  describe("proposal jobs (TEACH-134)", () => {
    const CASCADE_JOB = "01a06a15-1849-7000-ac6a-c07e27fe3134";
    const seedGenerated = () => {
      const row = fakeApi.get("demo-water-cycle");
      if (!row) throw new Error("fixture");
      row.body = { ...generatedLesson(), id: "demo-water-cycle" };
      return row.body as Lesson;
    };
    const cascadeProposals = (lesson: Lesson) => {
      const [, objectives, , mc] = lesson.slides;
      const ob = objectives?.elements[1];
      const q = mc?.elements[0];
      if (!objectives || !mc || !ob || !q) throw new Error("fixture");
      const generatedFrom = {
        factRefs: ["o1"],
        promptVersion: "cascade.v1",
        model: "m",
        at: "2026-09-08T00:00:00.000Z",
      };
      return [
        {
          target: { slideId: objectives.id, elementId: ob.id },
          element: { ...ob, id: "ob-1-new" },
          generatedFrom,
        },
        {
          target: { slideId: mc.id, elementId: q.id },
          element: { ...q, id: "q-new" },
          generatedFrom,
        },
      ];
    };
    const editObjective = async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Facts" }));
      const field = screen.getByRole("textbox", { name: "Objective 1" });
      fireEvent.focus(field);
      fireEvent.change(field, { target: { value: "Describe the water cycle" } });
      fireEvent.keyDown(field, { key: "Enter" });
      fireEvent.blur(field);
    };

    it("row 6: a fact edit enqueues one cascade; its completed proposals land as one undo step with the toast", async () => {
      installFakeEventSource();
      const lesson = seedGenerated();
      fakeApi.nextProposalJobId = CASCADE_JOB;
      renderPage();
      await editObjective();
      await waitFor(
        () =>
          expect(
            fakeApi.requests.filter((r) => r.path === "/lessons/demo-water-cycle/cascade"),
          ).toHaveLength(1),
        { timeout: 3_000 },
      );
      expect(fakeApi.requests.at(-1)?.body).toEqual({ changedFactIds: ["o1"] });
      // The impact set is busy until the proposals land.
      await waitFor(() => expect(document.querySelectorAll("[data-slide-busy]").length).toBe(2));
      const source = FakeEventSource.latest;
      expect(source.url).toBe(`/api/jobs/${CASCADE_JOB}/events`);
      act(() => {
        source.open();
        source.emit(
          "completed",
          {
            ...jobEvent("completed"),
            jobId: CASCADE_JOB,
            result: { job: "lesson.cascade", proposals: cascadeProposals(lesson), flagged: [] },
          },
          "1",
        );
      });
      await waitFor(() => expect(toastSpy).toHaveBeenCalled());
      const [message, options] = toastSpy.mock.calls.at(-1) as [
        string,
        { action?: { label: string; onClick: () => void }; cancel?: { label: string } },
      ];
      expect(message).toBe("Auto changed on slides 2 and 4 to match");
      expect(options.action?.label).toBe("Undo");
      expect(options.cancel?.label).toBe("View");
      expect(document.querySelectorAll("[data-slide-busy]")).toHaveLength(0);
      const stored = () => fakeApi.loadDocument("demo-water-cycle") as Lesson;
      await waitFor(() => expect(stored().slides[3]?.elements[0]?.id).toBe("q-new"), {
        timeout: 3_000,
      });
      // Undo reverts the cascade in one step; the typed fact — its own step — stays.
      act(() => options.action?.onClick());
      await waitFor(() => expect(stored().slides[3]?.elements[0]?.id).toBe("q"), {
        timeout: 3_000,
      });
      expect(stored().facts?.objectives[0]?.text).toBe("Describe the water cycle");
      expect(screen.getByRole("button", { name: "Redo" })).toBeEnabled();
    });

    it("a second request while a job is in flight is held and sent after the terminal event", async () => {
      installFakeEventSource();
      const lesson = seedGenerated();
      fakeApi.nextProposalJobId = CASCADE_JOB;
      renderPage();
      await editObjective();
      const cascades = () =>
        fakeApi.requests.filter((r) => r.path === "/lessons/demo-water-cycle/cascade");
      await waitFor(() => expect(cascades()).toHaveLength(1), { timeout: 3_000 });
      // A second fact commit while the first job runs: held, not posted.
      const term = screen.getByRole("textbox", { name: "Term 2" });
      fireEvent.focus(term);
      fireEvent.change(term, { target: { value: "Condensing" } });
      fireEvent.blur(term);
      await wait(1_300);
      expect(cascades()).toHaveLength(1);
      // The first job ends; the held cascade goes out with its own ids.
      const source = FakeEventSource.latest;
      act(() => {
        source.open();
        source.emit(
          "completed",
          {
            ...jobEvent("completed"),
            jobId: CASCADE_JOB,
            result: {
              job: "lesson.cascade",
              proposals: cascadeProposals(lesson).slice(0, 1),
              flagged: [],
            },
          },
          "1",
        );
      });
      await waitFor(() => expect(cascades()).toHaveLength(2), { timeout: 3_000 });
      expect(cascades()[1]?.body).toEqual({ changedFactIds: ["v2"] });
    });

    it("a worksheet-only result toasts without Undo (the lesson's history gained nothing)", async () => {
      installFakeEventSource();
      seedGenerated();
      const ws = fakeApi.get("fraction-practice");
      const lessonRow = fakeApi.get("demo-water-cycle");
      if (!ws || !lessonRow) throw new Error("fixture");
      lessonRow.body = {
        ...(lessonRow.body as Lesson),
        artefacts: { worksheetId: "fraction-practice" },
      };
      fakeApi.nextProposalJobId = CASCADE_JOB;
      renderPage();
      await editObjective();
      await waitFor(() => expect(FakeEventSource.instances.length).toBeGreaterThan(0), {
        timeout: 3_000,
      });
      const block = (ws.body as { blocks: { id: string }[] }).blocks[1];
      if (!block) throw new Error("fixture");
      act(() => {
        const source = FakeEventSource.latest;
        source.open();
        source.emit(
          "completed",
          {
            ...jobEvent("completed"),
            jobId: CASCADE_JOB,
            result: {
              job: "lesson.cascade",
              proposals: [
                {
                  target: { blockId: block.id },
                  block: { ...block, id: "b2-new" },
                  generatedFrom: {
                    factRefs: ["o1"],
                    promptVersion: "cascade.v1",
                    model: "m",
                    at: "2026-09-08T00:00:00.000Z",
                  },
                },
              ],
              flagged: [],
            },
          },
          "1",
        );
      });
      await waitFor(() => expect(toastSpy).toHaveBeenCalled());
      const [message, options] = toastSpy.mock.calls.at(-1) as [string, { action?: unknown }];
      expect(message).toBe("Auto changed the worksheet to match");
      expect(options.action).toBeUndefined();
      // The worksheet row (not in the page's cache before) was fetched, patched and saved.
      await waitFor(
        () =>
          expect(
            (fakeApi.loadDocument("fraction-practice") as { blocks: { id: string }[] }).blocks[1]
              ?.id,
          ).toBe("b2-new"),
        { timeout: 3_000 },
      );
    });

    it("row 7: flagged targets are counted in the toast", async () => {
      installFakeEventSource();
      const lesson = seedGenerated();
      fakeApi.nextProposalJobId = CASCADE_JOB;
      renderPage();
      await editObjective();
      await waitFor(() => expect(FakeEventSource.instances.length).toBeGreaterThan(0), {
        timeout: 3_000,
      });
      const source = FakeEventSource.latest;
      act(() => {
        source.open();
        source.emit(
          "completed",
          {
            ...jobEvent("completed"),
            jobId: CASCADE_JOB,
            result: {
              job: "lesson.cascade",
              proposals: cascadeProposals(lesson).slice(0, 1),
              flagged: [{ slideId: "s-mc", elementId: "q", reason: "teacher" }],
            },
          },
          "1",
        );
      });
      await waitFor(() => expect(toastSpy).toHaveBeenCalled());
      expect(toastSpy.mock.calls.at(-1)?.[0]).toBe(
        "Auto changed on slide 2 to match · 1 needs your OK",
      );
    });

    it("row 8: a 409 generating toasts and opens no job", async () => {
      installFakeEventSource();
      seedGenerated();
      fakeApi.failNext(
        (r) => r.path === "/lessons/demo-water-cycle/cascade",
        () =>
          new Response(
            JSON.stringify({
              error: {
                code: "conflict",
                message: "busy",
                requestId: "x",
                retryable: false,
                reason: "generating",
              },
            }),
            { status: 409, headers: { "content-type": "application/json" } },
          ),
      );
      renderPage();
      await editObjective();
      await waitFor(() => expect(toastSpy).toHaveBeenCalled(), { timeout: 3_000 });
      expect(toastSpy.mock.calls.at(-1)?.[0]).toBe(STILL_GENERATING_MESSAGE);
      expect(FakeEventSource.instances).toHaveLength(0);
    });

    it("a singleton 409 holds the request and re-sends it once the slot has passed", async () => {
      installFakeEventSource();
      seedGenerated();
      fakeApi.failNext(
        (r) => r.path === "/lessons/demo-water-cycle/cascade",
        () =>
          new Response(
            JSON.stringify({
              error: {
                code: "conflict",
                message: "An identical job is already queued.",
                requestId: "x",
                retryable: true,
              },
            }),
            { status: 409, headers: { "content-type": "application/json" } },
          ),
      );
      renderPage();
      await editObjective();
      const cascades = () =>
        fakeApi.requests.filter((r) => r.path === "/lessons/demo-water-cycle/cascade");
      await waitFor(() => expect(cascades()).toHaveLength(1), { timeout: 3_000 });
      expect(toastSpy).not.toHaveBeenCalled();
      await waitFor(() => expect(cascades()).toHaveLength(2), {
        timeout: SINGLETON_RETRY_MS + 3_000,
        interval: 200,
      });
      expect(cascades()[1]?.body).toEqual({ changedFactIds: ["o1"] });
      await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    }, 15_000);

    it("row 10: confirming the regenerate dialog posts one regenerate with the target and instruction", async () => {
      installFakeEventSource();
      const lesson = seedGenerated();
      fakeApi.nextProposalJobId = CASCADE_JOB;
      renderPage();
      await screen.findByRole("heading", { level: 1, name: "The water cycle" });
      const rows = screen
        .getByRole("listbox", { name: "Slides" })
        .querySelectorAll('[role="option"]');
      fireEvent.contextMenu(rows[2] as HTMLElement, { clientX: 40, clientY: 40 });
      fireEvent.click(await screen.findByRole("menuitem", { name: "Regenerate slide…" }));
      const dialog = await screen.findByRole("dialog", { name: "Regenerate slide 3" });
      fireEvent.change(screen.getByRole("textbox", { name: "Instruction (optional)" }), {
        target: { value: "Simpler words" },
      });
      fireEvent.click(within(dialog).getByRole("button", { name: "Regenerate" }));
      await waitFor(() =>
        expect(
          fakeApi.requests.filter((r) => r.path === "/lessons/demo-water-cycle/regenerate"),
        ).toHaveLength(1),
      );
      expect(fakeApi.requests.at(-1)?.body).toEqual({
        targets: [{ slideId: "s-vocab" }],
        instruction: "Simpler words",
      });
      const source = FakeEventSource.latest;
      const vocab = lesson.slides[2];
      const el = vocab?.elements[0];
      if (!vocab || !el) throw new Error("fixture");
      act(() => {
        source.open();
        source.emit(
          "completed",
          {
            ...jobEvent("completed"),
            jobId: CASCADE_JOB,
            result: {
              job: "lesson.regenerate",
              proposals: [
                {
                  target: { slideId: vocab.id },
                  element: { ...el, id: "vh-new" },
                  notes: null,
                  generatedFrom: {
                    factRefs: ["v1"],
                    promptVersion: "regenerate.v1",
                    model: "m",
                    at: "2026-09-08T00:00:00.000Z",
                  },
                },
              ],
              flagged: [],
            },
          },
          "1",
        );
      });
      await waitFor(() => expect(toastSpy).toHaveBeenCalled());
      expect(toastSpy.mock.calls.at(-1)?.[0]).toBe("Regenerated slide 3");
    });
  });
});
