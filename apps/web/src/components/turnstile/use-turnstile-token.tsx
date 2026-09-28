import { cn } from "@tj/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { env } from "@/env";
import { loadTurnstile, type TurnstileApi } from "./load-turnstile";

/** `unavailable`: the script did not load. `failed`: Cloudflare's challenge errored or timed out. */
export type TurnstileError = "unavailable" | "failed";

export interface TurnstileToken {
  /** False when no site key is configured (local dev): `getToken()` resolves `null`, no header. */
  readonly enabled: boolean;
  /**
   * The current token, waiting for the challenge when it has not finished yet. Tokens are single
   * use: the caller sends it once and then calls `reset()`, success or failure.
   */
  getToken(): Promise<string | null>;
  /** Discard the current token and start a fresh challenge. */
  reset(): void;
  readonly error: TurnstileError | null;
  /** Cloudflare is showing an interactive challenge; only then does the widget take space. */
  readonly interactive: boolean;
  /** Attach with `<TurnstileWidget turnstile={…} />`. */
  readonly containerRef: (element: HTMLDivElement | null) => void;
}

export interface UseTurnstileTokenOptions {
  /** Defaults to `VITE_TURNSTILE_SITE_KEY`. */
  siteKey?: string;
  /** Cloudflare's `action` label, visible in the Turnstile analytics. */
  action?: string;
  /** How long `getToken()` waits for the challenge before rejecting. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

interface Waiter {
  resolve: (token: string) => void;
  reject: (error: Error) => void;
}

/**
 * Cloudflare Turnstile for a form that calls a gated better-auth endpoint (TEACH-243). The widget
 * is managed and `interaction-only`: most visitors never see it, and the rare one Cloudflare wants
 * to check gets a checkbox where `<TurnstileWidget/>` sits. The challenge starts when the widget
 * mounts, so the token is usually ready before the submit.
 */
export function useTurnstileToken(options: UseTurnstileTokenOptions = {}): TurnstileToken {
  const siteKey = "siteKey" in options ? options.siteKey : env.VITE_TURNSTILE_SITE_KEY;
  const { action, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  const enabled = Boolean(siteKey);
  const [error, setErrorState] = useState<TurnstileError | null>(null);
  // Mirrors `error` for `getToken()`, which must not wait on a challenge that already failed.
  const failed = useRef<TurnstileError | null>(null);
  const setError = useCallback((value: TurnstileError | null) => {
    failed.current = value;
    setErrorState(value);
  }, []);

  const [interactive, setInteractive] = useState(false);
  const api = useRef<TurnstileApi | null>(null);
  const widgetId = useRef<string | undefined>(undefined);
  const element = useRef<HTMLDivElement | null>(null);
  const token = useRef<string | null>(null);
  const waiters = useRef<Waiter[]>([]);

  const settle = useCallback((outcome: { token: string } | { error: Error }) => {
    const pending = waiters.current;
    waiters.current = [];
    for (const waiter of pending) {
      if ("token" in outcome) waiter.resolve(outcome.token);
      else waiter.reject(outcome.error);
    }
  }, []);

  const mount = useCallback(
    (el: HTMLDivElement) => {
      if (!siteKey) return;
      loadTurnstile().then(
        (turnstile) => {
          // Unmounted, or already rendered into this element, while the script loaded.
          if (element.current !== el || widgetId.current !== undefined) return;
          api.current = turnstile;
          widgetId.current = turnstile.render(el, {
            sitekey: siteKey,
            ...(action ? { action } : {}),
            appearance: "interaction-only",
            "refresh-expired": "auto",
            theme: "light",
            callback: (value) => {
              token.current = value;
              setError(null);
              // A waiter consumes the token it is handed; single use.
              if (waiters.current.length > 0) {
                token.current = null;
                settle({ token: value });
              }
            },
            "error-callback": () => {
              token.current = null;
              setError("failed");
              settle({ error: new Error("turnstile challenge failed") });
              // Handled: Cloudflare retries on its own; the form shows the retry copy.
              return true;
            },
            "expired-callback": () => {
              token.current = null;
            },
            "timeout-callback": () => {
              token.current = null;
            },
            "before-interactive-callback": () => setInteractive(true),
            "after-interactive-callback": () => setInteractive(false),
          });
        },
        () => {
          setError("unavailable");
          settle({ error: new Error("turnstile unavailable") });
        },
      );
    },
    [siteKey, action, settle, setError],
  );

  const containerRef = useCallback(
    (el: HTMLDivElement | null) => {
      if (el === element.current) return;
      if (element.current && widgetId.current !== undefined) {
        api.current?.remove(widgetId.current);
        widgetId.current = undefined;
      }
      setInteractive(false);
      element.current = el;
      token.current = null;
      if (el) mount(el);
    },
    [mount],
  );

  useEffect(
    () => () => {
      settle({ error: new Error("turnstile unmounted") });
    },
    [settle],
  );

  const getToken = useCallback((): Promise<string | null> => {
    if (!enabled) return Promise.resolve(null);
    if (token.current) {
      const value = token.current;
      token.current = null;
      return Promise.resolve(value);
    }
    // The challenge already failed: say so now; the caller's `reset()` starts a fresh one.
    if (failed.current === "failed") return Promise.reject(new Error("turnstile challenge failed"));
    // The script failed to load earlier: try again rather than wait for a widget that never comes.
    if (widgetId.current === undefined && element.current) mount(element.current);
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        waiters.current = waiters.current.filter((w) => w !== waiter);
        setError("failed");
        reject(new Error("turnstile timed out"));
      }, timeoutMs);
      const waiter: Waiter = {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (reason) => {
          clearTimeout(timer);
          reject(reason);
        },
      };
      waiters.current.push(waiter);
    });
  }, [enabled, mount, timeoutMs, setError]);

  const reset = useCallback(() => {
    token.current = null;
    setError(null);
    if (widgetId.current !== undefined) api.current?.reset(widgetId.current);
  }, [setError]);

  return useMemo(
    () => ({ enabled, getToken, reset, error, interactive, containerRef }),
    [enabled, getToken, reset, error, interactive, containerRef],
  );
}

/**
 * Where the Turnstile checkbox appears when Cloudflare asks for one; out of the layout (no space,
 * no gap) the rest of the time. Renders nothing when Turnstile is off.
 */
export function TurnstileWidget({
  turnstile,
  className,
}: {
  turnstile: TurnstileToken;
  className?: string;
}) {
  if (!turnstile.enabled) return null;
  return (
    <div
      ref={turnstile.containerRef}
      data-turnstile=""
      // Out of the flow until Cloudflare shows a challenge: the empty frame Turnstile renders for an
      // invisible check must not add the form's gap or this margin. Kept rendered (not `hidden`) so
      // the invisible challenge still runs.
      className={cn(
        "[&_iframe]:max-w-full",
        turnstile.interactive ? className : "pointer-events-none absolute size-0 overflow-hidden",
      )}
    />
  );
}
