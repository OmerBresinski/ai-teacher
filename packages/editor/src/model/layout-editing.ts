/**
 * The lesson history's `settle` for layout groups, loaded only for a lesson that has one (bundle
 * budget, TEACH-205 part b). `syncLayoutGroups` and the layout code it needs stay out of the
 * lesson editor's route chunk: `useDocumentHistory` starts the load as soon as it sees a layout
 * group or a freed layout, before the teacher can type, and the "Free layout" switch loads with it.
 */
import { isLayoutGroup, type Lesson } from "@tj/domain/documents";

type LayoutSync = typeof import("./reducers/layout-sync");

let sync: LayoutSync | undefined;
let loading: Promise<void> | undefined;

/** Whether any slide holds a layout group, or a layout the teacher freed. */
export const hasLayouts = (lesson: Lesson): boolean =>
  lesson.slides.some((s) => s.freeLayout !== undefined || s.elements.some(isLayoutGroup));

/** Loads the layout write-through and the Free layout switch; the same promise every time. */
export function loadLayoutEditing(): Promise<void> {
  loading ??= Promise.all([
    import("./reducers/layout-sync").then((m) => {
      sync = m;
    }),
    import("../lesson/toolbar/FreeLayoutSwitch"),
  ]).then(() => undefined);
  return loading;
}

/** `syncLayoutGroups` once it has loaded; until then nothing to settle unless a layout is here. */
export function settleLayoutGroups(before: Lesson, after: Lesson): Lesson {
  if (sync) return sync.syncLayoutGroups(before, after);
  if (hasLayouts(after)) void loadLayoutEditing();
  return after;
}
