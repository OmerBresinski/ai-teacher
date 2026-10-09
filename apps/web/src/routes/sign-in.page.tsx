import { getRouteApi } from "@tanstack/react-router";
import { cn } from "@tj/ui";
import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import { type CastMood, type CastTargets, SignInCast } from "@/components/brand/sign-in-cast";
import { PAPER_GLOW, SIGN_IN_LOCKUP } from "@/components/brand/sign-in-chrome";
import { SignInForm } from "@/components/sign-in/SignInForm";
import { useContentHeight } from "@/hooks/use-content-height";
import { authClient } from "@/lib/auth";
import { sessionBoundary } from "@/lib/session-boundary";

// The form moved to `SignInForm` (TEACH-245) so the lesson's sign-in sheet renders the same one.
export {
  normaliseEmail,
  signInErrorMessage,
  socialStartError,
} from "@/components/sign-in/SignInForm";

const route = getRouteApi("/sign-in");

export function SignInPage() {
  const { notice } = useSyncExternalStore(sessionBoundary.subscribe, sessionBoundary.getSnapshot);
  const { redirect, error: errorCode, via } = route.useSearch();
  const emailField = useRef<HTMLInputElement>(null);
  const [cardBody, cardSize] = useContentHeight<HTMLDivElement>();
  // The provider button pressed last, which the cast watches as the teacher leaves for it.
  const leavingButton = useRef<HTMLElement | null>(null);
  const submitButton = useRef<HTMLButtonElement>(null);
  const alertBox = useRef<HTMLDivElement>(null);
  const sentMessage = useRef<HTMLDivElement>(null);
  const formRefs = useMemo(
    () => ({
      email: emailField,
      submit: submitButton,
      leaving: leavingButton,
      alert: alertBox,
      sent: sentMessage,
    }),
    [],
  );
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
  const onRetrySignOut = useCallback(
    () => void sessionBoundary.signOut(() => authClient.signOut()),
    [],
  );

  return (
    <main className="relative isolate flex min-h-svh flex-col overflow-x-clip bg-background">
      {PAPER_GLOW}
      <div className="mx-auto w-full max-w-[1296px] px-4 pt-5 sm:px-[clamp(22px,6vw,48px)] lg:pt-8">
        {SIGN_IN_LOCKUP}
      </div>
      <div className="flex flex-1 flex-col items-center justify-center px-4 pt-6 pb-10 sm:px-6">
        {HEADLINE}
        <SignInForm
          redirect={redirect}
          errorCode={errorCode}
          via={via}
          notice={notice}
          onRetrySignOut={onRetrySignOut}
          refs={formRefs}
          frame={(form, mood: CastMood) => (
            <div className="relative mt-24 w-full max-w-[520px] sm:mt-32">
              <SignInCast mood={mood} targets={castTargets} />
              {/* The card eases to each new height (form, sent, an alert) instead of jumping to
                  it; a resize or rotation that reflows it follows at once. */}
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
                  {form}
                </div>
              </div>
            </div>
          )}
        />
        {TAGLINE}
        {LEGAL}
      </div>
    </main>
  );
}

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
