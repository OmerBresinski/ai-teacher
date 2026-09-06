import { useNow } from "@/hooks/use-now";
import { absoluteTime, relativeTime } from "@/lib/format";

/**
 * "3h ago" with the absolute time as a tooltip. Subscribes to the shared minute clock itself so a
 * tick re-renders this element only, never the memoised card around it.
 */
export function EditedTime({ updatedAt, prefix = "" }: { updatedAt: string; prefix?: string }) {
  const now = useNow();
  return (
    <time dateTime={updatedAt} title={absoluteTime(updatedAt)}>
      {prefix}
      {relativeTime(updatedAt, now)}
    </time>
  );
}
