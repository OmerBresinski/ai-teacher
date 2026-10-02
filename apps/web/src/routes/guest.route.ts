import { createRoute, redirect } from "@tanstack/react-router";
import { sanitiseRedirectPath } from "@/lib/auth-redirect";
import { type Me, meQueryOptions } from "@/lib/query";
import { assertCurrentSession } from "@/lib/session-boundary";
import { rootRoute } from "./root.route";

/** The one guest route a visitor with no session at all may open: the brief. */
const OPEN_TO_SIGNED_OUT = "/lessons/new";

/**
 * Where a guest may be sent, from `/me` alone. Pure, so the route rules are unit-tested without a
 * router (guest.route.test.ts). Signed-out lessons are always on; the api's daily cap
 * (`ANONYMOUS_LESSONS_DAILY_CAP=0`) is the kill switch.
 *
 * An anonymous session may open the brief and its lesson pages (`/l/$lessonId`, `/view`,
 * `/present`); the API owns whose lesson it is. No session at all may open only the brief;
 * a lesson URL without a session still signs in first.
 */
export function guestAccess(me: Me | null, pathname: string): "allow" | "sign-in" {
  if (me) return "allow";
  return pathname === OPEN_TO_SIGNED_OUT ? "allow" : "sign-in";
}

/**
 * Pathless layout (id `guest`, TEACH-244, UX ruling 109): the brief and a lesson's own pages,
 * reachable before an account exists. Context carries `me: Me | null`; children that need a
 * session read it from there or from `meQueryOptions`.
 */
export const guestLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "guest",
  beforeLoad: async ({ context, location }): Promise<{ me: Me | null }> => {
    const me = await context.queryClient.fetchQuery({ ...meQueryOptions, staleTime: 0 });
    assertCurrentSession(context.queryClient);
    if (guestAccess(me, location.pathname) === "sign-in") {
      throw redirect({ to: "/sign-in", search: { redirect: sanitiseRedirectPath(location.href) } });
    }
    return { me };
  },
});
