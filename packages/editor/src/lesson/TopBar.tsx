import type { Lesson } from "@tj/domain/documents";
import {
  AppBar,
  AppBarGroup,
  Button,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
} from "@tj/ui";
import {
  ArrowLeft,
  ChevronDown,
  Ellipsis,
  FileText,
  ListChecks,
  Play,
  Redo2,
  Undo2,
} from "lucide-react";
import type { ReactNode } from "react";
import { InlineTitle } from "../kit/InlineTitle";
import { PanelSeparator } from "../kit/Panel";
import { SaveIndicator } from "../kit/SaveIndicator";
import * as reducers from "../model/reducers";
import type { Autosave } from "../model/use-autosave";
import { enterPresentFullscreen } from "../present/use-fullscreen";
import { useHistory, useLesson } from "./document-context";
import { ThemeCallout } from "./ThemeDialog";
import { useMobileEditor } from "./use-mobile-editor";

/*
 * The editor's top bar (ruling 186): back arrow → title (inline rename) → undo / redo → Saved at
 * the left; the selected-theme callout, ⋯ (Share, Facts, Worksheet), Export and the filled Present
 * at the right. The theme callout stays in the bar, never in ⋯ (ruling 123). On a phone the bar
 * keeps its compact shape: Undo and Redo fold into More. 48px (`--topbar-height`), hairline below.
 */

export type TopBarProps = {
  onBack: () => void;
  /** Awaits the autosave flush first, so present mode never opens a second-old deck. */
  onPresent: () => void;
  /** Opens the theme picker from the selected-theme callout (ruling 123). */
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
  /**
   * The app's Worksheet control (the lesson's sheets, with the maker inside), listed in ⋯ as the
   * one Worksheet entry (ruling 186); it replaces the built-in Worksheet button when given.
   */
  worksheetsSlot?: ReactNode;
};

/** Below 1180px Facts and Worksheet show as icons (names kept for screen readers), so Present and
 * the longest save label ("Unsaved changes") fit on one row at 1024. */
const NARROW_LABEL = "max-[1180px]:sr-only";

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
  worksheetsSlot,
}: TopBarProps) {
  const lesson = useLesson();
  const mobile = useMobileEditor();
  const { dispatch, undo, redo, canUndo, canRedo } = useHistory();
  const worksheetId = lesson.artefacts?.worksheetId;

  const present = async () => {
    // Before the await: the fullscreen request needs this click's gesture (ruling 104).
    enterPresentFullscreen();
    await autosave.flush();
    onPresent();
  };

  const secondaryActions = (
    <>
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
          <span className={NARROW_LABEL}>Facts</span>
        </Button>
      ) : null}
      {/* One Worksheet entry: the app's list-and-maker when it gives one, else the direct open or
          the creation flow. */}
      {worksheetsSlot ? (
        worksheetsSlot
      ) : worksheetId && onOpenWorksheet ? (
        <Button
          variant="ghost"
          size="sm"
          data-worksheet-link={worksheetId}
          onClick={() => onOpenWorksheet(worksheetId)}
        >
          <FileText aria-hidden size={16} strokeWidth={1.5} />
          <span className={NARROW_LABEL}>Worksheet</span>
        </Button>
      ) : onNewWorksheet ? (
        <Button variant="ghost" size="sm" data-new-worksheet onClick={onNewWorksheet}>
          <FileText aria-hidden size={16} strokeWidth={1.5} />
          <span className={NARROW_LABEL}>Worksheet</span>
        </Button>
      ) : null}
    </>
  );

  if (!mobile) {
    return (
      <AppBar data-topbar className="h-(--topbar-height) shrink-0">
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
          <SaveIndicator autosave={autosave} />
        </AppBarGroup>

        <AppBarGroup className="ml-auto gap-2">
          {/* Ruling 123: the selected theme, named, stays in the bar and never folds into ⋯. */}
          {onOpenTheme ? (
            <ThemeCallout themeId={lesson.themeId} onClick={onOpenTheme} className="shrink-0" />
          ) : null}
          {/* Everything used now and then sits in one menu; Export stays visible and Present is
              the only fill in the editor (ruling 186). */}
          <Popover>
            <PopoverTrigger asChild>
              <IconButton label="More lesson actions" data-lesson-actions>
                <Ellipsis aria-hidden size={16} strokeWidth={1.5} />
              </IconButton>
            </PopoverTrigger>
            <PopoverContent
              aria-label="Lesson actions"
              align="end"
              className="w-56 p-1.5"
              // Focus the first action that works, not Share: focused, Share's hint opens and the
              // first Escape would only close that hint instead of the menu.
              onOpenAutoFocus={(e) => {
                e.preventDefault();
                const content = e.currentTarget as HTMLElement;
                const first = content.querySelector<HTMLElement>(
                  'button:not([disabled]):not([aria-disabled="true"])',
                );
                (first ?? content).focus();
              }}
            >
              {/* A column of full-width rows: the content's own wrapper is a plain block. */}
              <div className="flex flex-col items-stretch gap-0.5 [&_button]:w-full [&_button]:justify-start">
                {secondaryActions}
              </div>
            </PopoverContent>
          </Popover>
          {exportSlot}
          <Button variant="primary" size="sm" aria-label="Present" onClick={() => void present()}>
            <Play aria-hidden size={16} strokeWidth={1.5} />
            Present
          </Button>
        </AppBarGroup>
      </AppBar>
    );
  }

  return (
    <AppBar data-topbar data-mobile-topbar className="h-(--topbar-height) shrink-0">
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
      </AppBarGroup>

      <AppBarGroup className="ml-auto gap-2">
        <SaveIndicator autosave={autosave} />
        {/* Ruling 123: the theme callout is visible on a phone too. */}
        {onOpenTheme ? (
          <ThemeCallout
            themeId={lesson.themeId}
            onClick={onOpenTheme}
            compact
            className="shrink-0"
          />
        ) : null}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" aria-label="More lesson actions">
              <ChevronDown aria-hidden />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            aria-label="Lesson actions"
            className="flex w-60 flex-col items-stretch gap-1 p-2"
          >
            <Button variant="ghost" disabled={!canUndo} onClick={undo}>
              <Undo2 />
              Undo
            </Button>
            <Button variant="ghost" disabled={!canRedo} onClick={redo}>
              <Redo2 />
              Redo
            </Button>
            {secondaryActions}
            {exportSlot}
          </PopoverContent>
        </Popover>
        <Button variant="primary" size="sm" aria-label="Present" onClick={() => void present()}>
          <Play aria-hidden size={16} strokeWidth={1.5} />
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
