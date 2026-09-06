import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { RichDoc } from "@tj/domain/documents";
import type { ReactNode } from "react";
import { ActiveEditorProvider, useActiveEditor } from "../../text/active-editor";
import { docToPlainText } from "../../text/static";
import { type EditorHooks, EditorHooksContext } from "../editor-hooks";
import { EMPTY_DOC, useInlineEditor } from "./use-inline-editor";

/*
 * Rows 2, 3 and part of 10 of TEACH-104 at the hook level, on a real Tiptap editor: what a typing
 * burst writes and how the edit session brackets it. `bun test` has no fake timers, so the idle
 * window is waited for in real time (the session's default is 500 ms).
 */

afterEach(cleanup);

const para = (text: string): RichDoc => ({
  type: "doc",
  content: [{ type: "paragraph", content: text ? [{ type: "text", text }] : undefined }],
});

/**
 * A stand-in for the cache: every write lands in `state.doc`, which the hook reads back on the next
 * render exactly as the real `doc` prop would.
 */
function harness(initial: RichDoc | undefined = para("")) {
  const state = { doc: initial };
  const hooks: EditorHooks = {
    writeElementHeight: mock(() => {}),
    writeElementDoc: mock((_s: string, _i: string, d: RichDoc) => {
      state.doc = d;
    }),
    writeExplanation: mock(() => {}),
    beginTransaction: mock(() => 1),
    endTransaction: mock(() => {}),
    exitTextEdit: mock(() => {}),
    exitExplanationEdit: mock(() => {}),
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <EditorHooksContext.Provider value={hooks}>
      <ActiveEditorProvider>{children}</ActiveEditorProvider>
    </EditorHooksContext.Provider>
  );
  return { hooks, wrapper, state };
}

const lastDoc = (hooks: EditorHooks) => {
  const calls = (hooks.writeElementDoc as ReturnType<typeof mock>).mock.calls;
  return calls[calls.length - 1]?.[2] as RichDoc | undefined;
};

describe("useInlineEditor", () => {
  test("creates a Tiptap editor on the element's doc, with the static path's `td-rt` class, and registers it as active", async () => {
    const { hooks, wrapper } = harness();
    const { result } = renderHook(
      () => ({
        editor: useInlineEditor({ slideId: "s1", id: "e1", doc: para("Hello") }),
        active: useActiveEditor(),
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.editor).not.toBeNull());
    const editor = result.current.editor;
    if (!editor) throw new Error("no editor");
    expect(editor.getText()).toBe("Hello");
    // DOM parity with `RichText`: the same class, so the type does not move on entry.
    expect(editor.view.dom.classList.contains("td-rt")).toBe(true);
    await waitFor(() => expect(result.current.active.elementId).toBe("e1"));
    expect(result.current.active.editor).toBe(editor);
    expect(hooks.writeElementDoc).not.toHaveBeenCalled();
  });

  test("row 2: a typing burst is written on every keystroke inside one transaction", async () => {
    const { hooks, wrapper, state } = harness();
    const { result, rerender } = renderHook(
      () => useInlineEditor({ slideId: "s1", id: "e1", doc: state.doc }),
      { wrapper },
    );
    await waitFor(() => expect(result.current).not.toBeNull());
    const editor = result.current;
    if (!editor) throw new Error("no editor");
    act(() => {
      for (const ch of "abc") {
        editor.commands.insertContent(ch);
        rerender();
      }
    });
    expect(hooks.beginTransaction).toHaveBeenCalledTimes(1);
    expect(hooks.writeElementDoc).toHaveBeenCalledTimes(3);
    expect(docToPlainText(lastDoc(hooks) as RichDoc)).toBe("abc");
    expect(hooks.endTransaction).not.toHaveBeenCalled();
    // The session closes after the idle window: one undo step for the whole burst.
    await waitFor(() => expect(hooks.endTransaction).toHaveBeenCalledTimes(1), { timeout: 2_000 });
  });

  test("row 3: a pause longer than the idle window starts a second undo step", async () => {
    const { hooks, wrapper, state } = harness();
    const { result, rerender } = renderHook(
      () => useInlineEditor({ slideId: "s1", id: "e1", doc: state.doc }),
      { wrapper },
    );
    await waitFor(() => expect(result.current).not.toBeNull());
    const editor = result.current;
    if (!editor) throw new Error("no editor");
    act(() => editor.commands.insertContent("one "));
    rerender();
    await waitFor(() => expect(hooks.endTransaction).toHaveBeenCalledTimes(1), { timeout: 2_000 });
    act(() => editor.commands.insertContent("two"));
    rerender();
    expect(hooks.beginTransaction).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(hooks.endTransaction).toHaveBeenCalledTimes(2), { timeout: 2_000 });
    expect(docToPlainText(lastDoc(hooks) as RichDoc)).toBe("one two");
  });

  test("Escape leaves through the shell's exit, which owns the focus return", async () => {
    const { hooks, wrapper } = harness();
    const { result } = renderHook(
      () => useInlineEditor({ slideId: "s1", id: "e1", doc: para("x") }),
      { wrapper },
    );
    await waitFor(() => expect(result.current).not.toBeNull());
    const editor = result.current;
    if (!editor) throw new Error("no editor");
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    act(() => {
      editor.view.dom.dispatchEvent(event);
    });
    expect(hooks.exitTextEdit).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  test("blur closes the open session at once; unmount does too", async () => {
    const { hooks, wrapper, state } = harness();
    const { result, unmount } = renderHook(
      () => useInlineEditor({ slideId: "s1", id: "e1", doc: state.doc }),
      { wrapper },
    );
    await waitFor(() => expect(result.current).not.toBeNull());
    const editor = result.current;
    if (!editor) throw new Error("no editor");
    act(() => editor.commands.insertContent("a"));
    act(() => {
      editor.emit("blur", { editor, event: new FocusEvent("blur"), transaction: editor.state.tr });
    });
    expect(hooks.endTransaction).toHaveBeenCalledTimes(1);
    act(() => editor.commands.insertContent("b"));
    expect(hooks.beginTransaction).toHaveBeenCalledTimes(2);
    unmount();
    expect(hooks.endTransaction).toHaveBeenCalledTimes(2);
  });

  test("undo → redo → type: the editor follows both and the next keystroke builds on the redone doc", async () => {
    const { hooks, wrapper, state } = harness(para("A"));
    const { result, rerender } = renderHook(
      () => useInlineEditor({ slideId: "s1", id: "e1", doc: state.doc }),
      { wrapper },
    );
    await waitFor(() => expect(result.current).not.toBeNull());
    const editor = result.current;
    if (!editor) throw new Error("no editor");
    act(() => editor.commands.insertContent("B"));
    rerender();
    const withB = lastDoc(hooks) as RichDoc;
    expect(editor.getText()).toBe("AB");
    // Undo: the cache goes back to "A".
    state.doc = para("A");
    rerender();
    expect(editor.getText()).toBe("A");
    // Redo: the cache returns to the doc this editor wrote — the editor must follow it, not keep "A".
    state.doc = withB;
    rerender();
    expect(editor.getText()).toBe("AB");
    act(() => editor.commands.insertContent("C"));
    rerender();
    expect(docToPlainText(lastDoc(hooks) as RichDoc)).toBe("ABC");
  });

  test("opens on the words of a stored doc that carries an empty text node", async () => {
    const stored: RichDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "" },
            { type: "text", text: "Kept" },
          ],
        },
      ],
    };
    const { hooks, wrapper, state } = harness(stored);
    const { result } = renderHook(
      () => useInlineEditor({ slideId: "s1", id: "e1", doc: state.doc }),
      { wrapper },
    );
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current?.getText()).toBe("Kept");
    expect(hooks.writeElementDoc).not.toHaveBeenCalled();
  });

  test("adopts a doc changed underneath it (an undo) without echoing its own writes back", async () => {
    const { hooks, wrapper } = harness();
    let doc = para("start");
    const { result, rerender } = renderHook(
      () => useInlineEditor({ slideId: "s1", id: "e1", doc }),
      { wrapper },
    );
    await waitFor(() => expect(result.current).not.toBeNull());
    const editor = result.current;
    if (!editor) throw new Error("no editor");
    act(() => editor.commands.insertContent("!"));
    // Our own write comes back as the prop: no setContent, the caret stays where it was.
    doc = lastDoc(hooks) as RichDoc;
    rerender();
    expect(editor.getText()).toBe("start!");
    expect(hooks.writeElementDoc).toHaveBeenCalledTimes(1);
    // An undo puts the old doc back: the editor follows it, and writes nothing.
    doc = para("start");
    rerender();
    expect(editor.getText()).toBe("start");
    expect(hooks.writeElementDoc).toHaveBeenCalledTimes(1);
  });

  test("seeds an empty paragraph for an element with no doc, as its own single step", async () => {
    const { hooks, wrapper } = harness();
    const { result } = renderHook(
      () => useInlineEditor({ slideId: "s1", id: "shape", doc: undefined, seedEmpty: true }),
      { wrapper },
    );
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(hooks.writeElementDoc).toHaveBeenCalledWith("s1", "shape", EMPTY_DOC);
    expect(hooks.beginTransaction).toHaveBeenCalledTimes(1);
    expect(hooks.endTransaction).toHaveBeenCalledTimes(1);
  });
});
