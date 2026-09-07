import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <LessonEditorPage />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

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

    const banner = await screen.findByTestId("generating-banner");
    expect(banner).toHaveTextContent("Generating your lesson…");
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
    expect(banner).toHaveTextContent("40%");
    expect(banner).toHaveTextContent("Planning");

    fakeApi.setGenerating("demo-water-cycle", null);
    act(() => {
      source.emit("completed", jobEvent("completed"), "2");
    });
    expect(await screen.findByRole("button", { name: "Rename lesson" })).toBeVisible();
    expect(screen.queryByTestId("generating-banner")).toBeNull();
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

    await screen.findByTestId("generating-banner");
    const skeletons = () =>
      document.querySelectorAll('nav[aria-label="Slides"] li[aria-hidden="true"]');
    const thumbs = () => screen.getAllByRole("button", { name: /^Slide \d+$/ });
    await waitFor(() => expect(skeletons()).toHaveLength(2));
    expect(thumbs()).toHaveLength(2);
    expect(screen.getByText("2 of 4 slides")).toBeVisible();

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
    expect(screen.getByText("3 of 4 slides")).toBeVisible();

    // A stopped run promises nothing more; what was written stays.
    act(() => {
      source.emit("cancelled", jobEvent("cancelled"), "2");
    });
    await waitFor(() => expect(skeletons()).toHaveLength(0));
    expect(thumbs()).toHaveLength(3);
    expect(screen.getByText("3 slides")).toBeVisible();
  });
});
