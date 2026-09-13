import { createRoute, redirect } from "@tanstack/react-router";
import { sanitiseRedirectPath } from "@/lib/auth-redirect";
import { meQueryOptions } from "@/lib/query";
import { assertCurrentSession } from "@/lib/session-boundary";
import { rootRoute } from "./root.route";

/**
 * Pathless layout: every child requires a session. `beforeLoad` resolves `/me` through the Query
 * client (revalidated on navigation) and redirects to `/sign-in` with the original URL when there is none.
 * better-auth's `?error=…` params are stripped from that URL so they never round-trip (TEACH-68).
 */
export const authLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "auth",
  beforeLoad: async ({ context, location }) => {
    const me = await context.queryClient.fetchQuery({ ...meQueryOptions, staleTime: 0 });
    assertCurrentSession(context.queryClient);
    if (!me) {
      throw redirect({ to: "/sign-in", search: { redirect: sanitiseRedirectPath(location.href) } });
    }
    return { me };
  },
});
