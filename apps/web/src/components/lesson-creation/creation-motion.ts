import { loadGsap } from "@/lib/gsap";

type Gsap = Awaited<ReturnType<typeof loadGsap>>;
type RigModule = typeof import("./motion/handover-rig.js");
export interface CreationMotion {
  gsap: Gsap;
  rig: RigModule;
}

let loaded: CreationMotion | null = null;
let loading: Promise<CreationMotion> | null = null;

/**
 * The characters' motion (GSAP and the rig), click-loaded (ADR 0028) but remembered once it is
 * here, so a character that mounts after it has loaded draws on its first frame instead of one
 * frame later (the intake's character, the generation companion). A failed load is retried next time.
 */
export function loadCreationMotion(): Promise<CreationMotion> {
  if (loaded) return Promise.resolve(loaded);
  loading ??= Promise.all([loadGsap(), import("./motion/handover-rig.js")]).then(
    ([gsap, rig]) => {
      loaded = { gsap, rig };
      return loaded;
    },
    (error: unknown) => {
      loading = null;
      throw error;
    },
  );
  return loading;
}

/** The motion if it has already loaded, else `null` (and the load is started). */
export function creationMotionNow(): CreationMotion | null {
  if (!loaded) void loadCreationMotion().catch(() => undefined);
  return loaded;
}

/**
 * Everything the hand-over from the intake to the editor draws: the motion, and the character
 * entrances (Plan's on the planning stage, Slides' in the editor). Called on the teacher's Next,
 * Skip planning or Continue, so nothing on the next screen waits for a chunk.
 */
export function preloadCreationMotion(): void {
  void loadCreationMotion().catch(() => undefined);
  void import("./motion/entrances/index.js").catch(() => undefined);
}
