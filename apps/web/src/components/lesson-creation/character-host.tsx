import { type Ref, useEffect, useImperativeHandle, useRef, useState } from "react";
import { loadGsap } from "@/lib/gsap";
import { type CharacterCapture, PERSONA_SPEED } from "./character-origin";
import { createHandoverRig, type HandoverRig } from "./motion/handover-rig.js";

export type CharacterStage =
  | "brief"
  | "planning"
  | "objectives"
  | "worksheet"
  | "generating"
  | "complete";
const OWNER: Record<CharacterStage, number> = {
  brief: 0,
  planning: 0,
  objectives: 0,
  worksheet: 2,
  generating: 1,
  complete: 3,
};
const BEAT = [0, 3, 6, 9];
/** Between gestures on a form step the character rests (breath and blink only), so the teacher's
 * peripheral vision is quiet while they type. Seconds, [min, max] before the next gesture. */
const REST: Partial<Record<CharacterStage, [number, number]>> = {
  brief: [7, 11],
  objectives: [7, 11],
  worksheet: [6, 9],
};
const TYPING_QUIET_MS = 2500;

/** React owns lifetime; the original rig owns articulated hands and their actual props. */
export function CharacterHost({
  stage,
  captureRef,
  initialStage = "brief",
  slidesPhase = "making",
}: {
  stage: CharacterStage;
  captureRef?: Ref<CharacterCapture>;
  initialStage?: CharacterStage;
  slidesPhase?: "making" | "stacking";
}) {
  const [gsap, setGsap] = useState<Awaited<ReturnType<typeof loadGsap>> | null>(null);
  useEffect(() => {
    let cancelled = false;
    void loadGsap()
      .then((runtime) => {
        if (!cancelled) setGsap(runtime);
      })
      .catch(() => {
        /* Characters are optional; the form remains usable if its chunk fails. */
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const element = useRef<HTMLDivElement>(null);
  const rig = useRef<HandoverRig | null>(null);
  useImperativeHandle(
    captureRef,
    () => ({
      capture() {
        const svg = element.current?.querySelector("svg");
        if (!svg || !rig.current) return null;
        const { left, top, width, height } = svg.getBoundingClientRect();
        if (!width || !height) return null;
        const pose = rig.current.snapshot(OWNER[stage]);
        const scale = Math.min(width / 480, height / 280);
        return { bounds: { left: left + pose.offsetX * scale, top, width, height }, pose };
      },
    }),
    [stage],
  );
  const previous = useRef<CharacterStage>(initialStage);
  const phase = useRef(slidesPhase);
  phase.current = slidesPhase;
  useEffect(() => {
    if (!element.current || !gsap) return;
    previous.current = initialStage;
    const context = gsap.context(() => {
      rig.current = createHandoverRig(element.current as HTMLDivElement, gsap);
    });
    return () => {
      rig.current?.dispose();
      rig.current = null;
      context.revert();
    };
  }, [initialStage, gsap]);
  useEffect(() => {
    const actor = rig.current;
    if (!actor || !gsap) return;
    const from = OWNER[previous.current],
      to = OWNER[stage];
    previous.current = stage;
    let cancelled = false;
    let rest: number | undefined;
    let lastInput = 0;
    const typed = () => {
      lastInput = performance.now();
    };
    document.addEventListener("input", typed, true);
    const restRange = REST[stage];
    // Wait out the rest, then any typing burst, before the next gesture.
    const afterRest = (then: () => void, seconds: number) => {
      rest = window.setTimeout(() => {
        const quiet = performance.now() - lastInput;
        if (quiet < TYPING_QUIET_MS) afterRest(then, (TYPING_QUIET_MS - quiet) / 1000);
        else then();
      }, seconds * 1000);
    };
    const work = (beat: number, reset = true) => {
      if (cancelled) return;
      actor.calm(false);
      actor.play(beat, {
        reset,
        speed: PERSONA_SPEED[to],
        onComplete: () => {
          if (stage === "complete") {
            if (beat === 9) work(10, false);
            return;
          }
          const next =
            to === 0
              ? beat === 0
                ? 1
                : 0
              : to === 2
                ? beat === 6
                  ? 7
                  : 6
                : phase.current === "stacking"
                  ? 4
                  : 3;
          // Finish the current creation gesture before sorting its completed deck.
          const go = () => work(next, to === 1 ? beat !== 3 : to === 2 && next === 6);
          if (!restRange) return go();
          actor.calm(true);
          afterRest(go, restRange[0] + Math.random() * (restRange[1] - restRange[0]));
        },
      });
    };
    if (actor.reduced) actor.settle(BEAT[to] ?? 0);
    else if (from !== to) {
      // A rapid next/back settles the previous receiver before making a new offer.
      actor.settle(BEAT[from] ?? 0);
      const transferBeat = from === 0 ? 2 : from === 1 ? 5 : 8;
      actor.play(transferBeat, {
        handoff: { from, to },
        speed: 1.45,
        onComplete: () => work(BEAT[to] ?? 0),
      });
    } else work(stage === "objectives" ? 1 : (BEAT[to] ?? 0));
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const changed = () => {
      if (media.matches) actor.settle(BEAT[to] ?? 0);
      else work(BEAT[to] ?? 0);
    };
    media.addEventListener("change", changed);
    return () => {
      cancelled = true;
      window.clearTimeout(rest);
      document.removeEventListener("input", typed, true);
      media.removeEventListener("change", changed);
    };
  }, [stage, gsap]);
  return <div ref={element} className="handover-stage" aria-hidden="true" />;
}
