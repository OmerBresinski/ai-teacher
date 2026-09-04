import { createRoute, redirect } from "@tanstack/react-router";
import { sanitiseRedirectPath } from "@/lib/auth-redirect";
import { meQueryOptions } from "@/lib/query";
import { rootRoute } from "./root.route";

/**
 * Pathless layout: every child requires a session. `beforeLoad` resolves `/me` through the Query
 * client (cached 30 s) and redirects to `/sign-in` with the original URL when there is none.
 * better-auth's `?error=…` params are stripped from that URL so they never round-trip (TEACH-68).
 */
export const authLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "auth",
  beforeLoad: async ({ context, location }) => {
    const me = await context.queryClient.ensureQueryData(meQueryOptions);
    if (!me) {
      throw redirect({ to: "/sign-in", search: { redirect: sanitiseRedirectPath(location.href) } });
    }
    return { me };
  },
});
