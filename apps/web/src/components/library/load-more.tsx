import { Button, Spinner } from "@tj/ui";
import { useEffect, useRef } from "react";

/**
 * The end of a paged list (ADR 0024 §17). Fetches the next page when it scrolls into view — the
 * `IntersectionObserver` is the one external subscription — and offers a button for keyboards,
 * screen readers and browsers without the observer. Renders nothing once every page is loaded.
 */
export function LoadMore({
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
}: {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
}) {
  const sentinel = useRef<HTMLDivElement>(null);
  const latest = useRef(onLoadMore);
  latest.current = onLoadMore;

  useEffect(() => {
    const node = sentinel.current;
    if (!node || !hasNextPage || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) latest.current();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage]);

  if (!hasNextPage) return null;
  return (
    <div ref={sentinel} className="flex justify-center py-6">
      <Button variant="ghost" onClick={onLoadMore} disabled={isFetchingNextPage}>
        {isFetchingNextPage ? <Spinner /> : null}
        {isFetchingNextPage ? "Loading more…" : "Load more"}
      </Button>
    </div>
  );
}
