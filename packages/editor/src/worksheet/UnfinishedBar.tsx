import type { UnfinishedReason } from "@tj/domain/documents";
import { Button } from "@tj/ui";
import { Trash2 } from "lucide-react";
import { UNFINISHED_REASON, UNFINISHED_TITLE } from "./unfinished-copy";

/*
 * The slim bar under the worksheet editor's top bar while `isUnfinishedWorksheet` holds: the sheet
 * did not finish, why in one line, and Delete. `SaveFailedBar`'s shape, so the two read as one
 * product. A status, not an alert: it is there from the first paint, not something that happened.
 * Remaking the sheet stays where it already lives, the lesson's Worksheet dialog.
 */

export function UnfinishedBar({
  reason,
  onDelete,
}: {
  reason: UnfinishedReason;
  onDelete?: () => void;
}) {
  return (
    <div
      role="status"
      data-unfinished-bar=""
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-warning/30 border-b bg-warning/10 px-4 py-2 text-sm"
    >
      <span className="font-medium text-foreground">{UNFINISHED_TITLE}</span>
      <span className="text-ink-2">{UNFINISHED_REASON[reason]}</span>
      {onDelete ? (
        <Button size="sm" variant="secondary" className="ml-auto" onClick={onDelete}>
          <Trash2 aria-hidden size={16} strokeWidth={1.5} />
          Delete
        </Button>
      ) : null}
    </div>
  );
}
