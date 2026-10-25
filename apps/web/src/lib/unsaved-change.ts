import type { Lesson } from "@tj/domain/documents";

/**
 * A teacher's change the lesson editor could not write before it unmounted (a job held the row,
 * or the network failed): kept on this browser per lesson and applied on the next open
 * (`LessonEditor` `restore`). The editor never retries it once gone, because a gone editor's
 * whole-deck copy no longer follows the row (P0, 25 Oct 2026); keeping the change here is what
 * makes sure the teacher's edit is still never silently lost.
 *
 * `base` is the newest copy the server was known to hold when the change was made, and `baseAt`
 * its version: the restore merges the change onto the current row on that base, so only what the
 * teacher changed comes back and the job's later writing stays.
 */
export type UnsavedChange = {
  lessonId: string;
  lesson: Lesson;
  base: Lesson;
  /** The row version the base was read at (`documentMeta.updatedAt`), when known. */
  baseAt: string | null;
  /** The job that held the lesson when the change was kept, when one did. */
  jobId: string | null;
  keptAt: number;
};

const PREFIX = "tj.unsaved-change.";

export function unsavedChangeKey(lessonId: string): string {
  return `${PREFIX}${lessonId}`;
}

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/** Keep `change` for its lesson, replacing an older one. Storage that throws keeps nothing. */
export function keepUnsavedChange(change: UnsavedChange): boolean {
  try {
    const store = storage();
    if (!store) return false;
    store.setItem(unsavedChangeKey(change.lessonId), JSON.stringify(change));
    return true;
  } catch {
    return false;
  }
}

/** The change kept for `lessonId`, if any and readable. Does not remove it. */
export function readUnsavedChange(lessonId: string): UnsavedChange | undefined {
  try {
    const raw = storage()?.getItem(unsavedChangeKey(lessonId));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<UnsavedChange>;
    if (
      parsed.lessonId !== lessonId ||
      !parsed.lesson ||
      !parsed.base ||
      !Array.isArray(parsed.lesson.slides) ||
      !Array.isArray(parsed.base.slides)
    )
      return undefined;
    return parsed as UnsavedChange;
  } catch {
    return undefined;
  }
}

/** Forget the change kept for `lessonId` (it has been applied, or there was nothing to apply). */
export function forgetUnsavedChange(lessonId: string): void {
  try {
    storage()?.removeItem(unsavedChangeKey(lessonId));
  } catch {
    // Nothing to do: a storage that throws holds nothing of ours.
  }
}

export const RESTORED_UNSAVED_CHANGE = "Restored your unsaved change.";
