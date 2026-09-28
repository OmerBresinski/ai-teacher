import { getRouteApi, Link } from "@tanstack/react-router";
import { Button } from "@tj/ui";
import { useEffect, useState } from "react";
import { PAPER_GLOW, SIGN_IN_LOCKUP } from "@/components/brand/sign-in-chrome";
import { env } from "@/env";
import {
  callbackUrl,
  errorCallbackUrl,
  pathOnOrigin,
  sanitiseRedirectPath,
} from "@/lib/auth-redirect";
import { resolveApiBaseUrl } from "@/lib/base-url";

const route = getRouteApi("/sign-in/confirm");

/**
 * The api verify URL the "Sign in" button opens (TEACH-246). Both callbacks go back through
 * `sanitiseRedirectPath` on this origin: one on another origin collapses to `/` (or to `/sign-in`
 * for the error callback) before better-auth's own origin check sees it.
 */
export function magicLinkVerifyUrl(
  apiBase: string,
  origin: string,
  query: { token: string; callbackURL?: string; errorCallbackURL?: string },
): string {
  const redirect = pathOnOrigin(query.callbackURL, origin);
  const errorPath = pathOnOrigin(query.errorCallbackURL, origin);
  const url = new URL(`${apiBase}/auth/magic-link/verify`);
  url.searchParams.set("token", query.token);
  url.searchParams.set("callbackURL", callbackUrl(origin, redirect));
  url.searchParams.set(
    "errorCallbackURL",
    errorPath ? origin + sanitiseRedirectPath(errorPath) : errorCallbackUrl(origin, redirect),
  );
  return url.toString();
}

/**
 * Where the magic-link email lands (TEACH-246). School mail scanners GET every link in an email;
 * this page makes no request on load and holds no link to the verify URL, so the token is spent
 * only when the teacher presses "Sign in", which opens the verify URL in this window so the session
 * cookie is set exactly as before. Works on any device: the token lives on the server.
 */
export function SignInConfirmPage() {
  const { token, callbackURL, errorCallbackURL } = route.useSearch();
  const [signingIn, setSigningIn] = useState(false);

  // Back from the api (or a failed navigation) can restore this page from the back/forward cache
  // with the button still "Signing in…"; a restored page starts over.
  useEffect(() => {
    function onPageShow(event: PageTransitionEvent) {
      if (event.persisted) setSigningIn(false);
    }
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  function onSignIn() {
    if (!token) return;
    const origin = window.location.origin;
    setSigningIn(true);
    window.location.assign(
      magicLinkVerifyUrl(resolveApiBaseUrl(env.VITE_API_URL, origin), origin, {
        token,
        callbackURL,
        errorCallbackURL,
      }),
    );
  }

  return (
    <main className="relative isolate flex min-h-svh flex-col overflow-x-clip bg-background">
      {PAPER_GLOW}
      <div className="mx-auto w-full max-w-[1296px] px-4 pt-5 sm:px-[clamp(22px,6vw,48px)] lg:pt-8">
        {SIGN_IN_LOCKUP}
      </div>
      <div className="flex flex-1 flex-col items-center justify-center px-4 pt-6 pb-16 sm:px-6">
        <h1 className="text-center text-[clamp(2.25rem,4.6vw,3.5rem)] leading-[1.05] font-[750] tracking-[-0.042em] text-balance text-foreground">
          Sign in to DayBack
        </h1>
        <div className="mt-10 w-full max-w-[440px] rounded-card border border-border bg-card p-5 shadow-2 sm:p-7">
          {token ? (
            <div className="flex flex-col gap-5">
              <p className="text-body text-ink-2">
                Press the button to finish signing in. Your link works once and lasts 15 minutes.
              </p>
              <Button
                type="button"
                variant="primary"
                className="h-12 w-full cursor-pointer"
                disabled={signingIn}
                onClick={onSignIn}
              >
                {signingIn ? "Signing in…" : "Sign in"}
              </Button>
            </div>
          ) : (
            <div className="flex flex-col items-start gap-4">
              <p role="alert" className="text-body text-foreground">
                This sign-in link is incomplete. Request a new one and open it from the email.
              </p>
              <Button asChild variant="primary" className="h-12">
                <Link to="/sign-in">Get a new link</Link>
              </Button>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
