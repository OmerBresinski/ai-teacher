import type { JobEvent } from "@tj/domain/jobs";
import type { JobEventRecord } from "@/hooks/use-job-events";

export function describeJobEvent(event: JobEvent): string {
  switch (event.type) {
    case "progress": {
      const pct = event.progress.percent === undefined ? "" : ` ${event.progress.percent}%`;
      return `progress${pct}${event.progress.message ? ` — ${event.progress.message}` : ""}`;
    }
    case "failed":
      return `failed — ${event.error.message}`;
    default:
      return event.type;
  }
}

export function JobEventList({ events }: { events: JobEventRecord[] }) {
  if (events.length === 0) {
    return <p className="text-sm text-muted-foreground">No events yet.</p>;
  }
  return (
    <ol className="flex flex-col gap-1 font-mono text-xs" aria-label="Job events">
      {events.map(({ id, event }) => (
        <li key={id} className="flex gap-3">
          <time dateTime={event.at} className="text-muted-foreground">
            {event.at.slice(11, 23)}
          </time>
          <span>{describeJobEvent(event)}</span>
        </li>
      ))}
    </ol>
  );
}
