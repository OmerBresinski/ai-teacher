import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { DocumentSummary, SeriesWithLessons } from "@/mocks/library-schema";
import {
  listDocuments,
  listSeriesWithLessons,
  loadDocument,
  resetLibraryStore,
} from "@/mocks/library-store";

const navigate = mock();
const toastSpy = mock();
const actualRouter = await import("@tanstack/react-router");
mock.module("@tanstack/react-router", () => ({ ...actualRouter, useNavigate: () => navigate }));
const actualUi = await import("@tj/ui");
mock.module("@tj/ui", () => ({ ...actualUi, toast: toastSpy }));

const { useLibraryActions, UNDO_MS } = await import("./use-library-actions");

function renderActions() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = mock(queryClient.invalidateQueries.bind(queryClient));
  queryClient.invalidateQueries = invalidate;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { ...renderHook(() => useLibraryActions(), { wrapper }), invalidate };
}

const lesson = (): Promise<DocumentSummary> =>
  listDocuments().then((docs) => {
    const doc = docs.find((d) => d.id === "demo-water-cycle");
    if (!doc) throw new Error("fixture missing");
    return doc;
  });
const romans = async (): Promise<SeriesWithLessons> => {
  const item = (await listSeriesWithLessons()).find((s) => s.series.id === "series-romans");
  if (!item) throw new Error("fixture missing");
  return item;
};
/** Fire a handler and let the mock store's async mutation settle inside act. */
const fire = (run: () => void) =>
  act(async () => {
    run();
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
const lastToast = () =>
  toastSpy.mock.calls.at(-1) as [string, { duration?: number; action?: { onClick: () => void } }];

describe("useLibraryActions", () => {
  beforeEach(async () => {
    navigate.mockReset();
    toastSpy.mockReset();
    cleanup();
    await resetLibraryStore();
  });
  afterAll(() => mock.restore());

  it("open and present navigate to the document routes by kind", async () => {
    const { result } = renderActions();
    const doc = await lesson();
    await fire(() => result.current.onDocumentAction("open", doc));
    expect(navigate).toHaveBeenLastCalledWith({
      to: "/l/$lessonId",
      params: { lessonId: doc.id },
    });
    await fire(() =>
      result.current.onDocumentAction("open", { ...doc, id: "w1", kind: "worksheet" }),
    );
    expect(navigate).toHaveBeenLastCalledWith({
      to: "/w/$worksheetId",
      params: { worksheetId: "w1" },
    });
    await fire(() => result.current.onDocumentAction("present", doc));
    expect(navigate).toHaveBeenLastCalledWith({
      to: "/l/$lessonId/present",
      params: { lessonId: doc.id },
    });
  });

  it("duplicate writes a copy, toasts, and invalidates the library family", async () => {
    const { result, invalidate } = renderActions();
    const doc = await lesson();
    await fire(() => result.current.onDocumentAction("duplicate", doc));
    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith(`Duplicated “${doc.title}”`));
    const titles = (await listDocuments()).map((d) => d.title);
    expect(titles).toContain(`${doc.title} (copy)`);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["library"] });
  });

  it("delete toasts after the store confirms, and Undo restores", async () => {
    const { result } = renderActions();
    const doc = await lesson();
    await fire(() => result.current.onDocumentAction("delete", doc));
    await waitFor(() => expect(toastSpy).toHaveBeenCalled());
    expect((await listDocuments()).some((d) => d.id === doc.id)).toBe(false);

    const [message, options] = lastToast();
    expect(message).toBe(`Deleted “${doc.title}”`);
    expect(options.duration).toBe(UNDO_MS);
    await fire(() => options.action?.onClick());
    await waitFor(async () =>
      expect((await listDocuments()).some((d) => d.id === doc.id)).toBe(true),
    );
  });

  it("export is a placeholder toast; rename writes the trimmed title", async () => {
    const { result } = renderActions();
    const doc = await lesson();
    await fire(() => result.current.onDocumentAction("export", doc));
    expect(toastSpy).toHaveBeenCalledWith("Export arrives with the editor");
    await fire(() => result.current.onDocumentRename(doc, "Rain"));
    await waitFor(async () => expect((await loadDocument(doc.id))?.title).toBe("Rain"));
  });

  it("series: present goes to the first lesson with the series search param", async () => {
    const { result } = renderActions();
    const item = await romans();
    await fire(() => result.current.onSeriesAction("present", item));
    expect(navigate).toHaveBeenCalledWith({
      to: "/l/$lessonId/present",
      params: { lessonId: item.lessons[0]?.id },
      search: { series: item.series.id },
    });
    await fire(() => result.current.onSeriesAction("present", { ...item, lessons: [] }));
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it("series: duplicate, delete with Undo, rename", async () => {
    const { result } = renderActions();
    const item = await romans();

    await fire(() => result.current.onSeriesAction("duplicate", item));
    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith(`Duplicated “${item.series.title}”`));

    await fire(() => result.current.onSeriesAction("delete", item));
    await waitFor(() => expect(lastToast()[0]).toBe(`Deleted “${item.series.title}”`));
    expect((await listSeriesWithLessons()).some((s) => s.series.id === item.series.id)).toBe(false);
    await fire(() => lastToast()[1].action?.onClick());
    await waitFor(async () =>
      expect((await listSeriesWithLessons()).some((s) => s.series.id === item.series.id)).toBe(
        true,
      ),
    );

    await fire(() => result.current.onSeriesRename(item, "Rome"));
    await waitFor(async () => expect((await romans()).series.title).toBe("Rome"));
  });

  it("create navigates to the new document or series", async () => {
    const { result } = renderActions();
    await act(async () => {
      await result.current.createNewDocument("worksheet", {
        title: "Sheet",
        themeId: "chalk",
        start: "starter",
      });
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(navigate).toHaveBeenLastCalledWith(expect.objectContaining({ to: "/w/$worksheetId" }));
    await act(async () => {
      await result.current.createNewSeries("Unit");
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(navigate).toHaveBeenLastCalledWith(expect.objectContaining({ to: "/series/$seriesId" }));
  });
});
