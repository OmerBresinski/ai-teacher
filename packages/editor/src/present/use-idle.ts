import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * Chrome that gets out of the way. Anything floating over the stage fades a
 * couple of seconds after the last pointer movement and comes back the moment
 * the teacher moves the mouse again (SPEC §8), so a slide is never permanently
 * covered.
 *
 * `held` is whatever the caller counts as "in use" — a panel open under it, the
 * pointer resting on it, a countdown still running. While it is true the piece
 * stays put and the timer does not run at all.
 */
export function useStageIdle(held: boolean, hideAfter = 2000): boolean {
  const [idle, setIdle] = useState(false);

  // Taking hold of a piece that had already faded clears the idle flag with it.
  // Without this the flag survives the hold, and the piece blinks straight back
  // out the moment the hold is released rather than getting its two seconds.
  if (held && idle) setIdle(false);

  useEffect(() => {
    if (held) return;
    let timer = window.setTimeout(() => setIdle(true), hideAfter);
    const wake = () => {
      setIdle(false);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setIdle(true), hideAfter);
    };
    window.addEventListener("pointermove", wake);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointermove", wake);
    };
  }, [held, hideAfter]);

  return held || !idle;
}

/**
 * "Is the pointer on this piece of chrome", for holding it open.
 *
 * A plain `onPointerLeave` is not enough: a menu or popover anchored to the
 * chrome portals out of it, and React still counts entering that panel as
 * entering the chrome. When the panel then unmounts under the pointer there is
 * no leave to match, and the pill would sit on the slide for the rest of the
 * lesson. The next movement anywhere that is neither this element nor an open
 * panel settles it.
 */
export function useStageHover() {
  const [hovering, setHovering] = useState(false);
  const el = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!hovering) return;
    const check = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (
        target &&
        (el.current?.contains(target) || target.closest('[role="dialog"], [role="menu"]'))
      )
        return;
      setHovering(false);
    };
    window.addEventListener("pointermove", check);
    return () => window.removeEventListener("pointermove", check);
  }, [hovering]);

  // The bind is spread onto a DOM node, so a new `ref` identity every render is
  // a detach and re-attach every render. It never has to change.
  const ref = useCallback((node: HTMLDivElement | null) => {
    el.current = node;
  }, []);

  const bind = useMemo(
    () => ({
      ref,
      onPointerEnter: () => setHovering(true),
      onPointerLeave: () => setHovering(false),
    }),
    [ref],
  );

  return { hovering, bind };
}
