import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TooltipProvider } from "@tj/ui";
import type { ReactNode } from "react";
import { loadDocument, resetLibraryStore } from "@/mocks/library-store";

let lessonId = "demo-water-cycle";
let search: Record<string, unknown> = {};
const navigate = mock();
const actualRouter = await import("@tanstack/react-router");
mock.module("@tanstack/react-router", () => ({
  ...actualRouter,
  Link: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a>,
  useNavigate: () => navigate,
  useParams: () => ({ lessonId }),
  useSearch: () => search,
}));

const { LessonPresentPage } = await import("./lesson-present.page");

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <LessonPresentPage />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

const start = async () =>
  fireEvent.click(await screen.findByRole("button", { name: "Stay in this window" }));
const key = (k: string) => fireEvent.keyDown(window, { key: k });

describe("LessonPresentPage", () => {
  beforeEach(async () => {
    lessonId = "demo-water-cycle";
    search = {};
    navigate.mockReset();
    cleanup();
    await resetLibraryStore();
  });
  afterAll(() => mock.restore());

  it("presents the lesson; Escape exits back to the lesson route", async () => {
    renderPage();
    await start();
    expect(screen.getAllByRole("status")[0]?.textContent).toMatch(/Slide 1 of \d+/);
    key("Escape");
    expect(navigate).toHaveBeenCalledWith({
      to: "/l/$lessonId",
      params: { lessonId: "demo-water-cycle" },
    });
  });

  it("?series= offers the next lesson on the end card and exits to the series", async () => {
    lessonId = "roman-roads";
    search = { series: "series-romans" };
    renderPage();
    await start();
    key("End");
    key(" ");
    expect(await screen.findByText("Next: Fractions of amounts")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Next lesson" }));
    expect(navigate).toHaveBeenCalledWith({
      to: "/l/$lessonId/present",
      params: { lessonId: "demo-fractions" },
      search: { series: "series-romans" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Exit" }));
    expect(navigate).toHaveBeenLastCalledWith({
      to: "/series/$seriesId",
      params: { seriesId: "series-romans" },
    });
  });

  it("the last lesson of a series has no Next lesson", async () => {
    lessonId = "roman-army";
    search = { series: "series-romans" };
    renderPage();
    await start();
    key("End");
    key(" ");
    expect(await screen.findByRole("heading", { name: "End of lesson" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Next lesson" })).toBeNull();
  });

  it("writes reachedSlideId and taughtAt on exit past slide 1; only reachedSlideId on slide 1", async () => {
    renderPage();
    await start();
    key("ArrowRight");
    key("ArrowRight");
    key("ArrowLeft");
    key("Escape");
    await waitFor(async () => {
      const body = await loadDocument("demo-water-cycle");
      if (!body || !("slides" in body)) throw new Error("lesson missing");
      expect(body.reachedSlideId).toBe(body.slides[2]?.id);
      expect(body.taughtAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    cleanup();
    await resetLibraryStore();
    renderPage();
    await start();
    key("Escape");
    await waitFor(async () => {
      const body = await loadDocument("demo-water-cycle");
      if (!body || !("slides" in body)) throw new Error("lesson missing");
      expect(body.reachedSlideId).toBe(body.slides[0]?.id);
      expect(body.taughtAt).toBeUndefined();
    });
  });

  it("?slide=3 opens on slide 3", async () => {
    search = { slide: 3 };
    renderPage();
    await start();
    expect(screen.getAllByRole("status")[0]?.textContent).toMatch(/Slide 3 of/);
  });

  it("a worksheet id shows the stub", async () => {
    lessonId = "fraction-practice";
    renderPage();
    expect(await screen.findByText("The editor arrives with @tj/editor")).toBeVisible();
  });
});
