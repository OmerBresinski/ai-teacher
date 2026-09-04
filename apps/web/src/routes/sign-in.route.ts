import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { z } from "zod";
import { rootRoute } from "./root.route";

export const signInSearchSchema = z.object({
  /**
   * Where to send the teacher after the magic link is verified (`location.href` of the guard).
   * `.catch(undefined)`: the search parser JSON-decodes values, so `?redirect=1` or
   * `?redirect=%5B%22a%22%5D` would otherwise fail validation and bubble to the root
   * errorComponent; a malformed param is silently dropped instead (see search-schemas.test.ts).
   */
  redirect: z.string().optional().catch(undefined),
});

export const signInRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sign-in",
  validateSearch: signInSearchSchema,
  component: lazyRouteComponent(() => import("./sign-in.page"), "SignInPage"),
});
