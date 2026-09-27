import { getRouteApi } from "@tanstack/react-router";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Input,
  Separator,
} from "@tj/ui";
import { type FormEvent, useEffect, useState, useSyncExternalStore } from "react";
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

type Status = { kind: "idle" } | { kind: "sending" } | { kind: "sent" } | { kind: "error" };

/** "Continue with Google" has its own status: it never shares a state with the magic link. */
type GoogleStatus = "idle" | "opening" | GoogleStartError;

export function SignInPage() {
  const { notice } = useSyncExternalStore(sessionBoundary.subscribe, sessionBoundary.getSnapshot);
  const { redirect, error: errorCode } = route.useSearch();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [google, setGoogle] = useState<GoogleStatus>("idle");

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
      setStatus(error ? { kind: "error" } : { kind: "sent" });
    } catch {
      // A network failure rejects instead of resolving with `error`. Left in "sending", the page
      // would disable both ways in for good.
      setStatus({ kind: "error" });
    }
  }

  // One alert at a time (TEACH-31): the newest failure wins. The send error
  // keeps its place under the email field; the others share the slot above the Google button.
  const googleError =
    google === "idle" || google === "opening" ? null : GOOGLE_START_ERRORS[google];
  // Only one way in at a time: while one request is in flight the other control is disabled, so a
  // Google redirect cannot fire in the middle of sending a link (or the other way round).
  const sending = status.kind === "sending";
  const opening = google === "opening";
  const alertMessage =
    status.kind === "error"
      ? null
      : (googleError ?? (errorCode ? signInErrorMessage(errorCode) : null));

  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col justify-center p-6">
      <Card>
        <CardHeader>
          <CardTitle>Sign in to Teaching Journey</CardTitle>
          <CardDescription>
            Continue with Google, or we will email you a link. No password needed.
          </CardDescription>
        </CardHeader>
        {notice ? (
          <CardContent>
            <p role="alert" className="text-sm text-destructive">
              {notice}
            </p>
            <Button
              type="button"
              onClick={() => void sessionBoundary.signOut(() => authClient.signOut())}
            >
              Retry sign out
            </Button>
          </CardContent>
        ) : null}
        {status.kind === "sent" ? (
          <CardContent>
            <p role="status">Check your inbox (or the api console in development).</p>
          </CardContent>
        ) : (
          <>
            <CardContent className="flex flex-col gap-4">
              {alertMessage ? (
                <p role="alert" className="text-sm text-destructive">
                  {alertMessage}
                </p>
              ) : null}
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
                <span className="text-sm text-muted-foreground">or</span>
                <Separator className="flex-1" />
              </div>
            </CardContent>
            <form onSubmit={onSubmit}>
              <CardContent className="flex flex-col gap-2">
                <label htmlFor="email" className="text-sm font-medium">
                  Email address
                </label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                {status.kind === "error" ? (
                  <p role="alert" className="text-sm text-destructive">
                    We could not send the link. Please check the address and try again.
                  </p>
                ) : null}
              </CardContent>
              <CardFooter>
                <Button variant="primary" type="submit" disabled={sending || opening}>
                  {sending ? "Sending…" : "Email me a link"}
                </Button>
              </CardFooter>
            </form>
          </>
        )}
      </Card>
    </main>
  );
}
