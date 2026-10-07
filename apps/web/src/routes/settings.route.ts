import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { pageTitle } from "@/lib/page-title";
import { libraryLayoutRoute } from "./library.route";

/** `/settings` sits in the library shell so the sidebar stays beside it (F17 §8: one page). */
export const settingsRoute = createRoute({
  getParentRoute: () => libraryLayoutRoute,
  path: "/settings",
  head: () => pageTitle("Settings"),
  component: lazyRouteComponent(() => import("./settings.page"), "SettingsPage"),
});
