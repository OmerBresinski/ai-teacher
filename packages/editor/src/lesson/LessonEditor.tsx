import type { QueryKey } from "@tanstack/react-query";
import type { Proposal } from "@tj/domain";
import type { Id, Lesson, RichDoc, SlideElement, Theme, Worksheet } from "@tj/domain/documents";
import { toast } from "@tj/ui";
import {
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ImageSearchClient } from "../images/image-search";
import { isFitStale } from "../layout/fit-plan";
import { createMeasurer } from "../layout/measure";
import { rethemeFromReducer } from "../layout/retheme";
import { type FitMigrationDeps, useFitMigration } from "../layout/use-fit-migration";
import { makeLine, makeShape, makeText } from "../model/insert";
import * as reducers from "../model/reducers";
import { renderTheme } from "../model/themes";
import { useAutosave } from "../model/use-autosave";
import { useDocumentHistory } from "../model/use-document-history";
import {
  type EditingState,
  EditingStateContext,
  type EditorHooks,
  EditorHooksContext,
} from "../slide/editor-hooks";
import { ActiveEditorProvider } from "../text/active-editor";
import { Canvas, stepZoom } from "./Canvas";
import { HistoryProvider, LessonProvider } from "./document-context";
import { EditChatPane, EditChatProvider } from "./edit-chat/EditChatPane";
import { type EditChatApi, EditChatContext } from "./edit-chat/edit-chat-context";
import { readPaneOpen, writePaneOpen } from "./edit-chat/thread";
import { FactsPanel } from "./FactsPanel";
import { HelpDialog } from "./HelpDialog";
import { InsertRail } from "./InsertRail";
import { isInTextField, matchesBinding } from "./keys";
import { MobileLessonEditor } from "./MobileLessonEditor";
import { Navigator } from "./Navigator";
import { NO_PROPOSALS, type ProposalsApi, ProposalsContext } from "./proposals-context";
import { RegenerateDialog } from "./RegenerateDialog";
import { ResidualFindingsContext, useComputedResidualFindings } from "./residual-findings";
import { SidePaneDock, usePaneWidth } from "./SidePaneDock";
import { paneMode as shellPaneMode } from "./shell-layout";
import { ThemeDialog } from "./ThemeDialog";
import { TopBar } from "./TopBar";
import { CANVAS_ROOT_SELECTOR } from "./transform/gesture-state";
import {
  EditorSessionProvider,
  type RegenerateTarget,
  resolveActiveSlide,
  useEditorSessionState,
} from "./use-editor-session";
import { useHistoryKeys } from "./use-history-keys";
import { useMobileEditor } from "./use-mobile-editor";

/*
 * The lesson editor shell (ruling 186): TopBar over InsertRail | Canvas above the Navigator's
 * filmstrip | the side pane (Dayback, ruling 186; the Facts panel), with the shell's own shortcuts on one `keydown` listener and the
 * `?` help sheet. The document lives in the TanStack Query cache under `queryKey` and is edited
 * through `useDocumentHistory` (ADR 0022 §4); the session state — selection, zoom, clipboard — is
 * React state owned here and handed down through `EditorSessionProvider`. Saving is the app's
 * `onSave` (ADR 0022 §5), debounced by `useAutosave`. The theme picker opens from the selected-theme
 * callout in the top bar (ruling 123) and re-themes and re-fits the whole lesson as one undo step
 * (TEACH-258).
 */

/** The single-key inserts (`SHELL_SHORTCUTS` Insert group); `i` waits for the images ticket. */
const INSERT_KEYS: Record<string, (theme: Theme) => SlideElement> = {
  t: (theme) => makeText("body", theme),
  r: (theme) => makeShape("rect", theme),
  o: (theme) => makeShape("ellipse", theme),
  l: (theme) => makeLine("line", theme),
};

export type LessonEditorProps = {
  lessonId: string;
  /** The signed-in user's id: the edit chat's stored thread is kept per user (TEACH-97). */
  userId?: string | undefined;
  /** The cache entry that holds the document — `queryKeys.libraryDocument(id)` in the app. */
  queryKey: QueryKey;
  /** Fetches the document for a first mount the loader has not filled (e.g. `fetchQuery(options)`). */
  queryFn?: () => Promise<unknown>;
  /** Persist the document: the mock store today, `PUT /documents/:id` later. */
  onSave: (lesson: Lesson) => Promise<void>;
  onBack: () => void;
  /**
   * Called after the autosave has flushed, so present mode opens the deck as it is now, with the
   * 1-based number of the slide the teacher is on (ruling 104).
   */
  onPresent: (slide: number) => void;
  /** Pexels search + pick for the Add image panel, injected by the app. */
  images?: ImageSearchClient;
  /** Where the export control sits once it exists (E1). */
  exportSlot?: ReactNode;
  /**
   * Optional generation companion finishing alongside the editable lesson. On a desktop it sits in
   * the right pane slot (ruling 186), so the slide keeps its size while it shows and when it goes.
   */
  companion?: ReactNode;
  /**
   * The generated worksheet (`lesson.artefacts.worksheetId`), once the app has fetched it, so the
   * objective-coverage check sees both halves (ADR 0025 §10); absent, that half is skipped.
   */
  worksheet?: Worksheet;
  /** Opens the worksheet; the top bar shows "Worksheet" only when this and the artefact exist. */
  onOpenWorksheet?: (worksheetId: string) => void;
  /** Opens the worksheet creation flow for this lesson (TEACH-184); the top bar's "Worksheet". */
  onNewWorksheet?: () => void;
  /**
   * The proposal jobs (TEACH-134, ADR 0025 §18): the app enqueues a cascade for changed facts and
   * a regenerate for a target, follows the job and applies its result through `editorRef`.
   * `busySlideIds` / `proposalsBusy` paint the in-flight state. Absent → no Facts panel, no
   * Regenerate entries.
   */
  onFactsChanged?: (factIds: string[]) => void;
  onRegenerate?: (target: RegenerateTarget, instruction: string | undefined) => void;
  /** Edit with a prompt, fast path (TEACH-97 part d). Absent → no "Edit with a prompt" button. */
  onPromptEdit?: ProposalsApi["onPromptEdit"];
  busySlideIds?: ReadonlySet<Id>;
  proposalsBusy?: boolean;
  editorRef?: Ref<LessonEditorHandle>;
  /**
   * The slide to open on (TEACH-252: the one the teacher was looking at while the lesson
   * generated). Read once at mount; an id not in the deck opens the first slide as usual.
   */
  initialSlideId?: Id;
  /** The app's Worksheet control (list and maker), the one Worksheet entry in ⋯ (ruling 186). */
  worksheetsSlot?: ReactNode;
  /**
   * A pane in the right slot (rulings 186, 187): reserved while the slide beside it stays usable,
   * else over the filmstrip (`shell-layout.ts`). `content` stays mounted while closed so its work
   * carries on.
   */
  sidePane?: { open: boolean; label: string; content: ReactNode };
};

/**
 * What the app may do to the open editor once a proposal job completes (ADR 0025 §19). Everything
 * else stays behind the reducers and the session; this is the one imperative seam.
 */
export type LessonEditorHandle = {
  /**
   * Apply a job's proposals as one undo step. Leaves any open text edit first: the element being
   * typed into may be one of those replaced, and an open typing session would otherwise merge with
   * the cascade into a single history entry. Returns the touched slide ids in document order.
   */
  applyProposals: (proposals: readonly Proposal[]) => Id[];
  undo: () => void;
  /** Make a slide the active one (the toast's "View"). */
  goToSlide: (slideId: Id) => void;
  /**
   * Re-theme and re-fit the lesson as one undo step: the theme the teacher picked while it was
   * being made, applied at Ready (ruling 123). Picking the theme it already has does nothing.
   */
  retheme: (themeId: string) => void;
};

export function LessonEditor({
  lessonId,
  userId,
  queryKey,
  queryFn,
  onSave,
  onBack,
  onPresent,
  images,
  exportSlot,
  companion,
  worksheet,
  onOpenWorksheet,
  onNewWorksheet,
  onFactsChanged,
  onRegenerate,
  onPromptEdit,
  busySlideIds,
  proposalsBusy = false,
  editorRef,
  initialSlideId,
  worksheetsSlot,
  sidePane,
}: LessonEditorProps) {
  const mobile = useMobileEditor();
  const paneW = usePaneWidth();
  const autosave = useAutosave(onSave);
  const { lesson, ...history } = useDocumentHistory({
    queryKey,
    queryFn,
    onChange: autosave.onChange,
  });
  // The residual findings (ADR 0025 §12), derived at the autosave cadence rather than per edit.
  const residuals = useComputedResidualFindings(lesson, worksheet, autosave);
  const session = useEditorSessionState({ activeSlideId: initialSlideId ?? null });
  const [helpOpen, setHelpOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const [factsOpen, setFactsOpen] = useState(false);
  // "Edit with Dayback" (TEACH-97): open or closed is remembered for the teacher on this browser.
  const [chatOpen, setChatOpen] = useState(readPaneOpen);
  const [chatFocusTick, setChatFocusTick] = useState(0);
  /** The canvas row: the closed chat's bubble sits at its bottom right, on the zoom row, clear of the filmstrip. */
  const [bubbleHost, setBubbleHost] = useState<HTMLElement | null>(null);
  const chatAvailable = onPromptEdit !== undefined && !mobile;
  const editChat = useMemo<EditChatApi>(
    () => ({
      available: chatAvailable,
      open: chatAvailable && chatOpen,
      toggle: () =>
        setChatOpen((open) => {
          writePaneOpen(!open);
          // One pane in the right slot: opening the chat closes Facts.
          if (!open) setFactsOpen(false);
          return !open;
        }),
      openAndFocus: () => {
        setFactsOpen(false);
        setChatOpen(true);
        writePaneOpen(true);
        setChatFocusTick((n) => n + 1);
      },
    }),
    [chatAvailable, chatOpen],
  );
  // The shell rules (`shell-layout.ts`): measured on the canvas row, which the pane never narrows.
  const [canvasBox, setCanvasBox] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    if (!bubbleHost) return;
    // Measured before the first paint, so the pane never paints docked and then flips to overlay.
    const first = bubbleHost.getBoundingClientRect();
    setCanvasBox({ w: first.width, h: first.height });
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setCanvasBox({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    ro.observe(bubbleHost);
    return () => ro.disconnect();
  }, [bubbleHost]);
  const paneMode = canvasBox.w > 0 ? shellPaneMode(canvasBox.w, canvasBox.h, paneW) : "docked";
  const factsAvailable =
    Boolean(lesson?.facts) &&
    (onFactsChanged !== undefined || onRegenerate !== undefined || onPromptEdit !== undefined);
  const hasPane =
    !mobile && (chatAvailable || factsAvailable || sidePane !== undefined || Boolean(companion));
  const paneOpen =
    !mobile && (Boolean(sidePane?.open) || Boolean(companion) || editChat.open || factsOpen);
  const proposalsEnabled =
    onFactsChanged !== undefined || onRegenerate !== undefined || onPromptEdit !== undefined;
  // `null` until the linked worksheet is here: its block refs are part of what `addFact` must skip.
  const reservedFactIds = useMemo(
    () =>
      lesson?.artefacts?.worksheetId && !worksheet ? null : reducers.worksheetFactRefs(worksheet),
    [lesson?.artefacts?.worksheetId, worksheet],
  );
  const proposals = useMemo<ProposalsApi>(
    () =>
      proposalsEnabled
        ? {
            onFactsChanged,
            onRegenerate,
            onPromptEdit,
            busySlideIds: busySlideIds ?? NO_PROPOSALS.busySlideIds,
            busy: proposalsBusy,
            reservedFactIds,
          }
        : NO_PROPOSALS,
    [
      proposalsEnabled,
      onFactsChanged,
      onRegenerate,
      onPromptEdit,
      busySlideIds,
      proposalsBusy,
      reservedFactIds,
    ],
  );
  const [canvasFocused, setCanvasFocused] = useState(false);

  // Canvas writes its measured scale here on every render of SlideScaler. A ref, not state: the
  // scale changes on every zoom frame and `stepZoom` only needs the latest value when ⌘± is pressed.
  const measuredScale = useRef(1);
  const onScaleChange = useCallback((s: number) => {
    measuredScale.current = s;
  }, []);

  const historyApi = useMemo(
    () => ({
      dispatch: history.dispatch,
      undo: history.undo,
      redo: history.redo,
      canUndo: history.canUndo,
      canRedo: history.canRedo,
      beginTransaction: history.beginTransaction,
      endTransaction: history.endTransaction,
      rollbackTransaction: history.rollbackTransaction,
      flushTransactions: history.flushTransactions,
      isTransactionInFlight: history.isTransactionInFlight,
    }),
    [
      history.dispatch,
      history.undo,
      history.redo,
      history.canUndo,
      history.canRedo,
      history.beginTransaction,
      history.endTransaction,
      history.rollbackTransaction,
      history.flushTransactions,
      history.isTransactionInFlight,
    ],
  );

  // What the element renderers may do to the document (ADR 0022 §4): the two contexts the slide
  // package reads in edit mode. The functions are stable; the two ids change on entry/exit.
  const { setEditingText, setEditingExplanation } = session.actions;
  const editorHooks = useMemo<EditorHooks>(
    () => ({
      writeElementHeight: (slideId, id, h) =>
        history.dispatch(reducers.updateElementLayout, slideId, id, { h }),
      writeElementDoc: (slideId, id, doc: RichDoc) =>
        history.dispatch(reducers.updateElement, slideId, id, { doc } as Partial<SlideElement>),
      writeExplanation: (slideId, text) => history.dispatch(reducers.setExplanation, slideId, text),
      beginTransaction: history.beginTransaction,
      endTransaction: history.endTransaction,
      // Esc out of a text editor lands focus back on the stage, so the canvas keys work at once.
      exitTextEdit: () => {
        setEditingText(null);
        document.querySelector<HTMLElement>(CANVAS_ROOT_SELECTOR)?.focus({ preventScroll: true });
      },
      exitExplanationEdit: () => {
        setEditingExplanation(null);
        document.querySelector<HTMLElement>(CANVAS_ROOT_SELECTOR)?.focus({ preventScroll: true });
      },
    }),
    [
      history.dispatch,
      history.beginTransaction,
      history.endTransaction,
      setEditingText,
      setEditingExplanation,
    ],
  );
  const { editingTextId, editingExplanation } = session.state;
  const editingState = useMemo<EditingState>(
    () => ({ editingTextId, editingExplanation }),
    [editingTextId, editingExplanation],
  );

  // The fit migration (ADR 0021 §3, ADR 0022 amendment TEACH-251): a lesson laid out under an
  // older floor table — a freshly generated one arrives at `fitVersion: 0` — is re-fitted once, on
  // open, when the editor is quiet, and again if the cache hands the editor a stale copy. Reads the
  // latest lesson/history/session at run time.
  const lessonRef = useRef(lesson);
  lessonRef.current = lesson;
  const historyRef = useRef(history);
  historyRef.current = history;
  useHistoryKeys(historyRef);
  const getFitDeps = useCallback((): FitMigrationDeps | null => {
    const current = lessonRef.current;
    if (!current) return null;
    const h = historyRef.current;
    return {
      lesson: current,
      dispatch: h.dispatch as FitMigrationDeps["dispatch"],
      beginTransaction: h.beginTransaction,
      endTransaction: h.endTransaction,
      rollbackTransaction: h.rollbackTransaction,
      isIdle: () => {
        const s = session.read();
        return (
          !s.editingTextId &&
          !s.editingExplanation &&
          s.selection.length === 0 &&
          !h.isTransactionInFlight()
        );
      },
    };
  }, [session]);
  useFitMigration({
    lessonId: lesson?.id,
    stale: lesson !== undefined && isFitStale(lesson),
    getDeps: getFitDeps,
    notify: (m) => toast(m),
  });

  // The app's seam for proposal jobs (ADR 0025 §19). Reads history and session through refs so the
  // handle is stable and always acts on the current document.
  useImperativeHandle(
    editorRef,
    () => ({
      applyProposals: (incoming) => {
        const h = historyRef.current;
        const current = lessonRef.current;
        if (!current) return [];
        // Leave any open text edit: its session closes its own transaction on blur, so the cascade
        // below is its own undo step and never swallows the typed text (TEACH-134 FR 3).
        const s = session.read();
        if (s.editingTextId) session.actions.setEditingText(null);
        if (s.editingExplanation) session.actions.setEditingExplanation(null);
        h.flushTransactions();
        h.beginTransaction();
        try {
          h.dispatch(reducers.applyProposals, incoming);
        } finally {
          h.endTransaction();
        }
        return reducers.proposalSlideIds(current, incoming);
      },
      undo: () => historyRef.current.undo(),
      goToSlide: (slideId) => session.actions.setActiveSlide(slideId),
      retheme: (themeId) => {
        const h = historyRef.current;
        const current = lessonRef.current;
        if (!current || current.themeId === themeId) return;
        h.flushTransactions();
        h.dispatch(
          rethemeFromReducer,
          current,
          themeId,
          createMeasurer(renderTheme(current, themeId)),
        );
      },
    }),
    [session],
  );

  const theme = useMemo(() => renderTheme(lesson), [lesson]);
  const slide = lesson ? resolveActiveSlide(lesson.slides, session.state.activeSlideId) : undefined;

  /** Add an element to the active slide and select it — TeachDeck's `insertElement`. */
  const insert = useCallback(
    (el: SlideElement, options?: { edit?: boolean }) => {
      if (!slide) return;
      history.dispatch(reducers.addElement, el, slide.id);
      session.actions.select([el.id]);
      // A new text box goes straight into edit: the placeholder is there to be typed over.
      if (options?.edit) session.actions.setEditingText(el.id);
    },
    [history.dispatch, session.actions, slide],
  );

  // The shell's own keys, on one listener. Insert only while the canvas has focus and nothing is
  // typing; zoom and help everywhere but inside a field.
  const focusedRef = useRef(canvasFocused);
  focusedRef.current = canvasFocused;
  const insertRef = useRef(insert);
  insertRef.current = insert;
  const { setZoom, openImagePanel } = session.actions;
  const readSession = session.read;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isInTextField(e.target)) return;
      const zoomNow = () => {
        const z = readSession().zoom;
        return z === "fit" ? measuredScale.current : z;
      };
      if (matchesBinding(e, "$mod+Alt+0")) {
        e.preventDefault();
        setZoom("fit");
      } else if (matchesBinding(e, "$mod+0")) {
        e.preventDefault();
        setZoom(1);
      } else if (matchesBinding(e, "$mod+Equal") || matchesBinding(e, "$mod+Shift+Equal")) {
        e.preventDefault();
        setZoom(stepZoom(zoomNow(), 1));
      } else if (matchesBinding(e, "$mod+Minus")) {
        e.preventDefault();
        setZoom(stepZoom(zoomNow(), -1));
      } else if (matchesBinding(e, "?")) {
        e.preventDefault();
        setHelpOpen(true);
      } else if (focusedRef.current && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        if (e.key === "i") {
          // The picture comes from the panel, not a factory: `i` opens it where the rail anchors it.
          e.preventDefault();
          openImagePanel();
          return;
        }
        const make = INSERT_KEYS[e.key];
        if (!make) return;
        e.preventDefault();
        insertRef.current(make(theme), { edit: e.key === "t" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [readSession, setZoom, openImagePanel, theme]);

  if (!lesson || !slide) return null;

  return (
    <LessonProvider value={lesson}>
      <HistoryProvider value={historyApi}>
        <EditorSessionProvider session={session}>
          <EditorHooksContext.Provider value={editorHooks}>
            <EditingStateContext.Provider value={editingState}>
              <ActiveEditorProvider>
                <ResidualFindingsContext.Provider value={residuals}>
                  <ProposalsContext.Provider value={proposals}>
                    <EditChatContext.Provider value={editChat}>
                      <EditChatProvider
                        lessonId={lessonId}
                        userId={userId}
                        open={editChat.open}
                        onClose={editChat.toggle}
                      >
                        <div
                          className="flex h-dvh flex-col overflow-hidden bg-background"
                          data-lesson-editor={lessonId}
                        >
                          <TopBar
                            onBack={onBack}
                            onPresent={() => onPresent(lesson.slides.indexOf(slide) + 1)}
                            onOpenTheme={() => setThemeOpen(true)}
                            exportSlot={exportSlot}
                            onOpenWorksheet={onOpenWorksheet}
                            onNewWorksheet={onNewWorksheet}
                            onToggleFacts={
                              proposalsEnabled && lesson.facts
                                ? () =>
                                    setFactsOpen((open) => {
                                      // One pane in the right slot: Facts swaps with the chat.
                                      if (!open && chatOpen) {
                                        setChatOpen(false);
                                        writePaneOpen(false);
                                      }
                                      return !open;
                                    })
                                : undefined
                            }
                            factsOpen={factsOpen}
                            autosave={autosave}
                            worksheetsSlot={worksheetsSlot}
                          />
                          {mobile && companion ? (
                            <aside data-editor-companion="mobile">{companion}</aside>
                          ) : null}
                          <div className="relative flex min-h-0 flex-1">
                            {mobile ? (
                              <MobileLessonEditor
                                initialSlideId={initialSlideId}
                                canvas={{
                                  slide,
                                  theme,
                                  onFocusChange: setCanvasFocused,
                                  onScaleChange,
                                  onInsert: insert,
                                  images,
                                  lessonId,
                                }}
                                insert={{
                                  onInsert: insert,
                                  onHelp: () => setHelpOpen(true),
                                  images,
                                }}
                              />
                            ) : (
                              <>
                                <InsertRail
                                  minimal
                                  onInsert={insert}
                                  onHelp={() => setHelpOpen(true)}
                                  images={images}
                                />
                                <div className="flex min-w-0 flex-1 flex-col">
                                  <div ref={setBubbleHost} className="relative flex min-h-0 flex-1">
                                    <Canvas
                                      slide={slide}
                                      theme={theme}
                                      onFocusChange={setCanvasFocused}
                                      onScaleChange={onScaleChange}
                                      onInsert={insert}
                                      images={images}
                                      lessonId={lessonId}
                                      bubble={!(chatAvailable && editChat.open)}
                                      fitInset={hasPane && paneMode === "docked" ? paneW : 0}
                                      clearRight={paneOpen ? paneW : 0}
                                    />
                                  </div>
                                  {/* Docked, the filmstrip makes room for the open pane; overlay, the pane lies over it. */}
                                  <div
                                    className="transition-[padding] duration-(--duration-base) ease-(--ease-standard) motion-reduce:transition-none"
                                    style={{
                                      paddingRight: paneOpen && paneMode === "docked" ? paneW : 0,
                                    }}
                                  >
                                    <Navigator strip />
                                  </div>
                                </div>
                              </>
                            )}
                            {!mobile && companion ? (
                              <SidePaneDock
                                open
                                label="Dayback"
                                mode={paneMode}
                                data-editor-companion="desktop"
                              >
                                {companion}
                              </SidePaneDock>
                            ) : null}
                            {factsOpen ? (
                              <FactsPanel
                                onClose={() => setFactsOpen(false)}
                                pane={mobile ? undefined : { mode: paneMode, width: paneW }}
                              />
                            ) : null}
                            {!mobile && sidePane ? (
                              <SidePaneDock
                                open={sidePane.open}
                                label={sidePane.label}
                                mode={paneMode}
                              >
                                {sidePane.content}
                              </SidePaneDock>
                            ) : null}
                            {/* The pane stays mounted: closed, it is the bubble (the way in), and a request in
                              flight carries on (TEACH-97). It sits in layout A's right pane slot. */}
                            {chatAvailable ? (
                              <EditChatPane
                                open={editChat.open}
                                onReopen={editChat.openAndFocus}
                                focusTick={chatFocusTick}
                                bubbleHost={bubbleHost}
                                paneMode={paneMode}
                                paneWidth={paneW}
                              />
                            ) : null}
                          </div>
                          <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
                          <ThemeDialog open={themeOpen} onClose={() => setThemeOpen(false)} />
                          {proposalsEnabled ? <RegenerateDialog /> : null}
                        </div>
                      </EditChatProvider>
                    </EditChatContext.Provider>
                  </ProposalsContext.Provider>
                </ResidualFindingsContext.Provider>
              </ActiveEditorProvider>
            </EditingStateContext.Provider>
          </EditorHooksContext.Provider>
        </EditorSessionProvider>
      </HistoryProvider>
    </LessonProvider>
  );
}
