import { type Ref, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { loadGsap } from "@/lib/gsap";
import { type CharacterCapture, PERSONA_SPEED } from "./character-origin";
import type { HandoverRig } from "./motion/handover-rig.js";

type RigModule = typeof import("./motion/handover-rig.js");

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

/** The planning stage: Plan enters with its own entrance, then reads the brief until it is planned. */
export type PlanningCard = {
  /** Set when the objectives are saved: Plan finishes the beat in hand, then `onDone`. */
  objectives: string[] | null;
  onDone?: () => void;
};

/** React owns lifetime; the original rig owns articulated hands and their actual props. */
export function CharacterHost({
  stage,
  captureRef,
  initialStage = "brief",
  slidesPhase = "making",
  planning,
}: {
  stage: CharacterStage;
  captureRef?: Ref<CharacterCapture>;
  initialStage?: CharacterStage;
  slidesPhase?: "making" | "stacking";
  /** The planning stage: Plan reads the brief centre stage until the objectives are saved. */
  planning?: PlanningCard;
}) {
  const planningRef = useRef(planning);
  planningRef.current = planning;
  const planState = useRef({ entering: false, finishing: false, pending: false, playing: false });
  const [gsap, setGsap] = useState<Awaited<ReturnType<typeof loadGsap>> | null>(null);
  const rigModule = useRef<RigModule | null>(null);
  useEffect(() => {
    let cancelled = false;
    // The rig is lazy: the form never waits for the characters' chunk.
    void Promise.all([loadGsap(), import("./motion/handover-rig.js")])
      .then(([runtime, module]) => {
        rigModule.current = module;
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
      rig.current =
        rigModule.current?.createHandoverRig(element.current as HTMLDivElement, gsap) ?? null;
    });
    return () => {
      rig.current?.dispose();
      rig.current = null;
      context.revert();
    };
  }, [initialStage, gsap]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: finishPlanning reads refs only.
  useEffect(() => {
    const actor = rig.current;
    if (!actor || !gsap) return;
    const prior = previous.current;
    const from = OWNER[prior],
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
    // One scheduler per character: a pending gesture is replaced, never doubled. Wait out the
    // rest, then any typing burst, before the next gesture.
    const afterRest = (then: () => void, seconds: number) => {
      window.clearTimeout(rest);
      rest = window.setTimeout(() => {
        const quiet = performance.now() - lastInput;
        if (quiet < TYPING_QUIET_MS) afterRest(then, (TYPING_QUIET_MS - quiet) / 1000);
        else then();
      }, seconds * 1000);
    };
    const work = (beat: number, reset = true) => {
      if (cancelled) return;
      window.clearTimeout(rest);
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
    const plan = planningRef.current;
    if (stage === "planning" && plan) {
      const state = planState.current;
      Object.assign(state, { entering: false, finishing: false, pending: false, playing: false });
      // Reading the brief: three lines, then the next page (its check-through) or a look up with a
      // nod, in turn, without rests (it is reading). When the objectives land it finishes the line,
      // lowers the sheet with a nod (17) and the page moves on. Beats 13-17 are in work-beats.
      let lines = 0,
        pages = 0;
      const next = (beat: number) => {
        if (beat === 14) {
          lines++;
          if (lines % 3) return 14;
          pages++;
          return pages % 3 === 2 ? 16 : 15;
        }
        return 14;
      };
      const loop = (beat: number) => {
        if (cancelled || state.finishing) return;
        state.playing = true;
        actor.play(beat, {
          speed: 1,
          reset: beat === 13,
          onComplete: () => {
            state.playing = false;
            if (cancelled) return;
            if (state.pending) return finishPlanning(state);
            loop(next(beat));
          },
        });
      };
      actor.settle(actor.reduced ? 14 : 13);
      let entry: { cancel: () => void } | null = null;
      if (!actor.reduced && element.current) {
        const stageEl = element.current;
        const box = actor.restBox();
        state.entering = true;
        actor.present(0, false);
        void import("./motion/entrances/index.js").then(({ playPlanEntrance }) => {
          if (cancelled || !box) return actor.present(0, true);
          entry = playPlanEntrance({
            stage: stageEl,
            box,
            onEnd: () => {
              actor.present(0, true);
              state.entering = false;
              // Ready before it has even picked the brief up: straight on, nothing to lower.
              if (state.pending) {
                state.finishing = true;
                planningRef.current?.onDone?.();
              } else afterRest(() => loop(13), 0.4);
            },
          });
        });
      }
      return () => {
        cancelled = true;
        entry?.cancel();
        window.clearTimeout(rest);
        document.removeEventListener("input", typed, true);
      };
    }
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
    } else if (prior !== stage) {
      // Same character, next step: it acknowledges the teacher's move with a nod, then carries on.
      actor.react("nod");
      work(stage === "objectives" ? 1 : (BEAT[to] ?? 0));
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
  function finishPlanning(state: { finishing: boolean }) {
    if (state.finishing) return;
    state.finishing = true;
    const actor = rig.current;
    const done = () => planningRef.current?.onDone?.();
    // Lowers the sheet with a nod, then the page moves on (without motion: straight on).
    if (!actor || actor.reduced) return done();
    actor.play(17, { speed: 1, reset: false, onComplete: done });
  }
  // The objectives landed: Plan finishes the entrance or the beat in hand, then the page moves on.
  const objectives = planning?.objectives ?? null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: finishPlanning reads refs only.
  useLayoutEffect(() => {
    if (!objectives || stage !== "planning" || !planningRef.current) return;
    const state = planState.current;
    state.pending = true;
    if (!state.entering && !state.playing) finishPlanning(state);
  }, [objectives, stage]);
  return <div ref={element} className="handover-stage" aria-hidden="true" />;
}
