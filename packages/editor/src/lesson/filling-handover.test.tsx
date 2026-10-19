import { describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render } from "@testing-library/react";
import type { Id, Lesson, Slide } from "@tj/domain/documents";
import { TooltipProvider } from "@tj/ui";
import { LessonEditor, type LessonEditorProps } from "./LessonEditor";
import { createDraftStore, type DraftStore } from "./live-draft";
import { seededLesson } from "./test-harness";

/*
 * The first-generation hand-over (UX audit 19 Oct, jank 1 and 3-6): while the job writes, the
 * slide sits where it will stay, only the slide being written says "Writing…", a thumbnail shows
 * the draft the canvas shows, the save status and the check count stay out of the way, and at
 * Ready nothing opens by itself.
 */

const KEY = ["lesson", "handover"];
const doc = (text: string) => ({
  type: "doc" as const,
  content: [{ type: "paragraph" as const, content: [{ type: "text" as const, text }] }],
});
const draftOf = (id: string, text: string): Slide => ({
  id,
  kind: "content",
  elements: [
    {
      id: "d-1",
      type: "text",
      x: 64,
      y: 46,
      w: 832,
      h: 120,
      doc: doc(text),
      style: { preset: "body", fontSize: 28 },
    } as Slide["elements"][number],
  ],
});

function setup(lesson: Lesson, extra: Partial<LessonEditorProps> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(KEY, lesson);
  const tree = (writing: ReadonlySet<Id> | undefined, drafts?: DraftStore) => (
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <LessonEditor
          lessonId={lesson.id}
          queryKey={KEY}
          queryFn={() => Promise.resolve(lesson)}
          onSave={() => Promise.resolve()}
          onBack={() => {}}
          onPresent={() => {}}
          writingSlideIds={writing}
          drafts={drafts}
          {...extra}
        />
      </TooltipProvider>
    </QueryClientProvider>
  );
  return { ...render(tree(undefined)), tree };
}

const row = (c: HTMLElement, n: number) =>
  c.querySelectorAll<HTMLElement>("[data-navigator] [role=option]")[n - 1] ?? null;

describe("the filling editor", () => {
  test("only the slide being written says Writing…, and its thumbnail shows the draft", () => {
    const lesson = seededLesson();
    const ids = lesson.slides.map((s) => s.id);
    const drafts = createDraftStore();
    const { container, rerender, tree } = setup(lesson);
    act(() => rerender(tree(new Set(ids), drafts)));
    // No draft yet: every slide the job owns keeps its marker, none says "Writing…".
    expect(container.querySelectorAll("[data-navigator] [data-slide-writing]").length).toBe(3);
    expect(container.querySelectorAll("[data-slide-writing-now]").length).toBe(0);
    expect(container.querySelector("[data-slide-writing-overlay]")?.textContent).toContain(
      "Planning the slides…",
    );

    act(() =>
      drafts.set([
        {
          index: 2,
          slideId: ids[2] as string,
          slide: draftOf(ids[2] as string, "Find a quarter of 24"),
        },
      ]),
    );
    const now = container.querySelectorAll("[data-slide-writing-now]");
    expect(now.length).toBe(1);
    expect(row(container, 3)?.contains(now[0] ?? null)).toBe(true);
    expect(row(container, 3)?.textContent).toContain("Find a quarter of 24");
    // A finished slide the job still holds shows its own words with no veil and no label.
    expect(row(container, 1)?.querySelector("[data-slide-writing-now]")).toBeNull();
    expect(container.querySelectorAll("[data-navigator] [role=status]").length).toBe(0);
  });

  test("the canvas pill names the slide being written when the open slide waits", () => {
    const lesson = seededLesson();
    const ids = lesson.slides.map((s) => s.id);
    const drafts = createDraftStore();
    drafts.set([
      { index: 2, slideId: ids[2] as string, slide: draftOf(ids[2] as string, "Divide by four") },
    ]);
    const { container, rerender, tree } = setup(lesson, { initialSlideId: ids[1] });
    act(() => rerender(tree(new Set(ids), drafts)));
    expect(container.querySelector("[data-slide-writing-overlay]")?.textContent).toContain(
      "Writing slide 3 of 3…",
    );
  });

  test("the companion takes no column, and the save status stays quiet until an edit", () => {
    const lesson = seededLesson();
    const ids = lesson.slides.map((s) => s.id);
    const { container, rerender, tree } = setup(lesson, {
      companion: <div data-test-companion />,
    });
    act(() => rerender(tree(new Set([ids[1] as Id]))));
    const slot = container.querySelector('[data-editor-companion="desktop"]');
    expect(slot).not.toBeNull();
    expect(slot?.tagName).toBe("DIV");
    expect(slot?.closest("aside")).toBeNull();
    expect(slot?.querySelector("[data-test-companion]")).not.toBeNull();
    // The strip under the canvas reserves no room for a pane.
    const strip = container.querySelector("[data-navigator]")?.parentElement as HTMLElement;
    expect(strip.style.paddingRight).toBe("0px");
    expect(container.querySelector("[data-save-state]")?.hasAttribute("data-save-quiet")).toBe(
      true,
    );
    act(() => rerender(tree(undefined)));
    expect(container.querySelector("[data-save-state]")?.hasAttribute("data-save-quiet")).toBe(
      false,
    );
  });

  test("at the hand-over the watched slide's controls wait for the teacher", () => {
    const lesson = seededLesson();
    const ids = lesson.slides.map((s) => s.id);
    const { container, rerender, tree, getByRole, queryByRole } = setup(lesson, {
      initialSlideId: ids[0],
    });
    act(() => rerender(tree(new Set([ids[0] as Id]))));
    expect(queryByRole("button", { name: /^Delete slide/ })).toBeNull();
    // The job lets go of the open slide: it turns editable, but nothing opens by itself.
    act(() => rerender(tree(undefined)));
    expect(container.querySelector("[data-slide-writing-overlay]")).toBeNull();
    expect(queryByRole("button", { name: /^Delete slide/ })).toBeNull();
    // The teacher's click on the canvas brings them back.
    const canvas = container.querySelector("[data-slide-frame]") as HTMLElement;
    act(() => {
      fireEvent.pointerDown(canvas);
    });
    expect(getByRole("button", { name: /^Delete slide/ })).toBeTruthy();
  });
});
