import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Button, Card, CardContent } from "@tj/ui";
import { authClient } from "@/lib/auth";
import { meQueryOptions, queryKeys } from "@/lib/query";

const labelClass = "text-xs font-medium uppercase tracking-wider text-muted-foreground";

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
    <main className="mx-auto flex min-h-svh w-full max-w-2xl flex-col justify-center gap-10 px-6 py-16">
      <header className="flex flex-col gap-4">
        <p className={labelClass}>Teaching Journey</p>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          Hello{me?.user.name ? `, ${me.user.name}` : ""}
        </h1>
      </header>

      <Card>
        <CardContent>
          <dl className="grid gap-y-4 sm:grid-cols-[8rem_1fr] sm:gap-x-6">
            <dt className={labelClass}>Email</dt>
            <dd className="break-all">{me?.user.email}</dd>
            <dt className={labelClass}>Workspace</dt>
            <dd className="break-all font-mono text-sm">{me?.workspaceId}</dd>
          </dl>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-4">
        <Button variant="outline" onClick={() => void signOut()}>
          Sign out
        </Button>
        {import.meta.env.DEV ? (
          <Link
            to="/dev/jobs"
            search={{}}
            className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Jobs / SSE demo (dev)
          </Link>
        ) : null}
      </div>
    </main>
  );
}
