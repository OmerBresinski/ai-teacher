import { BRIEF_TOPIC_MAX } from "@tj/domain/documents";
import { pathOnOrigin, sanitiseRedirectPath } from "./auth-redirect";

/**
 * Where a magic link is taking the teacher, read from its `callbackURL` alone (UX ruling 126,
 * TEACH-214). The confirm page draws a preview of it behind the sheet, so nothing here may need a
 * request: the page is public and a mail scanner may be the one rendering it.
 *
 * - `dashboard`: the library home, the default callback.
 * - `new-lesson`: the brief page with a topic from the marketing homepage (TEACH-309).
 * - `claim`: an anonymous lesson this browser is saving to the account. Follow-up hook for
 *   TEACH-224/245 (the signed-out first lesson): until that lands no callback resolves to it, and
 *   the page draws the generic shell instead of a lesson it cannot read yet.
 * - `other`: anything else on this origin.
 */
export type ConfirmDestination =
  | { kind: "dashboard" }
  | { kind: "new-lesson"; topic: string }
  | { kind: "claim"; lessonId: string }
  | { kind: "other" };

export function confirmDestination(
  callbackURL: string | undefined,
  origin: string,
): ConfirmDestination {
  // The same reduction the Sign in button applies, so the preview never shows a place the click
  // would not go (another origin collapses to `/`, the dashboard).
  const path = sanitiseRedirectPath(pathOnOrigin(callbackURL, origin));
  const url = new URL(path, origin);
  if (url.pathname === "/" || url.pathname === "/lessons") return { kind: "dashboard" };
  if (url.pathname === "/lessons/new") {
    const topic = url.searchParams.get("topic")?.trim().slice(0, BRIEF_TOPIC_MAX);
    return topic ? { kind: "new-lesson", topic } : { kind: "other" };
  }
  return { kind: "other" };
}

/**
 * The button's words for each destination (UX ruling 126).
 */
export function confirmActionLabel(destination: ConfirmDestination): string {
  switch (destination.kind) {
    case "dashboard":
      return "Open my lessons";
    case "new-lesson":
      return "Start my lesson";
    case "claim":
      return "Save this lesson to my account";
    case "other":
      return "Continue";
  }
}

/**
 * Handed from the confirm page to the page the api redirects back to, so the router's pending
 * state paints the same preview the teacher was looking at instead of a blank or generic page
 * (no blank page between). Session storage, this tab only, and it holds no token or email: only the
 * preview kind, the topic the teacher typed, and the path it is for.
 */
const LANDING_KEY = "tj:confirm-landing";
const LANDING_TTL_MS = 20_000;

export interface Landing {
  destination: ConfirmDestination;
  path: string;
  at: number;
}

export function rememberLanding(destination: ConfirmDestination, path: string): void {
  try {
    const landing: Landing = { destination, path, at: Date.now() };
    sessionStorage.setItem(LANDING_KEY, JSON.stringify(landing));
  } catch {
    // Storage blocked: the landing shows the ordinary pending skeleton.
  }
}

/** The preview to paint while `pathname` loads, if the confirm page just sent the teacher there. */
export function landingFor(pathname: string, now = Date.now()): ConfirmDestination | null {
  try {
    const raw = sessionStorage.getItem(LANDING_KEY);
    if (!raw) return null;
    const landing = JSON.parse(raw) as Partial<Landing>;
    if (typeof landing.at !== "number" || now - landing.at > LANDING_TTL_MS) {
      sessionStorage.removeItem(LANDING_KEY);
      return null;
    }
    const kind = landing.destination?.kind;
    if (kind !== "dashboard" && kind !== "new-lesson" && kind !== "other") return null;
    if (typeof landing.path !== "string" || new URL(landing.path, "http://x").pathname !== pathname)
      return null;
    return landing.destination as ConfirmDestination;
  } catch {
    return null;
  }
}

/**
 * The address this browser last asked a link for, so the expired sheet can offer it again. Kept
 * client-side only (never in a URL: mail scanners, proxies and logs capture query strings), in
 * local storage because the email link usually opens a new tab, and only for a link's lifetime.
 */
const REQUESTED_EMAIL_KEY = "tj:magic-link-email";
const REQUESTED_EMAIL_TTL_MS = 15 * 60_000;

export function rememberRequestedEmail(email: string): void {
  try {
    localStorage.setItem(REQUESTED_EMAIL_KEY, JSON.stringify({ email, at: Date.now() }));
  } catch {
    // Storage blocked: the expired sheet starts with an empty field.
  }
}

export function requestedEmail(now = Date.now()): string {
  try {
    const raw = localStorage.getItem(REQUESTED_EMAIL_KEY);
    if (!raw) return "";
    const { email, at } = JSON.parse(raw) as { email?: unknown; at?: unknown };
    if (typeof email !== "string" || typeof at !== "number" || now - at > REQUESTED_EMAIL_TTL_MS) {
      localStorage.removeItem(REQUESTED_EMAIL_KEY);
      return "";
    }
    return email;
  } catch {
    return "";
  }
}
