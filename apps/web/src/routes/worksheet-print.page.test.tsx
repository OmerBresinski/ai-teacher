import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { TooltipProvider } from "@tj/ui";
import type { ReactNode } from "react";
import { resetLibraryStore } from "@/mocks/library-store";

let worksheetId = "fraction-practice";
let search: { auto?: "1" } = {};
const navigate = mock();
const actualRouter = await import("@tanstack/react-router");
mock.module("@tanstack/react-router", () => ({
  ...actualRouter,
  Link: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a>,
  useNavigate: () => navigate,
  useParams: () => ({ worksheetId }),
  useSearch: () => search,
}));

const { WorksheetPrintPage } = await import("./worksheet-print.page");

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WorksheetPrintPage />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

/** `whenFontsReady` resolves on a microtask and the print fires two frames later: let both land. */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 60)));

/**
 * Nothing here is timed against a fixed delay (TEACH-140). `WorksheetPrint` keeps `<main>` at
 * `visibility: hidden` until the sheet is measured and the fonts are in; a role query polled during
 * that window leaves happy-dom's computed-style cache saying the `<h1>` is hidden after the inline
 * style is gone, and `findByRole` then never resolves. So wait on the inline style — read from the
 * attribute, not the cache — and only then query by role.
 */
const WAIT = { timeout: 3000 };
const whenSheetShown = () =>
  waitFor(() => {
    const main = document.querySelector<HTMLElement>("main.ws-print-root");
    expect(main).not.toBeNull();
    expect(main?.style.visibility).toBe("");
  }, WAIT);

describe("WorksheetPrintPage", () => {
  beforeEach(async () => {
    worksheetId = "fraction-practice";
    search = {};
    navigate.mockReset();
    cleanup();
    await resetLibraryStore();
  });
  afterAll(() => mock.restore());

  it("renders the demo worksheet as pages with its title and footer, and no app chrome", async () => {
    const { container } = renderPage();
    await whenSheetShown();
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "The water cycle: check your understanding",
      }),
    ).toBeInTheDocument();
    expect(container.querySelectorAll(".ws-print-root .ws-page").length).toBeGreaterThan(0);
    expect(screen.getByText(/^Page 1 of \d+$/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Back to the library" })).toBeNull();
    // The one landmark on the page (axe `landmark-one-main`).
    expect(screen.getByRole("main")).toHaveClass("ws-print-root");
    // The demo sheet ships without an answer key.
    expect(screen.queryByRole("heading", { level: 2, name: "Answer key" })).toBeNull();
    await settle();
  });

  it("?auto=1 prints once the sheet is measured; without it, never", async () => {
    const print = mock(() => {});
    const original = window.print;
    window.print = print;
    try {
      search = { auto: "1" };
      renderPage();
      await whenSheetShown();
      // Wait for the call, not for a fixed delay: fonts-ready → measure → two frames is not a
      // fixed number of milliseconds under CI load.
      await waitFor(() => expect(print).toHaveBeenCalledTimes(1), WAIT);
      cleanup();

      search = {};
      renderPage();
      await whenSheetShown();
      expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
      // A negative cannot be awaited: give the gate the same room it needs to print, then assert
      // it did not.
      await settle();
      await settle();
      expect(print).toHaveBeenCalledTimes(1);
    } finally {
      window.print = original;
    }
  });

  it("a lesson id on the print route shows WrongKindPage rather than crashing", async () => {
    worksheetId = "demo-water-cycle";
    renderPage();
    expect(await screen.findByText("This is a lesson")).toBeVisible();
    // Still chrome-free (ADR 0023 §2): no AppBar; the way back is a link under the message.
    expect(screen.queryByRole("banner")).toBeNull();
    expect(screen.queryByRole("button", { name: "Back to the library" })).toBeNull();
    expect(screen.getByText("Back to the library")).toBeInTheDocument();
  });
});
