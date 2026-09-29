import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { z } from "zod";
import { pageTitle } from "@/lib/page-title";
import { rootRoute } from "./root.route";

/**
 * What the magic-link email carries (TEACH-246): better-auth's token and the two callbacks the
 * sign-in form asked for, copied off the api verify URL by `confirmPageUrl`
 * (`apps/api/src/auth/magic-link-mail.ts`). Lenient like `signInSearchSchema`: a malformed value is
 * dropped, never an error page.
 */
export const signInConfirmSearchSchema = z.object({
  token: z.string().optional().catch(undefined),
  callbackURL: z.string().optional().catch(undefined),
  errorCallbackURL: z.string().optional().catch(undefined),
  // Shown as "Continue as <email>" (UX ruling 126); display only, the token decides the account.
  email: z.email().optional().catch(undefined),
  // better-auth's code when verify fails and sends the teacher back here (TEACH-214).
  error: z.string().optional().catch(undefined),
});

/**
 * Public, like `/sign-in`, and it never calls `/me`: the teacher is not signed in yet. The email
 * lands here so a mail scanner's GET reaches a static page; only the "Sign in" button spends the
 * single-use token.
 */
export const signInConfirmRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sign-in/confirm",
  validateSearch: signInConfirmSearchSchema,
  head: () => {
    const { meta } = pageTitle("Sign in");
    // The URL holds the token: keep it out of Referer (vercel.json sends the same header).
    return {
      meta: [
        ...meta,
        { name: "robots", content: "noindex" },
        { name: "referrer", content: "no-referrer" },
      ],
    };
  },
  component: lazyRouteComponent(() => import("./sign-in-confirm.page"), "SignInConfirmPage"),
});
