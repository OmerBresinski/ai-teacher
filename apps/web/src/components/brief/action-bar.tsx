import { cn } from "@tj/ui";
import type { ReactNode } from "react";

/**
 * The brief's sticky bottom action bar (TEACH-177 item 2): one primary per bar (ruling 33) at
 * 36px (ruling 34), pinned to the foot of the viewport however long the form gets, with an
 * optional one-line reason under the controls when the primary is disabled (item 4).
 *
 * App-local for now. Candidate for `@tj/ui` as `ActionBar` once the Plan review steps need the
 * same bar with "Next" / "Generate"; when that lands, this file becomes a re-export.
 */
/**
 * How far the bar pulls into the padding around it so it rests flush with the viewport's foot
 * at the end of the scroll. `"page"` matches the library layout's page padding (`<main>` has
 * `py-8`, i.e. 32px; see `library-page.tsx` and `lesson-brief.page.tsx`).
 */
const BLEED: Record<"page", string> = { page: "-mb-8" };

export function ActionBar({
  reason,
  reasonId,
  bleed,
  children,
}: {
  /** Why the primary is disabled, in one plain sentence; nothing when it is enabled. */
  reason?: string | null;
  /** The id the disabled primary's `aria-describedby` points at. */
  reasonId?: string;
  /** Pull the bar into the surrounding page padding so it sits flush with the viewport's foot. */
  bleed?: keyof typeof BLEED;
  children: ReactNode;
}) {
  return (
    <div
      data-testid="brief-action-bar"
      className={cn(
        "sticky bottom-0 z-10 mt-2 flex flex-col items-end gap-1.5 border-t border-border bg-background/95 py-3 backdrop-blur",
        bleed ? BLEED[bleed] : undefined,
      )}
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
