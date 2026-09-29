import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { loadGsap } from "@/lib/gsap";
import { CHARACTER_ENTRY_SECONDS, type CharacterOrigin } from "./character-origin";
import { GenerationStory } from "./generation-story";

/** Long enough for the worksheet-to-slides pass to read before the stage clears. */
const CENTRE_MIN_SECONDS = 1.15;

/** A persistent stage follows real editor slots across the generating→editable transition. */
export function GenerationCompanion({
  destination,
  origin,
  includedWorksheet,
  progress,
  ready,
  checking,
  statusText,
  skipIntro = false,
  paused,
  hold = false,
  onExited,
}: {
  destination: HTMLElement | null;
  origin: CharacterOrigin | null;
  includedWorksheet: boolean;
  progress: number;
  ready: boolean;
  checking?: boolean;
  statusText?: string;
  skipIntro?: boolean;
  paused: boolean;
  /** Keep the finished character in its slot until released (the teacher's first input). */
  hold?: boolean;
  onExited: () => void;
}) {
  const [gsap, setGsap] = useState<Awaited<ReturnType<typeof loadGsap>> | null>(null);
  const [rigModule, setRigModule] = useState<typeof import("./motion/handover-rig.js") | null>(
    null,
  );
  useEffect(() => {
    let cancelled = false;
    // Motion is lazy: the editor never waits for the characters' chunk.
    void Promise.all([loadGsap(), import("./motion/handover-rig.js")])
      .then(([runtime, module]) => {
        if (cancelled) return;
        setRigModule(module);
        setGsap(runtime);
      })
      .catch(() => {
        /* The editor remains usable without decorative motion. */
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const stage = useRef<HTMLDivElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  const finishing = useRef(false);
  const centred = useRef(false);
  const releaseWhenReady = useRef<() => void>(() => undefined);
  // Anything to look at (a slide, a finished or stopped job) ends the centre-stage hold.
  const hasContent = progress > 0 || ready || paused;
  const latest = useRef(hasContent);
  latest.current = hasContent;
  useEffect(() => {
    if (hasContent) releaseWhenReady.current();
  }, [hasContent]);
  const flight = useRef<ReturnType<Awaited<ReturnType<typeof loadGsap>>["timeline"]> | null>(null);
  const exit = useRef<ReturnType<Awaited<ReturnType<typeof loadGsap>>["to"]> | null>(null);
  const slotRef = useRef(destination);
  slotRef.current = destination;
  useLayoutEffect(() => {
    const actor = stage.current;
    if (!actor || !destination || !gsap) return;
    gsap.set(actor, { autoAlpha: 1 });
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    // A scroll or resize keeps a settled character on its slot. Mid-flight, the flight is not cut:
    // it lands where it was going and then eases onto the slot's new place.
    const place = () => {
      if (reduced.matches) {
        flight.current?.kill();
        centred.current = false;
        gsap.set(scrim.current, { autoAlpha: 0 });
        actor.dataset.handover = "settled";
      } else if (actor.dataset.handover !== "settled" || flight.current?.isActive()) return;
      const box = destination.getBoundingClientRect();
      gsap.set(actor, { x: box.left, y: box.top, width: box.width, height: box.height, scale: 1 });
    };
    const reseat = () => {
      // The slot may have been replaced while the character was in the air.
      const slot = (slotRef.current ?? destination).getBoundingClientRect();
      const now = actor.getBoundingClientRect();
      if (Math.abs(slot.left - now.left) < 0.5 && Math.abs(slot.top - now.top) < 0.5) return;
      flight.current = gsap.timeline().to(actor, {
        x: slot.left,
        y: slot.top,
        width: slot.width,
        height: slot.height,
        scale: 1,
        duration: 0.4,
        ease: "sine.inOut",
      });
    };
    const box = destination.getBoundingClientRect();
    if (first.current && !reduced.matches && !skipIntro) {
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
      // Centre stage only covers time with nothing to show. The characters step aside when the
      // first slide lands (after a short beat so the pass reads), never on a fixed clock.
      flight.current = gsap.timeline();
      if (origin) flight.current.to(actor, { ...centre, duration: travel, ease: "sine.inOut" }, 0);
      flight.current.call(
        () => {
          centred.current = true;
          releaseWhenReady.current();
        },
        [],
        travel + CENTRE_MIN_SECONDS,
      );
      releaseWhenReady.current = () => {
        if (!centred.current || !latest.current) return;
        centred.current = false;
        const slot = (slotRef.current ?? destination).getBoundingClientRect();
        actor.dataset.handover = "settling";
        // The character crouches and leaps with the flight when it is free to (not mid-pass).
        const leap = new CustomEvent("cast:leap", { detail: { flight: 0.65, accepted: false } });
        actor.dispatchEvent(leap);
        flight.current = gsap
          .timeline({
            onComplete: () => {
              actor.dataset.handover = "settled";
              reseat();
            },
          })
          // The scrim clears at once; only the flight waits out the 130 ms crouch.
          .to(
            actor,
            {
              x: slot.left,
              y: slot.top,
              scale: 1,
              duration: 0.65,
              ease: "sine.inOut",
            },
            leap.detail.accepted ? 0.13 : 0,
          )
          .to(scrim.current, { autoAlpha: 0, duration: 0.45, ease: "power1.out" }, 0);
      };
    } else {
      const immediate = first.current || reduced.matches;
      first.current = false;
      // A flight in the air is never cut: it lands, then eases onto this slot (its onComplete).
      const flying = !immediate && flight.current?.isActive();
      if (!flying) {
        // A new slot (the editor replacing the generating shell) supersedes any pending release.
        centred.current = false;
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
          duration: immediate ? 0 : 0.45,
          ease: "sine.inOut",
        });
      }
    }
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    reduced.addEventListener("change", place);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      reduced.removeEventListener("change", place);
    };
  }, [destination, origin, skipIntro, gsap]);
  useLayoutEffect(
    () => () => {
      flight.current?.kill();
      exit.current?.kill();
      first.current = true;
      finishing.current = false;
    },
    [],
  );
  const held = useRef(false);
  const holding = useRef(hold);
  holding.current = hold;
  const finish = () => {
    if (holding.current) {
      held.current = true;
      return;
    }
    if (finishing.current || !gsap) return;
    finishing.current = true;
    flight.current?.kill();
    // The character walks out of the slot; it is never faded. Without motion it simply goes.
    const leave = new CustomEvent("cast:leave", {
      detail: { done: () => onExited(), accepted: false },
    });
    stage.current?.dispatchEvent(leave);
    if (!leave.detail.accepted) onExited();
  };
  useEffect(() => {
    if (!hold && held.current) {
      held.current = false;
      finish();
    }
  });
  return (
    <div className="creation-generation-layer" aria-hidden="true">
      <div ref={scrim} className="creation-generation-scrim" />
      <div ref={stage} className="creation-generation-actor" data-handover="passing">
        {gsap && rigModule ? (
          <GenerationStory
            gsap={gsap}
            rigModule={rigModule}
            includedWorksheet={includedWorksheet}
            origin={origin}
            progress={progress}
            ready={ready}
            checking={checking}
            skipIntro={skipIntro}
            paused={paused}
            onFinished={finish}
          />
        ) : null}
        <p className="creation-generation-status">
          {statusText ??
            (paused ? "Generation stopped" : ready ? "Slides ready" : "Making your slides…")}
        </p>
      </div>
    </div>
  );
}
