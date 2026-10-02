import { Button, Input, Label, Separator } from "@tj/ui";
import { CircleAlert, MailCheck } from "lucide-react";
import {
  type FormEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import type { CastMood } from "@/components/brand/sign-in-cast";
import { GoogleLogo } from "@/components/google-logo";
import { MicrosoftLogo } from "@/components/microsoft-logo";
import {
  captchaHeaders,
  isCaptchaError,
  TurnstileWidget,
  useTurnstileToken,
} from "@/components/turnstile";
import { authClient } from "@/lib/auth";
import { fetchAuthProviders } from "@/lib/auth-providers";
import { callbackUrl, errorCallbackUrl } from "@/lib/auth-redirect";

export function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Human copy for the `?error=<code>` better-auth appends to our `errorCallbackURL`; the raw code is
 * never shown. The magic-link plugin (better-auth 1.7) only emits `INVALID_TOKEN`, for both used and
 * expired tokens. A provider round trip passes the provider's own `access_denied` through, and
 * better-auth reports `account_not_linked` and the three state-check failures itself (ADR 0008
 * amendment, item 6). `unable_to_get_user_info` is how the api refuses a Microsoft email Microsoft
 * does not vouch for, and `consent_required` comes from a school tenant that lets only its
 * administrators approve apps (amendment of 2026-09-28). The round trip is Google's unless the
 * error callback said `via=microsoft` (TEACH-206).
 * A `Map`, not an object literal, so `?error=constructor` cannot reach `Object.prototype`.
 */
function signInErrors(name: string): Map<string, string> {
  const interrupted = `Your ${name} sign-in took too long or was interrupted. Try again.`;
  return new Map([
    [
      "INVALID_TOKEN",
      "That sign-in link has expired or was already used. Request a new one below.",
    ],
    ["access_denied", `${name} sign-in was cancelled. Try again, or use the email link below.`],
    [
      "account_not_linked",
      `We could not match that ${name} account to your account. Use the email link below.`,
    ],
    [
      "unable_to_get_user_info",
      `${name} could not confirm the email address on that account. Use the email link below.`,
    ],
    [
      "consent_required",
      `Your school needs an administrator to approve DayBack for ${name} sign-in. Use the email link below.`,
    ],
    ["state_mismatch", interrupted],
    ["state_not_found", interrupted],
    ["please_restart_the_process", interrupted],
  ]);
}

const SIGN_IN_ERRORS = { google: signInErrors("Google"), microsoft: signInErrors("Microsoft") };

export function signInErrorMessage(code: string, via?: "microsoft"): string {
  return (
    SIGN_IN_ERRORS[via ?? "google"].get(code) ??
    "We could not sign you in. Request a new link below."
  );
}

type SocialProvider = "google" | "microsoft";
type SocialStartError = "not-set-up" | "unreachable";

const PROVIDER_NAME: Record<SocialProvider, string> = { google: "Google", microsoft: "Microsoft" };

function socialStartMessage(provider: SocialProvider, error: SocialStartError): string {
  const name = PROVIDER_NAME[provider];
  return error === "not-set-up"
    ? `${name} sign-in is not set up here. Use the email link below.`
    : `We could not reach ${name}. Try again, or use the email link below.`;
}

/** Why "Continue with …" could not start; the api answers 404 when it has no credentials. */
export function socialStartError(error: { status?: number; code?: string }): SocialStartError {
  return error.status === 404 || error.code === "PROVIDER_NOT_FOUND" ? "not-set-up" : "unreachable";
}

const SEND_ERROR = "We could not send the link. Please check the address and try again.";
/** Turnstile could not vouch for this browser (TEACH-243); a retry runs a fresh challenge. */
const CHECK_ERROR = "We could not finish a quick security check. Please try again.";

type Status =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent"; email: string }
  | { kind: "error"; reason: "send" | "check" };

/**
 * "Continue with Google" / "… Microsoft" have their own status: it never shares a state with the
 * magic link. `null` is idle; only one provider can be opening or failed at a time.
 */
type SocialStatus = { provider: SocialProvider; state: "opening" | SocialStartError } | null;

/**
 * The elements the sign-in page's cast looks at (`sign-in-cast.tsx`). The page owns the refs and
 * hands them in; the sheet passes none, and the form keeps its own for focus. `leaving` is set to
 * the provider button pressed last.
 */
export type SignInFormRefs = {
  email?: RefObject<HTMLInputElement | null>;
  submit?: RefObject<HTMLButtonElement | null>;
  leaving?: RefObject<HTMLElement | null>;
  alert?: RefObject<HTMLDivElement | null>;
  sent?: RefObject<HTMLDivElement | null>;
};

export type SignInFormProps = {
  /** Where the teacher lands after the link or a provider; sanitised to a same-origin path. */
  redirect: string | undefined;
  /** The `?error=` a failed round trip came back with, and its provider (the page only). */
  errorCode?: string;
  via?: "microsoft";
  /** The session boundary's sign-out notice, shown with its Retry button (the page only). */
  notice?: string | null;
  onRetrySignOut?: () => void;
  /** An extra line under "Check your inbox" (the sheet's "Open the link on this device…"). */
  sentNote?: ReactNode;
  /**
   * Wraps the form, given the mood the page's cast acts out (`/sign-in` draws its card and cast
   * here). Without it the form renders bare, as in the sheet.
   */
  frame?: (form: ReactNode, mood: CastMood) => ReactNode;
  refs?: SignInFormRefs;
};

/**
 * The sign-in form (TEACH-245, extracted from `/sign-in`): "Continue with Google" (and Microsoft
 * when the api has it), the email magic link, the sent state and the one alert. `/sign-in` renders
 * it inside its card with the cast; the lesson's `SignInSheet` renders it in a dialog. Both send
 * the same requests.
 */
export function SignInForm({
  redirect,
  errorCode,
  via,
  notice = null,
  onRetrySignOut,
  sentNote,
  frame,
  refs,
}: SignInFormProps) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [social, setSocial] = useState<SocialStatus>(null);
  // Microsoft shows only once the api says it has credentials (TEACH-206); Google always shows
  // (ADR 0008 amendment of 2026-09-27, item 6).
  const [microsoftOn, setMicrosoftOn] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);
  const turnstile = useTurnstileToken({ action: "magic-link" });
  const ownEmailField = useRef<HTMLInputElement>(null);
  const emailField = refs?.email ?? ownEmailField;

  useEffect(() => {
    let live = true;
    void fetchAuthProviders().then((providers) => {
      if (live) setMicrosoftOn(providers.microsoft);
    });
    return () => {
      live = false;
    };
  }, []);

  // Back from the provider's page can restore this page from the back/forward cache with the
  // button still "Opening Google…"; a restored page starts over.
  useEffect(() => {
    function onPageShow(event: PageTransitionEvent) {
      if (event.persisted) setSocial(null);
    }
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  async function onContinueWith(provider: SocialProvider, event: MouseEvent<HTMLButtonElement>) {
    if (refs?.leaving) refs.leaving.current = event.currentTarget;
    setSocial({ provider, state: "opening" });
    setStatus((current) => (current.kind === "error" ? { kind: "idle" } : current));
    try {
      // On success better-auth's redirect plugin sets `window.location.href` to the provider
      // itself, so the button stays disabled until the page unloads.
      const { error } = await authClient.signIn.social({
        provider,
        callbackURL: callbackUrl(window.location.origin, redirect),
        errorCallbackURL: errorCallbackUrl(
          window.location.origin,
          redirect,
          provider === "microsoft" ? "microsoft" : undefined,
        ),
      });
      if (error) setSocial({ provider, state: socialStartError(error) });
    } catch {
      // better-fetch rethrows a network failure instead of resolving with `error`.
      setSocial({ provider, state: "unreachable" });
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const address = normaliseEmail(email);
    if (!address) return;
    setStatus({ kind: "sending" });
    setSocial((current) => (current?.state === "opening" ? current : null));
    let token: string | null;
    try {
      token = await turnstile.getToken();
    } catch {
      turnstile.reset();
      setStatus({ kind: "error", reason: "check" });
      return;
    }
    try {
      const { error } = await authClient.signIn.magicLink({
        email: address,
        callbackURL: callbackUrl(window.location.origin, redirect),
        errorCallbackURL: errorCallbackUrl(window.location.origin, redirect),
        // Turnstile off (no site key): no header, and the api does not ask for one.
        ...(token ? { fetchOptions: { headers: captchaHeaders(token) } } : {}),
      });
      setStatus(
        error
          ? { kind: "error", reason: isCaptchaError(error) ? "check" : "send" }
          : { kind: "sent", email: address },
      );
    } catch {
      // A network failure rejects instead of resolving with `error`. Left in "sending", the page
      // would disable both ways in for good.
      setStatus({ kind: "error", reason: "send" });
    } finally {
      // Tokens are single use: the next attempt needs a fresh one, whatever happened.
      turnstile.reset();
    }
  }

  // "Use a different email" unmounts the button that had focus; the field it returns to takes it.
  function onUseDifferentEmail() {
    flushSync(() => setStatus({ kind: "idle" }));
    emailField.current?.focus();
  }

  const socialError =
    social && social.state !== "opening" ? socialStartMessage(social.provider, social.state) : null;
  // Only one way in at a time: while one request is in flight the other controls are disabled, so
  // a provider redirect cannot fire in the middle of sending a link (or the other way round).
  const sending = status.kind === "sending";
  const opening = social?.state === "opening";
  const alertMessage = oneAlert({ notice, status, socialError, errorCode, via });

  const mood: CastMood =
    status.kind === "sent"
      ? "sent"
      : alertMessage
        ? "error"
        : sending
          ? "sending"
          : opening
            ? "leaving"
            : emailFocused
              ? "typing"
              : "idle";

  const form = (
    <>
      {alertMessage ? (
        <div
          ref={refs?.alert}
          className="flex flex-col items-start gap-2.5 rounded-control border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-body text-foreground"
        >
          <div className="flex gap-2.5">
            {ALERT_ICON}
            <p role="alert">{alertMessage}</p>
          </div>
          {notice && onRetrySignOut ? (
            <Button type="button" size="sm" onClick={onRetrySignOut}>
              Retry sign out
            </Button>
          ) : null}
        </div>
      ) : null}
      {status.kind === "sent" ? (
        <div ref={refs?.sent} className="flex flex-col items-start gap-4">
          {SENT_BADGE}
          <div role="status" className="flex flex-col gap-1">
            <p className="text-title font-semibold text-foreground">Check your inbox</p>
            <p className="text-body text-ink-2">
              We sent a sign-in link to{" "}
              <strong className="font-semibold break-words text-foreground">{status.email}</strong>.
              It works once and expires in 15 minutes.
            </p>
            {sentNote ? <p className="text-body text-ink-2">{sentNote}</p> : null}
          </div>
          {DEV_HINT}
          <Button variant="ghost" className="-ml-4" onClick={onUseDifferentEmail}>
            Use a different email
          </Button>
        </div>
      ) : (
        <>
          <Button
            type="button"
            variant="default"
            className="h-12 w-full cursor-pointer"
            disabled={opening || sending}
            onClick={(event) => void onContinueWith("google", event)}
          >
            <GoogleLogo />
            {opening && social?.provider === "google" ? "Opening Google…" : "Continue with Google"}
          </Button>
          {microsoftOn ? (
            <Button
              type="button"
              variant="default"
              className="-mt-2 h-12 w-full cursor-pointer"
              disabled={opening || sending}
              onClick={(event) => void onContinueWith("microsoft", event)}
            >
              <MicrosoftLogo />
              {opening && social?.provider === "microsoft"
                ? "Opening Microsoft…"
                : "Continue with Microsoft"}
            </Button>
          ) : null}
          <div className="flex items-center gap-3">
            <Separator className="flex-1" />
            <span className="text-meta text-ink-3">or</span>
            <Separator className="flex-1" />
          </div>
          <form onSubmit={onSubmit} className="flex flex-col gap-2">
            <Label htmlFor="email">Email address</Label>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Input
                ref={emailField}
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                className="h-12"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onFocus={() => setEmailFocused(true)}
                onBlur={() => setEmailFocused(false)}
              />
              <Button
                ref={refs?.submit}
                variant="primary"
                type="submit"
                className="h-12 cursor-pointer sm:min-w-40"
                disabled={sending || opening}
              >
                {sending ? "Sending…" : "Email me a link"}
              </Button>
            </div>
            <TurnstileWidget turnstile={turnstile} className="mt-1" />
          </form>
        </>
      )}
    </>
  );
  return frame ? frame(form, mood) : form;
}

/**
 * The one alert on screen (TEACH-252), highest priority first: the sign-out notice (shown with its
 * Retry button), the send error, the provider start error, then the `?error=` a failed round trip
 * came back with. The handlers clear each other's failures, so the newest wins among the last three.
 * Once a link is sent only the notice can show.
 */
function oneAlert({
  notice,
  status,
  socialError,
  errorCode,
  via,
}: {
  notice: string | null;
  status: Status;
  socialError: string | null;
  errorCode: string | undefined;
  via: "microsoft" | undefined;
}): string | null {
  if (notice) return notice;
  if (status.kind === "sent") return null;
  if (status.kind === "error") return status.reason === "check" ? CHECK_ERROR : SEND_ERROR;
  return socialError ?? (errorCode ? signInErrorMessage(errorCode, via) : null);
}

// Static JSX hoisted so a state change never rebuilds it (rendering-hoist-jsx).
const ALERT_ICON = (
  <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />
);

const SENT_BADGE = (
  <span
    aria-hidden="true"
    className="grid size-12 place-items-center rounded-full bg-brand-tint text-foreground"
  >
    <MailCheck className="size-6" strokeWidth={1.5} />
  </span>
);

/** Only `vite dev` prints the link in the api console; a build must not say so (TEACH-252). */
const DEV_HINT = import.meta.env.DEV ? (
  <p className="text-meta text-ink-3">In development the link is printed in the api console.</p>
) : null;
