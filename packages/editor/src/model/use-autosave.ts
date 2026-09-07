import type { Lesson, Worksheet } from "@tj/domain/documents";
import { toast } from "@tj/ui";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";

/**
 * Autosave for both editors (TeachDeck `components/editor/use-autosave.ts` and
 * `lib/worksheet/autosave.ts`), with the one thing the write itself cannot give the chrome: an
 * outcome. Edits are "Unsaved changes" for the 800 ms before a write is even attempted, "Saving…"
 * while it runs, "Saved" after, and "Not saved" when it rejects — said out loud once, with the
 * unload warning as the net.
 *
 * Generic in the document (`Lesson` or `Worksheet`): the write is the `onSave(document)` prop
 * (ADR 0022 §5) — `PUT /documents/:id` in the app; nothing here knows that. Exposed as
 * `@tj/editor/autosave` so the app can import `SaveRefusedError` without either editor's chunk.
 */

export type SaveState = "saved" | "unsaved" | "saving" | "failed";

/** What autosave can persist: any full document the app's `saveDocument` accepts. */
export type SavableDocument = Lesson | Worksheet;

/** TeachDeck's `AUTOSAVE_MS`. */
export const AUTOSAVE_MS = 800;

export const SAVE_FAILED_MESSAGE =
  "Could not save your changes. Export a copy before you close the tab.";

/**
 * Reject `onSave` with this when the app has already told the teacher why the write was refused
 * (a `409` the app turned into its own toast with a Reload action, ADR 0024 §4). The indicator
 * still shows "Not saved" and the unload warning still stands; only the generic toast is skipped,
 * so the teacher is not told to export a copy over the message that explains what to do.
 */
export class SaveRefusedError extends Error {
  override readonly name = "SaveRefusedError";
}

export type Autosave<D extends SavableDocument = SavableDocument> = {
  /** Hand to the history hook's `onChange`: one call per committed change. */
  onChange: (document: D) => void;
  /** Write anything outstanding now — before Present opens, before the route is left. */
  flush: () => Promise<void>;
  subscribe: (listener: () => void) => () => void;
  getState: () => SaveState;
  /**
   * The document as of the last time the debounce fired — what is being (or was last) written.
   * `null` until the first change. Work that must follow edits at the save cadence rather than per
   * keystroke (the residual checks, ADR 0025 §12) derives from this instead of the live document.
   */
  getSettled: () => D | null;
};

export type AutosaveOptions = {
  /** The debounce, `AUTOSAVE_MS` unless a test shortens it. */
  delay?: number;
};

export function useAutosave<D extends SavableDocument>(
  onSave: (document: D) => Promise<void>,
  { delay = AUTOSAVE_MS }: AutosaveOptions = {},
): Autosave<D> {
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  // biome-ignore lint/correctness/useExhaustiveDependencies: the store is built once; `delay` is read at creation
  const store = useMemo(() => {
    let state: SaveState = "saved";
    const listeners = new Set<() => void>();
    let pending: D | null = null;
    let settled: D | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight: Promise<void> | null = null;
    /** One toast per run of failures: typing through a broken save must not stack twelve of them. */
    let warned = false;

    const notify = () => {
      for (const l of listeners) l();
    };
    const setState = (next: SaveState) => {
      if (next === state) return;
      state = next;
      notify();
    };
    /** The debounce fired (or a flush is about to write): publish what is being written. */
    const settle = () => {
      if (pending === null || pending === settled) return;
      settled = pending;
      notify();
    };

    const fail = (reported: boolean) => {
      // `pending` stays set on purpose: the beforeunload warning is the net.
      setState("failed");
      if (!warned && !reported) toast(SAVE_FAILED_MESSAGE, { duration: 12_000 });
      warned = true;
    };

    const write = async (): Promise<void> => {
      if (timer) clearTimeout(timer);
      timer = undefined;
      settle();
      const document = pending;
      if (!document) return;
      pending = null;
      setState("saving");
      try {
        await onSaveRef.current(document);
        warned = false;
        // Only "Saved" if nothing changed while the write was in flight.
        if (pending === null) setState("saved");
        else setState("unsaved");
      } catch (error) {
        pending = pending ?? document;
        fail(error instanceof SaveRefusedError);
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
      onChange: (document: D) => {
        pending = document;
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
      getSettled: () => settled,
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

/** The half of an `Autosave` the indicator reads; independent of the document type. */
export type SaveStateSource = Pick<Autosave, "subscribe" | "getState">;

/** What the saved indicator should say right now. */
export function useSaveState(autosave: SaveStateSource): SaveState {
  return useSyncExternalStore(autosave.subscribe, autosave.getState, SAVED);
}

const NONE = () => null;

/** The document at the save cadence: the last one the debounce handed to the write, or `null`. */
export function useSettledDocument<D extends SavableDocument>(autosave: Autosave<D>): D | null {
  return useSyncExternalStore(autosave.subscribe, autosave.getSettled, NONE);
}
