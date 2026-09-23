import { gsap } from "gsap";
import { useEffect, useRef } from "react";
import { createHandoverRig, type HandoverRig } from "./motion/handover-rig.js";

/** Data drives the story; completed gestures hand over without holding up the editor. */
export function GenerationStory({
  includedWorksheet,
  progress,
  ready,
  paused,
  onFinished,
}: {
  includedWorksheet: boolean;
  progress: number;
  ready: boolean;
  paused: boolean;
  onFinished: () => void;
}) {
  const element = useRef<HTMLDivElement>(null);
  const rig = useRef<HandoverRig | null>(null);
  const latest = useRef({ progress, ready, onFinished });
  latest.current = { progress, ready, onFinished };
  useEffect(() => {
    const root = element.current;
    if (!root) return;
    let cancelled = false;
    const context = gsap.context(() => {
      rig.current = createHandoverRig(root);
    });
    const actor = rig.current;
    if (!actor) return;
    const finish = () => {
      if (!cancelled) latest.current.onFinished();
    };
    const inspect = () => {
      if (cancelled) return;
      actor.play(5, {
        handoff: { from: 1, to: 3 },
        speed: 1.45,
        onComplete: () => {
          actor.play(9, {
            withWorksheet: includedWorksheet,
            onComplete: () => {
              actor.play(10, { reset: false, onComplete: finish });
            },
          });
        },
      });
    };
    const work = (beat: number, reset = true) => {
      if (cancelled) return;
      actor.play(beat, {
        reset,
        withWorksheet: includedWorksheet,
        onComplete: () => {
          if (latest.current.ready && beat === 4) return inspect();
          const next = latest.current.ready || latest.current.progress >= 0.75 ? 4 : 3;
          work(next, !(beat === 3 && next === 4));
        },
      });
    };
    if (actor.reduced) actor.settle(3);
    else {
      actor.settle(7);
      actor.play(includedWorksheet ? 8 : 11, {
        handoff: { from: 2, to: 1 },
        speed: includedWorksheet ? 1.45 : 1,
        onComplete: () => work(latest.current.ready ? 4 : 3),
      });
    }
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const changed = () => {
      if (media.matches) {
        actor.settle(3);
        if (latest.current.ready) finish();
      } else work(3);
    };
    media.addEventListener("change", changed);
    return () => {
      cancelled = true;
      media.removeEventListener("change", changed);
      actor.dispose();
      rig.current = null;
      context.revert();
    };
  }, [includedWorksheet]);
  useEffect(() => {
    rig.current?.pause(paused);
  }, [paused]);
  useEffect(() => {
    if (ready && rig.current?.reduced) latest.current.onFinished();
  }, [ready]);
  return <div ref={element} className="handover-stage" aria-hidden="true" />;
}
