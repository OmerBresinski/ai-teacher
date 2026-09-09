import type { QueryKey } from "@tanstack/react-query";
import type { Id, LessonFacts, RichDoc, Worksheet, WorksheetBlock } from "@tj/domain/documents";
import { Button } from "@tj/ui";
import { Plus } from "lucide-react";
import {
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { isInTextField, matchesBinding } from "../lesson/keys";
import { getTheme } from "../model/themes";
import { useAutosave } from "../model/use-autosave";
import { newBlock } from "../model/worksheet-factories";
import type { WorksheetRecipe } from "../model/worksheet-recipes";
import { ActiveEditorProvider } from "../text/active-editor";
import { isDocEmpty } from "../text/static";
import { AddBlockDialog } from "./AddBlockDialog";
import { FlowItemContent } from "./BlockContent";
import { type BlockRowActions, BlockShell } from "./BlockShell";
import { type BlockSpec, blankStem, isRich } from "./block-types";
import { EditableHeader } from "./EditableHeader";
import { HeaderToolbar } from "./HeaderToolbar";
import { useSheetPagination } from "./measure";
import { fitScale, pageMetrics } from "./metrics";
import { HEADER_KEY } from "./paginate";
import { deleteBlock, duplicateBlock, insertBlock, moveBlock, updateBlock } from "./reducers";
import { flowItemClass, Sheet } from "./Sheet";
import { SlashMenu } from "./SlashMenu";
import type { SlashItem } from "./slash-items";
import { BlockToolbar } from "./toolbar/BlockToolbar";
import { useTypingSessionState } from "./typing-session";
import { useBlockDrag } from "./use-block-drag";
import { useWorksheetHistory } from "./use-worksheet-history";
import { useWorksheetSessionState } from "./use-worksheet-session";
import { WorksheetTopBar } from "./WorksheetTopBar";
import {
  TypingSessionProvider,
  type WorksheetHistoryApi,
  WorksheetHistoryProvider,
  WorksheetProvider,
  WorksheetSessionProvider,
} from "./worksheet-context";

/*
 * The worksheet editor shell (TeachDeck `components/v2/worksheet/WorksheetEditor.tsx`): the top
 * bar over a scrolling column of paper. The document lives in the TanStack Query cache under
 * `queryKey` and is edited through `useWorksheetHistory` (ADR 0022 §4); selection and the open
 * editor are React state (`useWorksheetSessionState`); typing runs collapse into one undo step
 * each through the typing session; saving is the app's `onSave`, debounced by `useAutosave`.
 *
 * The pages are the print route's pages: the same `useSheetPagination` measures the same printed
 * markup off-screen, so the page breaks the teacher sees while typing are the ones the printer
 * will make. The editor only adds chrome around each item (`BlockShell`) and scales each page to
 * the column (`pageWrapper`).
 */

export type WorksheetEditorProps = {
  worksheetId: string;
  /** The cache entry that holds the document — `queryKeys.libraryDocument(id)` in the app. */
  queryKey: QueryKey;
  /** Fetches the document for a first mount the loader has not filled. */
  queryFn?: () => Promise<unknown>;
  /** Persist the document: the mock store today, `PUT /documents/:id` later. */
  onSave: (worksheet: Worksheet) => Promise<void>;
  onBack: () => void;
  /** Called after the autosave has flushed: open `/w/$id/print?auto=1`. */
  onPrint: () => void;
  /** Where the export menu sits once it exists (E1 / E3). */
  exportSlot?: ReactNode;
  /**
   * The facts of the lesson this sheet belongs to (`worksheet.lessonId`), when the app has them:
   * the "Add a block" sections are built from these. Without them, the placeholder build.
   */
  facts?: LessonFacts;
};

type RichBlock = Extract<WorksheetBlock, { doc: RichDoc }>;

/** The column's horizontal padding either side of the page, in px. */
const COLUMN_PAD = 48;

export function WorksheetEditor({
  worksheetId,
  queryKey,
  queryFn,
  onSave,
  onBack,
  onPrint,
  exportSlot,
  facts,
}: WorksheetEditorProps) {
  const autosave = useAutosave(onSave);
  const { worksheet, ...history } = useWorksheetHistory({
    queryKey,
    queryFn,
    onChange: autosave.onChange,
  });
  // `history` is a fresh object each render; its members are stable, so this is the identity the
  // providers and the typing session key on (the lesson shell does the same).
  const {
    dispatch,
    undo,
    redo,
    canUndo,
    canRedo,
    beginTransaction,
    endTransaction,
    rollbackTransaction,
    flushTransactions,
    isTransactionInFlight,
  } = history;
  const historyApi = useMemo<WorksheetHistoryApi>(
    () => ({
      dispatch,
      undo,
      redo,
      canUndo,
      canRedo,
      beginTransaction,
      endTransaction,
      rollbackTransaction,
      flushTransactions,
      isTransactionInFlight,
    }),
    [
      dispatch,
      undo,
      redo,
      canUndo,
      canRedo,
      beginTransaction,
      endTransaction,
      rollbackTransaction,
      flushTransactions,
      isTransactionInFlight,
    ],
  );
  const typing = useTypingSessionState(historyApi);
  const session = useWorksheetSessionState();
  const theme = useMemo(() => getTheme(worksheet?.themeId), [worksheet?.themeId]);
  const { pages, oversize, measureNode } = useSheetPagination(
    worksheet ?? null,
    theme,
    worksheet?.includeAnswerKey ?? false,
  );

  // Latest document and session for the handlers below, which are built once.
  const worksheetRef = useRef(worksheet);
  worksheetRef.current = worksheet;
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const historyRef = useRef(historyApi);
  historyRef.current = historyApi;
  const typingRef = useRef(typing);
  typingRef.current = typing;

  // The page column scales the paper to fit its width.
  const columnRef = useRef<HTMLDivElement>(null);
  const [columnWidth, setColumnWidth] = useState(0);
  useEffect(() => {
    const el = columnRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setColumnWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const pageW = pageMetrics(worksheet?.pageSize).page.w;
  const scale = columnWidth ? fitScale(columnWidth - COLUMN_PAD * 2, pageW) : 1;

  // The block rows, by id, for the slash menu anchor and the drag geometry.
  const rowEls = useRef(new Map<Id, HTMLElement>());
  const [slash, setSlash] = useState<{ afterId: Id | null; replaceId: Id | null } | null>(null);
  const slashAnchor = useRef<HTMLElement | null>(null);
  // The "Add a block" dialog: where its blocks go (`null` appends, from the pill).
  const [adder, setAdder] = useState<{ afterId: Id | null } | null>(null);

  /* ---- editing intents ------------------------------------------------ */

  const insertAfter = useCallback((block: WorksheetBlock, afterId: Id | null) => {
    const h = historyRef.current;
    typingRef.current.end();
    h.dispatch(insertBlock, block, afterId);
    sessionRef.current.select(block.id);
    if (isRich(block)) sessionRef.current.setEditing(block.id, "start");
    else sessionRef.current.setEditing(null);
  }, []);

  const openSlash = useCallback((anchor: HTMLElement, afterId: Id | null, replaceId: Id | null) => {
    slashAnchor.current = anchor;
    setSlash({ afterId, replaceId });
  }, []);

  /**
   * Insert `blocks` in order after `afterId` (`null` appends) as one undo step, then select the
   * first and open its editor when it has text. `replaceId` is the empty paragraph a `/` was typed
   * in: it goes in the same step, after the new blocks have taken its place.
   */
  const insertBlocks = useCallback(
    (blocks: WorksheetBlock[], afterId: Id | null, replaceId: Id | null = null) => {
      const first = blocks[0];
      if (!first) return;
      const h = historyRef.current;
      typingRef.current.end();
      const token = h.beginTransaction();
      let anchor = afterId;
      for (const block of blocks) {
        h.dispatch(insertBlock, block, anchor);
        anchor = block.id;
      }
      if (replaceId) h.dispatch(deleteBlock, replaceId);
      h.endTransaction(token);
      sessionRef.current.select(first.id);
      if (isRich(first)) sessionRef.current.setEditing(first.id, "start");
      else sessionRef.current.setEditing(null);
    },
    [],
  );

  const pickFromSlash = useCallback(
    (item: SlashItem) => {
      const target = slash;
      setSlash(null);
      if (!target) return;
      // `/` in an empty paragraph replaces it; a section's blocks land where the paragraph was.
      const blocks =
        item.pick.kind === "block"
          ? [blankStem(item.pick.spec.create())]
          : item.pick.recipe.build(facts);
      insertBlocks(blocks, target.afterId, target.replaceId);
    },
    [slash, facts, insertBlocks],
  );

  const pickRecipe = useCallback(
    (_recipe: WorksheetRecipe, blocks: WorksheetBlock[]) => {
      const target = adder;
      setAdder(null);
      if (target) insertBlocks(blocks, target.afterId);
    },
    [adder, insertBlocks],
  );

  const pickBlock = useCallback(
    (spec: BlockSpec) => {
      const target = adder;
      setAdder(null);
      if (target) insertBlocks([blankStem(spec.create())], target.afterId);
    },
    [adder, insertBlocks],
  );

  const order = useRef<Id[]>([]);
  order.current = worksheet?.blocks.map((b) => b.id) ?? [];
  const drag = useBlockDrag({
    order,
    rowEls,
    columnRef,
    onDrop: (id, toIndex) => {
      typingRef.current.end();
      historyRef.current.dispatch(moveBlock, id, toIndex);
    },
  });

  const rowActions = useMemo<BlockRowActions>(
    () => ({
      registerRef: (id, el) => {
        if (el) rowEls.current.set(id, el);
        else rowEls.current.delete(id);
      },
      onSelect: (block, event) => {
        const s = sessionRef.current;
        if (s.activeBlockId !== block.id) s.select(block.id);
        // A click on a rich block opens its editor with the caret under the pointer; one that
        // landed on a field (an option, a cell) is the field's own.
        if (isRich(block) && !isInTextField(event.target)) {
          if (s.editingId !== block.id) {
            s.setEditing(block.id, { x: event.clientX, y: event.clientY });
          }
        } else if (!isInTextField(event.target)) {
          s.setEditing(null);
        }
      },
      onPlus: (_anchor, id) => setAdder({ afterId: id }),
      onHandleDown: (block, event) => {
        event.stopPropagation();
        typingRef.current.end();
        sessionRef.current.setEditing(null);
        sessionRef.current.select(block.id);
        drag.start(block.id, event);
      },
      onSplit: (block) => {
        // Enter at the end of a heading or question starts a paragraph beneath; at the end of a
        // paragraph, another paragraph.
        insertAfter(blankStem(newBlock("paragraph")), block.id);
      },
      onBackspaceAtStart: (block, doc) => {
        const w = worksheetRef.current;
        if (!w) return;
        const h = historyRef.current;
        const at = w.blocks.findIndex((b) => b.id === block.id);
        const prev = at > 0 ? w.blocks[at - 1] : undefined;
        typingRef.current.end();
        if (isDocEmpty(doc)) {
          // An empty block goes, and the caret lands at the end of the one above.
          h.dispatch(deleteBlock, block.id);
          if (prev) {
            sessionRef.current.select(prev.id);
            if (isRich(prev)) sessionRef.current.setEditing(prev.id, "end");
            else sessionRef.current.setEditing(null);
          }
          return;
        }
        if (block.type !== "paragraph") {
          // A question with text does not vanish on Backspace: it becomes a paragraph first.
          const token = h.beginTransaction();
          h.dispatch(deleteBlock, block.id);
          h.dispatch(insertBlock, { id: block.id, type: "paragraph", doc }, prev?.id ?? null);
          h.endTransaction(token);
          sessionRef.current.setEditing(block.id, "start");
          return;
        }
        if (prev && prev.type === "paragraph") {
          // Two paragraphs join; the caret sits where they met.
          const joinAt = (prev.doc.content?.length ?? 1) - 1;
          const merged: RichDoc = {
            type: "doc",
            content: [...(prev.doc.content ?? []), ...(doc.content ?? [])],
          };
          const token = h.beginTransaction();
          h.dispatch(updateBlock<RichBlock>, prev.id, { doc: merged });
          h.dispatch(deleteBlock, block.id);
          h.endTransaction(token);
          sessionRef.current.select(prev.id);
          sessionRef.current.setEditing(prev.id, { child: joinAt });
        }
      },
      onSlash: (id) => {
        const el = rowEls.current.get(id);
        if (el) openSlash(el, id, id);
      },
      onMove: (id, direction) => {
        const w = worksheetRef.current;
        if (!w) return;
        const at = w.blocks.findIndex((b) => b.id === id);
        const to = at + direction;
        if (at === -1 || to < 0 || to >= w.blocks.length) return;
        typingRef.current.end();
        historyRef.current.dispatch(moveBlock, id, to);
      },
    }),
    [drag, insertAfter, openSlash],
  );

  const onHeaderSelect = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const s = sessionRef.current;
    s.select(HEADER_KEY);
    if (!isInTextField(event.target)) s.setEditing(null);
  }, []);
  const registerHeader = useCallback((el: HTMLElement | null) => {
    if (el) rowEls.current.set(HEADER_KEY, el);
    else rowEls.current.delete(HEADER_KEY);
  }, []);

  /* ---- the shell's keys --------------------------------------------------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      // Undo / redo are the history's everywhere on the page, including inside a block editor —
      // ProseMirror's own history is off (`block-extensions.ts`).
      if (matchesBinding(e, "$mod+z")) {
        e.preventDefault();
        typingRef.current.undo();
        return;
      }
      if (matchesBinding(e, "$mod+Shift+z") || matchesBinding(e, "$mod+y")) {
        e.preventDefault();
        typingRef.current.redo();
        return;
      }
      if (isInTextField(e.target)) return;
      const s = sessionRef.current;
      const id = s.activeBlockId;
      if (!id || id === HEADER_KEY) return;
      if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        typingRef.current.end();
        historyRef.current.dispatch(deleteBlock, id);
        s.select(null);
      } else if (matchesBinding(e, "$mod+d")) {
        e.preventDefault();
        typingRef.current.end();
        const copy = historyRef.current.dispatch(duplicateBlock, id)?.id;
        if (copy) s.select(copy);
        s.setEditing(null);
      } else if (e.key === "Escape") {
        s.select(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* ---- render --------------------------------------------------------------- */

  if (!worksheet) return null;

  const active = session.activeBlockId;
  const activeBlock = active ? worksheet.blocks.find((b) => b.id === active) : undefined;
  const oversizeSet = new Set(oversize);

  return (
    <WorksheetProvider value={worksheet}>
      <WorksheetHistoryProvider value={historyApi}>
        <TypingSessionProvider value={typing}>
          <WorksheetSessionProvider value={session}>
            <ActiveEditorProvider>
              <div
                className="flex h-dvh flex-col overflow-hidden bg-background"
                data-worksheet-editor={worksheetId}
              >
                <WorksheetTopBar
                  onBack={onBack}
                  onPrint={onPrint}
                  exportSlot={exportSlot}
                  printBlocked={oversize.length > 0}
                  autosave={autosave}
                />
                <div
                  ref={columnRef}
                  className="ws-column relative flex-1 overflow-auto"
                  onPointerDown={(e) => {
                    // A click on the canvas around the paper clears the selection.
                    if (e.target === e.currentTarget) {
                      typing.end();
                      session.select(null);
                      session.setEditing(null);
                    }
                  }}
                >
                  {active === HEADER_KEY ? <HeaderToolbar /> : null}
                  {activeBlock ? <BlockToolbar block={activeBlock} /> : null}
                  <Sheet
                    worksheet={worksheet}
                    theme={theme}
                    pages={pages}
                    mode="edit"
                    className={session.editingId ? "ws-edit ws-typing" : "ws-edit"}
                    header={
                      <EditableHeader
                        selected={active === HEADER_KEY}
                        onSelect={onHeaderSelect}
                        registerRef={registerHeader}
                      />
                    }
                    empty={
                      <button
                        type="button"
                        className="ws-empty"
                        onClick={(e) => openSlash(e.currentTarget, null, null)}
                      >
                        Add your first block — or press <kbd>/</kbd>
                      </button>
                    }
                    renderItem={(item) =>
                      item.kind === "block" ? (
                        <BlockShell
                          key={item.key}
                          block={item.block}
                          selected={active === item.block.id}
                          editing={session.editingId === item.block.id}
                          caret={session.caret}
                          oversize={oversizeSet.has(item.block.id)}
                          actions={rowActions}
                        />
                      ) : (
                        <div className={flowItemClass(item)} key={item.key}>
                          <FlowItemContent item={item} worksheet={worksheet} mode="edit" />
                        </div>
                      )
                    }
                    pageWrapper={(page, node) => (
                      <div
                        key={page.index}
                        className="ws-page-frame"
                        style={{
                          width: pageW * scale * (4 / 3),
                          height: pageMetrics(worksheet.pageSize).page.h * scale * (4 / 3),
                        }}
                      >
                        <div style={{ transform: `scale(${scale})`, transformOrigin: "top left" }}>
                          {node}
                        </div>
                      </div>
                    )}
                  />
                  {drag.dropLine ? (
                    <div className="ws-drop-line" style={drag.dropLine} aria-hidden />
                  ) : null}
                  {/* The one way in that needs no hover and no key: sticks to the foot of the column. */}
                  <Button
                    variant="primary"
                    size="sm"
                    className="ws-add-pill"
                    onClick={() => setAdder({ afterId: null })}
                  >
                    <Plus aria-hidden size={16} strokeWidth={1.5} />
                    Add block
                  </Button>
                </div>
                <AddBlockDialog
                  open={adder !== null}
                  onOpenChange={(next) => {
                    if (!next) setAdder(null);
                  }}
                  worksheet={worksheet}
                  theme={theme}
                  facts={facts}
                  onPickRecipe={pickRecipe}
                  onPickBlock={pickBlock}
                />
                <SlashMenu
                  open={slash !== null}
                  anchorRef={slashAnchor}
                  onClose={() => setSlash(null)}
                  onPick={pickFromSlash}
                />
              </div>
              {measureNode}
            </ActiveEditorProvider>
          </WorksheetSessionProvider>
        </TypingSessionProvider>
      </WorksheetHistoryProvider>
    </WorksheetProvider>
  );
}
