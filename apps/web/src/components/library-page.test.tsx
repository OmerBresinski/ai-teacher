import { afterAll, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as ui from "@tj/ui";
import { TooltipProvider } from "@tj/ui";
import type { ReactNode } from "react";
import { installFakeApi } from "@/test/fake-api";

const { fakeApi, restore: restoreFetch } = installFakeApi();

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
    fakeApi.reset();
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
    // The card title and its (aria-hidden) cover slide both carry the text.
    expect((await screen.findAllByText("The water cycle"))[0]).toBeVisible();
    // The search went to the server as `q`, on the lesson list only.
    const listRequest = fakeApi.requests.find((r) => r.path === "/documents");
    expect(Object.fromEntries(listRequest?.query ?? [])).toMatchObject({
      kind: "lesson",
      q: "water",
      sort: "updated",
      limit: "100",
    });
    expect(screen.queryByText("Roman roads")).toBeNull();

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
    // The new order is the server's: a fresh list request carries `sort=title`.
    await waitFor(() =>
      expect(
        fakeApi.requests.some((r) => r.path === "/documents" && r.query.get("sort") === "title"),
      ).toBe(true),
    );
    fireEvent.click(screen.getByRole("button", { name: "List" }));
    expect(localStorage.getItem("tj:library:view")).toBe("list");
  });

  it("focuses search only when slash has no modifier or editable target", async () => {
    search = { q: "no matching title" };
    renderPage("lesson");

    const input = await screen.findByRole("searchbox", { name: "Search by title" });
    fireEvent.keyDown(document, { key: "/" });
    expect(input).toHaveFocus();
    input.blur();

    for (const modifier of ["altKey", "ctrlKey", "metaKey", "shiftKey"] as const) {
      fireEvent.keyDown(document, { key: "/", [modifier]: true });
      expect(input).not.toHaveFocus();
    }

    input.focus();
    fireEvent.keyDown(input, { key: "/" });
    expect(input).toHaveFocus();

    const editable = document.createElement("div");
    editable.contentEditable = "true";
    document.body.append(editable);
    editable.focus();
    fireEvent.keyDown(editable, { key: "/" });
    expect(input).not.toHaveFocus();
    editable.remove();

    expect(await screen.findByText("No titles match that")).toBeVisible();
    expect(screen.getAllByRole("button", { name: "Clear search" })).toHaveLength(2);
  });

  it("renders the query error and retries the failed document query", async () => {
    fakeApi.failNext(
      (r) => r.path === "/documents" && r.query.get("kind") === "lesson",
      () =>
        new Response(JSON.stringify({ error: { code: "internal_error", message: "boom" } }), {
          status: 500,
        }),
    );

    renderPage("home");

    expect(await screen.findByText("Your library could not be loaded")).toBeVisible();
    const before = fakeApi.requests.filter((r) => r.query.get("kind") === "lesson").length;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() =>
      expect(fakeApi.requests.filter((r) => r.query.get("kind") === "lesson").length).toBe(
        before + 1,
      ),
    );
    expect(await screen.findByRole("heading", { name: "Recent" })).toBeVisible();
  });

  it("shows the empty state for a Workspace with nothing in it", async () => {
    fakeApi.rows.clear();
    renderPage("home");
    expect(await screen.findByText("Nothing here yet")).toBeVisible();
    expect(fakeApi.requests.map((r) => r.query.get("kind")).sort()).toEqual([
      "lesson",
      "series",
      "worksheet",
    ]);
  });

  it("keeps Recent and Earlier groups when the list preference is selected", async () => {
    localStorage.setItem("tj:library:view", "list");
    renderPage("lesson");

    expect(await screen.findByRole("heading", { name: "Recent" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Earlier" })).toBeVisible();
    expect(screen.getByRole("table", { name: "Recent" })).toBeVisible();
    expect(screen.getByRole("table", { name: "Earlier" })).toBeVisible();
  });

  it("deletes through a six-second Undo toast and restores the document", async () => {
    const toastSpy = spyOn(ui, "toast");
    renderPage("lesson");

    await screen.findAllByText("The water cycle");
    const menuTrigger = screen.getAllByRole("button", { name: "More actions" })[0];
    if (!menuTrigger) throw new Error("Library card menu trigger is missing");
    fireEvent.pointerDown(menuTrigger, {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete" }));
    await waitFor(() => expect(toastSpy).toHaveBeenCalled());
    const deletedToast = toastSpy.mock.calls.find(([message]) =>
      String(message).startsWith("Deleted “"),
    );
    if (!deletedToast) throw new Error("Delete toast is missing");
    const options = deletedToast[1] as unknown as {
      duration: number;
      action: { onClick: () => void };
    };
    expect(options.duration).toBe(6000);
    options.action.onClick();
    const title = String(deletedToast[0]).slice(9, -1);
    await waitFor(() => expect(screen.getAllByText(title)[0]).toBeVisible());
    toastSpy.mockRestore();
  });
});

afterAll(() => {
  mock.restore();
  restoreFetch();
});
