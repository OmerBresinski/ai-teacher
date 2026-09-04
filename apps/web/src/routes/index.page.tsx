import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { FALLBACK_GREETING } from "@tj/domain";
import { Button, Card, CardContent } from "@tj/ui";
import { authClient } from "@/lib/auth";
import { greetingQueryOptions, meQueryOptions, queryKeys } from "@/lib/query";

const labelClass = "text-xs font-medium uppercase tracking-wider text-muted-foreground";

/** Inline so `apps/web` does not take on an icon dependency for one button. */
function RefreshIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={spinning ? "animate-spin" : undefined}
    >
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

export function IndexPage() {
  const { data: me } = useQuery(meQueryOptions);
  const greeting = useQuery({ ...greetingQueryOptions, enabled: me != null });
  const text = greeting.data?.text ?? FALLBACK_GREETING;
  // Hidden during the first load *and* while a refresh is in flight, so the new joke fades in.
  const hidden = greeting.isFetching;
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  async function signOut() {
    await authClient.signOut();
    await queryClient.invalidateQueries({ queryKey: queryKeys.me });
    queryClient.removeQueries({ queryKey: queryKeys.greeting });
    await navigate({ to: "/sign-in", search: {} });
  }

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-2xl flex-col justify-center gap-10 px-6 py-16">
      <header className="flex flex-col gap-4">
        <p className={labelClass}>Teaching Journey</p>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          Hello{me?.user.name ? `, ${me.user.name}` : ""}
        </h1>
        {/* `min-h-14` reserves two `text-lg` lines so a longer joke does not shift the page. */}
        <div className="flex min-h-14 items-start gap-2">
          <p
            className={`text-lg text-muted-foreground transition-opacity duration-300 ${hidden ? "opacity-0" : "opacity-100"}`}
            aria-hidden={hidden}
          >
            {text}
          </p>
          {/* Announces the new joke to assistive tech once it has settled; the visible line fades. */}
          <span role="status" className="sr-only">
            {hidden ? "" : text}
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            className="mt-1 shrink-0 text-muted-foreground"
            aria-label="New joke"
            title="New joke"
            disabled={me == null || greeting.isFetching}
            onClick={() => void greeting.refetch()}
          >
            <RefreshIcon spinning={greeting.isFetching} />
          </Button>
        </div>
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
