import { gsap } from "gsap";
import { useLayoutEffect, useRef } from "react";
import { CharacterHost, type CharacterStage } from "./character-host";

/** One actor stage travels from the introduction into its measured editor slot. */
export function GenerationCompanion({ initialStage }: { initialStage: CharacterStage }) {
  const anchor = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const target = anchor.current;
    const actor = stage.current;
    if (!target || !actor) return;
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    let timeline: gsap.core.Timeline | undefined;
    const settle = () => {
      timeline?.kill();
      gsap.set(actor, { x: 0, y: 0, scale: 1 });
      gsap.set(scrim.current, { opacity: 0 });
      target.dataset.handover = "settled";
    };
    const context = gsap.context(() => {
      if (motion.matches) return settle();
      const box = target.getBoundingClientRect();
      const width = Math.min(620, window.innerWidth - 32);
      target.dataset.handover = "passing";
      gsap.set(actor, {
        x: window.innerWidth / 2 - box.left - box.width / 2,
        y: window.innerHeight / 2 - box.top - box.height / 2,
        scale: width / box.width,
      });
      timeline = gsap.timeline({ onComplete: settle });
      timeline.call(
        () => {
          target.dataset.handover = "settling";
        },
        undefined,
        2.05,
      );
      timeline.to(actor, { x: 0, y: 0, scale: 1, duration: 0.85, ease: "power3.inOut" }, 2.05);
      timeline.to(scrim.current, { opacity: 0, duration: 0.6, ease: "power2.out" }, 2.05);
    }, target);
    // A new viewport invalidates the flight coordinates; settle into its real slot immediately.
    window.addEventListener("resize", settle);
    motion.addEventListener("change", settle);
    return () => {
      window.removeEventListener("resize", settle);
      motion.removeEventListener("change", settle);
      context.revert();
    };
  }, []);
  return (
    <div ref={anchor} className="creation-generation-anchor" data-handover="passing">
      <div ref={scrim} className="creation-generation-scrim" aria-hidden="true" />
      <div ref={stage} className="creation-generation-actor">
        <CharacterHost stage="generating" initialStage={initialStage} />
      </div>
    </div>
  );
}
