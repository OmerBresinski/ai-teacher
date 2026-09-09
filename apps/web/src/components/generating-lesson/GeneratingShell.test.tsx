import { afterEach, describe, expect, it, mock } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Lesson } from "@tj/domain/documents";
import { demoWorkspace } from "@tj/editor/starter";
import { TooltipProvider } from "@tj/ui";
import { installFakeApi } from "@/test/fake-api";
import { FakeEventSource, installFakeEventSource } from "@/test/fake-event-source";
import {
  bodyAt,
  generationRun,
  playRun,
  RUN_UP_TO,
  runEvents,
  withTerminal,
} from "@/test/play-run";
import { GeneratingLesson } from "./GeneratingLesson";
import { GeneratingShell, LOCK_LINE, STOPPED_LOCK_LINE } from "./GeneratingShell";
import { STAGES } from "./stage";

const full = (() => {
  const found = demoWorkspace(new Date()).find((d) => d.key === generationRun.lesson);
  if (!found || !("slides" in found.body)) throw new Error("demo lesson missing");
  return found.body as Lesson;
})();

const noop = () => undefined;

function renderAt(upTo: number, extra: Partial<Parameters<typeof GeneratingShell>[0]> = {}) {
  const events = runEvents(generationRun, upTo);
  const lesson = bodyAt(generationRun, Math.max(0, upTo - 1), full);
  return render(
    <TooltipProvider>
      <GeneratingShell lesson={lesson} events={events} onBack={noop} onStop={noop} {...extra} />
    </TooltipProvider>,
  );
}

const stripStatuses = () =>
  STAGES.map((s) => {
    const item = document.querySelector(`[data-stage="${s.id}"]`);
    return `${s.id}:${item?.getAttribute("data-status")}`;
  }).join(" ");

const liveDot = () => document.querySelector('[data-status="live"] [data-dot]');

afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.theme;
});

describe("GeneratingShell", () => {
  it("row 1: a locked lesson with no slides shows the title, 'Planning your lesson', Planning live, no bar and no spinner", () => {
    render(
      <TooltipProvider>
        <GeneratingShell lesson={{ ...full, slides: [] }} events={[]} onBack={noop} onStop={noop} />
      </TooltipProvider>,
    );
    const shell = screen.getByTestId("generating-shell");
    expect(shell).toHaveAttribute("data-state", "running");
    // The Lora title on the canvas ground, and the bar's read-only h1.
    const canvas = shell.querySelector("[data-canvas]");
    expect(canvas).not.toBeNull();
    const display = within(canvas as HTMLElement).getByText(full.title);
    expect(display).toHaveClass("font-display");
    expect(display).toHaveClass("text-[28px]");
    expect(within(canvas as HTMLElement).getByText("Planning your lesson")).toBeVisible();
    expect(screen.getByRole("heading", { level: 1, name: full.title })).toBeVisible();
    expect(stripStatuses()).toBe(
      "planning:live writing:todo pictures:todo checking:todo ready:todo",
    );
    expect(screen.getByTestId("generating-stage")).toHaveTextContent("Planning");
    expect(document.querySelector("progress")).toBeNull();
    expect(document.querySelector("[data-spinner], .animate-spin")).toBeNull();
    expect(shell.querySelector("[data-slide-root]")).toBeNull();
    expect(screen.getByTestId("generating-lock")).toHaveTextContent(LOCK_LINE);
  });

  it("row 2: 2, 6, 10 then 'Slide 1 of 5' ticks Planning and goes live on Writing with the count", () => {
    const { rerender } = renderAt(RUN_UP_TO.planning);
    expect(stripStatuses()).toBe(
      "planning:live writing:todo pictures:todo checking:todo ready:todo",
    );
    for (const upTo of [4, 5]) {
      rerender(
        <TooltipProvider>
          <GeneratingShell
            lesson={bodyAt(generationRun, upTo - 1, full)}
            events={runEvents(generationRun, upTo)}
            onBack={noop}
            onStop={noop}
          />
        </TooltipProvider>,
      );
      expect(stripStatuses()).toMatch(/^planning:live/);
    }
    rerender(
      <TooltipProvider>
        <GeneratingShell
          lesson={bodyAt(generationRun, RUN_UP_TO.writing - 1, full)}
          events={runEvents(generationRun, RUN_UP_TO.writing)}
          onBack={noop}
          onStop={noop}
        />
      </TooltipProvider>,
    );
    expect(stripStatuses()).toBe(
      "planning:done writing:live pictures:todo checking:todo ready:todo",
    );
    expect(screen.getByTestId("generating-stage")).toHaveTextContent("Writing the slides, 1 of 5");
    // The live region says less: the boundary now, the count at every fourth slide.
    expect(screen.getByTestId("generating-announcement")).toHaveTextContent("Writing the slides");
    expect(screen.getByTestId("generating-announcement")).not.toHaveTextContent("1 of 5");
    expect(document.querySelector('[data-stage="writing"]')).toHaveAttribute(
      "aria-current",
      "step",
    );
    // The newest finished slide is on the canvas; the rest of the outline is skeleton rows.
    expect(document.querySelectorAll("[data-slide-thumb]")).toHaveLength(3);
    expect(
      document.querySelectorAll('nav[aria-label="Slides"] li[aria-hidden="true"]'),
    ).toHaveLength(4);
    expect(document.querySelector("[data-canvas] [data-slide-root]")).toHaveAttribute(
      "data-slide-id",
      full.slides[2]?.id ?? "",
    );
  });

  it("row 3: 85 keeps Writing; 88 Adding pictures; 90 Checking; 100 Ready ticked", () => {
    renderAt(RUN_UP_TO.worksheet);
    expect(stripStatuses()).toBe(
      "planning:done writing:live pictures:todo checking:todo ready:todo",
    );
    expect(screen.getByTestId("generating-stage")).toHaveTextContent("Writing the worksheet");
    cleanup();
    renderAt(RUN_UP_TO.pictures);
    expect(stripStatuses()).toBe(
      "planning:done writing:done pictures:live checking:todo ready:todo",
    );
    cleanup();
    renderAt(RUN_UP_TO.checking);
    expect(stripStatuses()).toBe(
      "planning:done writing:done pictures:done checking:live ready:todo",
    );
    cleanup();
    renderAt(generationRun.events.length);
    expect(stripStatuses()).toBe(
      "planning:done writing:done pictures:done checking:done ready:done",
    );
    expect(screen.getByTestId("generating-stage")).toHaveTextContent("Ready to edit");
    expect(screen.getByTestId("generating-lock")).toHaveTextContent("Ready to edit");
  });

  it("row 4: with no 88, Adding pictures is ticked when 90 arrives and never live", () => {
    const events = runEvents(generationRun, RUN_UP_TO.checking).filter(
      (e) => !(e.type === "progress" && e.progress.percent === 88),
    );
    render(
      <TooltipProvider>
        <GeneratingShell lesson={full} events={events} onBack={noop} onStop={noop} />
      </TooltipProvider>,
    );
    expect(document.querySelector('[data-stage="pictures"]')).toHaveAttribute(
      "data-status",
      "done",
    );
  });

  it("row 5: exactly one ghost Stop at 32px, no primary, and the strip is the only progress element", () => {
    renderAt(RUN_UP_TO.writing, { estimate: "About 1 to 2 minutes left" });
    const bar = document.querySelector("[data-topbar]") as HTMLElement;
    const buttons = within(bar).getAllByRole("button");
    // Back (an icon button) and Stop; nothing filled.
    expect(buttons.map((b) => b.getAttribute("aria-label") ?? b.textContent?.trim())).toEqual([
      "Back to library",
      "Stop",
    ]);
    const stop = within(bar).getByRole("button", { name: "Stop" });
    expect(stop.className).toContain("h-(--button-height)");
    expect(stop.className).toContain("text-ink-2");
    expect(bar.querySelector(".bg-primary-fill")).toBeNull();
    expect(within(bar).getByText("About 1 to 2 minutes left")).toBeVisible();
    expect(document.querySelectorAll("progress, [role='progressbar']")).toHaveLength(0);
    expect(document.querySelectorAll("[data-testid='generating-strip']")).toHaveLength(1);
  });

  it("row 6: the live dot breathes under motion-safe only", () => {
    renderAt(RUN_UP_TO.writing);
    const dot = liveDot();
    expect(dot).not.toBeNull();
    expect(dot?.className).toContain("motion-safe:animate-pulse");
    expect(dot?.className.split(" ")).not.toContain("animate-pulse");
    expect(dot?.className).toContain("bg-primary");
  });

  it("renders in the three themes with the same structure", () => {
    for (const theme of ["light", "dark", "high-contrast"]) {
      document.documentElement.dataset.theme = theme;
      renderAt(RUN_UP_TO.checking);
      expect(stripStatuses()).toBe(
        "planning:done writing:done pictures:done checking:live ready:todo",
      );
      expect(document.querySelectorAll("[data-slide-thumb]")).toHaveLength(7);
      cleanup();
    }
  });

  it("a failed run keeps the live stage in the danger tone, says so once and offers the way back", () => {
    const events = withTerminal(generationRun, RUN_UP_TO.writing + 1, "failed");
    render(
      <TooltipProvider>
        <GeneratingShell
          lesson={bodyAt(generationRun, RUN_UP_TO.writing, full)}
          events={events}
          onBack={noop}
          onStop={noop}
        />
      </TooltipProvider>,
    );
    expect(screen.getByTestId("generating-shell")).toHaveAttribute("data-state", "failed");
    // One assertive node, mounted on failure; the polite region is gone.
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.queryByTestId("generating-announcement")).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Generation stopped before the lesson was finished. The model timed out.",
    );
    expect(liveDot()?.className).toContain("bg-destructive");
    expect(liveDot()?.className).not.toContain("animate-pulse");
    expect(screen.getByTestId("generating-lock")).toHaveTextContent(STOPPED_LOCK_LINE);
    expect(screen.getByRole("button", { name: "Back to library" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    // A stopped run promises no more slides.
    expect(
      document.querySelectorAll('nav[aria-label="Slides"] li[aria-hidden="true"]'),
    ).toHaveLength(0);
  });

  it("honours the editor's compact navigator preference so nothing reflows at Ready", () => {
    window.localStorage.setItem("tj:navigator", "compact");
    try {
      renderAt(RUN_UP_TO.writing);
      const nav = document.querySelector('nav[aria-label="Slides"]') as HTMLElement;
      expect(nav.dataset.navigatorMode).toBe("compact");
      expect(nav.style.width).toBe("var(--navigator-width-sm)");
    } finally {
      window.localStorage.removeItem("tj:navigator");
    }
    cleanup();
    renderAt(RUN_UP_TO.writing);
    const nav = document.querySelector('nav[aria-label="Slides"]') as HTMLElement;
    expect(nav.style.width).toBe("var(--navigator-width)");
  });

  it("Cmd+Period stops the run", () => {
    const onStop = mock();
    renderAt(RUN_UP_TO.writing, { onStop });
    fireEvent.keyDown(window, { key: ".", metaKey: true });
    expect(onStop).toHaveBeenCalledTimes(1);
  });
});

describe("GeneratingLesson over playRun", () => {
  it("replays the recorded run through the FakeEventSource and the fake API to Ready", async () => {
    const { fakeApi, restore } = installFakeApi();
    installFakeEventSource();
    const lessonId = generationRun.lesson;
    const row = fakeApi.get(lessonId);
    if (!row) throw new Error("fixture missing");
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const persist = (body: Lesson) => {
      row.body = body;
      fakeApi.touch(lessonId);
    };
    persist(bodyAt(generationRun, 0, full));
    const onStopped = mock();
    render(
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <GeneratingLesson
            lesson={row.body as Lesson}
            jobId={generationRun.jobId}
            onBack={noop}
            onStopped={onStopped}
          />
        </TooltipProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByTestId("generating-stage")).toHaveTextContent("Planning");
    act(() => FakeEventSource.latest.open());
    act(() => {
      playRun(generationRun, { upTo: RUN_UP_TO.writing, persist, lesson: full });
    });
    expect(screen.getByTestId("generating-stage")).toHaveTextContent("Writing the slides, 1 of 5");
    act(() => {
      playRun(generationRun, { from: RUN_UP_TO.writing, persist, lesson: full });
    });
    await waitFor(() =>
      expect(screen.getByTestId("generating-shell")).toHaveAttribute("data-state", "completed"),
    );
    expect(stripStatuses()).toBe(
      "planning:done writing:done pictures:done checking:done ready:done",
    );
    expect(onStopped).not.toHaveBeenCalled();
    expect(FakeEventSource.latest.closed).toBe(true);
    restore();
  });
});
