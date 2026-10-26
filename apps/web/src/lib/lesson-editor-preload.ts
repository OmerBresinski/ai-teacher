import { preloadCreationMotion } from "@/components/lesson-creation/creation-motion";
import { lessonEditorRoute } from "@/routes/documents.route";
import { lazyPreload } from "./lazy-preload";

// Off the editor's first paint (and its chunk budget), but preloadable: the intake warms them on
// the teacher's Next, Skip planning and Continue, so the editor that follows draws its companion and
// generating view on its first frame instead of a frame later.
export const GenerationCompanion = lazyPreload(() =>
  import("@/components/lesson-creation/generation-companion").then((m) => ({
    default: m.GenerationCompanion,
  })),
);
// Only a lesson still under its `lesson.plan` lock reaches it (bundle-conditional).
export const GeneratingLesson = lazyPreload(() =>
  import("@/components/generating-lesson").then(({ GeneratingLesson }) => ({
    default: GeneratingLesson,
  })),
);

/**
 * Everything the lesson editor needs to draw a lesson being made: its route chunk, the companion,
 * the generating view, the characters' motion and the re-lay code. Fire and forget; a failed load retries on use.
 */
export function preloadLessonEditor(): void {
  const component = lessonEditorRoute.options.component as { preload?: () => Promise<void> };
  void component.preload?.().catch(() => undefined);
  void GenerationCompanion.preload().catch(() => undefined);
  void GeneratingLesson.preload().catch(() => undefined);
  preloadCreationMotion();
  preloadLayoutKit();
}

/**
 * The slides' re-lay code a re-theme needs (`@tj/slides/relayout`). Loaded ahead so a theme picked
 * before the editor opened goes on in the editor's first paint, with no wait on mount.
 */
export function preloadLayoutKit(): void {
  void import("@tj/editor/layout-kit").then((m) => m.loadLayoutKit()).catch(() => undefined);
}
