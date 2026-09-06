import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { TooltipProvider } from "@tj/ui";
import type { ReactNode } from "react";

let search: { q?: string } = {};
const navigate = mock();
const actualRouter = await import("@tanstack/react-router");
mock.module("@tanstack/react-router", () => ({
  ...actualRouter,
  Link: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a>,
  useNavigate: () => navigate,
  useRouterState: ({
    select,
  }: {
    select: (state: { location: { search: typeof search } }) => unknown;
  }) => select({ location: { search } }),
}));

const { LibraryPage } = await import("./library-page");

function renderPage(mode: React.ComponentProps<typeof LibraryPage>["mode"]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <LibraryPage mode={mode} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

describe("LibraryPage", () => {
  beforeEach(() => {
    search = {};
    navigate.mockReset();
    localStorage.clear();
  });

  it("renders Home's capped library sections and creation strip", async () => {
    renderPage("home");

    expect(await screen.findByRole("heading", { name: "Home" })).toBeVisible();
    expect(screen.getByRole("button", { name: "New lesson" })).toBeVisible();
    expect(await screen.findByRole("heading", { name: "Recent" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Lessons" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Worksheets" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Series" })).toBeVisible();
    expect(screen.getAllByText("See all")).toHaveLength(3);
  });

  it("filters kind pages through the URL search parameter and clears on Escape", async () => {
    search = { q: "water" };
    renderPage("lesson");

    const input = await screen.findByRole("searchbox", { name: "Search by title" });
    expect(input).toHaveValue("water");
    expect(await screen.findByText("The water cycle")).toBeVisible();

    fireEvent.keyDown(input, { key: "Escape" });
    const navigation = navigate.mock.calls[0]?.[0] as {
      to: string;
      replace: boolean;
      search: object;
    };
    expect(navigation.to).toBe("/lessons");
    expect(navigation.replace).toBe(true);
    expect(navigation.search).toEqual({});
  });

  it("persists sort and view preferences", async () => {
    renderPage("lesson");

    await screen.findByRole("searchbox", { name: "Search by title" });
    fireEvent.pointerDown(screen.getByRole("button", { name: /Sort:/ }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "Title A–Z" }));
    expect(localStorage.getItem("tj:library:sort")).toBe("title");
    fireEvent.click(screen.getByRole("button", { name: "List" }));
    expect(localStorage.getItem("tj:library:view")).toBe("list");
  });

  it("focuses search with slash and shows the exact search-miss state", async () => {
    search = { q: "no matching title" };
    renderPage("lesson");

    const input = await screen.findByRole("searchbox", { name: "Search by title" });
    fireEvent.keyDown(document, { key: "/" });
    expect(input).toHaveFocus();
    expect(await screen.findByText("No titles match that")).toBeVisible();
    expect(screen.getAllByRole("button", { name: "Clear search" })).toHaveLength(2);
  });

  it("keeps Recent and Earlier groups when the list preference is selected", async () => {
    localStorage.setItem("tj:library:view", "list");
    renderPage("lesson");

    expect(await screen.findByRole("heading", { name: "Recent" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Earlier" })).toBeVisible();
    expect(screen.getByRole("list", { name: "Recent" })).toBeVisible();
    expect(screen.getByRole("list", { name: "Earlier" })).toBeVisible();
  });
});

afterAll(() => {
  mock.restore();
});
