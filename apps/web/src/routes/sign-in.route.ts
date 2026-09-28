import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { z } from "zod";
import { rootRoute } from "./root.route";

export const signInSearchSchema = z.object({
  /**
   * Where to send the teacher after signing in (`location.href` of the guard).
   * `.catch(undefined)`: the search parser JSON-decodes values, so `?redirect=1` or
   * `?redirect=%5B%22a%22%5D` would otherwise fail validation and bubble to the root
   * errorComponent; a malformed param is silently dropped instead (see search-schemas.test.ts).
   */
  redirect: z.string().optional().catch(undefined),
  /**
   * better-auth's error code appended when it redirects to our `errorCallbackURL`: `INVALID_TOKEN`
   * from the magic-link verify endpoint (TEACH-68), or a failed Google round trip (`access_denied`,
   * `account_not_linked`, `state_mismatch`, …; TEACH-31). Only `error` is kept: `error_description`
   * is not in the schema. Same lenient parsing as `redirect`.
   */
  error: z.string().optional().catch(undefined),
  /**
   * Which provider's round trip the `error` came back from, when it is not Google's: our
   * `errorCallbackURL` for Microsoft adds `via=microsoft` (TEACH-206) so the copy names it.
   */
  via: z.literal("microsoft").optional().catch(undefined),
});

export const signInRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sign-in",
  validateSearch: signInSearchSchema,
  component: lazyRouteComponent(() => import("./sign-in.page"), "SignInPage"),
});
