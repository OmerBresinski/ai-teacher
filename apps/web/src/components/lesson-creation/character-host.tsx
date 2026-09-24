import { gsap } from "gsap";
import { type Ref, useEffect, useImperativeHandle, useRef } from "react";
import type { CharacterCapture } from "./character-origin";
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
    if (!element.current) return;
    previous.current = initialStage;
    const context = gsap.context(() => {
      rig.current = createHandoverRig(element.current as HTMLDivElement);
    });
    return () => {
      rig.current?.dispose();
      rig.current = null;
      context.revert();
    };
  }, [initialStage]);
  useEffect(() => {
    const actor = rig.current;
    if (!actor) return;
    const from = OWNER[previous.current],
      to = OWNER[stage];
    previous.current = stage;
    let cancelled = false;
    const work = (beat: number, reset = true) => {
      if (cancelled) return;
      actor.play(beat, {
        reset,
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
          work(next, to === 1 ? !(beat === 3 && next === 4) : to === 2 && next === 6);
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
      media.removeEventListener("change", changed);
    };
  }, [stage]);
  return <div ref={element} className="handover-stage" aria-hidden="true" />;
}
