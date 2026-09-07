import { cn } from "@tj/ui";
import { type SaveState, type SaveStateSource, useSaveState } from "../model/use-autosave";

/*
 * The save indicator both editors' top bars show (TeachDeck `WorksheetTopBar` "Saving / Saved"
 * and the editor `TopBar`). No `@tj/ui` twin: it is a live region bound to the autosave store, not
 * a status pill. One-line meta, the state carried by a 6px dot beside the word; the live region is
 * the wrapper, not the contents — a region that remounts is a region nothing announces.
 */

const SAVE_LABELS: Record<SaveState, string> = {
  saved: "Saved",
  unsaved: "Unsaved changes",
  saving: "Saving…",
  failed: "Not saved",
};

/**
 * What actually happens, named: an edit is unsaved for 800 ms before a write is even attempted,
 * and a write can fail. Polite live region, so a screen reader hears "Saving…" → "Saved" without
 * being interrupted by it.
 */
export function SaveIndicator({ autosave }: { autosave: SaveStateSource }) {
  const state = useSaveState(autosave);
  const failed = state === "failed";
  return (
    <span
      aria-live="polite"
      data-save-state={state}
      data-tabular
      className={cn(
        "mr-1 inline-flex items-center gap-1.5 text-meta",
        failed ? "text-destructive" : "text-ink-3",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          failed ? "bg-destructive" : state === "saved" ? "bg-success" : "bg-warning",
        )}
      />
      {SAVE_LABELS[state]}
    </span>
  );
}
