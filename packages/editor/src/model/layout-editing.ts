/**
 * The lesson history's `settle` for layout groups, loaded only for a lesson that has one (bundle
 * budget, TEACH-205 part b). `syncLayoutGroups` and the layout code it needs stay out of the
 * lesson editor's route chunk: `useDocumentHistory` starts the load as soon as it sees a layout
 * group or a freed layout, and the "Free layout" switch loads with it.
 *
 * An edit made before the chunk arrives is not lost: the lesson as it was before that first edit
 * is kept, and once the chunk loads the history settles everything since then in one step
 * (`takePendingSettle`). A failed import is forgotten, so the next edit or render tries again.
 */
import { isLayoutGroup, type Lesson } from "@tj/domain/documents";
import { freeLayoutSwitch } from "../lesson/toolbar/free-layout-loader";

type LayoutSync = Pick<typeof import("./reducers/layout-sync"), "syncLayoutGroups">;

/**
 * `load` once at a time, the same promise to every caller while it runs or after it succeeds; a
 * rejection is not kept, so the next call imports again.
 */
export function retryable<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return () => {
    pending ??= load().catch((error: unknown) => {
      pending = null;
      throw error;
    });
    return pending;
  };
}

let sync: LayoutSync | undefined;
let pendingBefore: Lesson | undefined;
const listeners = new Set<() => void>();

let importSync: () => Promise<LayoutSync> = () => import("./reducers/layout-sync");
const makeStart = () =>
  retryable(() =>
    importSync().then((m) => {
      sync = m;
      for (const listener of [...listeners]) listener();
    }),
  );
let start = makeStart();

/** Whether any slide holds a layout group, or a layout the teacher freed. */
export const hasLayouts = (lesson: Lesson): boolean =>
  lesson.slides.some((s) => s.freeLayout !== undefined || s.elements.some(isLayoutGroup));

/** Loads the layout write-through and the Free layout switch. Retries after a failure. */
export function loadLayoutEditing(): Promise<void> {
  freeLayoutSwitch.preload();
  return start();
}

/** `syncLayoutGroups` once it has loaded; until then the edit is kept to settle on load. */
export function settleLayoutGroups(before: Lesson, after: Lesson): Lesson {
  if (sync) return sync.syncLayoutGroups(before, after);
  if (before !== after && (hasLayouts(before) || hasLayouts(after))) {
    pendingBefore ??= before;
    loadLayoutEditing().catch(() => undefined);
  }
  return after;
}

/**
 * The settle owed for edits made before the chunk loaded, as a reducer over the current lesson
 * (it judges every layout group against the lesson before the first of those edits); `undefined`
 * when nothing is owed or the chunk is not here yet. Taking it clears it.
 */
export function takePendingSettle(): ((lesson: Lesson) => Lesson) | undefined {
  const s = sync;
  const before = pendingBefore;
  if (!s || !before) return undefined;
  pendingBefore = undefined;
  return (lesson) => s.syncLayoutGroups(before, lesson);
}

/** Calls `listener` each time the layout chunk finishes loading; returns the unsubscribe. */
export function onLayoutEditingLoaded(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Tests only: replaces the chunk import and forgets what has loaded. */
export function resetLayoutEditingForTest(load?: () => Promise<LayoutSync>): void {
  sync = undefined;
  pendingBefore = undefined;
  if (load) importSync = load;
  start = makeStart();
}
