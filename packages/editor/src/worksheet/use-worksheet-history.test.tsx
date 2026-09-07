import { describe, expect, mock, test } from "bun:test";
import { notifyManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { Worksheet } from "@tj/domain/documents";
import type { ReactNode } from "react";
import { newLesson } from "../model/factories";
import { starterWorksheet } from "../model/worksheet-factories";
import * as r from "./reducers";
import { isWorksheetData, useWorksheetHistory } from "./use-worksheet-history";

const KEY = ["library", "documents", "W1"] as const;

// TanStack batches observer notifications on a setTimeout; `act` cannot flush that, so the hook's
// `worksheet` would lag one tick behind the cache in assertions. Deliver them synchronously here.
notifyManager.setScheduler((callback) => callback());

function setup(seed: unknown = starterWorksheet("Seed")) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(KEY, seed);
  const onChange = mock((_worksheet: Worksheet) => {});
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(
    () => useWorksheetHistory({ queryKey: KEY, queryFn: () => Promise.resolve(seed), onChange }),
    { wrapper },
  );
  return { client, onChange, ...hook };
}

describe("useWorksheetHistory", () => {
  test("reads the worksheet from the cache; a lesson, a summary or null is not one", () => {
    expect(setup().result.current.worksheet?.title).toBe("Seed");
    expect(setup(null).result.current.worksheet).toBeUndefined();
    expect(setup({ kind: "worksheet" }).result.current.worksheet).toBeUndefined();
    expect(setup(newLesson("L")).result.current.worksheet).toBeUndefined();
    expect(isWorksheetData({ version: 1, blocks: [] })).toBe(true);
    expect(isWorksheetData({ version: 1, slides: [] })).toBe(false);
  });

  test("dispatch writes the cache, returns the reducer result and calls onChange once", () => {
    const { result, client, onChange } = setup();
    const first = result.current.worksheet?.blocks[0]?.id ?? "";
    let id: string | null = null;
    act(() => {
      id = result.current.dispatch(r.duplicateBlock, first)?.id ?? null;
    });
    expect(id).toBeTruthy();
    const cached = client.getQueryData(KEY);
    expect(cached).toBe(result.current.worksheet);
    expect(result.current.worksheet?.blocks[1]?.id).toBe(id ?? "");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]?.[0]).toBe(cached as Worksheet);
    expect(result.current.canUndo).toBe(true);
    // A no-op records nothing.
    act(() => {
      result.current.dispatch(r.deleteBlock, "missing");
    });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  test("3 dispatches → undo ×3 walks back to the original; redo ×3 restores", () => {
    const { result } = setup();
    const original = result.current.worksheet;
    const titles = ["One", "Two", "Three"];
    for (const title of titles) {
      act(() => {
        result.current.dispatch(r.setTitle, title);
      });
    }
    const final = result.current.worksheet;
    act(() => result.current.undo());
    expect(result.current.worksheet?.title).toBe("Two");
    act(() => result.current.undo());
    act(() => result.current.undo());
    expect(result.current.worksheet).toBe(original);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(true);
    for (const title of titles) {
      act(() => result.current.redo());
      expect(result.current.worksheet?.title).toBe(title);
    }
    expect(result.current.worksheet).toBe(final);
    expect(result.current.canRedo).toBe(false);
  });

  test("a transaction of 10 dispatches is one undo step and one onChange; rollback restores", () => {
    const { result, onChange } = setup();
    const before = result.current.worksheet;
    act(() => {
      result.current.beginTransaction();
      for (let i = 1; i <= 10; i += 1) result.current.dispatch(r.setTitle, `Title ${i}`);
    });
    expect(result.current.isTransactionInFlight()).toBe(true);
    expect(result.current.worksheet?.title).toBe("Title 10");
    expect(result.current.canUndo).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
    act(() => result.current.endTransaction());
    expect(result.current.canUndo).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(1);
    act(() => result.current.undo());
    expect(result.current.worksheet).toBe(before);

    let token = 0;
    act(() => {
      token = result.current.beginTransaction();
      result.current.dispatch(r.setPageSize, "Letter");
    });
    expect(result.current.worksheet?.pageSize).toBe("Letter");
    act(() => result.current.rollbackTransaction(token));
    expect(result.current.worksheet).toBe(before);
    expect(result.current.isTransactionInFlight()).toBe(false);
  });
});
