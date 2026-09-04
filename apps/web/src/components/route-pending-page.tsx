import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@tj/ui";

/**
 * Router `defaultPendingComponent`. Shown while a route's `beforeLoad`/`loader` (e.g. the
 * authenticated shell awaiting `GET /me`) or a lazy chunk is still in flight, so a cold load never
 * leaves `#root` empty. Screen readers get "Loading…" through the live region; sighted users get
 * pulsing placeholders that mirror the card layout used by the error and not-found pages.
 */
export function RoutePendingPage() {
  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col justify-center p-6">
      <Card aria-busy="true">
        <CardHeader>
          <CardTitle>
            <span className="sr-only" role="status" aria-live="polite">
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
