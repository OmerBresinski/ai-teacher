import type { Lesson } from "@tj/domain/documents";
import { toast } from "@tj/ui";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";

/**
 * Autosave for the editor (TeachDeck `components/editor/use-autosave.ts`), with the one thing the
 * write itself cannot give the chrome: an outcome. Edits are "Unsaved changes" for the 800 ms
 * before a write is even attempted, "Saving…" while it runs, "Saved" after, and "Not saved" when
 * it rejects — said out loud once, with the unload warning as the net.
 *
 * The write is the `onSave(lesson)` prop (ADR 0022 §5): the mock store today, `PUT /documents/:id`
 * later. Nothing here knows which.
 */

export type SaveState = "saved" | "unsaved" | "saving" | "failed";

/** TeachDeck's `AUTOSAVE_MS`. */
export const AUTOSAVE_MS = 800;

export const SAVE_FAILED_MESSAGE =
  "Could not save this lesson. Export a copy before you close the tab.";

export type Autosave = {
  /** Hand to `useDocumentHistory`'s `onChange`: one call per committed change. */
  onChange: (lesson: Lesson) => void;
  /** Write anything outstanding now — before Present opens, before the route is left. */
  flush: () => Promise<void>;
  subscribe: (listener: () => void) => () => void;
  getState: () => SaveState;
};

export type AutosaveOptions = {
  /** The debounce, `AUTOSAVE_MS` unless a test shortens it. */
  delay?: number;
};

export function useAutosave(
  onSave: (lesson: Lesson) => Promise<void>,
  { delay = AUTOSAVE_MS }: AutosaveOptions = {},
): Autosave {
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  // biome-ignore lint/correctness/useExhaustiveDependencies: the store is built once; `delay` is read at creation
  const store = useMemo(() => {
    let state: SaveState = "saved";
    const listeners = new Set<() => void>();
    let pending: Lesson | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight: Promise<void> | null = null;
    /** One toast per run of failures: typing through a broken save must not stack twelve of them. */
    let warned = false;

    const setState = (next: SaveState) => {
      if (next === state) return;
      state = next;
      for (const l of listeners) l();
    };

    const fail = () => {
      // `pending` stays set on purpose: the beforeunload warning is the net.
      setState("failed");
      if (!warned) toast(SAVE_FAILED_MESSAGE, { duration: 12_000 });
      warned = true;
    };

    const write = async (): Promise<void> => {
      if (timer) clearTimeout(timer);
      timer = undefined;
      const lesson = pending;
      if (!lesson) return;
      pending = null;
      setState("saving");
      try {
        await onSaveRef.current(lesson);
        warned = false;
        // Only "Saved" if nothing changed while the write was in flight.
        if (pending === null) setState("saved");
        else setState("unsaved");
      } catch {
        pending = pending ?? lesson;
        fail();
      }
    };

    const flush = async (): Promise<void> => {
      // One write at a time: a flush during a write waits for it, then writes what arrived since.
      if (inFlight) await inFlight;
      if (!pending) return;
      inFlight = write();
      try {
        await inFlight;
      } finally {
        inFlight = null;
      }
    };

    return {
      onChange: (lesson: Lesson) => {
        pending = lesson;
        setState("unsaved");
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => void flush(), delay);
      },
      flush,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      getState: () => state,
      hasPending: () => pending !== null,
    };
  }, []);

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") void store.flush();
    };
    const onUnload = (e: BeforeUnloadEvent) => {
      if (store.getState() === "saved" && !store.hasPending()) return;
      void store.flush();
      // Unsaved work: ask before the tab goes.
      e.preventDefault();
    };
    window.addEventListener("beforeunload", onUnload);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      document.removeEventListener("visibilitychange", onHide);
      void store.flush();
    };
  }, [store]);

  return store;
}

const SAVED = (): SaveState => "saved";

/** What the saved indicator should say right now. */
export function useSaveState(autosave: Autosave): SaveState {
  return useSyncExternalStore(autosave.subscribe, autosave.getState, SAVED);
}
