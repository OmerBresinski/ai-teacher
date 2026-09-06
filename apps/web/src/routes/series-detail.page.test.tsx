import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "@tj/ui";
import type { ReactNode } from "react";
import { libraryQueries } from "@/lib/library";
import { createSeries, loadSeriesWithLessons, resetLibraryStore } from "@/mocks/library-store";

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

/** The `/series` list beside the page: proves a write here invalidates and re-renders the list. */
function SeriesTitles() {
  const { data } = useQuery(libraryQueries.series());
  return (
    <ul aria-label="Series list">
      {data?.map((item) => (
        <li key={item.series.id}>{item.series.title}</li>
      ))}
    </ul>
  );
}

function renderPage({ withList = false } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <SeriesDetailPage />
        {withList ? <SeriesTitles /> : null}
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

  it("renames through the page title and the series list re-renders through invalidation", async () => {
    const user = userEvent.setup();
    renderPage({ withList: true });
    const list = await screen.findByRole("list", { name: "Series list" });
    await waitFor(() => expect(within(list).getByText("The Romans")).toBeVisible());

    await user.dblClick(await screen.findByRole("heading", { name: "The Romans" }));
    const input = screen.getByRole("textbox", { name: "Series name" });
    await user.clear(input);
    await user.type(input, "Rome and its roads{Enter}");

    expect(await screen.findByRole("heading", { name: "Rome and its roads" })).toBeVisible();
    await waitFor(() => expect(within(list).getByText("Rome and its roads")).toBeVisible());
    expect(within(list).queryByText("The Romans")).toBeNull();
  });

  it("adds lessons in candidate order, not click order", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("heading", { name: "The Romans" });
    await waitFor(() => expect(rows()).toHaveLength(3));

    await user.click(screen.getByRole("button", { name: "Add lesson" }));
    const dialog = await screen.findByRole("dialog");
    const boxes = within(dialog).getAllByRole("checkbox");
    const [first, second] = boxes.map((box) => box.getAttribute("aria-labelledby"));
    const nameOf = (id: string | null | undefined) =>
      (id && document.getElementById(id)?.textContent) ?? "";
    const [firstTitle, secondTitle] = [nameOf(first), nameOf(second)];
    expect(firstTitle && secondTitle).toBeTruthy();

    await user.click(boxes[1] as HTMLElement);
    await user.click(boxes[0] as HTMLElement);
    await user.click(within(dialog).getByRole("button", { name: "Add 2 lessons" }));

    await waitFor(() => expect(rows()).toHaveLength(5));
    const stored = await loadSeriesWithLessons("series-romans");
    expect(stored?.lessons.slice(3).map((lesson) => lesson.title)).toEqual([
      firstTitle,
      secondTitle,
    ]);
  });

  it("renders the empty series and the missing series states", async () => {
    const empty = await createSeries("Blank unit");
    seriesId = empty.id;
    const { unmount } = renderPage();
    await screen.findByRole("heading", { name: "Blank unit" });
    expect(screen.getByText("No lessons in this series")).toBeVisible();
    expect(screen.getByText("No lessons yet")).toBeVisible();
    expect(screen.getAllByRole("button", { name: "Add lesson" })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Present series" })).toBeNull();
    unmount();

    seriesId = "does-not-exist";
    renderPage();
    expect(await screen.findByText("This series was deleted or never existed.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Back to the library" }));
    expect(navigate).toHaveBeenCalledWith({ to: "/" });
    expect(screen.queryByRole("button", { name: "Present series" })).toBeNull();
  });
});
