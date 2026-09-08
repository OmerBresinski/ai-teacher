import type { ReactNode } from "react";

/**
 * The brief's sticky bottom action bar (TEACH-177 item 2): one primary per bar (ruling 33) at
 * 36px (ruling 34), pinned to the foot of the viewport however long the form gets, with an
 * optional one-line reason under the controls when the primary is disabled (item 4).
 *
 * App-local for now. Candidate for `@tj/ui` as `ActionBar` once the Plan review steps need the
 * same bar with "Next" / "Generate"; when that lands, this file becomes a re-export.
 */
export function ActionBar({
  reason,
  reasonId,
  children,
}: {
  /** Why the primary is disabled, in one plain sentence; nothing when it is enabled. */
  reason?: string | null;
  /** The id the disabled primary's `aria-describedby` points at. */
  reasonId?: string;
  children: ReactNode;
}) {
  return (
    <div
      data-testid="brief-action-bar"
      className="sticky bottom-0 z-10 -mb-8 mt-2 flex flex-col items-end gap-1.5 border-t border-border bg-background/95 py-3 backdrop-blur"
    >
      <div className="flex w-full items-center justify-end gap-2">{children}</div>
      {reason ? (
        <p id={reasonId} role="status" className="text-meta text-ink-2">
          {reason}
        </p>
      ) : null}
    </div>
  );
}
