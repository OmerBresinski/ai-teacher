import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "@tj/ui";
import type { ReactNode } from "react";
import { loadSeriesWithLessons, resetLibraryStore } from "@/mocks/library-store";

let seriesId = "series-romans";
const navigate = mock();
const toastSpy = mock();
const actualRouter = await import("@tanstack/react-router");
mock.module("@tanstack/react-router", () => ({
  ...actualRouter,
  Link: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a>,
  useNavigate: () => navigate,
  useParams: () => ({ seriesId }),
}));
const actualUi = await import("@tj/ui");
mock.module("@tj/ui", () => ({ ...actualUi, toast: toastSpy }));

const { SeriesDetailPage } = await import("./series-detail.page");

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <SeriesDetailPage />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

const rows = () => screen.getAllByRole("listitem").map((row) => row.getAttribute("data-lesson-id"));

describe("SeriesDetailPage", () => {
  beforeEach(async () => {
    seriesId = "series-romans";
    navigate.mockReset();
    toastSpy.mockReset();
    cleanup();
    await resetLibraryStore();
  });
  afterAll(() => mock.restore());

  it("shows the header, counts, rows in teaching order and the primary actions", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { name: "The Romans" })).toBeVisible();
    expect(screen.getByText(/3 lessons · \d+ slides/)).toBeVisible();
    await waitFor(() => expect(rows()).toEqual(["roman-roads", "demo-fractions", "roman-army"]));
    expect(screen.getByRole("button", { name: "Present series" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Add lesson" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Present series" }));
    expect(navigate).toHaveBeenCalledWith({
      to: "/l/$lessonId/present",
      params: { lessonId: "roman-roads" },
      search: { series: "series-romans" },
    });
  });

  it("reorders with ⌘/Ctrl + arrows, keeps focus on the moved row and announces", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("heading", { name: "The Romans" });
    await waitFor(() => expect(rows()).toHaveLength(3));

    const first = screen.getAllByRole("listitem")[0] as HTMLElement;
    first.focus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getAllByRole("listitem")[1]).toHaveFocus();

    first.focus();
    await user.keyboard("{Meta>}{ArrowDown}{/Meta}");
    await waitFor(() => expect(rows()).toEqual(["demo-fractions", "roman-roads", "roman-army"]));
    expect(screen.getAllByRole("listitem")[1]).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("Moved to position 2");

    const stored = await loadSeriesWithLessons("series-romans");
    expect(stored?.series.lessonIds).toEqual(["demo-fractions", "roman-roads", "roman-army"]);
  });

  it("disables Move up / Move down at the edges", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("heading", { name: "The Romans" });
    await waitFor(() => expect(rows()).toHaveLength(3));

    await user.click(screen.getAllByRole("button", { name: "More actions" })[0] as HTMLElement);
    expect(await screen.findByRole("menuitem", { name: /Move up/ })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByRole("menuitem", { name: /Move down/ })).not.toHaveAttribute(
      "aria-disabled",
    );
  });

  it("removes a lesson with an Undo toast that restores it at the same index", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("heading", { name: "The Romans" });
    await waitFor(() => expect(rows()).toHaveLength(3));

    await user.click(screen.getAllByRole("button", { name: "More actions" })[1] as HTMLElement);
    await user.click(await screen.findByRole("menuitem", { name: "Remove from series" }));
    await waitFor(() => expect(rows()).toEqual(["roman-roads", "roman-army"]));
    await waitFor(() => expect(toastSpy).toHaveBeenCalled());

    const [message, options] = toastSpy.mock.calls[0] as [
      string,
      { duration: number; action: { onClick: () => void } },
    ];
    expect(message).toBe("Removed “Fractions of amounts”");
    expect(options.duration).toBe(6000);
    options.action.onClick();
    await waitFor(() => expect(rows()).toEqual(["roman-roads", "demo-fractions", "roman-army"]));
  });

  it("renders the empty series and the missing series states", async () => {
    seriesId = "series-fractions";
    const { unmount } = renderPage();
    await screen.findByRole("heading", { name: "Fractions unit" });
    await waitFor(() => expect(rows()).toHaveLength(2));
    unmount();

    seriesId = "does-not-exist";
    renderPage();
    expect(await screen.findByText("This series was deleted or never existed.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Back to the library" }));
    expect(navigate).toHaveBeenCalledWith({ to: "/" });
    expect(screen.queryByRole("button", { name: "Present series" })).toBeNull();
  });
});
