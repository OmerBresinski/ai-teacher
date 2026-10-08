/*
 * Where the "Edit with Dayback" threads live in the browser (TEACH-97), without DOM types, so the
 * app's sign-out can clear them through `@tj/editor/starter` without the editor's React modules.
 */

/** Every stored thread's key starts with this (`threadKey` in `./thread`). */
export const EDIT_THREAD_PREFIX = "dayback.edit-thread.";

type Store = { length: number; key(index: number): string | null; removeItem(key: string): void };

/** Forget every stored thread (sign-out: a shared computer must not keep them). */
export function clearEditThreads(): void {
  try {
    const store = (globalThis as { localStorage?: Store }).localStorage;
    if (!store) return;
    const keys: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (key?.startsWith(EDIT_THREAD_PREFIX)) keys.push(key);
    }
    for (const key of keys) store.removeItem(key);
  } catch {
    // Storage refused: there is nothing stored to clear.
  }
}
