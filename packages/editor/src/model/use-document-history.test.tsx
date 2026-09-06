import { describe, expect, mock, test } from "bun:test";
import { notifyManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { Lesson, ShapeElement } from "@tj/domain/documents";
import type { ReactNode } from "react";
import { newLesson, uid } from "./factories";
import * as r from "./reducers";
import { HISTORY_LIMIT, isLessonData, useDocumentHistory } from "./use-document-history";

const KEY = ["library", "documents", "L1"] as const;

// TanStack batches observer notifications on a setTimeout; `act` cannot flush that, so the hook's
// `lesson` would lag one tick behind the cache in assertions. Deliver them synchronously here.
notifyManager.setScheduler((callback) => callback());

function shape(x: number, y: number): ShapeElement {
  return { id: uid(), type: "shape", shape: "rect", x, y, w: 100, h: 50 };
}

function setup(seed: Lesson | null | { kind: "lesson" } = seededLesson()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(KEY, seed);
  const onChange = mock((_lesson: Lesson) => {});
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(
    () => useDocumentHistory({ queryKey: KEY, queryFn: () => Promise.resolve(seed), onChange }),
    { wrapper },
  );
  return { client, onChange, ...hook };
}

function seededLesson(): Lesson {
  const lesson = newLesson("Seed");
  const first = lesson.slides[0];
  if (first) first.elements = [shape(10, 10)];
  return lesson;
}

const firstX = (lesson: Lesson | undefined) => lesson?.slides[0]?.elements[0]?.x;
const slideId = (lesson: Lesson | undefined) => lesson?.slides[0]?.id ?? "";
const elementId = (lesson: Lesson | undefined) => lesson?.slides[0]?.elements[0]?.id ?? "";

describe("useDocumentHistory", () => {
  test("reads the lesson from the cache; a summary or null is not a lesson", () => {
    expect(setup().result.current.lesson?.title).toBe("Seed");
    expect(setup(null).result.current.lesson).toBeUndefined();
    expect(setup({ kind: "lesson" }).result.current.lesson).toBeUndefined();
    expect(isLessonData({ version: 1, slides: [] })).toBe(true);
    expect(isLessonData({ version: 1, blocks: [] })).toBe(false);
  });

  test("dispatch writes the cache, returns the reducer result and calls onChange once", () => {
    const { result, client, onChange } = setup();
    let id: string | null = null;
    act(() => {
      id = result.current.dispatch(r.addSlide, "content")?.id ?? null;
    });
    expect(id).toBeTruthy();
    const cached = client.getQueryData(KEY);
    expect(cached).toBe(result.current.lesson);
    expect(result.current.lesson?.slides).toHaveLength(2);
    expect(result.current.lesson?.slides[1]?.id).toBe(id ?? "");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]?.[0]).toBe(cached as Lesson);
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);
  });

  test("a no-op dispatch records nothing", () => {
    const { result, onChange } = setup();
    act(() => {
      result.current.dispatch(r.deleteSlide, "missing");
    });
    expect(result.current.canUndo).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
  });

  test("undo ×3 walks back to the original; redo ×3 restores", () => {
    const { result } = setup();
    const original = result.current.lesson;
    const titles = ["One", "Two", "Three"];
    for (const title of titles) {
      act(() => {
        result.current.dispatch(r.setTitle, title);
      });
    }
    const final = result.current.lesson;
    expect(final?.title).toBe("Three");
    act(() => result.current.undo());
    expect(result.current.lesson?.title).toBe("Two");
    expect(result.current.canRedo).toBe(true);
    act(() => result.current.undo());
    expect(result.current.lesson?.title).toBe("One");
    act(() => result.current.undo());
    expect(result.current.lesson).toBe(original);
    expect(result.current.canUndo).toBe(false);
    act(() => result.current.undo());
    expect(result.current.lesson).toBe(original);
    for (const title of titles) {
      act(() => result.current.redo());
      expect(result.current.lesson?.title).toBe(title);
    }
    expect(result.current.lesson).toBe(final);
    expect(result.current.canRedo).toBe(false);
  });

  test("a new edit after undo drops the redo stack", () => {
    const { result } = setup();
    act(() => {
      result.current.dispatch(r.setTitle, "A");
    });
    act(() => result.current.undo());
    expect(result.current.canRedo).toBe(true);
    act(() => {
      result.current.dispatch(r.setTitle, "B");
    });
    expect(result.current.canRedo).toBe(false);
    act(() => result.current.redo());
    expect(result.current.lesson?.title).toBe("B");
  });

  test("a 30-step drag inside a transaction is one undo step and one onChange", () => {
    const { result, onChange } = setup();
    const before = result.current.lesson;
    const sid = slideId(before);
    const eid = elementId(before);
    act(() => {
      result.current.beginTransaction();
      for (let i = 1; i <= 30; i += 1) {
        result.current.dispatch(r.transformElements, sid, [eid], { dx: 1 });
      }
    });
    expect(result.current.isTransactionInFlight()).toBe(true);
    expect(firstX(result.current.lesson)).toBe(40);
    expect(result.current.canUndo).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
    act(() => result.current.endTransaction());
    expect(result.current.isTransactionInFlight()).toBe(false);
    expect(result.current.canUndo).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(1);
    act(() => result.current.undo());
    expect(result.current.lesson).toBe(before);
    expect(result.current.canUndo).toBe(false);
    act(() => result.current.redo());
    expect(firstX(result.current.lesson)).toBe(40);
  });

  test("nested transactions commit once, at the outermost end", () => {
    const { result } = setup();
    const before = result.current.lesson;
    const sid = slideId(before);
    const eid = elementId(before);
    act(() => {
      result.current.beginTransaction();
      result.current.dispatch(r.updateElement, sid, eid, { x: 100 });
      result.current.beginTransaction();
      result.current.dispatch(r.updateElement, sid, eid, { x: 101 });
      result.current.endTransaction();
      result.current.dispatch(r.updateElement, sid, eid, { x: 200 });
    });
    expect(result.current.canUndo).toBe(false);
    act(() => result.current.endTransaction());
    expect(firstX(result.current.lesson)).toBe(200);
    act(() => result.current.undo());
    expect(result.current.lesson).toBe(before);
    expect(result.current.canUndo).toBe(false);
  });

  test("an empty transaction records nothing; a stray end is ignored", () => {
    const { result, onChange } = setup();
    act(() => {
      result.current.beginTransaction();
      result.current.endTransaction();
      result.current.endTransaction();
    });
    expect(result.current.canUndo).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
  });

  test("undo and redo are ignored while a transaction is open", () => {
    const { result } = setup();
    act(() => {
      result.current.dispatch(r.setTitle, "A");
      result.current.beginTransaction();
      result.current.undo();
    });
    expect(result.current.lesson?.title).toBe("A");
    act(() => result.current.endTransaction());
    act(() => result.current.undo());
    expect(result.current.lesson?.title).toBe("Seed");
  });

  test("silent reducers change the cache and notify, without an undo step", () => {
    const { result, onChange } = setup();
    act(() => {
      result.current.dispatch(r.setFitVersion, 42);
    });
    expect(result.current.lesson?.fitVersion).toBe(42);
    expect(result.current.canUndo).toBe(false);
    expect(onChange).toHaveBeenCalledTimes(1);
    // the next real edit's undo returns to the state *with* the silent write applied
    act(() => {
      result.current.dispatch(r.setTitle, "A");
    });
    act(() => result.current.undo());
    expect(result.current.lesson?.fitVersion).toBe(42);
    expect(result.current.lesson?.title).toBe("Seed");
  });

  test("history is capped at HISTORY_LIMIT entries", () => {
    const { result } = setup();
    act(() => {
      for (let i = 0; i < HISTORY_LIMIT + 50; i += 1) {
        result.current.dispatch(r.setTitle, `T${i}`);
      }
    });
    let steps = 0;
    while (result.current.canUndo && steps < HISTORY_LIMIT + 100) {
      act(() => result.current.undo());
      steps += 1;
    }
    expect(steps).toBe(HISTORY_LIMIT);
    expect(result.current.lesson?.title).toBe("T49");
  });

  test("the returned callbacks keep their identity across renders", () => {
    const { result, rerender } = setup();
    const first = result.current;
    rerender();
    expect(result.current.dispatch).toBe(first.dispatch);
    expect(result.current.undo).toBe(first.undo);
    expect(result.current.beginTransaction).toBe(first.beginTransaction);
  });
});
