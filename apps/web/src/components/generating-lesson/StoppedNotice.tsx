import { Button, IconButton } from "@tj/ui";
import { X } from "lucide-react";

export const STOPPED_NOTICE = "Stopped. The slides written so far are here to edit.";
export const FAILED_NOTICE =
  "Something went wrong before the lesson was finished. The slides written so far are here to edit.";
export const TRY_AGAIN_LABEL = "Try again";
export const TRY_AGAIN_FAILED = "That didn’t start. Try again in a moment.";

/**
 * After Stop or a failure the teacher stays in the editor with every slide written so far (UX-A).
 * One plain line says so over the slide; a failure adds Try again, which writes the rest. Stop
 * offers nothing more: the teacher asked for it. Light on purpose: it is on the editor's chunk.
 */
export function StoppedNotice({
  outcome,
  onTryAgain,
  trying,
  error,
  onDismiss,
}: {
  outcome: "failed" | "cancelled";
  onTryAgain?: () => void;
  trying?: boolean;
  error?: boolean;
  onDismiss: () => void;
}) {
  const failed = outcome === "failed";
  return (
    <div
      role="status"
      data-stopped-notice={outcome}
      className="fixed top-14 left-1/2 z-40 flex w-[min(640px,calc(100vw-32px))] -translate-x-1/2 items-center gap-3 rounded-lg border border-border bg-background py-2 pr-2 pl-4 text-sm text-foreground shadow-md"
    >
      <p className="m-0 flex-1">
        {failed ? FAILED_NOTICE : STOPPED_NOTICE}
        {error ? <span className="mt-1 block text-destructive">{TRY_AGAIN_FAILED}</span> : null}
      </p>
      {failed && onTryAgain ? (
        <Button size="sm" variant="default" disabled={trying} onClick={onTryAgain}>
          {TRY_AGAIN_LABEL}
        </Button>
      ) : null}
      <IconButton label="Dismiss" onClick={onDismiss}>
        <X aria-hidden size={16} strokeWidth={1.5} />
      </IconButton>
    </div>
  );
}
