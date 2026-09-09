/**
 * `@tj/editor/starter` — the starter and demo documents, and the pure document factories, without
 * any React module. For code that only needs content: `bun run db:seed` and the e2e seed route
 * insert `demoWorkspace()` (ADR 0024 §16) through the `@tj/db` documents repository; the web's
 * library mutations build blank / starter documents and copies with the factories here (ADR 0024
 * §9, §11) without pulling the renderer into the library chunk. The root barrel re-exports the
 * same functions beside the renderer; this entry exists so a Bun script or a lazy web chunk can
 * import them without TSX or `react` in its own dependency tree.
 */

// The layout catalogue and the ten-slide fixture lesson (TEACH-214), for a Bun script or an e2e
// spec that seeds a lesson laid out through `chooseVariant` without the renderer.
export {
  chooseVariant,
  DEMO_LESSON_SPECS,
  demoLessonSlides,
  LAYOUT_CATALOGUE,
  variantsFor,
} from "@tj/slides";
export { demoWorksheet } from "./model/demo-worksheet";
export { type DemoDocument, demoWorkspace } from "./model/demo-workspace";
export { cloneSlide, newLesson, newSlide } from "./model/factories";
export { DEMO_CONTENT_VERSION, DEMO_IDS, demoLibrary, starterLesson } from "./model/starter";
export { newWorksheet, starterWorksheet } from "./model/worksheet-factories";
