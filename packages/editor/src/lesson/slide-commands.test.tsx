import { describe, expect, mock, test } from "bun:test";
import { notifyManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { Lesson } from "@tj/domain/documents";
import type { ReactNode } from "react";
import { newLesson, newSlide } from "../model/factories";
import { useDocumentHistory } from "../model/use-document-history";
import {
  addSlideAfter,
  canMoveSlide,
  deleteSlide,
  duplicateSlide,
  insertSlideAfter,
  moveSlideBy,
  regenerateSlide,
  type SlideCommandDeps,
  slideIndex,
} from "./slide-commands";

/*
 * The slide-level commands behind the action pill, the navigator and the canvas keys (TeachDeck
 * `lib/__tests__/slide-actions.test.ts` "slide commands", TEACH-113 gap analysis). Each is a single
 * reducer dispatch, so one undo step; inserting makes the new slide active; deleting the active
 * slide lands on its neighbour. Driven through the real `useDocumentHistory`, so the undo-stack
 * claims are the hook's, not a fake's. (`changeLayout` is a SlideToolbar concern here —
 * `contextual-toolbar.test.tsx` "layout menu lists every kind".)
 */

const KEY = ["library", "documents", "L1"] as const;
notifyManager.setScheduler((callback) => callback());

function seeded(): Lesson {
  const lesson = newLesson("Test", "chalk");
  lesson.slides.push(newSlide("content", lesson.themeId), newSlide("starter", lesson.themeId));
  return lesson;
}

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const seed = seeded();
  client.setQueryData(KEY, seed);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(
    () => useDocumentHistory({ queryKey: KEY, queryFn: () => Promise.resolve(seed) }),
    { wrapper },
  );
  const session = { setActiveSlide: mock((_id: string) => {}), openRegenerate: mock(() => {}) };
  const lesson = (): Lesson => {
    const l = hook.result.current.lesson;
    if (!l) throw new Error("no lesson in the cache");
    return l;
  };
  const deps = (): SlideCommandDeps => ({
    history: hook.result.current,
    lesson: lesson(),
    session,
  });
  const kinds = () => lesson().slides.map((s) => s.kind);
  const idAt = (i: number): string => {
    const id = lesson().slides[i]?.id;
    if (!id) throw new Error(`no slide ${i}`);
    return id;
  };
  const undo = () => act(() => hook.result.current.undo());
  const canUndo = () => hook.result.current.canUndo;
  return { deps, kinds, idAt, undo, canUndo, session, lesson };
}

describe("slide commands", () => {
  test("duplicate inserts a copy after the slide, makes it active, one undo step", () => {
    const t = setup();
    const id = t.idAt(1);
    const made: { copy: string | null } = { copy: null };
    act(() => {
      made.copy = duplicateSlide(t.deps(), id);
    });
    expect(t.kinds()).toEqual(["title", "content", "content", "starter"]);
    expect(made.copy).toBe(t.idAt(2));
    expect(made.copy).not.toBe(id);
    expect(t.session.setActiveSlide).toHaveBeenCalledWith(made.copy);
    t.undo();
    expect(t.kinds()).toEqual(["title", "content", "starter"]);
    expect(t.canUndo()).toBe(false);
  });

  test("add slide after inserts the chosen kind and makes it active", () => {
    const t = setup();
    const made: { id: string | null } = { id: null };
    act(() => {
      made.id = addSlideAfter(t.deps(), t.idAt(0), "vocabulary");
    });
    expect(t.kinds()).toEqual(["title", "vocabulary", "content", "starter"]);
    expect(made.id).toBe(t.idAt(1));
    expect(t.session.setActiveSlide).toHaveBeenCalledWith(made.id);
    t.undo();
    expect(t.kinds()).toEqual(["title", "content", "starter"]);
  });

  test("insert slide after places a built slide and makes it active", () => {
    const t = setup();
    const built = newSlide("multiple-choice", "chalk");
    act(() => {
      insertSlideAfter(t.deps(), t.idAt(2), built);
    });
    expect(t.kinds()).toEqual(["title", "content", "starter", "multiple-choice"]);
    expect(t.idAt(3)).toBe(built.id);
    expect(t.session.setActiveSlide).toHaveBeenCalledWith(built.id);
    t.undo();
    expect(t.kinds()).toEqual(["title", "content", "starter"]);
  });

  test("delete removes the slide in one entry, lands the active slide on its neighbour, undo brings it back", () => {
    const t = setup();
    const id = t.idAt(1);
    const next = t.idAt(2);
    act(() => {
      deleteSlide(t.deps(), id, id);
    });
    expect(t.kinds()).toEqual(["title", "starter"]);
    expect(t.session.setActiveSlide).toHaveBeenCalledWith(next);
    t.undo();
    expect(t.kinds()).toEqual(["title", "content", "starter"]);
    expect(t.canUndo()).toBe(false);
  });

  test("deleting the last slide in the deck lands on the new last; deleting a non-active slide moves nothing", () => {
    const t = setup();
    act(() => {
      deleteSlide(t.deps(), t.idAt(2), t.idAt(2));
    });
    expect(t.session.setActiveSlide).toHaveBeenLastCalledWith(t.idAt(1));
    t.session.setActiveSlide.mockClear();
    act(() => {
      deleteSlide(t.deps(), t.idAt(1), t.idAt(0));
    });
    expect(t.kinds()).toEqual(["title"]);
    expect(t.session.setActiveSlide).not.toHaveBeenCalled();
  });

  test("delete refuses the last remaining slide and an unknown id, recording nothing", () => {
    const t = setup();
    act(() => {
      deleteSlide(t.deps(), t.idAt(2), null);
      deleteSlide(t.deps(), t.idAt(1), null);
    });
    expect(t.kinds()).toEqual(["title"]);
    const before = t.lesson();
    act(() => {
      deleteSlide(t.deps(), t.idAt(0), null);
      deleteSlide(t.deps(), "missing", null);
    });
    expect(t.lesson()).toBe(before);
    expect(t.kinds()).toEqual(["title"]);
  });

  test("move up and move down shift the slide by one, one entry each", () => {
    const t = setup();
    const id = t.idAt(1);
    act(() => {
      moveSlideBy(t.deps(), id, -1);
    });
    expect(t.kinds()).toEqual(["content", "title", "starter"]);
    act(() => {
      moveSlideBy(t.deps(), id, 1);
    });
    expect(t.kinds()).toEqual(["title", "content", "starter"]);
    expect(slideIndex(t.lesson(), id)).toBe(1);
    t.undo();
    expect(t.kinds()).toEqual(["content", "title", "starter"]);
    t.undo();
    expect(t.kinds()).toEqual(["title", "content", "starter"]);
    expect(t.canUndo()).toBe(false);
  });

  test("move stops at the ends and records nothing there", () => {
    const t = setup();
    const lesson = t.lesson();
    expect(canMoveSlide(lesson, t.idAt(0), -1)).toBe(false);
    expect(canMoveSlide(lesson, t.idAt(2), 1)).toBe(false);
    expect(canMoveSlide(lesson, t.idAt(1), 1)).toBe(true);
    expect(canMoveSlide(lesson, "missing", 1)).toBe(false);
    act(() => {
      moveSlideBy(t.deps(), t.idAt(0), -1);
      moveSlideBy(t.deps(), t.idAt(2), 1);
    });
    expect(t.lesson()).toBe(lesson);
    expect(t.canUndo()).toBe(false);
  });

  test("regenerate makes the slide active and opens the dialog without a document write", () => {
    const t = setup();
    const lesson = t.lesson();
    regenerateSlide(t.deps(), t.idAt(1));
    expect(t.session.setActiveSlide).toHaveBeenCalledWith(t.idAt(1));
    expect(t.session.openRegenerate).toHaveBeenCalledWith({ slideId: t.idAt(1) });
    expect(t.lesson()).toBe(lesson);
    expect(t.canUndo()).toBe(false);
    t.session.openRegenerate.mockClear();
    regenerateSlide(t.deps(), "missing");
    expect(t.session.openRegenerate).not.toHaveBeenCalled();
  });
});
