/**
 * Code-based route tree (ADR 0004). Route definitions live in `src/routes/<name>.route.ts`,
 * their components in `<name>.page.tsx` (loaded with `lazyRouteComponent`), and the tree is
 * assembled only here. No file-based routing, no generated route tree.
 */
import { createRouter } from "@tanstack/react-router";
import { queryClient } from "@/lib/query";
import { authLayoutRoute } from "@/routes/auth.route";
import { devJobsRoute } from "@/routes/dev-jobs.route";
import { indexRoute } from "@/routes/index.route";
import { rootRoute } from "@/routes/root.route";
import { signInRoute } from "@/routes/sign-in.route";

export const routeTree = rootRoute.addChildren([
  signInRoute,
  authLayoutRoute.addChildren([indexRoute, devJobsRoute]),
]);

export const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: "intent",
  scrollRestoration: true,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
