import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Button } from "@tj/ui";
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
    <main className="mx-auto flex min-h-svh w-full max-w-2xl flex-col justify-center gap-10 px-6 py-16">
      <header className="flex flex-col gap-4">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
          Teaching Journey
        </p>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          Hello{me?.user.name ? `, ${me.user.name}` : ""}
        </h1>
        <p className="text-lg text-muted-foreground">
          You are signed in. Journeys, Lessons and Artefacts will appear here soon.
        </p>
      </header>

      <dl className="grid gap-y-4 rounded-lg border bg-card p-6 text-card-foreground sm:grid-cols-[8rem_1fr] sm:gap-x-6">
        <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Email
        </dt>
        <dd className="break-all">{me?.user.email}</dd>
        <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Workspace
        </dt>
        <dd className="break-all font-mono text-sm">{me?.workspaceId}</dd>
      </dl>

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
