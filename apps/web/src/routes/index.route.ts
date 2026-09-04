import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { authLayoutRoute } from "./auth.route";

export const indexRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/",
  component: lazyRouteComponent(() => import("./index.page"), "IndexPage"),
});
