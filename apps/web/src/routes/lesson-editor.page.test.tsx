import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TooltipProvider } from "@tj/ui";
import type { ReactNode } from "react";
import { listDocuments, loadDocument, resetLibraryStore } from "@/mocks/library-store";

let lessonId = "demo-water-cycle";
const navigate = mock();
const actualRouter = await import("@tanstack/react-router");
mock.module("@tanstack/react-router", () => ({
  ...actualRouter,
  Link: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a>,
  useNavigate: () => navigate,
  useParams: () => ({ lessonId }),
}));

const { LessonEditorPage } = await import("./lesson-editor.page");

// happy-dom has no layout: give the navigator's scroll region a height so react-virtual renders rows.
Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
  configurable: true,
  get(this: HTMLElement) {
    return this.getAttribute("role") === "listbox" ? 800 : 0;
  },
});

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <LessonEditorPage />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

describe("LessonEditorPage", () => {
  beforeEach(async () => {
    lessonId = "demo-water-cycle";
    navigate.mockReset();
    cleanup();
    await resetLibraryStore();
  });
  afterAll(() => mock.restore());

  it("row 1: mounts the editor with the title, N navigator thumbs, slide 1 on the canvas and Saved", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { level: 1, name: "The water cycle" })).toBeVisible();
    const lesson = await loadDocument("demo-water-cycle");
    const count = lesson && "slides" in lesson ? lesson.slides.length : 0;
    expect(count).toBeGreaterThan(1);
    const rail = screen.getByRole("listbox", { name: "Slides" });
    await waitFor(() => expect(rail.querySelectorAll('[role="option"]').length).toBe(count));
    // Exactly one full-size slide on the canvas: the first.
    const frame = document.querySelector('[data-slide-frame] [data-slide-mode="edit"]');
    expect(frame?.getAttribute("data-slide-id")).toBe(
      lesson && "slides" in lesson ? lesson.slides[0]?.id : "",
    );
    expect(screen.getByText("Saved")).toBeVisible();
    expect(screen.getByRole("button", { name: "Export" })).toHaveAttribute("aria-disabled", "true");
  });

  it("row 11: an inline rename autosaves to the store and the library list follows", async () => {
    renderPage();
    await screen.findByRole("heading", { level: 1, name: "The water cycle" });
    fireEvent.click(screen.getByRole("button", { name: "Rename lesson" }));
    const input = screen.getByRole("textbox", { name: "Lesson title" });
    fireEvent.change(input, { target: { value: "Rain, rivers and seas" } });
    fireEvent.blur(input);
    expect(screen.getByText("Unsaved changes")).toBeVisible();
    await waitFor(() => expect(screen.getByText("Saved")).toBeVisible(), { timeout: 3_000 });
    const saved = await loadDocument("demo-water-cycle");
    expect(saved?.title).toBe("Rain, rivers and seas");
    expect((await listDocuments()).find((d) => d.id === "demo-water-cycle")?.title).toBe(
      "Rain, rivers and seas",
    );
  });

  it("Present navigates to present mode with from=edit; Back returns to the shell", async () => {
    renderPage();
    await screen.findByRole("heading", { level: 1, name: "The water cycle" });
    fireEvent.click(screen.getByRole("button", { name: "Present" }));
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({
        to: "/l/$lessonId/present",
        params: { lessonId: "demo-water-cycle" },
        search: { series: undefined, from: "edit" },
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Back to library" }));
    expect(navigate).toHaveBeenCalledWith({ to: "/" });
  });

  it("a worksheet id on the lesson route shows the stub rather than crashing", async () => {
    lessonId = "fraction-practice";
    renderPage();
    expect(await screen.findByText("The editor arrives with @tj/editor")).toBeVisible();
  });
});
