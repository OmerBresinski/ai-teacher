/*
 * The live pilot pack's id and the writer bundle a pack runs with, in a module that imports
 * nothing, so `bundle.ts` can read them without importing `pilot-pack.ts` (which reaches
 * `bundle.ts` through `fixes.ts`). `pilot-pack.ts` re-exports the id as `PILOT_PACK_LIVE`, typed
 * as a pack id, so a typo fails the typecheck.
 */

/** The pack production runs (TEACH-110 part s). Switching the default is this one line. */
export const PILOT_PACK_LIVE_ID = "v5.0b";

/**
 * A pack whose prompt files need their own writer bundle (objectives, user turn, notes), by pack
 * id. The pack's lessons are planned with that bundle and stamped with it, so a saved lesson keeps
 * it (`writerBundleOf`). Every other pack runs `WRITER_BUNDLE_ID`.
 */
export const PACK_WRITER_BUNDLE: Readonly<Record<string, string>> = {
  "v5.2-gold": "base4f-p127",
  "v5.3-gold": "base4f-p128",
  "v5.3b-gold": "base4f-p129",
};
