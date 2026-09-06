/**
 * `@tj/editor/starter` — the starter and demo documents without any React module, for scripts
 * that only need content: `bun run db:seed` (ADR 0024 §16) inserts `demoLibrary()` and
 * `demoWorksheet()` through the `@tj/db` documents repository. The root barrel re-exports the
 * same functions beside the renderer; this entry exists so a Bun script can import them without
 * TSX or `react` in its own dependency tree.
 */
export { demoWorksheet } from "./model/demo-worksheet";
export { DEMO_CONTENT_VERSION, DEMO_IDS, demoLibrary, starterLesson } from "./model/starter";
export { starterWorksheet } from "./model/worksheet-factories";
