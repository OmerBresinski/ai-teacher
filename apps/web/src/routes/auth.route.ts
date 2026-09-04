import { createRoute, redirect } from "@tanstack/react-router";
import { meQueryOptions } from "@/lib/query";
import { rootRoute } from "./root.route";

/**
 * Pathless layout: every child requires a session. `beforeLoad` resolves `/me` through the Query
 * client (cached 30 s) and redirects to `/sign-in` with the original URL when there is none.
 */
export const authLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "auth",
  beforeLoad: async ({ context, location }) => {
    const me = await context.queryClient.ensureQueryData(meQueryOptions);
    if (!me) {
      throw redirect({ to: "/sign-in", search: { redirect: location.href } });
    }
    return { me };
  },
});
