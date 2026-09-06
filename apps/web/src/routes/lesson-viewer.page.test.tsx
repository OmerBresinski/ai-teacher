import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TooltipProvider } from "@tj/ui";
import type { ReactNode } from "react";
import { listDocuments, resetLibraryStore } from "@/mocks/library-store";

let lessonId = "demo-water-cycle";
const navigate = mock();
const toastSpy = mock();
const actualRouter = await import("@tanstack/react-router");
mock.module("@tanstack/react-router", () => ({
  ...actualRouter,
  Link: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a>,
  useNavigate: () => navigate,
  useParams: () => ({ lessonId }),
}));
const actualUi = await import("@tj/ui");
mock.module("@tj/ui", () => ({ ...actualUi, toast: toastSpy }));

const { LessonViewerPage } = await import("./lesson-viewer.page");

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <LessonViewerPage />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

describe("LessonViewerPage", () => {
  beforeEach(async () => {
    lessonId = "demo-water-cycle";
    navigate.mockReset();
    toastSpy.mockReset();
    cleanup();
    await resetLibraryStore();
  });
  afterAll(() => mock.restore());

  it("renders the lesson in the viewer with Present, Export (disabled) and Make a copy", async () => {
    renderPage();
    expect((await screen.findAllByText("The water cycle"))[0]).toBeVisible();
    expect(screen.getByText(/\d+ slides/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Export" })).toHaveAttribute("aria-disabled", "true");
    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.click(screen.getByRole("button", { name: "Present" }));
    expect(navigate).toHaveBeenCalledWith({
      to: "/l/$lessonId/present",
      params: { lessonId: "demo-water-cycle" },
      search: { series: undefined, slide: 2, from: "view" },
    });
  });

  it("Make a copy duplicates the document, toasts and navigates to the copy", async () => {
    renderPage();
    await screen.findAllByText("The water cycle");
    const before = (await listDocuments()).length;
    fireEvent.click(screen.getByRole("button", { name: "Make a copy" }));
    await waitFor(() => expect(navigate).toHaveBeenCalled());
    const call = navigate.mock.calls[0]?.[0] as { to: string; params: { lessonId: string } };
    expect(call.to).toBe("/l/$lessonId/view");
    expect(call.params.lessonId).not.toBe("demo-water-cycle");
    expect((await listDocuments()).length).toBe(before + 1);
    expect(toastSpy).toHaveBeenCalledWith("Duplicated “The water cycle”");
  });

  it("Back returns to the remembered shell page", async () => {
    renderPage();
    await screen.findAllByText("The water cycle");
    fireEvent.click(screen.getByRole("button", { name: "Back to the library" }));
    expect(navigate).toHaveBeenCalledWith({ to: "/" });
  });

  it("a worksheet id on the lesson route shows the stub rather than crashing", async () => {
    lessonId = "fraction-practice";
    renderPage();
    expect(await screen.findByText("The editor arrives with @tj/editor")).toBeVisible();
  });
});
