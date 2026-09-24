import { gsap } from "gsap";
import { useLayoutEffect, useRef } from "react";
import { CHARACTER_ENTRY_SECONDS, type CharacterOrigin } from "./character-origin";
import { GenerationStory } from "./generation-story";

/** A persistent stage follows real editor slots across the generating→editable transition. */
export function GenerationCompanion({
  destination,
  origin,
  includedWorksheet,
  progress,
  ready,
  paused,
  onExited,
}: {
  destination: HTMLElement | null;
  origin: CharacterOrigin | null;
  includedWorksheet: boolean;
  progress: number;
  ready: boolean;
  paused: boolean;
  onExited: () => void;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  const finishing = useRef(false);
  const flight = useRef<gsap.core.Timeline | null>(null);
  const exit = useRef<gsap.core.Tween | null>(null);
  useLayoutEffect(() => {
    const actor = stage.current;
    if (!actor || !destination) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const place = () => {
      flight.current?.kill();
      const box = destination.getBoundingClientRect();
      gsap.set(actor, { x: box.left, y: box.top, width: box.width, height: box.height, scale: 1 });
      gsap.set(scrim.current, { autoAlpha: 0 });
      actor.dataset.handover = "settled";
    };
    const box = destination.getBoundingClientRect();
    if (first.current && !reduced.matches) {
      first.current = false;
      gsap.set(scrim.current, { autoAlpha: 1 });
      const width = Math.min(620, window.innerWidth - 32);
      const centre = {
        x: (window.innerWidth - box.width) / 2,
        y: (window.innerHeight - box.height) / 2,
        width: box.width,
        height: box.height,
        scale: width / box.width,
      };
      gsap.set(
        actor,
        origin
          ? {
              x: origin.bounds.left,
              y: origin.bounds.top,
              width: origin.bounds.width,
              height: origin.bounds.height,
              scale: 1,
            }
          : centre,
      );
      const travel = origin ? CHARACTER_ENTRY_SECONDS : 0;
      flight.current = gsap.timeline({
        onComplete: () => {
          actor.dataset.handover = "settled";
        },
      });
      if (origin) flight.current.to(actor, { ...centre, duration: travel, ease: "sine.inOut" }, 0);
      flight.current.call(
        () => {
          actor.dataset.handover = "settling";
        },
        [],
        2.05 + travel,
      );
      flight.current.to(
        actor,
        { x: box.left, y: box.top, scale: 1, duration: 0.85, ease: "sine.inOut" },
        2.05 + travel,
      );
      flight.current.to(scrim.current, { autoAlpha: 0, duration: 0.6 }, 2.05 + travel);
    } else {
      first.current = false;
      actor.dataset.handover = "settled";
      gsap.set(scrim.current, { autoAlpha: 0 });
      flight.current?.kill();
      flight.current = gsap.timeline();
      flight.current.to(actor, {
        x: box.left,
        y: box.top,
        width: box.width,
        height: box.height,
        scale: 1,
        duration: reduced.matches ? 0 : 0.3,
      });
    }
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    reduced.addEventListener("change", place);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      reduced.removeEventListener("change", place);
    };
  }, [destination, origin]);
  useLayoutEffect(
    () => () => {
      flight.current?.kill();
      exit.current?.kill();
      first.current = true;
      finishing.current = false;
    },
    [],
  );
  const finish = () => {
    if (finishing.current) return;
    finishing.current = true;
    flight.current?.kill();
    exit.current = gsap.to(stage.current, {
      opacity: 0,
      duration: matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 0.3,
      onComplete: onExited,
    });
  };
  return (
    <div className="creation-generation-layer" aria-hidden="true">
      <div ref={scrim} className="creation-generation-scrim" />
      <div ref={stage} className="creation-generation-actor" data-handover="passing">
        <GenerationStory
          includedWorksheet={includedWorksheet}
          origin={origin}
          progress={progress}
          ready={ready}
          paused={paused}
          onFinished={finish}
        />
      </div>
    </div>
  );
}
