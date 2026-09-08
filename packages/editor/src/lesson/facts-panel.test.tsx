import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { Proposal } from "@tj/domain";
import type { Lesson, TextElement } from "@tj/domain/documents";
import { generatedLesson } from "@tj/domain/documents/fixtures";
import { createRef } from "react";
import type { LessonEditorHandle } from "./LessonEditor";
import { catcher, pointer, renderEditor } from "./test-harness";

/*
 * TEACH-134 on the real shell: the facts panel (typing is one undo step, commits coalesce into
 * one `onFactsChanged`), the editor handle applying proposals as one undo step — leaving an open
 * text edit or typing session first — and the regenerate entry points and dialog.
 */

afterEach(cleanup);

const GENERATED_FROM = {
  factRefs: ["o1"],
  promptVersion: "cascade.v1",
  model: "m",
  at: "2026-09-08T00:00:00.000Z",
};

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const panel = () => screen.getByRole("complementary", { name: "Facts" });
const openPanel = () => fireEvent.click(screen.getByRole("button", { name: "Facts" }));

/** Element proposals for the objectives slide (2) and the multiple-choice slide (4). */
function twoProposals(lesson: Lesson): Proposal[] {
  const [, objectives, , mc] = lesson.slides;
  const ob = objectives?.elements[1];
  const q = mc?.elements[0];
  if (!objectives || !mc || !ob || !q) throw new Error("fixture");
  return [
    {
      target: { slideId: objectives.id, elementId: ob.id },
      element: { ...ob, id: "ob-1-new" },
      generatedFrom: GENERATED_FROM,
    },
    {
      target: { slideId: mc.id, elementId: q.id },
      element: { ...q, id: "q-new" },
      generatedFrom: GENERATED_FROM,
    },
  ];
}

describe("facts panel", () => {
  test("no Facts button without the app's wiring; with it, the panel toggles", () => {
    const { unmount } = renderEditor(generatedLesson());
    expect(screen.queryByRole("button", { name: "Facts" })).toBeNull();
    unmount();
    renderEditor(generatedLesson(), { onFactsChanged: () => {} });
    openPanel();
    expect(panel()).toBeVisible();
    expect(within(panel()).getByRole("textbox", { name: "Objective 1" })).toHaveValue(
      "Describe the stages of the water cycle",
    );
    fireEvent.click(within(panel()).getByRole("button", { name: "Close facts" }));
    expect(screen.queryByRole("complementary", { name: "Facts" })).toBeNull();
  });

  test("row 5: typing then Enter reports the fact once after the window; a second edit inside it joins the same call", async () => {
    const onFactsChanged = mock((_ids: string[]) => {});
    const { read } = renderEditor(generatedLesson(), { onFactsChanged });
    openPanel();
    const first = within(panel()).getByRole("textbox", { name: "Objective 1" });
    fireEvent.focus(first);
    fireEvent.change(first, { target: { value: "Describe the water" } });
    fireEvent.change(first, { target: { value: "Describe the water cycle" } });
    fireEvent.keyDown(first, { key: "Enter" });
    fireEvent.blur(first);
    expect(read().facts?.objectives[0]?.text).toBe("Describe the water cycle");
    expect(onFactsChanged).not.toHaveBeenCalled();
    // A typing burst is one undo step.
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(read().facts?.objectives[0]?.text).toBe("Describe the stages of the water cycle");
    fireEvent.click(screen.getByRole("button", { name: "Redo" }));

    const second = within(panel()).getByRole("textbox", { name: "Term 2" });
    fireEvent.focus(second);
    fireEvent.change(second, { target: { value: "Condensing" } });
    fireEvent.blur(second);
    await waitFor(() => expect(onFactsChanged).toHaveBeenCalledTimes(1), { timeout: 3_000 });
    expect(onFactsChanged.mock.calls[0]?.[0]).toEqual(["o1", "v2"]);
    // A commit that changed nothing reports nothing.
    fireEvent.focus(first);
    fireEvent.blur(first);
    await wait(1_200);
    expect(onFactsChanged).toHaveBeenCalledTimes(1);
  });

  test("add and remove report the new / removed id; a removed fact leaves outline refs", async () => {
    const onFactsChanged = mock((_ids: string[]) => {});
    const { read } = renderEditor(generatedLesson(), { onFactsChanged });
    openPanel();
    fireEvent.click(within(panel()).getByRole("button", { name: "Add objective" }));
    expect(read().facts?.objectives.at(-1)?.id).toBe("o3");
    fireEvent.click(within(panel()).getByRole("button", { name: "Remove term 2" }));
    expect(read().facts?.vocabulary.map((v) => v.id)).toEqual(["v1"]);
    await waitFor(() => expect(onFactsChanged).toHaveBeenCalledTimes(1), { timeout: 3_000 });
    expect(onFactsChanged.mock.calls[0]?.[0]).toEqual(["o3", "v2"]);
  });

  test("busy: the panel shows Updating slides… and the busy slides a changing… overlay", () => {
    const lesson = generatedLesson();
    renderEditor(lesson, {
      onFactsChanged: () => {},
      proposalsBusy: true,
      busySlideIds: new Set([lesson.slides[3]?.id ?? ""]),
    });
    openPanel();
    expect(within(panel()).getByText("Updating slides…")).toBeVisible();
    const rows = within(screen.getByRole("listbox", { name: "Slides" })).getAllByRole("option");
    expect(rows[3]?.querySelector("[data-slide-busy]")).not.toBeNull();
    expect(rows[2]?.querySelector("[data-slide-busy]")).toBeNull();
  });
});

describe("LessonEditorHandle.applyProposals", () => {
  test("applies proposals as one undo step and returns the touched slides in order", () => {
    const ref = createRef<LessonEditorHandle>();
    const lesson = generatedLesson();
    const { read } = renderEditor(lesson, { onFactsChanged: () => {}, editorRef: ref });
    const before = read();
    let touched: string[] = [];
    act(() => {
      touched = ref.current?.applyProposals(twoProposals(lesson)) ?? [];
    });
    expect(touched).toEqual(["s-objectives", "s-mc"]);
    expect(read().slides[1]?.elements[1]?.id).toBe("ob-1-new");
    expect(read().slides[3]?.elements[0]?.id).toBe("q-new");
    act(() => ref.current?.undo());
    expect(read()).toEqual(before);
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Redo" })).toBeEnabled();
  });

  test("trap: an open typing session in the facts panel is committed first, so Undo reverts the cascade only", () => {
    const ref = createRef<LessonEditorHandle>();
    const lesson = generatedLesson();
    const { read } = renderEditor(lesson, { onFactsChanged: () => {}, editorRef: ref });
    openPanel();
    const field = within(panel()).getByRole("textbox", { name: "Objective 1" });
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: "Typed while the cascade lands" } });
    // No blur: the edit session's transaction is still open when the job completes.
    act(() => {
      ref.current?.applyProposals(twoProposals(lesson));
    });
    expect(read().slides[3]?.elements[0]?.id).toBe("q-new");
    act(() => ref.current?.undo());
    expect(read().slides[3]?.elements[0]?.id).toBe("q");
    expect(read().facts?.objectives[0]?.text).toBe("Typed while the cascade lands");
  });

  test("trap: an open text edit on the canvas is left before the element under it is replaced", async () => {
    const ref = createRef<LessonEditorHandle>();
    const lesson = generatedLesson();
    // Put a plain text box at a known spot on slide 1 so the double-click lands on it.
    const title = lesson.slides[0];
    if (!title) throw new Error("fixture");
    const box: TextElement = {
      ...(title.elements[0] as TextElement),
      id: "t1",
      x: 100,
      y: 100,
      w: 400,
      h: 100,
    };
    title.elements = [box];
    const { container, read } = renderEditor(lesson, { onFactsChanged: () => {}, editorRef: ref });
    fireEvent.pointerDown(catcher(container), pointer(150, 150));
    fireEvent.pointerUp(window, pointer(150, 150));
    fireEvent.doubleClick(catcher(container), { clientX: 150, clientY: 150 });
    await waitFor(() => expect(container.querySelector(".ProseMirror")).not.toBeNull());

    act(() => {
      ref.current?.applyProposals([
        {
          target: { slideId: title.id, elementId: "t1" },
          element: { ...box, id: "t1-new" },
          generatedFrom: GENERATED_FROM,
        },
      ]);
    });
    await waitFor(() => expect(container.querySelector(".ProseMirror")).toBeNull());
    expect(read().slides[0]?.elements[0]?.id).toBe("t1-new");
  });
});

describe("regenerate", () => {
  test("the slide toolbar opens the dialog with the impact preview; confirm calls onRegenerate once", async () => {
    const onRegenerate = mock((_t: unknown, _i: string | undefined) => {});
    renderEditor(generatedLesson(), { onRegenerate });
    // Slide 1 is active; go to slide 2 (objectives, shares o1 with slide 4).
    const rows = within(screen.getByRole("listbox", { name: "Slides" })).getAllByRole("option");
    const second = rows[1];
    if (!second) throw new Error("row");
    fireEvent.pointerDown(second, pointer(20, 20));
    fireEvent.pointerUp(second, pointer(20, 20));
    fireEvent.click(
      within(screen.getByRole("toolbar", { name: "Slide" })).getByRole("button", {
        name: "Regenerate slide",
      }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Regenerate slide 2" });
    expect(dialog).toHaveTextContent("Also changes: slide 4");
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Instruction (optional)" }), {
      target: { value: "Shorter" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Regenerate" }));
    expect(onRegenerate).toHaveBeenCalledTimes(1);
    expect(onRegenerate.mock.calls[0]).toEqual([{ slideId: "s-objectives" }, "Shorter"]);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  test("a teacher-authored target asks first", async () => {
    const lesson = generatedLesson();
    const el = lesson.slides[1]?.elements[1];
    if (!el) throw new Error("fixture");
    el.authoredBy = "teacher";
    const onRegenerate = mock((_t: unknown, _i: string | undefined) => {});
    renderEditor(lesson, { onRegenerate });
    const rows = within(screen.getByRole("listbox", { name: "Slides" })).getAllByRole("option");
    const second = rows[1];
    if (!second) throw new Error("row");
    fireEvent.pointerDown(second, pointer(20, 20));
    fireEvent.pointerUp(second, pointer(20, 20));
    fireEvent.click(screen.getByRole("button", { name: "Regenerate slide" }));
    const ask = await screen.findByRole("dialog", { name: "Replace your edits?" });
    fireEvent.click(within(ask).getByRole("button", { name: "Yes, replace them" }));
    expect(await screen.findByRole("dialog", { name: "Regenerate slide 2" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));
    expect(onRegenerate.mock.calls[0]).toEqual([{ slideId: "s-objectives" }, undefined]);
  });

  test("the navigator's slide menu offers Regenerate slide…", async () => {
    const onRegenerate = mock(() => {});
    renderEditor(generatedLesson(), { onRegenerate });
    const rows = within(screen.getByRole("listbox", { name: "Slides" })).getAllByRole("option");
    const third = rows[2];
    if (!third) throw new Error("row");
    fireEvent.contextMenu(third, { clientX: 40, clientY: 40 });
    const item = await screen.findByRole("menuitem", { name: "Regenerate slide…" });
    fireEvent.click(item);
    expect(await screen.findByRole("dialog", { name: "Regenerate slide 3" })).toBeVisible();
  });
});
