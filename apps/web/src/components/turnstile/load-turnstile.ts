/**
 * Cloudflare Turnstile's browser API (TEACH-243), loaded on first use and never app-wide: only a
 * page that renders `<TurnstileWidget/>` pulls the script in. The api verifies the token through
 * better-auth's captcha plugin (`apps/api/src/auth/captcha.ts`).
 */

export const TURNSTILE_SCRIPT_URL =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/** The request header the api's captcha plugin reads. */
export const CAPTCHA_HEADER = "x-captcha-response";

/** The subset of `window.turnstile` this app uses. */
export interface TurnstileApi {
  render(container: HTMLElement, options: TurnstileRenderOptions): string | undefined;
  reset(widgetId?: string): void;
  remove(widgetId?: string): void;
  getResponse(widgetId?: string): string | undefined;
}

export interface TurnstileRenderOptions {
  sitekey: string;
  callback?: (token: string) => void;
  "error-callback"?: (code: string) => boolean | undefined;
  "expired-callback"?: () => void;
  "timeout-callback"?: () => void;
  /** The widget is about to show an interactive challenge (a checkbox), and leaves it again. */
  "before-interactive-callback"?: () => void;
  "after-interactive-callback"?: () => void;
  appearance?: "always" | "execute" | "interaction-only";
  "refresh-expired"?: "auto" | "manual" | "never";
  theme?: "auto" | "light" | "dark";
  size?: "normal" | "flexible" | "compact";
  action?: string;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loading: Promise<TurnstileApi> | null = null;

/** Inject the script once; later calls share the same promise. A failed load can be retried. */
export function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (loading) return loading;
  loading = new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = TURNSTILE_SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (window.turnstile) resolve(window.turnstile);
      else reject(new Error("turnstile script loaded without window.turnstile"));
    };
    script.onerror = () => reject(new Error("turnstile script failed to load"));
    document.head.appendChild(script);
  }).catch((error: unknown) => {
    loading = null;
    throw error;
  });
  return loading;
}

/** Headers for a better-auth call: the token when there is one, nothing when Turnstile is off. */
export function captchaHeaders(token: string | null): Record<string, string> {
  return token ? { [CAPTCHA_HEADER]: token } : {};
}

/**
 * better-auth's captcha plugin answers 400 `MISSING_RESPONSE` or 403 `VERIFICATION_FAILED`; the
 * caller resets the widget and offers a retry. Anything else is not a captcha failure.
 */
export function isCaptchaError(error: { status?: number; code?: string } | null | undefined) {
  return error?.code === "MISSING_RESPONSE" || error?.code === "VERIFICATION_FAILED";
}

/** Test seam: forget the cached loader. */
export function resetTurnstileLoaderForTests() {
  loading = null;
}
