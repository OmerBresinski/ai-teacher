import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { TooltipProvider } from "@tj/ui";
import type { ReactNode } from "react";
import { installFakeApi } from "@/test/fake-api";

const { fakeApi, restore: restoreFetch } = installFakeApi();

let worksheetId = "fraction-practice";

/**
 * The top bar's h1. The sheet's own title heading reads the same since TEACH-186 (the paper says
 * what the card says), so the query is scoped to the bar that holds Back to library.
 */
async function findTopBarTitle(name = "Fractions practice"): Promise<HTMLElement> {
  const back = await screen.findByRole("button", { name: "Back to library" });
  const bar = back.closest('header, [role="banner"]');
  if (!(bar instanceof HTMLElement)) throw new Error("no top bar");
  return within(bar).findByRole("heading", { level: 1, name });
}

const navigate = mock();
const actualRouter = await import("@tanstack/react-router");
mock.module("@tanstack/react-router", () => ({
  ...actualRouter,
  Link: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a>,
  useNavigate: () => navigate,
  useParams: () => ({ worksheetId }),
}));

const { WorksheetEditorPage } = await import("./worksheet-editor.page");
const { worksheetPrintHref } = await import("@/lib/worksheet-print-href");

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WorksheetEditorPage />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

describe("WorksheetEditorPage", () => {
  beforeEach(async () => {
    worksheetId = "fraction-practice";
    navigate.mockReset();
    cleanup();
    fakeApi.reset();
  });
  afterAll(() => {
    mock.restore();
    restoreFetch();
  });

  it("row 1: mounts the editor with the title, the header, every block and Saved", async () => {
    const { container } = renderPage();
    expect(await findTopBarTitle()).toBeVisible();
    const worksheet = fakeApi.loadDocument("fraction-practice");
    const count = worksheet && "blocks" in worksheet ? worksheet.blocks.length : 0;
    expect(count).toBeGreaterThan(1);
    // The header strip is on the sheet, editable.
    expect(screen.getByRole("textbox", { name: "Sheet title" })).toHaveTextContent(
      "Fractions practice",
    );
    await waitFor(() =>
      // The self-assessment strip is a flow item too, not one of the blocks (TEACH-196).
      expect(container.querySelectorAll(".ws-column .ws-block:not(.ws-rag-slot)").length).toBe(
        count,
      ),
    );
    expect(screen.getByText("Saved")).toBeVisible();
    expect(screen.getByRole("button", { name: "Export" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Print" })).toBeEnabled();
  });

  it("an inline rename autosaves to the store and the library list follows", async () => {
    renderPage();
    await findTopBarTitle();
    fireEvent.click(screen.getByRole("button", { name: "Rename worksheet" }));
    const input = screen.getByRole("textbox", { name: "Worksheet title" });
    fireEvent.change(input, { target: { value: "Fractions: a check" } });
    fireEvent.blur(input);
    expect(screen.getByText("Unsaved changes")).toBeVisible();
    await waitFor(() => expect(screen.getByText("Saved")).toBeVisible(), { timeout: 3_000 });
    const saved = fakeApi.loadDocument("fraction-practice");
    expect(saved?.title).toBe("Fractions: a check");
    expect(fakeApi.listDocuments().find((d) => d.id === "fraction-practice")?.title).toBe(
      "Fractions: a check",
    );
  });

  it("row 9: Print opens the print route with ?auto=1 in a new tab; Back returns to the shell", async () => {
    const open = mock(() => null);
    const original = window.open;
    window.open = open as unknown as typeof window.open;
    try {
      renderPage();
      await findTopBarTitle();
      fireEvent.click(screen.getByRole("button", { name: "Print" }));
      await waitFor(() =>
        expect(open).toHaveBeenCalledWith(
          "/w/fraction-practice/print?auto=1",
          "_blank",
          "noopener",
        ),
      );
      expect(worksheetPrintHref("a b")).toBe("/w/a%20b/print?auto=1");
      fireEvent.click(screen.getByRole("button", { name: "Back to library" }));
      expect(navigate).toHaveBeenCalledWith({ to: "/" });
    } finally {
      window.open = original;
    }
  });

  it("row 10: a lesson id on the worksheet route shows WrongKindPage with a link to the lesson", async () => {
    worksheetId = "demo-water-cycle";
    renderPage();
    expect(await screen.findByText("This is a lesson")).toBeVisible();
    // The route mock renders `Link` as a bare anchor: assert the text, the real href is the router's.
    expect(screen.getByText("Open the lesson")).toBeInTheDocument();
    expect(document.querySelector("[data-worksheet-editor]")).toBeNull();
  });
});
