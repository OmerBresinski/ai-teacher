import type { Id, RichDoc, WorksheetBlock } from "@tj/domain/documents";
import { IconButton } from "@tj/ui";
import { GripVertical, Plus, TriangleAlert } from "lucide-react";
import {
  lazy,
  memo,
  type PointerEvent as ReactPointerEvent,
  Suspense,
  useCallback,
  useMemo,
} from "react";
import { BlockContent, SheetText, type StemRenderer } from "./BlockContent";
import type { BlockKeyHandlers } from "./BlockTextEditor";
import { EditableBlock, INLINE_EDIT_TYPES } from "./EditableBlocks";
import { HANDLE_X, PLUS_X } from "./metrics";
import type { CaretIntent } from "./use-worksheet-session";

/**
 * Vertical offset for the gutter buttons, in points (TeachDeck `BlockShell.tsx`).
 *
 * BlockNote's rule, and the reason matters more than the numbers: the handle is *offset* to the
 * centre of the block's first line, never stretched to the block's height, because a stretched
 * invisible target swallows clicks meant for the controls beside it — which on this sheet would be a
 * matching block's or a table's own rows. The formula is `(first line height - handle height) / 2`
 * with the handle 24pt tall; the first line heights come straight out of worksheet.css.
 */
const HANDLE_H = 24;
const firstLinePt = (block: WorksheetBlock): number => {
  switch (block.type) {
    case "heading":
      return block.level === 1 ? 14 * 1.3 : 12 * 1.35;
    case "instructions":
      return 10.5 * 1.5;
    case "word-bank":
    case "answer-box":
      return 9.5 * 1.4; // the label above the box
    case "table":
      return 10.5 * 1.5 + 10; // a cell's line plus its 5pt padding, top and bottom
    case "image":
    case "divider":
    case "lines":
    case "page-break":
      return HANDLE_H; // nothing to centre on: leave the handle at the block top
    default:
      return 11 * 1.5; // body copy
  }
};
const handleOffsetPt = (block: WorksheetBlock): number =>
  Math.round(((firstLinePt(block) - HANDLE_H) / 2) * 100) / 100;

const GLYPH = { width: "11pt", height: "11pt" } as const;

/** Tiptap and ProseMirror load only when a block is actually being typed into (ADR 0022 §8). */
const BlockTextEditor = lazy(() => import("./BlockTextEditor"));

/**
 * What a block row can ask the editor to do, addressed by block so one stable object serves every
 * row (and `memo` below holds). `WorksheetEditor` builds it once over refs to its latest state.
 */
export type BlockRowActions = {
  onSelect: (block: WorksheetBlock, event: ReactPointerEvent<HTMLDivElement>) => void;
  onPlus: (anchor: HTMLElement, id: Id) => void;
  onHandleDown: (block: WorksheetBlock, event: ReactPointerEvent<HTMLElement>) => void;
  /** Enter at the end of the block's text. */
  onSplit: (block: WorksheetBlock) => void;
  onBackspaceAtStart: (block: WorksheetBlock, doc: RichDoc) => void;
  /** `/` in an empty rich block. */
  onSlash: (id: Id) => void;
  onMove: (id: Id, direction: -1 | 1) => void;
  registerRef: (id: Id, el: HTMLElement | null) => void;
};

export type BlockShellProps = {
  block: WorksheetBlock;
  selected: boolean;
  editing: boolean;
  caret: CaretIntent;
  oversize: boolean;
  actions: BlockRowActions;
};

/**
 * The editor chrome around one block: the gutter handle and insert button that appear on row
 * hover, the selection frame, and the "won't fit" warning. None of it exists in the printed sheet.
 * Memoised on its props: the reducers keep an untouched block's identity, and `WorksheetEditor`
 * hands every row stable callbacks, so a keystroke in one block re-renders that block alone.
 */
export const BlockShell = memo(function BlockShell({
  block,
  selected,
  editing,
  caret,
  oversize,
  actions,
}: BlockShellProps) {
  const keyHandlers = useMemo<BlockKeyHandlers>(
    () => ({
      onSplit: () => actions.onSplit(block),
      onBackspaceAtStart: (doc) => actions.onBackspaceAtStart(block, doc),
      onSlash: () => actions.onSlash(block.id),
      onMove: (direction) => actions.onMove(block.id, direction),
    }),
    [actions, block],
  );
  const registerRef = useCallback(
    (el: HTMLElement | null) => actions.registerRef(block.id, el),
    [actions, block.id],
  );

  // Only the block being edited swaps its rich-text run for the Tiptap instance; every other row
  // renders the printed markup, so `BlockContent` keeps its empty-state hints.
  const renderStem: StemRenderer | undefined = editing
    ? ({ doc, className }) => (
        // The static text stands in for the frame or two the editor chunk takes to arrive.
        <Suspense fallback={<SheetText doc={doc} className={className} />}>
          <BlockTextEditor
            id={block.id}
            doc={doc}
            className={className}
            caret={caret}
            handlers={keyHandlers}
          />
        </Suspense>
      )
    : undefined;

  return (
    <div
      ref={registerRef}
      className="ws-block ws-shell"
      data-block-id={block.id}
      onPointerDown={(event) => actions.onSelect(block, event)}
    >
      {/* The warning is editor-only: `measure.tsx` renders `FlowItemContent`, never `BlockShell`,
          so it does not reach pagination. Sized in points like everything on the sheet, because
          the page is drawn through a CSS scale. */}
      {oversize ? (
        <p className="ws-warning" role="status">
          <TriangleAlert style={{ width: "10pt", height: "10pt" }} aria-hidden />
          This question won’t fit on one page. Shorten it or cut its answer lines.
        </p>
      ) : null}

      <IconButton
        label="Insert a block below"
        className="ws-gutter"
        style={{ left: `${PLUS_X}pt`, top: `${handleOffsetPt(block)}pt` }}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => actions.onPlus(e.currentTarget, block.id)}
      >
        <Plus style={GLYPH} strokeWidth={1.5} aria-hidden />
      </IconButton>

      {/* No tooltip on the handle: it would open under the cursor the instant the drag began. */}
      <IconButton
        label="Drag to reorder this block"
        noTooltip
        className="ws-gutter ws-gutter-handle"
        style={{ left: `${HANDLE_X}pt`, top: `${handleOffsetPt(block)}pt` }}
        onPointerDown={(event) => actions.onHandleDown(block, event)}
      >
        <GripVertical style={GLYPH} strokeWidth={1.5} aria-hidden />
      </IconButton>

      {selected ? <div className="ws-selected-ring" /> : null}

      {INLINE_EDIT_TYPES.includes(block.type) ? (
        <EditableBlock block={block} renderStem={renderStem} />
      ) : (
        <BlockContent block={block} mode="edit" renderStem={renderStem} />
      )}
    </div>
  );
});
