import { useEffect, useLayoutEffect, useRef } from "react";
import { CHARACTER_ENTRY_SECONDS, type CharacterOrigin, PERSONA_SPEED } from "./character-origin";
import type { HandoverRig } from "./motion/handover-rig.js";

type RigModule = typeof import("./motion/handover-rig.js");

/** Data drives the story; completed gestures hand over without holding up the editor. */
export function GenerationStory({
  gsap,
  rigModule,
  includedWorksheet,
  origin,
  progress,
  ready,
  checking,
  skipIntro = false,
  paused,
  onFinished,
}: {
  gsap: typeof import("gsap").gsap;
  rigModule: RigModule;
  includedWorksheet: boolean;
  origin: CharacterOrigin | null;
  progress: number;
  ready: boolean;
  checking?: boolean;
  skipIntro?: boolean;
  paused: boolean;
  onFinished: () => void;
}) {
  const element = useRef<HTMLDivElement>(null);
  const rig = useRef<HandoverRig | null>(null);
  const latest = useRef({ progress, ready, checking: checking ?? ready, paused, onFinished });
  latest.current = { progress, ready, checking: checking ?? ready, paused, onFinished };
  useLayoutEffect(() => {
    const root = element.current;
    if (!root) return;
    let cancelled = false;
    const context = gsap.context(() => {
      rig.current = rigModule.createHandoverRig(root, gsap);
    });
    const actor = rig.current;
    if (!actor) return;
    const finish = () => {
      if (!cancelled) latest.current.onFinished();
    };
    const inspectLoop = () => {
      if (cancelled) return;
      // Once the lesson is ready the check is a quick, exact sign-off, not a performance.
      const tail = latest.current.ready ? 1.7 : PERSONA_SPEED[3];
      actor.play(9, {
        withWorksheet: includedWorksheet,
        speed: tail,
        onComplete: () => {
          if (latest.current.ready)
            actor.play(10, { reset: false, speed: 1.7, onComplete: finish });
          else inspectLoop();
        },
      });
    };
    const inspect = () => {
      if (cancelled) return;
      // If the lesson is already ready, Check skips the inspection and signs off.
      actor.play(5, {
        handoff: { from: 1, to: 3 },
        speed: latest.current.ready ? 1.7 : 1.45,
        onComplete: () => {
          if (latest.current.ready)
            actor.play(10, { reset: false, speed: 1.7, onComplete: finish });
          else inspectLoop();
        },
      });
    };
    const work = (beat: number, reset = true) => {
      if (cancelled) return;
      actor.play(beat, {
        reset,
        speed: PERSONA_SPEED[1],
        withWorksheet: includedWorksheet,
        onComplete: () => {
          if (latest.current.ready && !latest.current.checking) return finish();
          if ((latest.current.checking || latest.current.ready) && beat === 4) return inspect();
          const next =
            latest.current.checking || latest.current.ready || latest.current.progress >= 0.75
              ? 4
              : 3;
          // Keep the completed deck under the next blank slide; do not resurrect the brief.
          work(next, beat !== 3);
        },
      });
    };
    let entry: ReturnType<typeof gsap.delayedCall> | null = null;
    root.dataset.entry = origin && !actor.reduced && !skipIntro ? "travelling" : "arrived";
    if (actor.reduced) actor.settle(3);
    else if (skipIntro) {
      if (latest.current.ready && !latest.current.checking) finish();
      else if (latest.current.checking || latest.current.ready) {
        actor.settle(4);
        inspect();
      } else work(3);
    } else {
      if (origin) actor.restore(origin.pose);
      else actor.settle(7);
      entry = gsap.delayedCall(origin ? CHARACTER_ENTRY_SECONDS : 0, () => {
        root.dataset.entry = "arrived";
        handoverFrom = performance.now();
        actor.play(includedWorksheet ? 8 : 11, {
          handoff: { from: 2, to: 1 },
          speed: includedWorksheet ? 1.45 : 1,
          onComplete: () => {
            work(latest.current.ready ? 4 : 3);
          },
        });
        actor.pause(latest.current.paused);
      });
    }
    // The companion's flight and exit: the character leaps with the flight and walks out at the end.
    const host = root.closest(".creation-generation-actor");
    // The leap may join once the receiver has arrived and is carrying the work to centre.
    let handoverFrom = !skipIntro && !actor.reduced ? Number.POSITIVE_INFINITY : 0;
    const onLeap = (event: Event) => {
      const detail = (event as CustomEvent<{ flight: number; accepted: boolean }>).detail;
      if (actor.reduced || performance.now() - handoverFrom < 1500) return;
      detail.accepted = true;
      actor.react("leap", { flight: detail.flight });
    };
    const onLeave = (event: Event) => {
      const detail = (event as CustomEvent<{ done: () => void; accepted: boolean }>).detail;
      if (actor.reduced) return;
      detail.accepted = true;
      actor.react("leave", { onComplete: detail.done });
    };
    host?.addEventListener("cast:leap", onLeap);
    host?.addEventListener("cast:leave", onLeave);
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const changed = () => {
      if (media.matches) {
        entry?.kill();
        root.dataset.entry = "arrived";
        actor.settle(3);
        if (latest.current.ready) finish();
      } else work(3);
    };
    media.addEventListener("change", changed);
    return () => {
      cancelled = true;
      entry?.kill();
      media.removeEventListener("change", changed);
      host?.removeEventListener("cast:leap", onLeap);
      host?.removeEventListener("cast:leave", onLeave);
      actor.dispose();
      rig.current = null;
      context.revert();
    };
  }, [includedWorksheet, origin, skipIntro, gsap, rigModule]);
  useEffect(() => {
    rig.current?.pause(paused);
  }, [paused]);
  useEffect(() => {
    if (ready && rig.current?.reduced) latest.current.onFinished();
  }, [ready]);
  return <div ref={element} className="handover-stage" aria-hidden="true" />;
}
