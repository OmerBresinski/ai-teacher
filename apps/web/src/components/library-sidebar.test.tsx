import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ThemeProvider, TooltipProvider } from "@tj/ui";
import type { ReactNode } from "react";
import { installFakeApi } from "@/test/fake-api";

const { fakeApi, restore: restoreFetch } = installFakeApi();

let pathname = "/lessons";
const navigate = mock();
const actualRouter = await import("@tanstack/react-router");
mock.module("@tanstack/react-router", () => ({
  ...actualRouter,
  Link: ({
    children,
    to,
    search: _search,
    ...props
  }: {
    children: ReactNode;
    to: string;
    search?: unknown;
  }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useNavigate: () => navigate,
  useRouterState: ({
    select,
  }: {
    select: (state: { location: { pathname: string } }) => unknown;
  }) => select({ location: { pathname } }),
}));

const { LibrarySidebar } = await import("./library-sidebar");

function renderSidebar() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <LibrarySidebar onImport={() => {}} onShortcuts={() => {}} />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe("LibrarySidebar", () => {
  beforeEach(() => {
    pathname = "/lessons";
    localStorage.clear();
    navigate.mockReset();
    fakeApi.reset();
  });

  it("counts an empty Workspace's lessons as 0", async () => {
    fakeApi.rows.clear();
    renderSidebar();

    const lessons = screen.getByRole("link", { name: /Lessons/ });
    await waitFor(() => expect(lessons).toHaveTextContent(/^Lessons\s*0$/));
  });

  it("marks the current library branch active and persists collapse", async () => {
    renderSidebar();

    expect(screen.getByText("DayBack")).toHaveClass("whitespace-nowrap");
    expect(screen.getByRole("link", { name: /Lessons/ })).toHaveAttribute("aria-current", "page");
    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(localStorage.getItem("tj:sidebar-collapsed")).toBe("1");
  });

  it("links to Settings in the foot and marks it active there", () => {
    pathname = "/settings";
    renderSidebar();

    const link = screen.getByRole("link", { name: /Settings/ });
    expect(link).toHaveAttribute("href", "/settings");
    expect(link).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /Lessons/ })).not.toHaveAttribute("aria-current");
  });

  it("has no Theme menu: the theme is set on the Settings page", () => {
    renderSidebar();

    expect(screen.queryByRole("button", { name: "Theme" })).toBeNull();
  });
});

afterAll(() => {
  mock.restore();
  restoreFetch();
});
