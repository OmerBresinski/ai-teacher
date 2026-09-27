import { getRouteApi } from "@tanstack/react-router";
import { Button, cn, Display, Input, Label, Separator } from "@tj/ui";
import { CircleAlert, MailCheck } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { DaybackMark } from "@/components/brand/dayback-mark";
import { PlanCharacter } from "@/components/brand/plan-character";
import { GoogleLogo } from "@/components/google-logo";
import { authClient } from "@/lib/auth";
import { sanitiseRedirectPath } from "@/lib/auth-redirect";
import { sessionBoundary } from "@/lib/session-boundary";

const route = getRouteApi("/sign-in");

export function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Where better-auth sends the browser after the magic link is verified or Google signs the teacher
 * in. Same-origin paths only; a stale `?error=…` from a previous failed attempt is dropped
 * (TEACH-68).
 */
export function callbackUrl(origin: string, redirect: string | undefined): string {
  return origin + sanitiseRedirectPath(redirect);
}

/**
 * Where better-auth sends the browser when verification or the Google round trip fails. It appends
 * `error=<code>` itself, so we point it back at `/sign-in` and keep `redirect` so the teacher can
 * retry to the same place.
 */
export function errorCallbackUrl(origin: string, redirect: string | undefined): string {
  const url = new URL("/sign-in", origin);
  url.searchParams.set("redirect", sanitiseRedirectPath(redirect));
  return url.toString();
}

const GOOGLE_INTERRUPTED = "Your Google sign-in took too long or was interrupted. Try again.";

/**
 * Human copy for the `?error=<code>` better-auth appends to our `errorCallbackURL`; the raw code is
 * never shown. The magic-link plugin (better-auth 1.7) only emits `INVALID_TOKEN`, for both used and
 * expired tokens. The Google round trip passes Google's own `access_denied` through, and reports
 * `account_not_linked` and the three state-check failures itself (ADR 0008 amendment, item 6).
 * A `Map`, not an object literal, so `?error=constructor` cannot reach `Object.prototype`.
 */
const SIGN_IN_ERRORS = new Map([
  ["INVALID_TOKEN", "That sign-in link has expired or was already used. Request a new one below."],
  ["access_denied", "Google sign-in was cancelled. Try again, or use the email link below."],
  [
    "account_not_linked",
    "We could not match that Google account to your account. Use the email link below.",
  ],
  ["state_mismatch", GOOGLE_INTERRUPTED],
  ["state_not_found", GOOGLE_INTERRUPTED],
  ["please_restart_the_process", GOOGLE_INTERRUPTED],
]);

export function signInErrorMessage(code: string): string {
  return SIGN_IN_ERRORS.get(code) ?? "We could not sign you in. Request a new link below.";
}

type GoogleStartError = "not-set-up" | "unreachable";

const GOOGLE_START_ERRORS: Record<GoogleStartError, string> = {
  "not-set-up": "Google sign-in is not set up here. Use the email link below.",
  unreachable: "We could not reach Google. Try again, or use the email link below.",
};

/** Why "Continue with Google" could not start; the api answers 404 when it has no credentials. */
export function googleStartError(error: { status?: number; code?: string }): GoogleStartError {
  return error.status === 404 || error.code === "PROVIDER_NOT_FOUND" ? "not-set-up" : "unreachable";
}

const SEND_ERROR = "We could not send the link. Please check the address and try again.";

type Status =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent"; email: string }
  | { kind: "error" };

/** "Continue with Google" has its own status: it never shares a state with the magic link. */
type GoogleStatus = "idle" | "opening" | GoogleStartError;

export function SignInPage() {
  const { notice } = useSyncExternalStore(sessionBoundary.subscribe, sessionBoundary.getSnapshot);
  const { redirect, error: errorCode } = route.useSearch();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [google, setGoogle] = useState<GoogleStatus>("idle");
  const emailField = useRef<HTMLInputElement>(null);

  // Back from Google's page can restore this page from the back/forward cache with the button
  // still "Opening Google…"; a restored page starts over.
  useEffect(() => {
    function onPageShow(event: PageTransitionEvent) {
      if (event.persisted) setGoogle("idle");
    }
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  async function onContinueWithGoogle() {
    setGoogle("opening");
    setStatus((current) => (current.kind === "error" ? { kind: "idle" } : current));
    try {
      // On success better-auth's redirect plugin sets `window.location.href` to Google itself, so
      // the button stays disabled until the page unloads.
      const { error } = await authClient.signIn.social({
        provider: "google",
        callbackURL: callbackUrl(window.location.origin, redirect),
        errorCallbackURL: errorCallbackUrl(window.location.origin, redirect),
      });
      if (error) setGoogle(googleStartError(error));
    } catch {
      // better-fetch rethrows a network failure instead of resolving with `error`.
      setGoogle("unreachable");
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const address = normaliseEmail(email);
    if (!address) return;
    setStatus({ kind: "sending" });
    setGoogle((current) => (current === "opening" ? current : "idle"));
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

  const googleError =
    google === "idle" || google === "opening" ? null : GOOGLE_START_ERRORS[google];
  // Only one way in at a time: while one request is in flight the other control is disabled, so a
  // Google redirect cannot fire in the middle of sending a link (or the other way round).
  const sending = status.kind === "sending";
  const opening = google === "opening";
  // One alert on screen (TEACH-252), in one slot above the Google button: the sign-out notice wins
  // (it renders on its own, with its Retry button), then the send error, then the Google start
  // error, then the `?error=` a failed round trip came back with. The handlers clear each other's
  // failures, so the newest one wins between the last three. Once a link is sent only the notice
  // can show.
  const alertMessage =
    status.kind === "sent"
      ? null
      : status.kind === "error"
        ? SEND_ERROR
        : (googleError ?? (errorCode ? signInErrorMessage(errorCode) : null));

  return (
    <main className="relative isolate flex min-h-svh flex-col overflow-x-clip bg-background">
      {PAPER_GLOW}
      <div className={cn(GRID_WIDTH, "pt-5 lg:pt-8")}>{LOCKUP}</div>
      <div
        className={cn(
          GRID_WIDTH,
          "grid flex-1 content-center items-center gap-8 pt-6 pb-8 lg:grid-cols-[minmax(0,1fr)_460px] lg:gap-16 lg:py-10",
        )}
      >
        <div className="flex w-full max-w-[460px] flex-col gap-5 justify-self-center lg:col-start-2 lg:row-start-1">
          <div className="relative isolate">
            {PAPER_SHEET}
            <div className="flex flex-col gap-6 rounded-card border border-border bg-card p-6 shadow-2 sm:p-8">
              <div className="flex flex-col gap-2">
                <Display as="h1" size="xl">
                  Welcome to DayBack
                </Display>
                <p className="text-body text-ink-2">
                  Continue with Google, or we will email you a link. No password needed.
                </p>
                <p className="text-body text-ink-2">
                  New to DayBack? The same steps create your account.
                </p>
              </div>
              {notice ? (
                <div className={cn(ALERT_BOX, "flex-col items-start")}>
                  <div className="flex gap-2.5">
                    {ALERT_ICON}
                    <p role="alert">{notice}</p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void sessionBoundary.signOut(() => authClient.signOut())}
                  >
                    Retry sign out
                  </Button>
                </div>
              ) : alertMessage ? (
                <div className={ALERT_BOX}>
                  {ALERT_ICON}
                  <p role="alert">{alertMessage}</p>
                </div>
              ) : null}
              {status.kind === "sent" ? (
                <div className="flex flex-col items-start gap-4">
                  {SENT_BADGE}
                  <div role="status" className="flex flex-col gap-1">
                    <p className="text-title font-semibold text-foreground">Check your inbox</p>
                    <p className="text-body text-ink-2">
                      We sent a sign-in link to{" "}
                      <strong className="font-semibold break-words text-foreground">
                        {status.email}
                      </strong>
                      . It works once and expires in 5 minutes.
                    </p>
                  </div>
                  {DEV_HINT}
                  <Button variant="ghost" className="-ml-4" onClick={onUseDifferentEmail}>
                    Use a different email
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col gap-5">
                  <Button
                    type="button"
                    variant="default"
                    className="w-full"
                    disabled={opening || sending}
                    onClick={() => void onContinueWithGoogle()}
                  >
                    <GoogleLogo />
                    {opening ? "Opening Google…" : "Continue with Google"}
                  </Button>
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
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                      />
                      <Button
                        variant="primary"
                        type="submit"
                        className="sm:min-w-38"
                        disabled={sending || opening}
                      >
                        {sending ? "Sending…" : "Email me a link"}
                      </Button>
                    </div>
                  </form>
                </div>
              )}
            </div>
          </div>
          {LEGAL}
        </div>
        {TAGLINE_PANEL}
      </div>
    </main>
  );
}

/** One grid for the page, the homepage's: 1200px on a gutter of clamp(22px, 6vw, 48px). */
const GRID_WIDTH = "mx-auto w-full max-w-[1296px] px-4 sm:px-[clamp(22px,6vw,48px)]";

const ALERT_BOX =
  "flex gap-2.5 rounded-control border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-body text-foreground";

// Static JSX hoisted so a state change never rebuilds it (rendering-hoist-jsx).
const ALERT_ICON = (
  <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />
);

/** The homepage hero's paper glow (homepage/assets/hero.css `.hm-hero-band`), on tokens. */
const PAPER_GLOW = (
  <div
    aria-hidden="true"
    className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_60%_50%,var(--card)_0,transparent_65%)]"
  />
);

/** A sage sheet under the card, the homepage's tilted papers (homepage/assets/proof.css). */
const PAPER_SHEET = (
  <div
    aria-hidden="true"
    className="absolute inset-0 -z-10 hidden translate-x-3 translate-y-2 rotate-[2.5deg] rounded-card border border-brand-tint-line bg-brand-tint sm:block"
  />
);

/** The brand lockup: not a link, so it adds no tab stop before the email field. */
const LOCKUP = (
  <Display as="span" size="md" className="inline-flex items-center gap-[0.2em] whitespace-nowrap">
    <span className="inline-flex origin-[50%_52%] motion-safe:animate-dayback-rewind">
      <DaybackMark />
    </span>
    DayBack
  </Display>
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
  <p className="text-center text-meta text-ink-3">
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
 * The one tagline (homepage/DESIGN-SYSTEM.md) and Plan. From `lg` it is the left column; below it,
 * where the character is hidden, the tagline follows the form. It comes after the form in the DOM,
 * so a screen reader meets the heading and the form first.
 */
const TAGLINE_PANEL = (
  <div className="flex flex-col items-center gap-8 lg:col-start-1 lg:row-start-1 lg:items-start lg:justify-between lg:self-stretch lg:py-4">
    <p className="text-center text-[22px] leading-7 font-semibold tracking-[-0.03em] text-foreground lg:text-left lg:text-[clamp(2.5rem,3.5vw,3.25rem)] lg:leading-[1.04] lg:font-[750]">
      <span className="block">Outstanding lessons.</span>
      <span className="block text-ink-2">Without losing your evening.</span>
    </p>
    <div className="relative hidden lg:-mr-16 lg:block lg:self-end">
      <div
        aria-hidden="true"
        className="absolute inset-x-4 bottom-0 h-6 bg-[radial-gradient(closest-side,var(--scrim),transparent)] opacity-60"
      />
      <PlanCharacter className="relative" />
    </div>
  </div>
);
