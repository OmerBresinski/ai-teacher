import type { Lesson, Worksheet } from "@tj/domain/documents";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";

/**
 * Autosave for both editors (TeachDeck `components/editor/use-autosave.ts` and
 * `lib/worksheet/autosave.ts`), with the one thing the write itself cannot give the chrome: an
 * outcome. Edits are "Unsaved changes" for the 800 ms before a write is even attempted, "Saving…"
 * while it runs, "Saved" after, and "Not saved" when it rejects. A failed save is loud: the
 * editors show `SaveFailedBar` under the top bar until a save succeeds (what is wrong, when the
 * last save landed, Retry), and the indicator itself becomes a Retry button. The unload warning is
 * the last net.
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

export const SAVE_FAILED_MESSAGE = "Your changes are not saved.";
export const SAVE_FAILED_HINT = "Keep this tab open and retry. If it keeps failing, export a copy.";
export const SAVE_RETRY_LABEL = "Retry";

/**
 * Reject `onSave` with this when the app has already told the teacher why the write was refused
 * (a `409` the app turned into its own toast with a Reload action, ADR 0024 §4). The indicator
 * still shows "Not saved" and the unload warning still stands; only the save-failed bar is skipped,
 * so the teacher is not told to export a copy over the message that explains what to do.
 */
export class SaveRefusedError extends Error {
  override readonly name = "SaveRefusedError";
}

/**
 * Reject `onSave` with this when the write could not land *yet* and nobody needs telling: a
 * lesson that is still filling, whose job wrote the row between the editor's read and its write
 * (ADR 0037). The change is kept, the indicator says "Unsaved changes" rather than "Not saved",
 * no bar shows, and the write is tried again on its own (`DEFERRED_RETRY_MS`, doubling to
 * `DEFERRED_RETRY_MAX_MS`) until it lands or a newer change replaces it. The unload warning stands.
 */
export class SaveDeferredError extends Error {
  override readonly name = "SaveDeferredError";
}

/**
 * Reject `onSave` with this when what is waiting is not the teacher's content (UX-A: the editor's
 * fit stamp while the lesson's own job still writes) and cannot be written yet. The indicator
 * stays on the teacher's truth ("Saved" when every edit is saved), the store is `held`
 * (`getHeld`), and the write is tried again quietly (no "Saving…") until it lands. A held write
 * that then fails is a failure like any other; a new edit makes it an ordinary pending change.
 */
export class SaveHeldError extends Error {
  override readonly name = "SaveHeldError";
}

/** The first retry after a deferred write, then doubling up to the max. */
export const DEFERRED_RETRY_MS = 1_500;
export const DEFERRED_RETRY_MAX_MS = 8_000;

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
  /**
   * Whether the current failure is one nothing else has explained: not a `SaveRefusedError`, whose
   * app toast says why and what to do. `SaveFailedBar` shows only for these.
   */
  getUnreportedFailure: () => boolean;
  /** When a write last succeeded (ms since epoch), or `null` before the first one. */
  getLastSavedAt: () => number | null;
  /**
   * `true` while only a non-teacher change waits (`SaveHeldError`): the state reads "saved" and
   * the write is retried quietly. A status that wants to stay quiet can read this.
   */
  getHeld: () => boolean;
};

export type AutosaveOptions = {
  /** The debounce, `AUTOSAVE_MS` unless a test shortens it. */
  delay?: number;
  /** The first retry after a deferred write, `DEFERRED_RETRY_MS` unless a test shortens it. */
  deferredRetry?: number;
};

export function useAutosave<D extends SavableDocument>(
  onSave: (document: D) => Promise<void>,
  { delay = AUTOSAVE_MS, deferredRetry = DEFERRED_RETRY_MS }: AutosaveOptions = {},
): Autosave<D> {
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  // False once the editor has unmounted: its last copy is written once (the unmount flush), and a
  // deferred write is never retried after that. A retry from a gone editor would resend a copy
  // that no longer follows the row, under the row's newest version (P0, 25 Oct 2026).
  const mountedRef = useRef(true);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the store is built once; `delay` and `deferredRetry` are read at creation
  const store = useMemo(() => {
    let state: SaveState = "saved";
    const listeners = new Set<() => void>();
    let pending: D | null = null;
    let settled: D | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight: Promise<void> | null = null;
    let unreported = false;
    let lastSavedAt: number | null = null;
    /** The wait before the next retry of a deferred write; reset by any write that lands. */
    let retryMs = deferredRetry;
    /** Only a non-teacher change waits (`SaveHeldError`): retried quietly, state "saved". */
    let held = false;

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
      // `pending` stays set on purpose: Retry writes it, and the beforeunload warning is the net.
      unreported = !reported;
      if (state === "failed") notify();
      setState("failed");
    };

    const write = async (): Promise<void> => {
      if (timer) clearTimeout(timer);
      timer = undefined;
      settle();
      const document = pending;
      if (!document) return;
      pending = null;
      // A held write (nothing of the teacher's) goes out quietly: the indicator stays "Saved".
      const quiet = held;
      if (!quiet) setState("saving");
      try {
        await onSaveRef.current(document);
        unreported = false;
        lastSavedAt = Date.now();
        retryMs = deferredRetry;
        if (quiet && pending === null) {
          held = false;
          notify();
          return;
        }
        // Only "Saved" if nothing changed while the write was in flight.
        if (pending === null) setState("saved");
        else setState("unsaved");
      } catch (error) {
        const newer = pending !== null;
        pending = pending ?? document;
        if (error instanceof SaveHeldError && !newer && mountedRef.current) {
          // Nothing of the teacher's is waiting: the teacher's truth is "Saved".
          held = true;
          setState("saved");
          notify();
          if (!timer) {
            timer = setTimeout(() => void flush(), retryMs);
            retryMs = Math.min(retryMs * 2, DEFERRED_RETRY_MAX_MS);
          }
          return;
        }
        held = false;
        if (
          !mountedRef.current &&
          (error instanceof SaveDeferredError || error instanceof SaveHeldError)
        ) {
          pending = null;
          return;
        }
        if (error instanceof SaveDeferredError || error instanceof SaveHeldError) {
          // Not a failure: still unsaved, tried again shortly (a newer change resets the timer).
          setState("unsaved");
          if (!timer) {
            timer = setTimeout(() => void flush(), retryMs);
            retryMs = Math.min(retryMs * 2, DEFERRED_RETRY_MAX_MS);
          }
          return;
        }
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
        held = false;
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
      getUnreportedFailure: () => state === "failed" && unreported,
      getLastSavedAt: () => lastSavedAt,
      getHeld: () => held,
      hasPending: () => pending !== null,
    };
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const onHide = () => {
      if (document.visibilityState === "hidden") void store.flush();
    };
    const onUnload = (e: BeforeUnloadEvent) => {
      // A held change is not the teacher's: it is written again on the next visit, no warning.
      if (store.getState() === "saved" && (!store.hasPending() || store.getHeld())) return;
      void store.flush();
      // Unsaved work: ask before the tab goes.
      e.preventDefault();
    };
    window.addEventListener("beforeunload", onUnload);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      document.removeEventListener("visibilitychange", onHide);
      mountedRef.current = false;
      void store.flush();
    };
  }, [store]);

  return store;
}

const SAVED = (): SaveState => "saved";

/**
 * The half of an `Autosave` the indicator reads; independent of the document type. With `flush`,
 * a failed state is a Retry button.
 */
export type SaveStateSource = Pick<Autosave, "subscribe" | "getState"> &
  Partial<Pick<Autosave, "flush" | "getUnreportedFailure" | "getLastSavedAt" | "getHeld">>;

/** What the saved indicator should say right now. */
export function useSaveState(autosave: SaveStateSource): SaveState {
  return useSyncExternalStore(autosave.subscribe, autosave.getState, SAVED);
}

const NONE = () => null;

/** The document at the save cadence: the last one the debounce handed to the write, or `null`. */
export function useSettledDocument<D extends SavableDocument>(autosave: Autosave<D>): D | null {
  return useSyncExternalStore(autosave.subscribe, autosave.getSettled, NONE);
}

const NOT_HELD = () => false;

/** Whether only a non-teacher change waits (`Autosave.getHeld`); `false` for a source without it. */
export function useSaveHeld(autosave: SaveStateSource): boolean {
  return useSyncExternalStore(autosave.subscribe, autosave.getHeld ?? NOT_HELD, NOT_HELD);
}
