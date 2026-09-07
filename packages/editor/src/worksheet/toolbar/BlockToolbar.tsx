import type { WorksheetBlock } from "@tj/domain/documents";
import { Kbd, Tooltip } from "@tj/ui";
import { Copy, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { Panel, PanelSeparator } from "../../kit/Panel";
import { specForBlock } from "../block-types";
import { deleteBlock, duplicateBlock } from "../reducers";
import { useTypingSession, useWorksheetHistoryApi } from "../worksheet-context";
import { AnswerSpaceToolbar } from "./AnswerSpaceToolbar";
import { LayoutToolbar } from "./LayoutToolbar";
import { QuestionToolbar } from "./QuestionToolbar";
import { BarButton, ICON_SM } from "./shared";
import { WordSearchToolbar } from "./WordSearchToolbar";

/*
 * The floating toolbar over the selected block (TeachDeck `components/v2/worksheet/BlockToolbar.tsx`,
 * split here by block family so no file passes 300 lines). Every block gets the block's name and
 * the two closing actions — Duplicate and Delete; the family in the middle is type-specific:
 * `QuestionToolbar` (question, multiple-choice, fill-gap, matching), `WordSearchToolbar`,
 * `AnswerSpaceToolbar` (answer-box, lines, word-bank), `LayoutToolbar` (heading, image, table).
 * Paragraph, instructions, divider and page-break have nothing to set.
 *
 * Sticky at the top of the paper column, centred (`.ws-toolbar`); a bar anchored to the block would
 * ride under the topbar on the first block and off the screen on the last.
 */

export function BlockToolbar({ block }: { block: WorksheetBlock }) {
  const { dispatch } = useWorksheetHistoryApi();
  const typing = useTypingSession();
  const spec = specForBlock(block);

  const act = (fn: () => void) => {
    typing.end();
    fn();
  };

  return (
    <div className="ws-toolbar" data-block-toolbar={block.type}>
      <Panel as="bar" role="toolbar" aria-label={`${spec.label} block`}>
        <span className="inline-flex items-center gap-1.5 pr-1 pl-1 text-body text-ink-2">
          <span className="text-ink-3 [&>svg]:size-4">{spec.icon}</span>
          {spec.label}
        </span>
        <Family block={block} />
        <PanelSeparator />
        <Tooltip label="Duplicate block" shortcut="⌘D">
          <BarButton
            aria-label="Duplicate block"
            onClick={() => act(() => dispatch(duplicateBlock, block.id))}
          >
            <Copy {...ICON_SM} aria-hidden />
          </BarButton>
        </Tooltip>
        <Tooltip
          label={
            <>
              Delete block <Kbd>⌫</Kbd>
            </>
          }
        >
          <BarButton
            aria-label="Delete block"
            className="text-destructive hover:bg-destructive/10"
            onClick={() => act(() => dispatch(deleteBlock, block.id))}
          >
            <Trash2 {...ICON_SM} aria-hidden />
          </BarButton>
        </Tooltip>
      </Panel>
    </div>
  );
}

function Family({ block }: { block: WorksheetBlock }): ReactNode {
  switch (block.type) {
    case "question":
    case "multiple-choice":
    case "fill-gap":
    case "matching":
      return (
        <>
          <PanelSeparator />
          <QuestionToolbar block={block} />
        </>
      );
    case "word-search":
      return (
        <>
          <PanelSeparator />
          <WordSearchToolbar block={block} />
        </>
      );
    case "answer-box":
    case "lines":
    case "word-bank":
      return (
        <>
          <PanelSeparator />
          <AnswerSpaceToolbar block={block} />
        </>
      );
    case "heading":
    case "image":
    case "table":
      return (
        <>
          <PanelSeparator />
          <LayoutToolbar block={block} />
        </>
      );
    default:
      return null;
  }
}
