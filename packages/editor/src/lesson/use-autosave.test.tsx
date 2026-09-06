import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, renderHook, screen, waitFor } from "@testing-library/react";
import type { Lesson } from "@tj/domain/documents";
import { newLesson } from "../model/factories";
import { renderEditor } from "./test-harness";
import { AUTOSAVE_MS, SAVE_FAILED_MESSAGE, useAutosave, useSaveState } from "./use-autosave";

/*
 * Rows 11–13 of TEACH-103. `bun test` has no fake timers, so the hook takes its debounce as an
 * option: the tests run it at 20 ms and wait on the state machine instead of advancing a clock.
 */

const toastSpy = mock((..._args: unknown[]) => {});
const actualUi = await import("@tj/ui");
mock.module("@tj/ui", () => ({ ...actualUi, toast: toastSpy }));

afterEach(() => {
  cleanup();
  toastSpy.mockReset();
});
afterAll(() => mock.restore());

/** A promise the test resolves or rejects by hand. */
function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useAutosave", () => {
  test("defaults to TeachDeck's 800 ms", () => {
    expect(AUTOSAVE_MS).toBe(800);
  });

  test("row 11: unsaved → saving → saved, one write after the debounce", async () => {
    const gate = deferred();
    const onSave = mock((_l: Lesson) => gate.promise);
    const { result } = renderHook(() => {
      const autosave = useAutosave(onSave, { delay: 20 });
      return { autosave, state: useSaveState(autosave) };
    });
    expect(result.current.state).toBe("saved");

    const lesson = newLesson("Renamed");
    act(() => result.current.autosave.onChange(lesson));
    expect(result.current.state).toBe("unsaved");
    expect(onSave).not.toHaveBeenCalled();

    await waitFor(() => expect(result.current.state).toBe("saving"));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0]?.[0]).toBe(lesson);

    await act(async () => {
      gate.resolve();
      await gate.promise;
    });
    await waitFor(() => expect(result.current.state).toBe("saved"));
  });

  test("a burst of changes is one write of the latest document", async () => {
    const onSave = mock((_l: Lesson) => Promise.resolve());
    const { result } = renderHook(() => useAutosave(onSave, { delay: 20 }));
    const first = newLesson("One");
    const second = newLesson("Two");
    act(() => {
      result.current.onChange(first);
      result.current.onChange(second);
    });
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0]?.[0]).toBe(second);
  });

  test("row 12: a rejected write says Not saved, toasts once, and keeps the unload guard", async () => {
    const onSave = mock((_l: Lesson) => Promise.reject(new Error("quota")));
    const { result } = renderHook(() => {
      const autosave = useAutosave(onSave, { delay: 10 });
      return { autosave, state: useSaveState(autosave) };
    });
    act(() => result.current.autosave.onChange(newLesson("A")));
    await waitFor(() => expect(result.current.state).toBe("failed"));
    expect(toastSpy).toHaveBeenCalledTimes(1);
    expect(toastSpy.mock.calls[0]?.[0]).toBe(SAVE_FAILED_MESSAGE);

    // A second failure is not a second toast.
    act(() => result.current.autosave.onChange(newLesson("B")));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.state).toBe("failed"));
    expect(toastSpy).toHaveBeenCalledTimes(1);

    // Unsaved work: `beforeunload` is answered (preventDefault) so the browser asks.
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
  });

  test("nothing unsaved: beforeunload passes untouched", () => {
    const onSave = mock((_l: Lesson) => Promise.resolve());
    renderHook(() => useAutosave(onSave, { delay: 10 }));
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(false);
  });

  test("row 13: flush writes the pending document immediately", async () => {
    const onSave = mock((_l: Lesson) => Promise.resolve());
    const { result } = renderHook(() => useAutosave(onSave, { delay: 10_000 }));
    const lesson = newLesson("Now");
    act(() => result.current.onChange(lesson));
    await act(() => result.current.flush());
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0]?.[0]).toBe(lesson);
    expect(result.current.getState()).toBe("saved");
    // The timer was cleared: nothing writes twice.
    await new Promise((r) => setTimeout(r, 30));
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});

describe("LessonEditor autosave", () => {
  test("row 11: an inline rename reaches onSave with the new title and the indicator settles on Saved", async () => {
    const { onSave, read } = renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Rename lesson" }));
    const input = screen.getByRole("textbox", { name: "Lesson title" });
    fireEvent.change(input, { target: { value: "The new title" } });
    fireEvent.blur(input);
    expect(read().title).toBe("The new title");
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1), { timeout: 2_000 });
    expect(onSave.mock.calls[0]?.[0]?.title).toBe("The new title");
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());
  });

  test("row 13: Present flushes the pending save before navigating", async () => {
    const gate = deferred();
    const onSave = mock((_l: Lesson) => gate.promise);
    const { onPresent, read } = renderEditor(undefined, { onSave });
    fireEvent.click(screen.getByRole("button", { name: "Rename lesson" }));
    const input = screen.getByRole("textbox", { name: "Lesson title" });
    fireEvent.change(input, { target: { value: "Presented" } });
    fireEvent.blur(input);

    fireEvent.click(screen.getByRole("button", { name: "Present" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0]?.[0]).toBe(read());
    expect(onPresent).not.toHaveBeenCalled();
    await act(async () => {
      gate.resolve();
      await gate.promise;
    });
    await waitFor(() => expect(onPresent).toHaveBeenCalledTimes(1));
  });
});
