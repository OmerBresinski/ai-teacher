import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

/**
 * Fullscreen with an honest fallback (SPEC §8, research/03 §6 and decision 5).
 *
 * Safari needs the `webkit` prefix, iPhone Safari has no element fullscreen at
 * all, and a request without a user gesture is rejected silently. So: try every
 * vendor spelling, and when none of them takes, raise a CSS "fake fullscreen"
 * flag instead — a fixed inset-0 stage that letterboxes exactly the same way.
 * The teacher never sees an error, because there is nothing they could do about it.
 */

type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
  mozRequestFullScreen?: () => Promise<void> | void;
  msRequestFullscreen?: () => Promise<void> | void;
};

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  mozFullScreenElement?: Element | null;
  msFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
  mozCancelFullScreen?: () => Promise<void> | void;
  msExitFullscreen?: () => Promise<void> | void;
  webkitFullscreenEnabled?: boolean;
  mozFullScreenEnabled?: boolean;
  msFullscreenEnabled?: boolean;
};

const CHANGE_EVENTS = [
  "fullscreenchange",
  "webkitfullscreenchange",
  "mozfullscreenchange",
  "MSFullscreenChange",
] as const;

function currentElement(): Element | null {
  if (typeof document === "undefined") return null;
  const d = document as FullscreenDocument;
  return (
    d.fullscreenElement ??
    d.webkitFullscreenElement ??
    d.mozFullScreenElement ??
    d.msFullscreenElement ??
    null
  );
}

function supported(): boolean {
  if (typeof document === "undefined") return false;
  const d = document as FullscreenDocument;
  const enabled =
    d.fullscreenEnabled ??
    d.webkitFullscreenEnabled ??
    d.mozFullScreenEnabled ??
    d.msFullscreenEnabled;
  if (enabled === false) return false;
  const el = document.documentElement as FullscreenElement;
  return !!(
    el.requestFullscreen ??
    el.webkitRequestFullscreen ??
    el.mozRequestFullScreen ??
    el.msRequestFullscreen
  );
}

async function request(): Promise<boolean> {
  const el = document.documentElement as FullscreenElement;
  const fn =
    el.requestFullscreen ??
    el.webkitRequestFullscreen ??
    el.mozRequestFullScreen ??
    el.msRequestFullscreen;
  if (!fn) return false;
  try {
    await fn.call(el);
    return !!currentElement();
  } catch {
    return false;
  }
}

async function release(): Promise<void> {
  if (!currentElement()) return;
  const d = document as FullscreenDocument;
  const fn =
    d.exitFullscreen ?? d.webkitExitFullscreen ?? d.mozCancelFullScreen ?? d.msExitFullscreen;
  if (!fn) return;
  try {
    await fn.call(document);
  } catch {
    /* Already exiting, or the browser declined. Nothing to tell the teacher. */
  }
}

export type FullscreenApi = {
  /** Real fullscreen is active. */
  isFullscreen: boolean;
  /** The CSS stand-in is active because the real thing was unavailable or refused. */
  isFake: boolean;
  /** Either kind — what the stage should style itself against. */
  active: boolean;
  isSupported: boolean;
  enter: () => Promise<void>;
  exit: () => Promise<void>;
  toggle: () => Promise<void>;
};

/** The browser is the source of truth here, so read it rather than mirror it. */
function subscribeFullscreen(onChange: () => void): () => void {
  for (const name of CHANGE_EVENTS) document.addEventListener(name, onChange);
  return () => {
    for (const name of CHANGE_EVENTS) document.removeEventListener(name, onChange);
  };
}

const NEVER = () => () => {};

export function useFullscreen(): FullscreenApi {
  const [isFake, setIsFake] = useState(false);
  const isFullscreen = useSyncExternalStore(
    subscribeFullscreen,
    () => !!currentElement(),
    () => false,
  );
  const isSupported = useSyncExternalStore(NEVER, supported, () => true);

  const enter = useCallback(async () => {
    if (currentElement()) return;
    const ok = supported() ? await request() : false;
    if (!ok) setIsFake(true);
  }, []);

  const exit = useCallback(async () => {
    setIsFake(false);
    await release();
  }, []);

  const toggle = useCallback(async () => {
    if (currentElement() || isFake) await exit();
    else await enter();
  }, [enter, exit, isFake]);

  return { isFullscreen, isFake, active: isFullscreen || isFake, isSupported, enter, exit, toggle };
}

/**
 * Keeps the projector awake while presenting. Guarded everywhere: the API is
 * Chromium-and-Safari-16.4-only and throws in an insecure context.
 */
export function useWakeLock(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    type Sentinel = { released: boolean; release: () => Promise<void> };
    const nav = navigator as Navigator & {
      wakeLock?: { request: (t: "screen") => Promise<Sentinel> };
    };
    if (!nav.wakeLock) return;

    let sentinel: Sentinel | null = null;
    let cancelled = false;

    const acquire = async () => {
      if (cancelled || document.visibilityState !== "visible") return;
      try {
        sentinel = (await nav.wakeLock?.request("screen")) ?? null;
      } catch {
        /* Denied or unsupported: presenting still works, the screen may dim. */
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible" && (!sentinel || sentinel.released))
        void acquire();
    };

    void acquire();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      void sentinel?.release().catch(() => {});
      sentinel = null;
    };
  }, [enabled]);
}

/** `prefers-reduced-motion: reduce`, live. Transitions collapse to a cut. */
const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void): () => void {
  const mq = window.matchMedia(REDUCED_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED_QUERY).matches,
    () => false,
  );
}
