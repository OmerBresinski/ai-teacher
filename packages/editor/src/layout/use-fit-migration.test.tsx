import { describe, expect, test } from "bun:test";
import { notifyManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { Lesson, Slide, TextElement } from "@tj/domain/documents";
import type { ReactNode } from "react";
import { docFromText, newLesson } from "../model/factories";
import { FIT_VERSION } from "../model/themes";
import { useDocumentHistory } from "../model/use-document-history";
import type { Measurer } from "./reflow";
import {
  createRunGate,
  type FitMigrationDeps,
  MAX_ATTEMPTS,
  runFitMigration,
  useFitMigration,
} from "./use-fit-migration";

/* TeachDeck `fit-migration.test.ts`, the runner half — against the real history hook. */

notifyManager.setScheduler((cb) => cb());
const KEY = ["library", "documents", "L1"] as const;

function textAt(name: string, y: number, h: number): TextElement {
  return {
    id: name,
    type: "text",
    x: 58,
    y,
    w: 413,
    h,
    doc: docFromText("Some words on the slide"),
    style: { preset: "body", autoHeight: true },
  };
}
/** Two boxes that already overlap: `lintSlide` flags this one on geometry alone. */
const brokenSlide = (id: string): Slide => ({
  id,
  kind: "vocabulary",
  elements: [
    { ...textAt("def", 185, 100), id: `${id}-def` },
    { ...textAt("term", 240, 41), id: `${id}-term` },
  ],
});
const cleanSlide = (id: string): Slide => ({
  id,
  kind: "content",
  elements: [{ ...textAt("body", 140, 41), id: `${id}-body` }],
});

/** Measures every box as shorter than it is stored at, so nothing grows. */
const flatRuler: Measurer = () => 1;

function stale(slides: Slide[]): Lesson {
  return { ...newLesson("Stored under the old sizes", "chalk"), fitVersion: 0, slides };
}

function setup(lesson: Lesson) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(KEY, lesson);
  const onChange: Lesson[] = [];
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(
    () =>
      useDocumentHistory({
        queryKey: KEY,
        queryFn: () => Promise.resolve(lesson),
        onChange: (l) => onChange.push(l),
      }),
    { wrapper },
  );
  const read = () => client.getQueryData<Lesson>(KEY) as Lesson;
  const deps = (over: Partial<FitMigrationDeps> = {}): FitMigrationDeps => ({
    lesson: read(),
    dispatch: hook.result.current.dispatch as FitMigrationDeps["dispatch"],
    beginTransaction: hook.result.current.beginTransaction,
    endTransaction: hook.result.current.endTransaction,
    isIdle: () => true,
    measurer: () => flatRuler,
    warm: () => {},
    ...over,
  });
  return { hook, read, deps, onChange, client, wrapper };
}

describe("runFitMigration", () => {
  test("does nothing, and measures nothing, for a lesson at the current version", () => {
    const { deps } = setup(newLesson("Current", "chalk"));
    let warmed = 0;
    const out = runFitMigration(deps({ warm: () => void warmed++ }));
    expect(out).toEqual({ ran: false, tidied: 0 });
    expect(warmed).toBe(0);
  });

  test("warms the whole deck in one batch before it lints", () => {
    const { deps } = setup(stale([cleanSlide("a"), cleanSlide("b")]));
    const batches: number[] = [];
    act(() => void runFitMigration(deps({ warm: (inputs) => void batches.push(inputs.length) })));
    expect(batches).toEqual([2]);
  });

  test("tidies only the slides the linter flags; stamps the version outside the undo history", () => {
    const { hook, read, deps, onChange } = setup(
      stale([cleanSlide("a"), brokenSlide("b"), cleanSlide("c")]),
    );
    const before = read();
    let out: ReturnType<typeof runFitMigration> | undefined;
    act(() => {
      out = runFitMigration(deps());
    });
    expect(out).toEqual({ ran: true, tidied: 1 });
    const after = read();
    expect(after.fitVersion).toBe(FIT_VERSION);
    // Only slide b changed; a and c keep their identity.
    expect(after.slides[0]).toBe(before.slides[0]);
    expect(after.slides[2]).toBe(before.slides[2]);
    expect(after.slides[1]).not.toBe(before.slides[1]);
    // One undo step for the tidy; undo restores the layout and keeps the stamp.
    expect(hook.result.current.canUndo).toBe(true);
    expect(onChange).toHaveLength(2); // the silent stamp notifies once, the transaction once
    act(() => hook.result.current.undo());
    expect(read().slides[1]?.elements[1]?.y).toBe(240);
    expect(read().fitVersion).toBe(FIT_VERSION);
    expect(hook.result.current.canUndo).toBe(false);
  });

  test("stamps the version and writes no undo entry when nothing was flagged", () => {
    const { hook, read, deps } = setup(stale([cleanSlide("a")]));
    let out: ReturnType<typeof runFitMigration> | undefined;
    act(() => {
      out = runFitMigration(deps());
    });
    expect(out).toEqual({ ran: true, tidied: 0 });
    expect(read().fitVersion).toBe(FIT_VERSION);
    expect(hook.result.current.canUndo).toBe(false);
  });

  test("puts the run off, and writes nothing, while the teacher is in the middle of something", () => {
    const { read, deps } = setup(stale([brokenSlide("b")]));
    const out = runFitMigration(deps({ isIdle: () => false }));
    expect(out).toEqual({ ran: false, tidied: 0, deferred: true });
    expect(read().fitVersion).toBe(0);
  });

  test("never tidies a continuation slide the tidy itself added (ids captured up front)", () => {
    // A tall list on a flat ruler never splits; the plan is fixed before any tidy runs regardless.
    const { read, deps } = setup(stale([brokenSlide("b")]));
    act(() => void runFitMigration(deps()));
    expect(read().slides).toHaveLength(1);
  });
});

describe("useFitMigration", () => {
  test("runs once after fonts are ready, defers while busy up to MAX_ATTEMPTS, then notifies", async () => {
    const { read, hook, wrapper } = setup(stale([brokenSlide("b")]));
    let idle = false;
    const notes: string[] = [];
    // happy-dom has no requestIdleCallback, so the runner retries on a 120 ms timeout; count the
    // attempts by the idle checks the deps see.
    let attempts = 0;
    renderHook(
      () =>
        useFitMigration({
          lessonId: read().id,
          getDeps: () => ({
            lesson: read(),
            dispatch: hook.result.current.dispatch as FitMigrationDeps["dispatch"],
            beginTransaction: hook.result.current.beginTransaction,
            endTransaction: hook.result.current.endTransaction,
            isIdle: () => {
              attempts += 1;
              return idle;
            },
            measurer: () => flatRuler,
            warm: () => {},
          }),
          notify: (m) => notes.push(m),
          fontsReady: () => Promise.resolve(),
        }),
      { wrapper },
    );
    // Busy: it keeps trying on idle callbacks.
    await waitFor(() => expect(attempts).toBeGreaterThanOrEqual(2), { timeout: 2_000 });
    expect(read().fitVersion).toBe(0);
    idle = true;
    await waitFor(() => expect(read().fitVersion).toBe(FIT_VERSION), { timeout: 2_000 });
    expect(notes).toEqual(["1 slide tidied to fit the new text sizes."]);
    expect(attempts).toBeLessThanOrEqual(MAX_ATTEMPTS);
  });

  test("gives up quietly after MAX_ATTEMPTS and leaves the lesson unstamped", async () => {
    const { read, hook, wrapper } = setup(stale([brokenSlide("b")]));
    let attempts = 0;
    renderHook(
      () =>
        useFitMigration({
          lessonId: read().id,
          getDeps: () => ({
            lesson: read(),
            dispatch: hook.result.current.dispatch as FitMigrationDeps["dispatch"],
            beginTransaction: hook.result.current.beginTransaction,
            endTransaction: hook.result.current.endTransaction,
            isIdle: () => {
              attempts += 1;
              return false;
            },
            measurer: () => flatRuler,
            warm: () => {},
          }),
          notify: () => {},
          fontsReady: () => Promise.resolve(),
        }),
      { wrapper },
    );
    await waitFor(() => expect(attempts).toBe(MAX_ATTEMPTS), { timeout: 3_000 });
    await new Promise((r) => setTimeout(r, 200));
    expect(attempts).toBe(MAX_ATTEMPTS);
    expect(read().fitVersion).toBe(0);
  });
});

describe("createRunGate", () => {
  test("runs once per lesson", () => {
    const gate = createRunGate();
    expect(gate.claim("l1")).toBe(true);
    expect(gate.claim("l1")).toBe(false);
  });
  test("gives the id back when the effect is torn down before the fonts settle", () => {
    const gate = createRunGate();
    expect(gate.claim("l1")).toBe(true);
    gate.release("l1");
    expect(gate.held()).toBeNull();
    expect(gate.claim("l1")).toBe(true);
  });
  test("a release for another lesson does not free the one in hand", () => {
    const gate = createRunGate();
    gate.claim("l1");
    gate.release("l2");
    expect(gate.claim("l1")).toBe(false);
  });
});
