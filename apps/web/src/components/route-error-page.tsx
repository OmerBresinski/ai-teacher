import { type ErrorComponentProps, useRouter } from "@tanstack/react-router";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@tj/ui";
import { ApiError } from "@/lib/query";

/**
 * Route-level error boundary. Shows the API's plain sentence when we have one and a generic one
 * otherwise (F18-R12) — never error codes or stacks. Retry re-runs loaders via `router.invalidate()`.
 */
export function RouteErrorPage({ error }: ErrorComponentProps) {
  const router = useRouter();
  const message =
    error instanceof ApiError
      ? error.message
      : "Something went wrong while loading this page. Please try again.";
  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col justify-center p-6">
      <Card>
        <CardHeader>
          <CardTitle>We hit a problem</CardTitle>
          <CardDescription>{message}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => void router.invalidate()}>Retry</Button>
        </CardContent>
      </Card>
    </main>
  );
}
