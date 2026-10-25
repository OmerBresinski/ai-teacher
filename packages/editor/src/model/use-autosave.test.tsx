import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, renderHook, screen, waitFor } from "@testing-library/react";
import type { Lesson } from "@tj/domain/documents";
import { renderEditor, seededLesson } from "../lesson/test-harness";
import { newLesson } from "../model/factories";
import {
  AUTOSAVE_MS,
  SaveDeferredError,
  SaveHeldError,
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

  test("row 12: a rejected write says Not saved, raises the bar, keeps the unload guard; Retry saves", async () => {
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
    expect(result.current.autosave.getUnreportedFailure()).toBe(true);
    expect(result.current.autosave.getLastSavedAt()).toBeNull();
    // Nothing transient: the bar (SaveFailedBar) is the message, not a toast.
    expect(toastSpy).not.toHaveBeenCalled();
    expect(toastErrorSpy).not.toHaveBeenCalled();

    // Three failures in a row are still one failing state, one bar.
    for (const title of ["B", "C"]) {
      act(() => result.current.autosave.onChange(newLesson(title)));
      await waitFor(() => expect(onSave.mock.calls.at(-1)?.[0]?.title).toBe(title));
      await waitFor(() => expect(result.current.state).toBe("failed"));
    }
    expect(result.current.autosave.getUnreportedFailure()).toBe(true);

    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);

    fail = false;
    await act(() => result.current.autosave.flush());
    await waitFor(() => expect(result.current.state).toBe("saved"));
    expect(onSave.mock.calls.at(-1)?.[0]?.title).toBe("C");
    expect(result.current.autosave.getUnreportedFailure()).toBe(false);
    expect(result.current.autosave.getLastSavedAt()).toEqual(expect.any(Number));
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
    expect(result.current.autosave.getUnreportedFailure()).toBe(false);
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
  });

  test("UX-A: a SaveDeferredError stays Unsaved changes, shows nothing and retries until it lands", async () => {
    let refusals = 2;
    const saved: string[] = [];
    const onSave = mock((l: Lesson) => {
      if (refusals > 0) {
        refusals -= 1;
        return Promise.reject(new SaveDeferredError("the job wrote first"));
      }
      saved.push(l.title);
      return Promise.resolve();
    });
    const states: string[] = [];
    const { result } = renderHook(() => {
      const autosave = useAutosave(onSave, { delay: 10, deferredRetry: 20 });
      const state = useSaveState(autosave);
      states.push(state);
      return { autosave, state };
    });
    act(() => result.current.autosave.onChange(newLesson("Kept")));
    await waitFor(() => expect(result.current.state).toBe("saved"));
    // Two deferred attempts, then the third lands the same change: never "Not saved", no bar.
    expect(onSave).toHaveBeenCalledTimes(3);
    expect(saved).toEqual(["Kept"]);
    expect(states).not.toContain("failed");
    expect(result.current.autosave.getUnreportedFailure()).toBe(false);
    expect(toastSpy).not.toHaveBeenCalled();
    expect(toastErrorSpy).not.toHaveBeenCalled();
  });

  // P0 25 Oct 2026: each row the job wrote flipped the header to "Unsaved changes" and back.
  test("a quiet copy is written but never shows Unsaved changes, even when it has to wait", async () => {
    let refusals = 2;
    const saved: string[] = [];
    const onSave = mock((l: Lesson) => {
      if (refusals > 0) {
        refusals -= 1;
        return Promise.reject(new SaveDeferredError("all slides still writing"));
      }
      saved.push(l.title);
      return Promise.resolve();
    });
    const states: string[] = [];
    const { result } = renderHook(() => {
      const autosave = useAutosave(onSave, { delay: 10, deferredRetry: 20 });
      states.push(useSaveState(autosave));
      return autosave;
    });
    act(() => result.current.onChange(newLesson("Stamp"), { quiet: true }));
    await waitFor(() => expect(saved).toEqual(["Stamp"]));
    expect(states.every((s) => s === "saved")).toBe(true);
    // A teacher change is never quiet, even when offered as one behind it.
    act(() => result.current.onChange(newLesson("Typed")));
    act(() => result.current.onChange(newLesson("Typed + stamp"), { quiet: true }));
    expect(states.at(-1)).toBe("unsaved");
    await waitFor(() => expect(saved.at(-1)).toBe("Typed + stamp"));
  });

  // PR 623 review: a job row arriving while the previous quiet copy was still being written made
  // the header say "Unsaved changes" and left it there (and the unload warning on).
  test("a quiet copy offered while a quiet write is in flight: Saved throughout, Saved after", async () => {
    const gates: ReturnType<typeof deferred<void>>[] = [];
    const saved: string[] = [];
    const onSave = mock((l: Lesson) => {
      const gate = deferred();
      gates.push(gate);
      return gate.promise.then(() => {
        saved.push(l.title);
      });
    });
    const states: string[] = [];
    const { result } = renderHook(() => {
      const autosave = useAutosave(onSave, { delay: 10 });
      states.push(useSaveState(autosave));
      return autosave;
    });
    act(() => result.current.onChange(newLesson("Row 1"), { teacher: false, quiet: true }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    act(() => result.current.onChange(newLesson("Row 2"), { teacher: false, quiet: true }));
    await act(async () => {
      gates[0]?.resolve();
      await gates[0]?.promise;
    });
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    await act(async () => {
      gates[1]?.resolve();
      await gates[1]?.promise;
    });
    await waitFor(() => expect(saved).toEqual(["Row 1", "Row 2"]));
    expect(states.every((s) => s === "saved")).toBe(true);
    expect(result.current.getState()).toBe("saved");
    expect(result.current.getHeld()).toBe(false);
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(false);
  });

  test("a teacher's change during a quiet write shows Unsaved and Saving, then Saved", async () => {
    const gates: ReturnType<typeof deferred<void>>[] = [];
    const saved: string[] = [];
    const onSave = mock((l: Lesson) => {
      const gate = deferred();
      gates.push(gate);
      return gate.promise.then(() => {
        saved.push(l.title);
      });
    });
    const states: string[] = [];
    const { result } = renderHook(() => {
      const autosave = useAutosave(onSave, { delay: 10 });
      states.push(useSaveState(autosave));
      return autosave;
    });
    act(() => result.current.onChange(newLesson("Row 1"), { teacher: false, quiet: true }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(states.every((s) => s === "saved")).toBe(true);
    act(() => result.current.onChange(newLesson("Typed")));
    expect(result.current.getState()).toBe("unsaved");
    await act(async () => {
      gates[0]?.resolve();
      await gates[0]?.promise;
    });
    expect(result.current.getState()).not.toBe("saved");
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    expect(result.current.getState()).toBe("saving");
    await act(async () => {
      gates[1]?.resolve();
      await gates[1]?.promise;
    });
    await waitFor(() => expect(result.current.getState()).toBe("saved"));
    expect(saved).toEqual(["Row 1", "Typed"]);
    expect(states).toContain("unsaved");
    expect(states).toContain("saving");
    expect(states.at(-1)).toBe("saved");
  });

  // P0 25 Oct 2026: a filling editor that unmounted kept retrying its last copy for minutes, and
  // once the job's grace ran out the retry went out raw and overwrote the job's slides.
  test("an unmounted editor writes its copy once on unmount and never retries it", async () => {
    const onSave = mock((_l: Lesson) =>
      Promise.reject(new SaveDeferredError("the job wrote first")),
    );
    const { result, unmount } = renderHook(() =>
      useAutosave(onSave, { delay: 10_000, deferredRetry: 5 }),
    );
    act(() => result.current.onChange(newLesson("Early copy")));
    unmount();
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 60));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  // PR 622 review: a gone editor never retries, so a teacher's change it could not write is
  // handed to the app (`onAbandon`) with the server copy it was made on, never silently dropped.
  test("an edit, then unmount while a job holds the row: the change is handed on once, unretried", async () => {
    const onSave = mock((_l: Lesson) =>
      Promise.reject(new SaveDeferredError("the job holds the row")),
    );
    const onAbandon = mock((_l: Lesson, _base: Lesson | null) => {});
    const server = newLesson("On the server");
    const { result, unmount } = renderHook(() =>
      useAutosave(onSave, { delay: 10_000, deferredRetry: 5, onAbandon }),
    );
    act(() => result.current.noteServerCopy(server));
    act(() => result.current.onChange(newLesson("Teacher's title")));
    unmount();
    await waitFor(() => expect(onAbandon).toHaveBeenCalledTimes(1));
    expect(onAbandon.mock.calls[0]?.[0].title).toBe("Teacher's title");
    expect(onAbandon.mock.calls[0]?.[1]).toBe(server);
    await new Promise((r) => setTimeout(r, 60));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onAbandon).toHaveBeenCalledTimes(1);
  });

  test("unmount with nothing of the teacher's waiting: nothing is sent and nothing is kept", async () => {
    const onSave = mock((_l: Lesson) => Promise.resolve());
    const onAbandon = mock((_l: Lesson, _base: Lesson | null) => {});
    const { result, unmount } = renderHook(() =>
      useAutosave(onSave, { delay: 10_000, deferredRetry: 5, onAbandon }),
    );
    // The fit stamp, or a job's write folded in: not the teacher's.
    act(() => result.current.onChange(newLesson("Folded copy"), { teacher: false }));
    unmount();
    await new Promise((r) => setTimeout(r, 60));
    expect(onSave).not.toHaveBeenCalled();
    expect(onAbandon).not.toHaveBeenCalled();
  });

  test("a saved edit, then only a folded copy: unmount sends and keeps nothing", async () => {
    const onSave = mock((_l: Lesson) => Promise.resolve());
    const onAbandon = mock((_l: Lesson, _base: Lesson | null) => {});
    const { result, unmount } = renderHook(() =>
      useAutosave(onSave, { delay: 10_000, deferredRetry: 5, onAbandon }),
    );
    act(() => result.current.onChange(newLesson("Teacher's title")));
    await act(() => result.current.flush());
    expect(onSave).toHaveBeenCalledTimes(1);
    act(() => result.current.onChange(newLesson("Folded copy"), { teacher: false }));
    unmount();
    await new Promise((r) => setTimeout(r, 60));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onAbandon).not.toHaveBeenCalled();
  });

  test("a network failure after unmount: the teacher's change is handed on, not lost", async () => {
    const onSave = mock((_l: Lesson) => Promise.reject(new TypeError("Failed to fetch")));
    const onAbandon = mock((_l: Lesson, _base: Lesson | null) => {});
    const { result, unmount } = renderHook(() =>
      useAutosave(onSave, { delay: 10_000, deferredRetry: 5, onAbandon }),
    );
    act(() => result.current.onChange(newLesson("Typed offline")));
    unmount();
    await waitFor(() => expect(onAbandon).toHaveBeenCalledTimes(1));
    expect(onAbandon.mock.calls[0]?.[0].title).toBe("Typed offline");
    await new Promise((r) => setTimeout(r, 60));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  test("UX-A: while a write is deferred the unload warning stands, and a newer edit replaces it", async () => {
    let refuse = true;
    const saved: string[] = [];
    const onSave = mock((l: Lesson) => {
      if (refuse) return Promise.reject(new SaveDeferredError("the job wrote first"));
      saved.push(l.title);
      return Promise.resolve();
    });
    const { result } = renderHook(() => {
      const autosave = useAutosave(onSave, { delay: 10, deferredRetry: 10_000 });
      return { autosave, state: useSaveState(autosave) };
    });
    act(() => result.current.autosave.onChange(newLesson("Old")));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(result.current.state).toBe("unsaved");
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    refuse = false;
    act(() => result.current.autosave.onChange(newLesson("New")));
    await waitFor(() => expect(result.current.state).toBe("saved"));
    expect(saved).toEqual(["New"]);
  });

  test("UX-A: a held non-teacher change reads Saved, retries quietly and is written once the job ends", async () => {
    let jobRunning = true;
    const written: string[] = [];
    const onSave = mock((l: Lesson) => {
      if (jobRunning) return Promise.reject(new SaveHeldError("fit stamp waits"));
      written.push(l.title);
      return Promise.resolve();
    });
    const states: string[] = [];
    const { result } = renderHook(() => {
      const autosave = useAutosave(onSave, { delay: 10, deferredRetry: 15 });
      const state = useSaveState(autosave);
      states.push(state);
      return { autosave, state };
    });
    act(() => result.current.autosave.onChange(newLesson("Stamped")));
    await waitFor(() => expect(result.current.autosave.getHeld()).toBe(true));
    expect(result.current.state).toBe("saved");
    // Quiet retries while the job runs: never "Saving…", never "Not saved".
    await waitFor(() => expect(onSave.mock.calls.length).toBeGreaterThanOrEqual(3));
    const afterHold = states.slice(states.indexOf("saved", 1));
    expect(afterHold).not.toContain("saving");
    expect(afterHold).not.toContain("unsaved");
    expect(states).not.toContain("failed");
    // No warning on leaving: nothing of the teacher's is waiting.
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(false);
    // The job ends, with no teacher edit: the stamp is written on its own.
    jobRunning = false;
    await waitFor(() => expect(written).toEqual(["Stamped"]));
    expect(result.current.autosave.getHeld()).toBe(false);
    expect(result.current.state).toBe("saved");
  });

  test("UX-A: a held write that then fails shows as a failure; a teacher edit beside it is Unsaved changes", async () => {
    let mode: "held" | "fail" = "held";
    const onSave = mock((_l: Lesson) =>
      Promise.reject(mode === "held" ? new SaveHeldError("fit stamp waits") : new Error("down")),
    );
    const { result } = renderHook(() => {
      const autosave = useAutosave(onSave, { delay: 10, deferredRetry: 15 });
      return { autosave, state: useSaveState(autosave) };
    });
    act(() => result.current.autosave.onChange(newLesson("Stamped")));
    await waitFor(() => expect(result.current.autosave.getHeld()).toBe(true));
    mode = "fail";
    await waitFor(() => expect(result.current.state).toBe("failed"));
    expect(result.current.autosave.getHeld()).toBe(false);

    mode = "held";
    act(() => result.current.autosave.onChange(newLesson("Teacher typed")));
    expect(result.current.state).toBe("unsaved");
    expect(result.current.autosave.getHeld()).toBe(false);
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
