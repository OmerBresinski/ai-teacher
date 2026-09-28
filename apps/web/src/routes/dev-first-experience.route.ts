import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { rootRoute } from "./root.route";

/** Visual review only. No auth, uploads, generation or private data; erased from production. */
export const devFirstExperienceRoute =
  import.meta.env.DEV || import.meta.env.VITE_APP_ENV === "preview"
    ? createRoute({
        getParentRoute: () => rootRoute,
        path: "/dev/first-experience",
        component: lazyRouteComponent(
          () => import("./dev-first-experience.page"),
          "DevFirstExperiencePage",
        ),
      })
    : null;
