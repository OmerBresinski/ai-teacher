import { describe, expect, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import type { GroupElement, LayoutRef, Lesson } from "@tj/domain/documents";
import * as kit from "@tj/slides/relayout";
import { produce } from "immer";
import { LazyPart, lazyLoader, RetryLoad } from "../kit/LazyPart";
import { newLesson } from "./factories";
import {
  resetLayoutEditingForTest,
  retryable,
  settleLayoutGroups,
  takePendingSettle,
} from "./layout-editing";
import { syncLayoutGroups } from "./reducers/layout-sync";
import { renderTheme } from "./themes";

function withLayout(): Lesson {
  const lesson = newLesson("Plants");
  const first = lesson.slides[0];
  if (!first) throw new Error("seed");
  const theme = renderTheme(lesson);
  const grid = ["Roots", "Stem", "Leaves"].map((label) => ({ label, text: `The ${label} works.` }));
  const ref: LayoutRef = { template: "cards-grid", input: { heading: "Parts", grid } };
  first.elements = [kit.layoutGroup(ref, theme, kit.stageOf(theme, lesson.ageBand), "g1")];
  return lesson;
}

const group = (l: Lesson) => l.slides[0]?.elements[0] as GroupElement;

describe("layout settle before the layout chunk loads", () => {
  test("an edit made before load is settled once the chunk arrives", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    resetLayoutEditingForTest(() => gate.then(() => ({ syncLayoutGroups })));
    const before = withLayout();
    // Deleting a child detaches the group (layout-sync's rule).
    const after = produce(before, (d) => {
      const g = d.slides[0]?.elements[0] as GroupElement | undefined;
      g?.children.pop();
    });
    expect(settleLayoutGroups(before, after)).toBe(after);
    expect(group(after).layout).toBeDefined();
    expect(takePendingSettle()).toBeUndefined();

    release();
    await gate;
    await Promise.resolve();
    const fix = takePendingSettle();
    expect(fix).toBeDefined();
    const settled = fix?.(after) as Lesson;
    expect(settled).toEqual(syncLayoutGroups(before, after));
    expect(group(settled).layout).toBeUndefined();
    expect(takePendingSettle()).toBeUndefined();
  });

  test("a failed import is forgotten and the next call imports again", async () => {
    let calls = 0;
    const load = retryable(() => {
      calls++;
      return calls === 1 ? Promise.reject(new Error("offline")) : Promise.resolve("ok");
    });
    await expect(load()).rejects.toThrow("offline");
    await expect(load()).resolves.toBe("ok");
    await expect(load()).resolves.toBe("ok");
    expect(calls).toBe(2);
    resetLayoutEditingForTest(() => import("./reducers/layout-sync"));
  });
});

describe("a lazy layout part whose chunk fails", () => {
  test("shows the retry in its place, then the part once a retry loads", async () => {
    let fail = true;
    const loader = lazyLoader<{ label: string }>(() =>
      fail
        ? Promise.reject(new Error("chunk"))
        : Promise.resolve(({ label }: { label: string }) => <span>{label}</span>),
    );
    const warn = console.warn;
    console.warn = () => {};
    try {
      render(
        <LazyPart
          loader={loader}
          props={{ label: "Free layout" }}
          fallback={null}
          failed={(retry) => <RetryLoad onRetry={retry} />}
        />,
      );
      const retry = await screen.findByRole("button", { name: "Couldn't load. Retry" });
      fail = false;
      fireEvent.click(retry);
      expect(await screen.findByText("Free layout")).toBeTruthy();
    } finally {
      console.warn = warn;
    }
  });
});
