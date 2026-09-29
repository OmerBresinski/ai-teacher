import { useRouterState } from "@tanstack/react-router";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@tj/ui";
import { ConfirmPreview } from "@/components/auth/confirm-preview";
import { landingFor } from "@/lib/confirm-destination";

/**
 * Router `defaultPendingComponent`. Rendered once a route's `beforeLoad`/`loader` (e.g. the
 * authenticated shell awaiting `GET /me`) or a lazy chunk has been in flight for
 * `defaultPendingMs` (`src/router.tsx`), and kept up for at least `defaultPendingMinMs` so it
 * never flashes. Screen readers get "Loading…" through the status region; sighted users get
 * pulsing placeholders that mirror the card layout used by the error and not-found pages.
 *
 * Just after a magic-link sign-in it paints the preview the confirm sheet sat on instead
 * (`rememberLanding`, UX ruling 126), so the page the teacher lands on never flashes blank.
 */
export function RoutePendingPage() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const landing = landingFor(pathname);
  if (landing) {
    return (
      <main className="min-h-svh overflow-hidden bg-background" aria-busy="true">
        <span className="sr-only" role="status">
          Loading…
        </span>
        <div aria-hidden="true" data-landing-preview={landing.kind} className="min-h-svh">
          <ConfirmPreview destination={landing} />
        </div>
      </main>
    );
  }
  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col justify-center p-6">
      <Card aria-busy="true">
        <CardHeader>
          <CardTitle>
            <span className="sr-only" role="status">
              Loading…
            </span>
            <span aria-hidden="true" className="block h-5 w-2/5 animate-pulse rounded bg-muted" />
          </CardTitle>
          <CardDescription>
            <span aria-hidden="true" className="block h-4 w-4/5 animate-pulse rounded bg-muted" />
          </CardDescription>
        </CardHeader>
        <CardContent aria-hidden="true" className="space-y-2">
          <span className="block h-4 w-full animate-pulse rounded bg-muted" />
          <span className="block h-4 w-3/5 animate-pulse rounded bg-muted" />
        </CardContent>
      </Card>
    </main>
  );
}
