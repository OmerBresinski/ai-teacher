import { getRouteApi } from "@tanstack/react-router";
import { Button, Input, Label } from "@tj/ui";
import { MailCheck } from "lucide-react";
import {
  type CSSProperties,
  type FormEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { ConfirmPreview } from "@/components/auth/confirm-preview";
import { DaybackMark } from "@/components/brand/dayback-mark";
import { env } from "@/env";
import { authClient } from "@/lib/auth";
import {
  callbackUrl,
  errorCallbackUrl,
  pathOnOrigin,
  sanitiseRedirectPath,
} from "@/lib/auth-redirect";
import { resolveApiBaseUrl } from "@/lib/base-url";
import {
  type ConfirmDestination,
  confirmActionLabel,
  confirmDestination,
  rememberLanding,
} from "@/lib/confirm-destination";

const route = getRouteApi("/sign-in/confirm");

/** Where better-auth sends a failed verify: back to this page, without the token (TEACH-214). */
export function confirmErrorUrl(origin: string, redirect: string, email?: string): string {
  const url = new URL("/sign-in/confirm", origin);
  url.searchParams.set("callbackURL", redirect);
  if (email) url.searchParams.set("email", email);
  return url.toString();
}

/**
 * The api verify URL the button opens (TEACH-246). The callback goes back through
 * `sanitiseRedirectPath` on this origin: one on another origin collapses to `/` before
 * better-auth's own origin check sees it. A failed verify (expired or used link) returns to this
 * page with the same callback, so the teacher sees the same preview and can ask for a new link
 * (TEACH-214); `errorCallbackURL` from the email is no longer followed.
 */
export function magicLinkVerifyUrl(
  apiBase: string,
  origin: string,
  query: { token: string; callbackURL?: string; email?: string },
): string {
  const redirect = sanitiseRedirectPath(pathOnOrigin(query.callbackURL, origin));
  const url = new URL(`${apiBase}/auth/magic-link/verify`);
  url.searchParams.set("token", query.token);
  url.searchParams.set("callbackURL", callbackUrl(origin, redirect));
  url.searchParams.set("errorCallbackURL", confirmErrorUrl(origin, redirect, query.email));
  return url.toString();
}

/** As `/sign-in` does (`normaliseEmail` there); not imported, so this chunk stays small. */
const normaliseEmail = (raw: string) => raw.trim().toLowerCase();

const SHEET_NO_RING = {
  outline: "none",
  "--tw-ring-shadow": "0 0 #0000",
  "--tw-ring-offset-shadow": "0 0 #0000",
} as CSSProperties;

type Resend = { kind: "idle" } | { kind: "sending" } | { kind: "sent" } | { kind: "error" };

/**
 * Where the magic-link email lands (TEACH-246, UX ruling 126). A compact sheet over a preview of
 * the destination, read from the link's callback alone. School mail scanners GET every link in an
 * email; this page makes no request on load and holds no link to the verify URL, so the token is
 * spent only by the button, which opens the verify URL in this window so the session cookie is set
 * exactly as before. The preview is hidden from assistive technology and inert, so the sheet holds
 * every tab stop.
 */
export function SignInConfirmPage() {
  const { token, callbackURL, email, error } = route.useSearch();
  const origin = window.location.origin;
  const destination = useMemo(() => confirmDestination(callbackURL, origin), [callbackURL, origin]);
  const [signingIn, setSigningIn] = useState(false);
  const sheet = useRef<HTMLElement>(null);
  const titleId = useId();

  // Back from the api (or a failed navigation) can restore this page from the back/forward cache
  // with the button still "Signing in…"; a restored page starts over.
  useEffect(() => {
    function onPageShow(event: PageTransitionEvent) {
      if (event.persisted) setSigningIn(false);
    }
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  // A dialog's focus starts inside it. On the sheet itself, so its title is read first and the
  // button does not open with a focus ring; the next Tab reaches the button.
  useEffect(() => {
    sheet.current?.focus({ preventScroll: true });
  }, []);

  function onContinue() {
    if (!token) return;
    const redirect = sanitiseRedirectPath(pathOnOrigin(callbackURL, origin));
    setSigningIn(true);
    rememberLanding(destination, redirect);
    window.location.assign(
      magicLinkVerifyUrl(resolveApiBaseUrl(env.VITE_API_URL, origin), origin, {
        token,
        callbackURL,
        email,
      }),
    );
  }

  const live = Boolean(token) && !error;
  return (
    <main className="relative isolate min-h-svh overflow-hidden bg-background">
      <div
        aria-hidden="true"
        inert
        data-confirm-preview={destination.kind}
        className="pointer-events-none absolute inset-0 overflow-hidden select-none"
      >
        <ConfirmPreview destination={destination} />
      </div>
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[color-mix(in_oklab,var(--background)_40%,transparent)] backdrop-blur-[1.5px]"
      />
      <div className="relative flex min-h-svh items-end justify-center sm:items-center sm:p-6">
        <section
          ref={sheet}
          role="dialog"
          tabIndex={-1}
          // The sheet takes focus only to start the tab order inside it (its title is announced),
          // so it draws no ring; the global `:focus-visible` ring (`@tj/ui` globals.css) is reset here.
          style={SHEET_NO_RING}
          aria-modal="true"
          aria-labelledby={titleId}
          data-leaving={signingIn || undefined}
          className="w-full rounded-t-[24px] border border-border bg-card p-6 pb-[max(24px,env(safe-area-inset-bottom))] shadow-2 outline-none transition-[opacity,transform] duration-300 ease-out data-leaving:translate-y-2 data-leaving:opacity-0 motion-reduce:transition-none sm:max-w-[420px] sm:rounded-[24px] sm:p-7"
        >
          <span className="mb-5 inline-flex items-center gap-1.5 text-[17px] font-[750] tracking-[-0.03em] text-foreground">
            <DaybackMark />
            DayBack
          </span>
          {live ? (
            <ContinueSheet
              titleId={titleId}
              email={email}
              destination={destination}
              signingIn={signingIn}
              onContinue={onContinue}
            />
          ) : (
            <ExpiredSheet
              titleId={titleId}
              email={email}
              redirect={sanitiseRedirectPath(pathOnOrigin(callbackURL, origin))}
              incomplete={!token && !error}
            />
          )}
        </section>
      </div>
    </main>
  );
}

function ContinueSheet({
  titleId,
  email,
  destination,
  signingIn,
  onContinue,
}: {
  titleId: string;
  email?: string;
  destination: ConfirmDestination;
  signingIn: boolean;
  onContinue: () => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <h1
          id={titleId}
          className="text-[26px] leading-[1.15] font-[750] tracking-[-0.03em] text-foreground"
        >
          {email ? (
            <>
              Continue as{" "}
              <span className="block text-[20px] leading-[1.25] font-[650] tracking-[-0.01em] [overflow-wrap:anywhere]">
                {email}
              </span>
            </>
          ) : (
            "Continue to DayBack"
          )}
        </h1>
        <p className="text-body text-ink-2">
          {destination.kind === "new-lesson"
            ? "Your topic is ready. This link works once and lasts 15 minutes."
            : "This link works once and lasts 15 minutes."}
        </p>
      </div>
      <Button
        type="button"
        variant="primary"
        className="h-12 w-full cursor-pointer"
        disabled={signingIn}
        onClick={onContinue}
      >
        {signingIn ? "Signing in…" : confirmActionLabel(destination)}
      </Button>
    </div>
  );
}

/**
 * An expired or used link (better-auth's `?error=INVALID_TOKEN` on the way back from verify), or
 * a link that lost its token: the same sheet asks for a new link to the same place.
 */
function ExpiredSheet({
  titleId,
  email: initialEmail,
  redirect,
  incomplete,
}: {
  titleId: string;
  email?: string;
  redirect: string;
  incomplete: boolean;
}) {
  const [email, setEmail] = useState(initialEmail ?? "");
  const [status, setStatus] = useState<Resend>({ kind: "idle" });
  const fieldId = useId();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const address = normaliseEmail(email);
    if (!address || status.kind === "sending") return;
    setStatus({ kind: "sending" });
    try {
      const origin = window.location.origin;
      const { error } = await authClient.signIn.magicLink({
        email: address,
        callbackURL: callbackUrl(origin, redirect),
        errorCallbackURL: errorCallbackUrl(origin, redirect),
      });
      setStatus(error ? { kind: "error" } : { kind: "sent" });
    } catch {
      setStatus({ kind: "error" });
    }
  }

  if (status.kind === "sent") {
    return (
      <div role="status" className="flex flex-col gap-2">
        <h1
          id={titleId}
          className="flex items-center gap-2 text-[26px] leading-[1.15] font-[750] tracking-[-0.03em] text-foreground"
        >
          <MailCheck aria-hidden="true" size={24} strokeWidth={1.75} />
          Check your inbox
        </h1>
        <p className="text-body text-ink-2">
          We sent a new link to{" "}
          <span className="[overflow-wrap:anywhere]">{normaliseEmail(email)}</span>. It lasts 15
          minutes.
        </p>
      </div>
    );
  }

  return (
    <form className="flex flex-col gap-5" onSubmit={onSubmit} noValidate>
      <div className="flex flex-col gap-1.5">
        <h1
          id={titleId}
          className="text-[26px] leading-[1.15] font-[750] tracking-[-0.03em] text-foreground"
        >
          {incomplete ? "This link is incomplete" : "This link has expired"}
        </h1>
        <p role="alert" className="text-body text-ink-2">
          {incomplete
            ? "Part of the link went missing. We can send you a fresh one."
            : "Sign-in links work once and last 15 minutes. We can send you a fresh one."}
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={fieldId}>Email address</Label>
        <Input
          id={fieldId}
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          className="h-12"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>
      {status.kind === "error" ? (
        <p role="alert" className="text-body text-foreground">
          We could not send the link. Please check the address and try again.
        </p>
      ) : null}
      <Button
        type="submit"
        variant="primary"
        className="h-12 w-full cursor-pointer"
        disabled={status.kind === "sending"}
      >
        {status.kind === "sending" ? "Sending…" : "Email me a new link"}
      </Button>
    </form>
  );
}
