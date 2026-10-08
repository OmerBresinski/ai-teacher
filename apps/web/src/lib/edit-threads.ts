/**
 * The edit chat keeps its threads in this browser (TEACH-97, `threadKey` in `@tj/editor`). Sign-out
 * clears them, so a shared computer never shows one teacher's thread to the next. The prefix is
 * repeated here rather than imported, so the always-loaded session code does not pull editor
 * modules into the entry chunk; `edit-threads.test.ts` holds it equal to the editor's.
 */
export const EDIT_THREAD_PREFIX = "dayback.edit-thread.";

export function clearEditThreads(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key?.startsWith(EDIT_THREAD_PREFIX)) keys.push(key);
    }
    for (const key of keys) window.localStorage.removeItem(key);
  } catch {
    // Storage refused: nothing stored to clear.
  }
}
