import { type RefObject, useEffect, useRef, useSyncExternalStore } from "react";
import { loadGsap, prefersReducedMotion } from "@/lib/gsap";
import { CAST_ARTWORK } from "./cast-artwork";
import { type Cast, type CastMood, createCast } from "./cast-rig";

export type { CastMood } from "./cast-rig";

/** What the cast looks at in each mood; `idle` follows the pointer instead. */
export type CastTargets = Partial<Record<CastMood, RefObject<HTMLElement | null>>>;

function subscribeReducedMotion(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/**
 * The four characters around the sign-in card (TEACH-252), placed like the homepage hero's:
 * Slides and Worksheet peek over the card's top edge, Plan and Check stand at its sides from `lg`.
 * Render it first inside a `relative` wrapper whose card comes after it with a higher z-index, so
 * the card hides the peekers' lower halves. Decorative: hidden from assistive technology.
 *
 * Motion is GSAP, loaded on mount through `loadGsap()` (ADR 0028). With reduced motion it is never
 * loaded and the cast stays still; only the faces follow the mood.
 */
export function SignInCast({ mood, targets }: { mood: CastMood; targets: CastTargets }) {
  const stage = useRef<HTMLDivElement>(null);
  const cast = useRef<Cast | null>(null);
  // Read by the effects, so a new `targets` object each render never restarts a scene.
  const latest = useRef({ mood, targets });
  const reduced = useSyncExternalStore(subscribeReducedMotion, prefersReducedMotion, () => false);

  useEffect(() => {
    const root = stage.current;
    if (!root) return;
    const hosts = [...root.querySelectorAll<HTMLElement>("[data-cast]")];
    let cancelled = false;
    let live: Cast | null = null;
    const start = (gsap: Awaited<ReturnType<typeof loadGsap>> | null) => {
      if (cancelled) return;
      live = createCast(hosts, gsap);
      cast.current = live;
      const { mood: now, targets: where } = latest.current;
      live.enter(root, now === "idle");
      live.setMood(now, where[now]?.current ?? null);
    };
    // No IntersectionObserver (the unit-test DOM): nothing could tell the rig what is on screen.
    if (reduced || typeof IntersectionObserver === "undefined") start(null);
    else loadGsap().then(start, () => start(null));
    return () => {
      cancelled = true;
      live?.destroy();
      cast.current = null;
    };
  }, [reduced]);

  useEffect(() => {
    latest.current = { mood, targets };
  });

  useEffect(() => {
    cast.current?.setMood(mood, latest.current.targets[mood]?.current ?? null);
  }, [mood]);

  return (
    <div
      ref={stage}
      aria-hidden="true"
      // "waiting" keeps the cast out of sight until the rig brings it on; "still" shows it at rest.
      data-cast-stage={reduced ? "still" : "waiting"}
      className="group/cast absolute inset-0 text-foreground"
    >
      {ACTORS}
    </div>
  );
}

// Static artwork hoisted so a re-render never rebuilds it (rendering-hoist-jsx). The rig writes
// transforms and paths into these nodes directly; React never touches them again.
const ACTORS = (
  <>
    {/* The peekers' window: it ends just under the card's top edge, so they climb out of the
        card's back on arrival and their lower halves stay hidden behind it. */}
    <div className="absolute inset-x-0 top-[-110px] h-[118px] overflow-hidden sm:top-[-140px] sm:h-[150px]">
      <div
        data-cast="slides"
        className="absolute top-[42px] left-[4%] w-[124px] group-data-[cast-stage=waiting]/cast:translate-y-full sm:left-[8%] sm:w-[180px]"
      >
        {CAST_ARTWORK.slides}
      </div>
      <div
        data-cast="activity"
        className="absolute top-[48px] right-[5%] w-[116px] group-data-[cast-stage=waiting]/cast:translate-y-full sm:top-[50px] sm:right-[9%] sm:w-[168px]"
      >
        {CAST_ARTWORK.activity}
      </div>
    </div>
    <div
      data-cast="support"
      className="absolute bottom-[-64px] left-[-206px] hidden w-[244px] group-data-[cast-stage=waiting]/cast:opacity-0 lg:block"
    >
      {CAST_ARTWORK.support}
    </div>
    <div
      data-cast="answers"
      className="absolute right-[-214px] bottom-[-70px] hidden w-[252px] group-data-[cast-stage=waiting]/cast:opacity-0 lg:block"
    >
      {CAST_ARTWORK.answers}
    </div>
  </>
);
