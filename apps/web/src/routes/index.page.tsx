import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@tj/ui";
import { authClient } from "@/lib/auth";
import { meQueryOptions, queryKeys } from "@/lib/query";

export function IndexPage() {
  const { data: me } = useQuery(meQueryOptions);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  async function signOut() {
    await authClient.signOut();
    await queryClient.invalidateQueries({ queryKey: queryKeys.me });
    await navigate({ to: "/sign-in", search: {} });
  }

  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col justify-center gap-4 p-6">
      <Card>
        <CardHeader>
          <CardTitle>Hello{me?.user.name ? `, ${me.user.name}` : ""}</CardTitle>
          <CardDescription>You are signed in to Teaching Journey.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Email</dt>
            <dd>{me?.user.email}</dd>
            <dt className="text-muted-foreground">Workspace</dt>
            <dd className="font-mono text-xs">{me?.workspaceId}</dd>
          </dl>
          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={() => void signOut()}>
              Sign out
            </Button>
            {import.meta.env.DEV ? (
              <Link to="/dev/jobs" search={{}} className="text-sm underline underline-offset-4">
                Jobs / SSE demo (dev)
              </Link>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
