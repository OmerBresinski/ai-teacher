import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { TooltipProvider } from "@tj/ui";
import type { ReactNode } from "react";
import { installFakeApi } from "@/test/fake-api";

const { fakeApi, restore: restoreFetch } = installFakeApi();

let worksheetId = "fraction-practice";
let search: { auto?: "1"; part?: "pupil" | "key" | "both" } = {};
/** A new-path generation record: only those sheets are judged unfinished (R4 review). */
const NEW_PATH = {
  jobId: "job-ws",
  stage: "checked" as const,
  startedAt: "2026-11-12T10:01:00.000Z",
  completedAt: "2026-11-12T10:02:00.000Z",
  promptVersions: { build: "worksheet-slides.v1" },
  usage: { calls: 1, inputTokens: 0, outputTokens: 0, costUsd: 0 },
  findings: [],
  recipeId: "practice" as const,
  practiceMinutes: 10,
};
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
    fakeApi.reset();
  });
  afterAll(() => {
    mock.restore();
    restoreFetch();
  });

  it("renders the demo worksheet as pages with its title and footer, and no app chrome", async () => {
    const { container } = renderPage();
    await whenSheetShown();
    expect(
      screen.getByRole("heading", { level: 1, name: "Fractions practice" }),
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

  it("the starter worksheet prints as pages under its own title", async () => {
    worksheetId = "roman-source";
    const { container } = renderPage();
    await whenSheetShown();
    expect(
      screen.getByRole("heading", { level: 1, name: "Roman source investigation" }),
    ).toBeInTheDocument();
    expect(container.querySelectorAll(".ws-print-root .ws-page").length).toBeGreaterThan(0);
    expect(screen.getByText(/^Page 1 of \d+$/)).toBeInTheDocument();
    await settle();
  });

  it("an unfinished sheet never prints, even with ?auto=1, and says why (WS1)", async () => {
    const print = mock(() => {});
    const original = window.print;
    window.print = print;
    try {
      const row = fakeApi.rows.get("fraction-practice");
      if (!row || !("blocks" in row.body)) throw new Error("fixture missing");
      row.body = {
        ...row.body,
        generation: NEW_PATH,
        blocks: [
          ...row.body.blocks,
          {
            id: "ph",
            type: "paragraph",
            doc: {
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Generation writes this part: questions" }],
                },
              ],
            },
          },
        ],
      };
      search = { auto: "1" };
      const { container } = renderPage();
      expect(await screen.findByText("This worksheet didn’t finish.")).toBeVisible();
      expect(
        screen.getByText("This worksheet isn’t finished, so it can’t be printed yet."),
      ).toBeVisible();
      expect(screen.getByText("Open the worksheet")).toHaveAttribute("to", "/w/$worksheetId");
      expect(container.querySelectorAll(".ws-page")).toHaveLength(0);
      await settle();
      expect(print).not.toHaveBeenCalled();
    } finally {
      window.print = original;
    }
  });

  it("an unkeyed question on a new-path sheet: the pupil sheet prints, the key says why", async () => {
    const row = fakeApi.rows.get("fraction-practice");
    if (!row || !("blocks" in row.body)) throw new Error("fixture missing");
    const unkeyed = {
      id: "qx",
      type: "question" as const,
      doc: {
        type: "doc" as const,
        content: [{ type: "paragraph", content: [{ type: "text", text: "A teacher's question" }] }],
      },
      answerLines: 2,
      number: 99,
    };
    row.body = {
      ...row.body,
      generation: NEW_PATH,
      blocks: [...row.body.blocks, unkeyed],
    } as never;
    search = { part: "key" };
    const first = renderPage();
    expect(await screen.findByText("The answer key isn’t ready.")).toBeVisible();
    expect(first.container.querySelectorAll(".ws-page")).toHaveLength(0);
    first.unmount();
    search = { part: "pupil" };
    const { container } = renderPage();
    await whenSheetShown();
    expect(container.querySelectorAll(".ws-print-root .ws-page").length).toBeGreaterThan(0);
    await settle();
  });

  it("a hand-made sheet with a placeholder prints as it did before the new path", async () => {
    const row = fakeApi.rows.get("fraction-practice");
    if (!row || !("blocks" in row.body)) throw new Error("fixture missing");
    row.body = {
      ...row.body,
      generation: undefined,
      blocks: [
        ...row.body.blocks,
        {
          id: "ph",
          type: "paragraph",
          doc: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "Generation writes this part: x" }],
              },
            ],
          },
        },
      ],
    } as never;
    const { container } = renderPage();
    await whenSheetShown();
    expect(container.querySelectorAll(".ws-print-root .ws-page").length).toBeGreaterThan(0);
    await settle();
  });

  it("a lesson id on the print route shows WrongKindPage rather than crashing", async () => {
    worksheetId = "demo-water-cycle";
    const { container } = renderPage();
    expect(await screen.findByText("This is a lesson")).toBeVisible();
    expect(container.querySelectorAll(".ws-page")).toHaveLength(0);
    // Still chrome-free (ADR 0023 §2): no AppBar; the way back is a link under the message.
    expect(screen.queryByRole("banner")).toBeNull();
    expect(screen.queryByRole("button", { name: "Back to the library" })).toBeNull();
    expect(screen.getByText("Back to the library")).toBeInTheDocument();
  });
});
