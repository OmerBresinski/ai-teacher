import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, renderHook, screen, waitFor } from "@testing-library/react";
import type { Lesson } from "@tj/domain/documents";
import { renderEditor, seededLesson } from "../lesson/test-harness";
import { newLesson } from "../model/factories";
import {
  AUTOSAVE_MS,
  SAVE_FAILED_MESSAGE,
  SAVE_FAILED_TOAST_ID,
  SAVE_RETRY_LABEL,
  SaveRefusedError,
  useAutosave,
  useSaveState,
  useSettledDocument,
} from "./use-autosave";

/*
 * Rows 11–13 of TEACH-103. `bun test` has no fake timers, so the hook takes its debounce as an
 * option: the tests run it at 20 ms and wait on the state machine instead of advancing a clock.
 */

const toastErrorSpy = mock((..._args: unknown[]) => {});
const toastDismissSpy = mock((..._args: unknown[]) => {});
const toastSpy = Object.assign(
  mock((..._args: unknown[]) => {}),
  { error: toastErrorSpy, dismiss: toastDismissSpy },
);
const actualUi = await import("@tj/ui");
mock.module("@tj/ui", () => ({ ...actualUi, toast: toastSpy }));

afterEach(() => {
  cleanup();
  toastSpy.mockReset();
  toastErrorSpy.mockReset();
  toastDismissSpy.mockReset();
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

  test("the settled document is published when the debounce fires, not per change", async () => {
    const onSave = mock((_l: Lesson) => Promise.resolve());
    const { result } = renderHook(() => {
      const autosave = useAutosave(onSave, { delay: 20 });
      return { autosave, settled: useSettledDocument(autosave) };
    });
    expect(result.current.settled).toBeNull();
    const first = newLesson("One");
    const second = newLesson("Two");
    act(() => result.current.autosave.onChange(first));
    expect(result.current.settled).toBeNull();
    act(() => result.current.autosave.onChange(second));
    await waitFor(() => expect(result.current.settled).toBe(second));
    expect(onSave).toHaveBeenCalledTimes(1);
    // A flush publishes what it writes, too.
    const third = newLesson("Three");
    act(() => result.current.autosave.onChange(third));
    await act(() => result.current.autosave.flush());
    expect(result.current.settled).toBe(third);
  });

  test("row 12: a rejected write says Not saved loudly, every time, with Retry, and keeps the unload guard", async () => {
    let fail = true;
    const onSave = mock((_l: Lesson) =>
      fail ? Promise.reject(new Error("quota")) : Promise.resolve(),
    );
    const { result } = renderHook(() => {
      const autosave = useAutosave(onSave, { delay: 10 });
      return { autosave, state: useSaveState(autosave) };
    });
    act(() => result.current.autosave.onChange(newLesson("A")));
    await waitFor(() => expect(result.current.state).toBe("failed"));
    expect(toastErrorSpy).toHaveBeenCalledTimes(1);
    const [message, options] = toastErrorSpy.mock.calls[0] as [
      string,
      {
        id: string;
        duration: number;
        action: { label: string; onClick: () => void };
      },
    ];
    expect(message).toBe(SAVE_FAILED_MESSAGE);
    // Persistent until a save succeeds, never a few seconds of small print.
    expect(options).toMatchObject({
      id: SAVE_FAILED_TOAST_ID,
      duration: Number.POSITIVE_INFINITY,
      action: { label: SAVE_RETRY_LABEL },
    });

    // A later edit that fails too is said again, in the same toast (same id, so no stack).
    act(() => result.current.autosave.onChange(newLesson("B")));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(toastErrorSpy).toHaveBeenCalledTimes(2));
    expect(toastErrorSpy.mock.calls[1]?.[1]).toMatchObject({ id: SAVE_FAILED_TOAST_ID });

    // Unsaved work: `beforeunload` is answered (preventDefault) so the browser asks.
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);

    // Retry writes what is pending; a good save clears the toast and says Saved.
    fail = false;
    await act(async () => options.action.onClick());
    await waitFor(() => expect(result.current.state).toBe("saved"));
    // (The unload above also tried a write; Retry is the last one, and it wrote "B".)
    expect(onSave.mock.calls.at(-1)?.[0]?.title).toBe("B");
    expect(toastDismissSpy).toHaveBeenCalledWith(SAVE_FAILED_TOAST_ID);
  });

  test("three failures in a row are one toast, updated in place, never a second one", async () => {
    const onSave = mock((_l: Lesson) => Promise.reject(new Error("offline")));
    const { result } = renderHook(() => {
      const autosave = useAutosave(onSave, { delay: 10 });
      return { autosave, state: useSaveState(autosave) };
    });
    for (const [i, title] of ["A", "B", "C"].entries()) {
      act(() => result.current.autosave.onChange(newLesson(title)));
      await waitFor(() => expect(toastErrorSpy).toHaveBeenCalledTimes(i + 1));
    }
    // Sonner replaces a toast that shares an id, so one id across every call is one toast on screen.
    const ids = new Set(toastErrorSpy.mock.calls.map((c) => (c[1] as { id: string }).id));
    expect([...ids]).toEqual([SAVE_FAILED_TOAST_ID]);
    expect(toastSpy).not.toHaveBeenCalled();
    expect(toastDismissSpy).not.toHaveBeenCalled();
  });

  test("a SaveRefusedError says Not saved without the generic toast", async () => {
    const onSave = mock((_l: Lesson) => Promise.reject(new SaveRefusedError("stale")));
    const { result } = renderHook(() => {
      const autosave = useAutosave(onSave, { delay: 10 });
      return { autosave, state: useSaveState(autosave) };
    });
    act(() => result.current.autosave.onChange(newLesson("A")));
    await waitFor(() => expect(result.current.state).toBe("failed"));
    expect(toastSpy).not.toHaveBeenCalled();
    expect(toastErrorSpy).not.toHaveBeenCalled();
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

  test("ruling 104: Present asks for fullscreen in the click and opens on the current slide", async () => {
    const lesson = seededLesson();
    const third = lesson.slides[2];
    if (!third) throw new Error("seeded lesson has three slides");
    const root = document.documentElement;
    const original = root.requestFullscreen;
    const requestFullscreen = mock(() => Promise.reject(new Error("refused")));
    root.requestFullscreen = requestFullscreen;
    try {
      const { onPresent } = renderEditor(lesson, { initialSlideId: third.id });
      fireEvent.click(screen.getByRole("button", { name: "Present" }));
      // Synchronously, inside the click: an awaited request would have lost the gesture.
      expect(requestFullscreen).toHaveBeenCalledTimes(1);
      // A refusal is not an error; the teacher still gets present, on slide 3.
      await waitFor(() => expect(onPresent).toHaveBeenCalledWith(3));
    } finally {
      root.requestFullscreen = original;
    }
  });
});
