import type { UnfinishedReason } from "@tj/domain/documents";
import { Button } from "@tj/ui";
import { RotateCcw, Trash2 } from "lucide-react";
import {
  MAKING_REASON,
  MAKING_TITLE,
  RETRY_LABEL,
  UNFINISHED_REASON,
  UNFINISHED_TITLE,
} from "./unfinished-copy";

/*
 * The slim bar under the worksheet editor's top bar while `isUnfinishedWorksheet` holds: the sheet
 * did not finish, why in one line, and Delete. `SaveFailedBar`'s shape, so the two read as one
 * product. A status, not an alert: it is there from the first paint, not something that happened.
 * A failed sheet (`stage: "failed"`) shows the reason its job saved and, when the app can make the
 * request, Try again. While the job still holds the sheet the bar says it is being made, with no
 * buttons.
 */

export function UnfinishedBar({
  reason,
  detail,
  making = false,
  onDelete,
  onRetry,
  retrying = false,
}: {
  reason: UnfinishedReason;
  /** The job's own words for a failure (`generation.failure.message`); else the reason's copy. */
  detail?: string;
  making?: boolean;
  onDelete?: () => void;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  return (
    <div
      role="status"
      data-unfinished-bar={making ? "making" : reason}
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-warning/30 border-b bg-warning/10 px-4 py-2 text-sm"
    >
      <span className="font-medium text-foreground">
        {making ? MAKING_TITLE : UNFINISHED_TITLE}
      </span>
      <span className="text-ink-2">
        {making ? MAKING_REASON : (detail ?? UNFINISHED_REASON[reason])}
      </span>
      {!making && (onRetry || onDelete) ? (
        <span className="ml-auto flex gap-2">
          {reason === "failed" && onRetry ? (
            <Button size="sm" variant="default" onClick={onRetry} disabled={retrying}>
              <RotateCcw aria-hidden size={16} strokeWidth={1.5} />
              {RETRY_LABEL}
            </Button>
          ) : null}
          {onDelete ? (
            <Button size="sm" variant="secondary" onClick={onDelete}>
              <Trash2 aria-hidden size={16} strokeWidth={1.5} />
              Delete
            </Button>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}
