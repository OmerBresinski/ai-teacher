import { getRouteApi } from "@tanstack/react-router";
import { Button, cn, Input, Label, Separator } from "@tj/ui";
import { CircleAlert, MailCheck } from "lucide-react";
import {
  type FormEvent,
  type MouseEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { flushSync } from "react-dom";
import { type CastMood, type CastTargets, SignInCast } from "@/components/brand/sign-in-cast";
import { PAPER_GLOW, SIGN_IN_LOCKUP } from "@/components/brand/sign-in-chrome";
import { GoogleLogo } from "@/components/google-logo";
import { MicrosoftLogo } from "@/components/microsoft-logo";
import { useContentHeight } from "@/hooks/use-content-height";
import { authClient } from "@/lib/auth";
import { fetchAuthProviders } from "@/lib/auth-providers";
import { callbackUrl, errorCallbackUrl } from "@/lib/auth-redirect";
import { sessionBoundary } from "@/lib/session-boundary";

const route = getRouteApi("/sign-in");

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

type Status =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent"; email: string }
  | { kind: "error" };

/**
 * "Continue with Google" / "… Microsoft" have their own status: it never shares a state with the
 * magic link. `null` is idle; only one provider can be opening or failed at a time.
 */
type SocialStatus = { provider: SocialProvider; state: "opening" | SocialStartError } | null;

export function SignInPage() {
  const { notice } = useSyncExternalStore(sessionBoundary.subscribe, sessionBoundary.getSnapshot);
  const { redirect, error: errorCode, via } = route.useSearch();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [social, setSocial] = useState<SocialStatus>(null);
  // Microsoft shows only once the api says it has credentials (TEACH-206); Google always shows
  // (ADR 0008 amendment of 2026-09-27, item 6).
  const [microsoftOn, setMicrosoftOn] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);
  const emailField = useRef<HTMLInputElement>(null);
  const [cardBody, cardSize] = useContentHeight<HTMLDivElement>();
  // The provider button pressed last, which the cast watches as the teacher leaves for it.
  const leavingButton = useRef<HTMLElement | null>(null);
  const submitButton = useRef<HTMLButtonElement>(null);
  const alertBox = useRef<HTMLDivElement>(null);
  const sentMessage = useRef<HTMLDivElement>(null);
  // What the characters look at in each mood (`sign-in-cast.tsx`). Refs are stable, so is this.
  const castTargets = useMemo<CastTargets>(
    () => ({
      typing: emailField,
      sending: submitButton,
      sent: sentMessage,
      error: alertBox,
      leaving: leavingButton,
    }),
    [],
  );

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
    leavingButton.current = event.currentTarget;
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
    try {
      const { error } = await authClient.signIn.magicLink({
        email: address,
        callbackURL: callbackUrl(window.location.origin, redirect),
        errorCallbackURL: errorCallbackUrl(window.location.origin, redirect),
      });
      setStatus(error ? { kind: "error" } : { kind: "sent", email: address });
    } catch {
      // A network failure rejects instead of resolving with `error`. Left in "sending", the page
      // would disable both ways in for good.
      setStatus({ kind: "error" });
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

  const castMood: CastMood =
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

  return (
    <main className="relative isolate flex min-h-svh flex-col overflow-x-clip bg-background">
      {PAPER_GLOW}
      <div className="mx-auto w-full max-w-[1296px] px-4 pt-5 sm:px-[clamp(22px,6vw,48px)] lg:pt-8">
        {SIGN_IN_LOCKUP}
      </div>
      <div className="flex flex-1 flex-col items-center justify-center px-4 pt-6 pb-10 sm:px-6">
        {HEADLINE}
        <div className="relative mt-24 w-full max-w-[520px] sm:mt-32">
          <SignInCast mood={castMood} targets={castTargets} />
          {/* The card eases to each new height (form, sent, an alert) instead of jumping to it; a
              resize or rotation that reflows it follows at once. */}
          <div
            data-sign-in-card=""
            className={cn(
              "relative z-10 box-content overflow-hidden rounded-card border border-border bg-card shadow-2",
              !cardSize?.reflowed &&
                "motion-safe:transition-[height] motion-safe:duration-500 motion-safe:ease-out-expo",
            )}
            style={cardSize ? { height: cardSize.height } : undefined}
          >
            <div ref={cardBody} className="flex flex-col gap-5 p-5 sm:p-7">
              {alertMessage ? (
                <div
                  ref={alertBox}
                  className="flex flex-col items-start gap-2.5 rounded-control border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-body text-foreground"
                >
                  <div className="flex gap-2.5">
                    {ALERT_ICON}
                    <p role="alert">{alertMessage}</p>
                  </div>
                  {notice ? (
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void sessionBoundary.signOut(() => authClient.signOut())}
                    >
                      Retry sign out
                    </Button>
                  ) : null}
                </div>
              ) : null}
              {status.kind === "sent" ? (
                <div ref={sentMessage} className="flex flex-col items-start gap-4">
                  {SENT_BADGE}
                  <div role="status" className="flex flex-col gap-1">
                    <p className="text-title font-semibold text-foreground">Check your inbox</p>
                    <p className="text-body text-ink-2">
                      We sent a sign-in link to{" "}
                      <strong className="font-semibold break-words text-foreground">
                        {status.email}
                      </strong>
                      . It works once and expires in 15 minutes.
                    </p>
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
                    {opening && social?.provider === "google"
                      ? "Opening Google…"
                      : "Continue with Google"}
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
                        ref={submitButton}
                        variant="primary"
                        type="submit"
                        className="h-12 cursor-pointer sm:min-w-40"
                        disabled={sending || opening}
                      >
                        {sending ? "Sending…" : "Email me a link"}
                      </Button>
                    </div>
                  </form>
                </>
              )}
            </div>
          </div>
        </div>
        {TAGLINE}
        {LEGAL}
      </div>
    </main>
  );
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
  if (status.kind === "error") return SEND_ERROR;
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

const LEGAL_LINK =
  "rounded-chip text-foreground underline underline-offset-4 outline-none hover:decoration-2 focus-visible:shadow-focus";

/** The homepage's legal pages, served under /homepage/ by the same Vercel project. */
const LEGAL = (
  <p className="mt-3 max-w-[22rem] text-center text-meta text-ink-3 sm:max-w-none">
    By continuing you agree to the{" "}
    <a href="/homepage/terms/" className={LEGAL_LINK}>
      Terms
    </a>{" "}
    and have read the{" "}
    <a href="/homepage/privacy/" className={LEGAL_LINK}>
      Privacy notice
    </a>
    .
  </p>
);

/**
 * The page's one heading, set like the homepage hero's (homepage/assets/hero.css `.hm-hero-intro
 * h1`): the UI face at 750, tight tracking, centred over the card and its cast.
 */
const HEADLINE = (
  <h1 className="max-w-[11ch] text-center text-[clamp(2.5rem,5.4vw,4.25rem)] leading-[1.02] font-[750] tracking-[-0.042em] text-balance text-foreground sm:max-w-none">
    Welcome to DayBack
  </h1>
);

/** The one tagline (homepage/DESIGN-SYSTEM.md), where the homepage hero puts its grounded line. */
const TAGLINE = (
  <p className="mt-10 max-w-[20rem] text-center text-lead text-ink-2 sm:max-w-none lg:mt-12 lg:text-[22px] lg:leading-8">
    Outstanding lessons. Without losing your evening.
  </p>
);
