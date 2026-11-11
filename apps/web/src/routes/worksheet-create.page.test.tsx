import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { TooltipProvider } from "@tj/ui";
import { installFakeApi } from "@/test/fake-api";

/*
 * The worksheet creation flow (TEACH-184) at `/worksheets/new`: Source, then Kind. Rows 1, 2, 5
 * and 8 and the example-facts case, moved from Playwright (TEACH-301). The fake api is seeded
 * with `demoWorkspace()`, so the water cycle lesson carries facts and Roman roads does not.
 */
const { fakeApi, restore } = installFakeApi();
const navigate = mock();
let search: { lesson?: string } = {};
const actualRouter = await import("@tanstack/react-router");
mock.module("@tanstack/react-router", () => ({
  ...actualRouter,
  useNavigate: () => navigate,
  useSearch: () => search,
}));
const { WorksheetCreatePage } = await import("./worksheet-create.page");

function show() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <WorksheetCreatePage />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

const step = (name: "source" | "kind") => document.querySelector(`[data-create-step="${name}"]`);
const recipe = (name: string) => document.querySelector(`[data-recipe="${name}"]`);
const kinds = () => within(screen.getByRole("list", { name: "Kinds" })).getAllByRole("listitem");
const recentLessons = () =>
  within(screen.getByRole("list", { name: "Recent lessons" })).getAllByRole("listitem");

describe("WorksheetCreatePage", () => {
  beforeEach(() => {
    cleanup();
    fakeApi.reset();
    navigate.mockReset();
    localStorage.clear();
    search = {};
  });
  afterAll(() => {
    cleanup();
    restore();
    mock.restore();
  });

  it("row 1: opens on Source with recent lessons and Blank, and nothing chosen", async () => {
    show();
    expect(screen.getByRole("heading", { level: 1, name: "New worksheet" })).toBeVisible();
    await waitFor(() => expect(recentLessons()).toHaveLength(10));
    expect(screen.getByRole("button", { name: /^The water cycle\. Year 4 Science/ })).toBeVisible();
    expect(screen.getByRole("button", { name: /^Blank/ })).toBeVisible();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    expect(screen.getByText("Choose a lesson or Blank.")).toBeVisible();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search lessons" }), {
      target: { value: "roman" },
    });
    await waitFor(() => expect(recentLessons()).toHaveLength(3));
  });

  it("row 2 (plan v2 T6): the water cycle's Kind offers only Exit ticket, the old seven and the job chips hidden; no exit slide greys it", async () => {
    search = { lesson: "demo-water-cycle" };
    show();
    await waitFor(() => expect(kinds()).toHaveLength(1));
    expect(recipe("exit-ticket")).not.toBeNull();
    for (const old of ["knowledge-check", "cloze", "matching", "word-search", "exam-style"]) {
      expect(recipe(old)).toBeNull();
    }
    expect(screen.queryByRole("button", { name: "Practise" })).toBeNull();
    expect(recipe("exit-ticket")).toHaveTextContent("Suggested");
    // The demo lesson has no exit-ticket slide, so the sheet cannot be made from it.
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    expect(screen.getByText("This lesson has no exit ticket to put on a sheet.")).toBeVisible();
    expect(document.querySelector('[data-tier="core"]')).toHaveAttribute("data-selected", "true");
  });

  it("row 5: ?lesson= opens Kind for that lesson; Escape returns to Source with it chosen; Enter continues", async () => {
    search = { lesson: "demo-water-cycle" };
    show();
    await waitFor(() => expect(kinds()).toHaveLength(1));
    expect(step("kind")).toHaveTextContent("For The water cycle.");
    // Row 8: Escape returns to Source, from anywhere on the step (bound on window).
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(step("source")).not.toBeNull());
    const lesson = screen.getByRole("button", { name: /^The water cycle\./ });
    expect(lesson).toHaveAttribute("aria-pressed", "true");
    fireEvent.keyDown(lesson, { key: "Enter" });
    await waitFor(() => expect(step("kind")).not.toBeNull());
  });

  it("row 8: Enter on an unselected card chooses and continues; Enter on Blank after a lesson goes Blank", async () => {
    show();
    const roman = await screen.findByRole("button", { name: /^Roman roads\./ });
    fireEvent.keyDown(roman, { key: "Enter" });
    await waitFor(() => expect(step("kind")).not.toBeNull());
    expect(step("kind")).toHaveTextContent("For Roman roads.");
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(step("source")).not.toBeNull());
    expect(screen.getByRole("button", { name: /^Roman roads\./ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.keyDown(screen.getByRole("button", { name: /^Blank/ }), { key: "Enter" });
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({
        to: "/w/$worksheetId",
        params: { worksheetId: expect.any(String) },
      }),
    );
    const created = fakeApi.requests.find((r) => r.method === "POST" && r.path === "/documents");
    if (!created) throw new Error("no POST /documents");
    expect((created.body as { body: { title: string } }).body.title).toBe("Untitled worksheet");
  });

  it("a lesson without facts says its miniatures are built from example facts", async () => {
    search = { lesson: "roman-roads" };
    show();
    await waitFor(() => expect(kinds()).toHaveLength(1));
    expect(step("kind")).toHaveAttribute("data-facts", "example");
    expect(document.querySelector("[data-example-facts-hint]")).toHaveTextContent(
      /^Built from example facts until this lesson has its own$/,
    );
    // The header is this lesson's, not the example lesson's.
    expect(recipe("exit-ticket")?.querySelector(".ws-mini .ws-title")).toHaveTextContent(
      /^Roman roads$/,
    );
    expect(recipe("exit-ticket")).toHaveTextContent("Suggested");
  });
});
