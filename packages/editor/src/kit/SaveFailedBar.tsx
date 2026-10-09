import { Button } from "@tj/ui";
import { useSyncExternalStore } from "react";
import {
  SAVE_FAILED_HINT,
  SAVE_FAILED_MESSAGE,
  SAVE_RETRY_LABEL,
  type SaveStateSource,
} from "../model/use-autosave";

const NO = () => false;
const NEVER = () => null;

/** "Last saved at 14:32", or nothing before the first save of the session. */
function lastSavedLine(at: number | null): string | null {
  if (at === null) return null;
  const time = new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return `Last saved at ${time}.`;
}

/**
 * The slim bar under an editor's top bar while a save is failing (TEACH-245): what is wrong, when
 * the last save landed, and Retry. It stays until a save succeeds; there is no close button, since
 * the work really is unsaved until then. A refusal the app already explained (`SaveRefusedError`)
 * does not raise it. An alert, so a screen reader hears it once when it appears.
 */
export function SaveFailedBar({ autosave }: { autosave: SaveStateSource }) {
  const failing = useSyncExternalStore(autosave.subscribe, autosave.getUnreportedFailure ?? NO, NO);
  const lastSavedAt = useSyncExternalStore(
    autosave.subscribe,
    autosave.getLastSavedAt ?? NEVER,
    NEVER,
  );
  if (!failing) return null;
  const retry = autosave.flush;
  const last = lastSavedLine(lastSavedAt);
  return (
    <div
      role="alert"
      data-save-failed-bar=""
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-destructive/30 border-b bg-destructive/10 px-4 py-2 text-sm"
    >
      <span className="font-medium text-destructive">{SAVE_FAILED_MESSAGE}</span>
      <span className="text-ink-2">
        {last ? `${last} ` : ""}
        {SAVE_FAILED_HINT}
      </span>
      {retry ? (
        <Button size="sm" variant="secondary" className="ml-auto" onClick={() => void retry()}>
          {SAVE_RETRY_LABEL}
        </Button>
      ) : null}
    </div>
  );
}
