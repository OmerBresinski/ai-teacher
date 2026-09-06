import {
  AppBar,
  AppBarGroup,
  Button,
  cn,
  IconButton,
  Input,
  Tooltip,
  useInlineRename,
} from "@tj/ui";
import { ArrowLeft, Pencil, Play, Redo2, Undo2 } from "lucide-react";
import type { ReactNode } from "react";
import { PanelSeparator } from "../kit/Panel";
import * as reducers from "../model/reducers";
import { useHistory, useLesson } from "./document-context";
import { type Autosave, type SaveState, useSaveState } from "./use-autosave";

/*
 * The editor's top bar (TeachDeck `components/v2/editor/TopBar.tsx`): back arrow → title (inline
 * rename) → undo / redo at the left; the save indicator, Theme, Share, Export and the filled
 * Present at the right. 48px (`--topbar-height`), hairline below, on the card surface.
 */

export type TopBarProps = {
  onBack: () => void;
  /** Awaits the autosave flush first, so present mode never opens a second-old deck. */
  onPresent: () => void;
  /** The theme dialog arrives with TEACH-105; until then the button is off. */
  onOpenTheme?: () => void;
  /** Where the export control sits once it exists (E1, TEACH-110). */
  exportSlot?: ReactNode;
  autosave: Autosave;
};

export function TopBar({ onBack, onPresent, onOpenTheme, exportSlot, autosave }: TopBarProps) {
  const lesson = useLesson();
  const { dispatch, undo, redo, canUndo, canRedo } = useHistory();

  const present = async () => {
    await autosave.flush();
    onPresent();
  };

  return (
    <AppBar data-topbar className="h-(--topbar-height) shrink-0">
      {/* The editor's h1 is the title field's static twin, for the landmark outline. */}
      <AppBarGroup>
        <IconButton label="Back to library" onClick={onBack}>
          <ArrowLeft aria-hidden size={16} strokeWidth={1.5} />
        </IconButton>
        <LessonTitle title={lesson.title} onCommit={(t) => dispatch(reducers.setTitle, t)} />
        <PanelSeparator />
        <IconButton label="Undo" disabled={!canUndo} onClick={undo}>
          <Undo2 aria-hidden size={16} strokeWidth={1.5} />
        </IconButton>
        <IconButton label="Redo" disabled={!canRedo} onClick={redo}>
          <Redo2 aria-hidden size={16} strokeWidth={1.5} />
        </IconButton>
      </AppBarGroup>

      <AppBarGroup className="ml-auto gap-2">
        <SaveIndicator autosave={autosave} />
        {/* Theme, Share and Export are the same kind of object three times over, so they take one
            shape — a ghost label — and Present is the only fill in the editor. */}
        <QuietButton
          label="Theme"
          hintLabel="Themes arrive with the slide toolbar"
          onClick={onOpenTheme}
        />
        <QuietButton label="Share" hintLabel="Sharing is not available yet" />
        {exportSlot}
        <Button size="sm" onClick={() => void present()}>
          <Play aria-hidden size={16} strokeWidth={1.5} />
          Present
        </Button>
      </AppBarGroup>
    </AppBar>
  );
}

/* ------------------------------------------------------------------ */

/**
 * The lesson title as an inline-renamable heading (the shell's `useInlineRename` pattern, in place
 * of TeachDeck's own `AppBarTitle onCommit`): double-click, F2 or the pencil opens the field; Enter
 * or blur commits through `setTitle`; Escape cancels.
 */
function LessonTitle({ title, onCommit }: { title: string; onCommit: (title: string) => void }) {
  const rename = useInlineRename(title, { onCommit });
  if (rename.editing) {
    return (
      <Input
        aria-label="Lesson title"
        className="h-8 w-64 font-semibold text-lead"
        {...rename.inputProps}
      />
    );
  }
  return (
    <div className="flex min-w-0 items-center gap-1">
      {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: the heading is the rename target (double-click, F2), as in `PageTitle` */}
      <h1
        className="min-w-0 truncate font-semibold text-lead outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: F2 renames from the heading, as in `PageTitle`
        tabIndex={0}
        onDoubleClick={rename.start}
        onKeyDown={rename.onCardKeyDown}
      >
        {title}
      </h1>
      <IconButton label="Rename lesson" size="sm" onClick={rename.start}>
        <Pencil aria-hidden size={14} strokeWidth={1.5} />
      </IconButton>
    </div>
  );
}

/** A ghost label that is off until its feature lands: focusable, announced as disabled, tooltipped. */
function QuietButton({
  label,
  hintLabel,
  onClick,
}: {
  label: string;
  hintLabel: string;
  onClick?: () => void;
}) {
  if (onClick) {
    return (
      <Button variant="ghost" size="sm" onClick={onClick}>
        {label}
      </Button>
    );
  }
  // `aria-disabled`, not `disabled`: a disabled button swallows pointer and focus events, so its
  // tooltip could never open.
  return (
    <Tooltip label={hintLabel}>
      <Button variant="ghost" size="sm" aria-disabled="true" className="opacity-50">
        {label}
      </Button>
    </Tooltip>
  );
}

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
export function SaveIndicator({ autosave }: { autosave: Autosave }) {
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
