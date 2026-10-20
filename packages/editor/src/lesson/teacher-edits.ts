import { useSyncExternalStore } from "react";

/**
 * Whether the teacher has changed the open lesson (an edit, an undo or redo, a title or theme
 * change: anything through the editor's history), as opposed to the editor's own bookkeeping (the
 * fit migration) or a generating job's write merged into it. While a job fills the lesson, the
 * save status shows only once this is set (UX audit J3): the job's own saves are not the
 * teacher's to watch, but a teacher's change always is, pending, saving, failed or saved.
 */
export type TeacherEdits = {
  mark: () => void;
  get: () => boolean;
  subscribe: (fn: () => void) => () => void;
};

export function createTeacherEdits(): TeacherEdits {
  let edited = false;
  const subs = new Set<() => void>();
  return {
    mark: () => {
      if (edited) return;
      edited = true;
      for (const fn of subs) fn();
    },
    get: () => edited,
    subscribe: (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

const NEVER = () => () => {};
export function useTeacherEdited(edits: TeacherEdits | undefined): boolean {
  return useSyncExternalStore(
    edits?.subscribe ?? NEVER,
    () => edits?.get() ?? false,
    () => false,
  );
}
