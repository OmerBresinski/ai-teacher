import { Link } from "@tanstack/react-router";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@tj/ui";

export function NotFoundPage() {
  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col justify-center p-6">
      <Card>
        <CardHeader>
          <CardTitle>Page not found</CardTitle>
          <CardDescription>That page does not exist or has moved.</CardDescription>
        </CardHeader>
        <CardContent>
          <Link to="/" className="underline underline-offset-4">
            Go to the home page
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
