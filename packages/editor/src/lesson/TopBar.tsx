import type { Lesson } from "@tj/domain/documents";
import { AppBar, AppBarGroup, Button, IconButton, Tooltip } from "@tj/ui";
import { ArrowLeft, FileText, ListChecks, Play, Redo2, Undo2 } from "lucide-react";
import type { ReactNode } from "react";
import { InlineTitle } from "../kit/InlineTitle";
import { PanelSeparator } from "../kit/Panel";
import { SaveIndicator } from "../kit/SaveIndicator";
import * as reducers from "../model/reducers";
import type { Autosave } from "../model/use-autosave";
import { useHistory, useLesson } from "./document-context";

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
  /**
   * Opens the generated worksheet (`/w/$worksheetId` in the app, ADR 0025 §4). The "Worksheet"
   * button shows only when the lesson has `artefacts.worksheetId` and the app handles the open.
   */
  onOpenWorksheet?: (worksheetId: string) => void;
  /**
   * Opens the worksheet creation flow on Kind for this lesson (TEACH-184). The same "Worksheet"
   * label as above, shown when the lesson has no generated sheet to open instead.
   */
  onNewWorksheet?: () => void;
  /** Toggles the facts panel (TEACH-134); absent when the app has not wired the proposal jobs. */
  onToggleFacts?: () => void;
  factsOpen?: boolean;
  autosave: Autosave<Lesson>;
};

export function TopBar({
  onBack,
  onPresent,
  onOpenTheme,
  exportSlot,
  onOpenWorksheet,
  onNewWorksheet,
  onToggleFacts,
  factsOpen = false,
  autosave,
}: TopBarProps) {
  const lesson = useLesson();
  const { dispatch, undo, redo, canUndo, canRedo } = useHistory();
  const worksheetId = lesson.artefacts?.worksheetId;

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
        <InlineTitle
          title={lesson.title}
          fieldLabel="Lesson title"
          renameLabel="Rename lesson"
          onCommit={(t) => dispatch(reducers.setTitle, t)}
        />
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
        {onToggleFacts ? (
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={factsOpen}
            data-facts-toggle
            onClick={onToggleFacts}
          >
            <ListChecks aria-hidden size={16} strokeWidth={1.5} />
            Facts
          </Button>
        ) : null}
        {worksheetId && onOpenWorksheet ? (
          <Button
            variant="ghost"
            size="sm"
            data-worksheet-link={worksheetId}
            onClick={() => onOpenWorksheet(worksheetId)}
          >
            <FileText aria-hidden size={16} strokeWidth={1.5} />
            Worksheet
          </Button>
        ) : onNewWorksheet ? (
          <Button variant="ghost" size="sm" data-new-worksheet onClick={onNewWorksheet}>
            <FileText aria-hidden size={16} strokeWidth={1.5} />
            Worksheet
          </Button>
        ) : null}
        {exportSlot}
        <Button variant="primary" size="sm" onClick={() => void present()}>
          <Play aria-hidden size={16} strokeWidth={1.5} />
          Present
        </Button>
      </AppBarGroup>
    </AppBar>
  );
}

/* ------------------------------------------------------------------ */

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
