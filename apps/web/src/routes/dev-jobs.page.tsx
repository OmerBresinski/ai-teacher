import { useMutation } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@tj/ui";
import { JobEventList } from "@/components/job-event-list";
import { useJobEvents } from "@/hooks/use-job-events";
import { api } from "@/lib/api";
import { apiErrorFromResponse } from "@/lib/query";

// Route *id* (the pathless `auth` layout prefixes it), not the URL path.
const route = getRouteApi("/auth/dev/jobs");

/** Development aid for the ADR 0012 SSE demo (TEACH-19/21). Not a product screen. */
export function DevJobsPage() {
  const { jobId } = route.useSearch();
  const navigate = route.useNavigate();
  const stream = useJobEvents(jobId);

  const ping = useMutation({
    mutationFn: async () => {
      const res = await api.jobs.ping.$post({ json: { message: "hello", steps: 5 } });
      if (res.status !== 202) throw await apiErrorFromResponse(res);
      return res.json();
    },
    onSuccess: ({ jobId: id }) => void navigate({ search: { jobId: id } }),
  });

  const cancel = useMutation({
    mutationFn: async (id: string) => {
      const res = await api.jobs[":id"].cancel.$post({ param: { id } });
      if (res.status !== 202) throw await apiErrorFromResponse(res);
      return res.json();
    },
  });

  const running = Boolean(jobId) && stream.terminal === null && stream.status !== "error";

  return (
    <main className="mx-auto flex min-h-svh max-w-2xl flex-col gap-4 p-6">
      <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
        Development aid — exercises the jobs API and SSE stream. Not part of the product.{" "}
        <Link to="/" className="underline underline-offset-4">
          Back home
        </Link>
      </p>
      <Card>
        <CardHeader>
          <CardTitle>Jobs / SSE demo</CardTitle>
          <CardDescription>
            Enqueue a <code>ping</code> job, the worker runs it, the API streams its events.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => ping.mutate()} disabled={ping.isPending || running}>
              {ping.isPending ? "Enqueuing…" : "Run ping"}
            </Button>
            <Button
              variant="outline"
              disabled={!jobId || !running || cancel.isPending}
              onClick={() => jobId && cancel.mutate(jobId)}
            >
              Cancel
            </Button>
            <span className="text-sm text-muted-foreground">
              {jobId ? `job ${jobId.slice(0, 8)}… · ${stream.status}` : "no job"}
            </span>
          </div>
          {ping.error ? (
            <p role="alert" className="text-sm text-destructive">
              {ping.error.message}
            </p>
          ) : null}
          {cancel.error ? (
            <p role="alert" className="text-sm text-destructive">
              {cancel.error.message}
            </p>
          ) : null}
          {cancel.data ? (
            <p className="text-sm text-muted-foreground">Cancel: {cancel.data.status}</p>
          ) : null}
          {jobId ? (
            <label className="flex flex-col gap-1 text-sm">
              <span>Progress{stream.percent === null ? "" : ` ${stream.percent}%`}</span>
              <progress className="w-full" max={100} value={stream.percent ?? undefined} />
            </label>
          ) : null}
          <JobEventList events={stream.events} />
        </CardContent>
      </Card>
    </main>
  );
}
