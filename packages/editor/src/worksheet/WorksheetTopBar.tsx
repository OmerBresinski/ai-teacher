import type { Worksheet } from "@tj/domain/documents";
import { AppBar, AppBarGroup, Button, IconButton, Tooltip } from "@tj/ui";
import { ArrowLeft, Eye, Printer, Redo2, Undo2 } from "lucide-react";
import type { ReactNode } from "react";
import { InlineTitle } from "../kit/InlineTitle";
import { PanelSeparator } from "../kit/Panel";
import { SaveIndicator } from "../kit/SaveIndicator";
import type { Autosave } from "../model/use-autosave";
import { setTitle } from "./reducers";
import {
  useTypingSession,
  useWorksheet,
  useWorksheetHistoryApi,
  useWorksheetSession,
} from "./worksheet-context";

/*
 * The worksheet editor's top bar (TeachDeck `components/v2/worksheet/WorksheetTopBar.tsx`): back
 * arrow → title (inline rename) → undo / redo at the left; the save indicator, the export slot and
 * the filled Print at the right. The lesson `TopBar`'s shape, so the two editors read as one
 * product. Page size, the printed answer key and self-assessment live on the `HeaderToolbar`,
 * beside the header they change. "Show answers" (TEACH-195) is here because it is a view of the
 * whole sheet, not a document flag: a 32px ghost control with a pressed state, editor state only.
 */

export type WorksheetTopBarProps = {
  onBack: () => void;
  /** Awaits the autosave flush first, so the print tab never opens a second-old sheet. */
  onPrint: () => void;
  /** Where the export menu sits once it exists (E1 / E3). */
  exportSlot?: ReactNode;
  /** The sheet has a block that will not fit a page: Print is off until it is fixed. */
  printBlocked: boolean;
  autosave: Autosave<Worksheet>;
};

const PRINT_BLOCKED = "A question doesn’t fit on its page — shorten it before printing";
const SHOW_ANSWERS_TIP = "Show the answers on screen. Nothing prints.";

export function WorksheetTopBar({
  onBack,
  onPrint,
  exportSlot,
  printBlocked,
  autosave,
}: WorksheetTopBarProps) {
  const worksheet = useWorksheet();
  const typing = useTypingSession();
  const { dispatch, canUndo, canRedo } = useWorksheetHistoryApi();
  const { showAnswers, setShowAnswers } = useWorksheetSession();

  const print = async () => {
    typing.end();
    await autosave.flush();
    onPrint();
  };

  return (
    <AppBar data-topbar className="h-(--topbar-height) shrink-0">
      <AppBarGroup>
        <IconButton label="Back to library" onClick={onBack}>
          <ArrowLeft aria-hidden size={16} strokeWidth={1.5} />
        </IconButton>
        <InlineTitle
          title={worksheet.title}
          fieldLabel="Worksheet title"
          renameLabel="Rename worksheet"
          onCommit={(title) => {
            // A rename is a discrete edit, not a keystroke in a run: its own undo entry. `setTitle`
            // moves the printed header title with it while the two agree.
            typing.end();
            dispatch(setTitle, title);
          }}
        />
        <PanelSeparator />
        <IconButton label="Undo" disabled={!canUndo} onClick={typing.undo}>
          <Undo2 aria-hidden size={16} strokeWidth={1.5} />
        </IconButton>
        <IconButton label="Redo" disabled={!canRedo} onClick={typing.redo}>
          <Redo2 aria-hidden size={16} strokeWidth={1.5} />
        </IconButton>
      </AppBarGroup>

      <AppBarGroup className="ml-auto gap-2">
        <SaveIndicator autosave={autosave} />
        {exportSlot}
        <Tooltip label={SHOW_ANSWERS_TIP}>
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={showAnswers}
            className="aria-pressed:bg-accent aria-pressed:text-foreground"
            onClick={() => setShowAnswers()}
          >
            <Eye aria-hidden size={16} strokeWidth={1.5} />
            Show answers
          </Button>
        </Tooltip>
        {printBlocked ? (
          <Tooltip label={PRINT_BLOCKED}>
            <Button variant="primary" size="sm" aria-disabled="true" className="opacity-50">
              <Printer aria-hidden size={16} strokeWidth={1.5} />
              Print
            </Button>
          </Tooltip>
        ) : (
          <Button variant="primary" size="sm" onClick={() => void print()}>
            <Printer aria-hidden size={16} strokeWidth={1.5} />
            Print
          </Button>
        )}
      </AppBarGroup>
    </AppBar>
  );
}
