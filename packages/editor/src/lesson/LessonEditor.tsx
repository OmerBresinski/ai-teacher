import type { QueryKey } from "@tanstack/react-query";
import type { Proposal } from "@tj/domain";
import {
  type Id,
  type Lesson,
  mergeJobLesson,
  type RichDoc,
  type SlideElement,
  sameJson,
  type Theme,
  type Worksheet,
  withoutEditorCopies,
} from "@tj/domain/documents";
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
import { SaveFailedBar } from "../kit/SaveFailedBar";
import { isFitStale } from "../layout/fit-plan";
import { createMeasurer } from "../layout/measure";
import { inLessonTheme, rethemeFromReducer } from "../layout/retheme";
import { type FitMigrationDeps, useFitMigration } from "../layout/use-fit-migration";
import { makeLine, makeShape, makeText } from "../model/insert";
import { layoutKit, loadLayoutKit } from "../model/layout-kit";
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
import { useFirstSlidesReveal, useRevealCurrent } from "./first-slides-reveal";
import { FollowMarkContext } from "./follow-mark";
import { HelpDialog } from "./HelpDialog";
import { InsertRail } from "./InsertRail";
import { isInTextField, matchesBinding } from "./keys";
import { type DraftStore, LiveSlide, useDraftLead } from "./live-draft";
import { MobileLessonEditor } from "./MobileLessonEditor";
import { Navigator } from "./Navigator";
import { NO_PROPOSALS, type ProposalsApi, ProposalsContext } from "./proposals-context";
import { RegenerateDialog } from "./RegenerateDialog";
import { ResidualFindingsContext, useComputedResidualFindings } from "./residual-findings";
import { SidePaneDock, usePaneWidth } from "./SidePaneDock";
import { paneMode as shellPaneMode } from "./shell-layout";
import { ThemeDialog } from "./ThemeDialog";
import { TopBar } from "./TopBar";
import { createTeacherEdits } from "./teacher-edits";
import { CANVAS_ROOT_SELECTOR } from "./transform/gesture-state";
import {
  EditorSessionProvider,
  type RegenerateTarget,
  resolveActiveSlide,
  useEditorSessionState,
} from "./use-editor-session";
import { type FollowPace, useFollowWriting } from "./use-follow-writing";
import { useHistoryKeys } from "./use-history-keys";
import { useMobileEditor } from "./use-mobile-editor";
import { FINISHING_TEXT, type PillPace, useLinger, useWritingPill } from "./writing-pill";

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
  /**
   * Slides a generating job is still writing (ADR 0037, UX ruling 189): selectable but read-only,
   * marked "Writing". Every other slide is the teacher's to edit while the lesson fills.
   */
  writingSlideIds?: ReadonlySet<Id>;
  /**
   * Live writing (ADR 0039): the generating job's slide drafts. A slide still being written shows
   * its newest draft, typed out, in place of its saved copy; the saved copy always wins once the
   * slide is done. Drafts never enter the document, its history or a save.
   */
  drafts?: DraftStore;
  editorRef?: Ref<LessonEditorHandle>;
  /**
   * The slide to open on (TEACH-252: the one the teacher was looking at while the lesson
   * generated). Read once at mount; an id not in the deck opens the first slide as usual.
   */
  initialSlideId?: Id;
  /**
   * The job's writer has finished every slide's words (TEACH-202 part o); its slides stay the
   * job's until the lesson is editable, while it adds pictures and checks the lesson.
   */
  writingFinished?: boolean;
  /** How the follow paces itself through the slides being written (tests pass a faster one). */
  followPace?: FollowPace;
  /** The pill's settle and dwell (tests pass zeros). */
  pillPace?: PillPace;
  /** The app's Worksheet control (list and maker), the one Worksheet entry in ⋯ (ruling 186). */
  worksheetsSlot?: ReactNode;
  /**
   * A pane in the right slot (rulings 186, 187): reserved while the slide beside it stays usable,
   * else over the filmstrip (`shell-layout.ts`). `content` stays mounted while closed so its work
   * carries on.
   */
  sidePane?: { open: boolean; label: string; content: ReactNode };
  /**
   * The editor unmounted with a teacher's change it could not write (`AutosaveOptions.onAbandon`):
   * `base` is the newest copy the server was known to hold. The app keeps both for the next open.
   */
  onAbandon?: (lesson: Lesson, base: Lesson | null) => void;
  /**
   * A change kept from an earlier visit (`onAbandon`): once the lesson loads it is merged onto the
   * current copy (`mergeJobLesson` on `base`, the teacher's side winning only where they edited)
   * as one undo step, and saved like any edit. `onRestored` follows, once.
   */
  restore?: { lesson: Lesson; base: Lesson };
  onRestored?: (applied: boolean) => void;
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
  /**
   * Fold the generating job's newer copy of the lesson into the open one (ADR 0037): a three-way
   * merge on `base` (the copy last received), applied to the document and to every undo step,
   * recording nothing. Returns the merged lesson.
   */
  receiveGenerated: (base: Lesson, theirs: Lesson) => Lesson | undefined;
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
  writingSlideIds,
  drafts,
  editorRef,
  initialSlideId,
  followPace,
  pillPace,
  writingFinished = false,
  worksheetsSlot,
  sidePane,
  onAbandon,
  restore,
  onRestored,
}: LessonEditorProps) {
  const mobile = useMobileEditor();
  const paneW = usePaneWidth();
  const autosave = useAutosave(onSave, { onAbandon });
  // Every change through the history is the teacher's, except the fit migration's bookkeeping
  // (`systemWrite`); a job's merged write reaches the autosave directly (`receiveGenerated`).
  const teacherEdits = useMemo(() => createTeacherEdits(), []);
  const systemWrite = useRef(false);
  // The copy the last history change or job fold left: what the next teacher change is read
  // against, to mark the slides it changed (`teacherEdited`, TEACH-251 part p).
  const lastDoc = useRef<Lesson | undefined>(undefined);
  const replaying = useRef(false);
  const onHistoryChange = useCallback(
    (doc: Lesson) => {
      if (systemWrite.current) {
        lastDoc.current = doc;
        autosave.onChange(doc, { teacher: false });
        return;
      }
      teacherEdits.mark();
      if (replaying.current) {
        lastDoc.current = doc;
        autosave.onChange(doc, { teacher: true });
        return;
      }
      // ADR 0037: the job's merge keeps a slide as the teacher's only when it is marked. A real
      // action marks the slides it changed; the fit migration (`systemWrite`) and a re-theme (the
      // theme changed in this step: every slide is redrawn by the editor) mark none.
      const marked = markTeacherEdited(lastDoc.current ?? lessonRef.current, doc);
      if (marked !== doc) historyRef.current.rebase?.((d) => (d === doc ? marked : d));
      lastDoc.current = marked;
      autosave.onChange(marked, { teacher: true });
    },
    [autosave, teacherEdits],
  );
  const { lesson, ...history } = useDocumentHistory({
    queryKey,
    queryFn,
    onChange: onHistoryChange,
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
  // The generation companion takes no column (UX audit J1): it waits in the canvas's right margin,
  // so the slide sits where it will stay from the first slide to Ready and after.
  const hasPane = !mobile && (chatAvailable || factsAvailable || sidePane !== undefined);
  const paneOpen = !mobile && (Boolean(sidePane?.open) || editChat.open || factsOpen);
  const proposalsEnabled =
    onFactsChanged !== undefined || onRegenerate !== undefined || onPromptEdit !== undefined;
  // `null` until the linked worksheet is here: its block refs are part of what `addFact` must skip.
  const reservedFactIds = useMemo(
    () =>
      lesson?.artefacts?.worksheetId && !worksheet ? null : reducers.worksheetFactRefs(worksheet),
    [lesson?.artefacts?.worksheetId, worksheet],
  );
  const lead = useDraftLead(drafts);
  // A new lesson's title and objectives type out while the writer plans (presentation only).
  const reveal = useFirstSlidesReveal({
    lessonId,
    slides: lesson?.slides,
    writingSlideIds,
    leadIndex: lead === undefined ? -1 : (lesson?.slides.findIndex((s) => s.id === lead) ?? -1),
  });
  const revealing = useRevealCurrent(reveal);
  // The slide being written now: the streaming slide, while the job still owns it.
  const writingNowId = lead !== undefined && writingSlideIds?.has(lead) ? lead : undefined;
  // The writer has finished every content slide; the job still adds pictures and checks the lesson
  // (often a minute or more), and only the objectives slide waits for the job's end.
  const writerDone = !!writingSlideIds && writingFinished;
  // Greg 20 Oct (62 C): the companion waits in the margin only until the first slide has words,
  // then leaves for good (latched: a later gap between drafts never brings it back).
  const [companionGone, setCompanionGone] = useState(false);
  if (!companionGone && lead !== undefined) setCompanionGone(true);
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
            writingSlideIds,
            writingNowId,
            writingFinished: writerDone,
            drafts,
            reveal,
          }
        : writingSlideIds
          ? {
              ...NO_PROPOSALS,
              writingSlideIds,
              writingNowId,
              writingFinished: writerDone,
              drafts,
              reveal,
            }
          : NO_PROPOSALS,
    [
      writingSlideIds,
      writingNowId,
      writerDone,
      drafts,
      reveal,
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

  // Undo and redo step back to copies the history already holds, each marked as it was when it
  // was made: they mark nothing new (`markTeacherEdited`).
  const undo = useCallback(() => {
    replaying.current = true;
    try {
      historyRef.current.undo();
    } finally {
      replaying.current = false;
    }
  }, []);
  const redo = useCallback(() => {
    replaying.current = true;
    try {
      historyRef.current.redo();
    } finally {
      replaying.current = false;
    }
  }, []);
  const historyApi = useMemo(
    () => ({
      dispatch: history.dispatch,
      undo,
      redo,
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
      undo,
      redo,
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
  const fillingRef = useRef(false);
  fillingRef.current = writingSlideIds !== undefined;
  const readSessionRef = useRef(session.read);
  readSessionRef.current = session.read;
  const { setEditingText, setEditingExplanation } = session.actions;
  const editorHooks = useMemo<EditorHooks>(
    () => ({
      // While the lesson fills (ADR 0037) a box's measured height is written back only for the
      // text the teacher is typing into: a re-measure on view is not a teacher's edit, so it must
      // neither dirty the lesson nor claim a slide the job may still reword.
      writeElementHeight: (slideId, id, h) => {
        if (fillingRef.current && readSessionRef.current().editingTextId !== id) return;
        history.dispatch(reducers.updateElementLayout, slideId, id, { h });
      },
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
  const restoreRef = useRef(restore);
  const onRestoredRef = useRef(onRestored);
  onRestoredRef.current = onRestored;
  const historyRef = useRef(history);
  historyRef.current = history;
  // The copy the editor opened on is the server's: the base of any change kept for later.
  const opened = lesson !== undefined;
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, when the lesson first loads
  useEffect(() => {
    const current = lessonRef.current;
    if (!current) return;
    autosave.noteServerCopy(current);
    lastDoc.current ??= current;
    const kept = restoreRef.current;
    restoreRef.current = undefined;
    if (!kept) return;
    // A kept change rejoins through the history (one undo step, the teacher's, autosaved).
    let applied = false;
    historyRef.current.dispatch((doc: Lesson) => {
      const merged = mergeJobLesson(kept.base, kept.lesson, doc);
      if (sameJson(merged, doc)) return doc;
      applied = true;
      return merged;
    });
    onRestoredRef.current?.(applied);
  }, [opened]);
  useHistoryKeys(historyRef);
  const getFitDeps = useCallback((): FitMigrationDeps | null => {
    const current = lessonRef.current;
    if (!current) return null;
    const h = historyRef.current;
    return {
      lesson: current,
      dispatch: ((...args: Parameters<typeof h.dispatch>) =>
        asSystem(systemWrite, () => h.dispatch(...args))) as FitMigrationDeps["dispatch"],
      beginTransaction: h.beginTransaction,
      endTransaction: (token?: number) => asSystem(systemWrite, () => h.endTransaction(token)),
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
  // While a job writes the lesson the tidy is the job's own layout settling, not the teacher's
  // change: no "slides tidied" toast over the filmstrip as the title types (judge 638).
  const jobWriting = useRef(writingSlideIds !== undefined);
  jobWriting.current = writingSlideIds !== undefined;
  useFitMigration({
    lessonId: lesson?.id,
    stale: lesson !== undefined && isFitStale(lesson),
    getDeps: getFitDeps,
    notify: (m) => {
      if (!jobWriting.current) toast(m);
    },
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
        // A regenerated check's answers slide (ruling 200): added, kept or dropped once the
        // answers-slide layout has loaded, as its own step.
        const regenerated = reducers.regeneratedSlideIds(incoming);
        if (regenerated.size > 0) {
          void import("../model/answers-sync").then(({ syncAnswersReducer }) => {
            historyRef.current.dispatch(syncAnswersReducer, regenerated);
          });
        }
        return reducers.proposalSlideIds(current, incoming);
      },
      receiveGenerated: (base, theirs) => {
        // The merge before the editor draws the job's slides in the teacher's theme: what of the
        // teacher's the row does not have yet. The repaint is the editor's, never the teacher's.
        let teachers: Lesson | undefined;
        const merged = historyRef.current.rebase?.((mine) => {
          // Its own repaint and fit of slides the teacher has not marked are the editor's, not
          // the teacher's: left out, so the job's copy (late pictures included) comes whole.
          teachers = mergeJobLesson(base, withoutEditorCopies(mine, base), theirs);
          return inTeachersTheme(teachers, theirs, base);
        });
        if (merged) lastDoc.current = merged;
        // Nothing of the teacher's left to send: hold the job's very copy, so the next round sees
        // an untouched document and the autosave stays quiet.
        if (merged && sameJson(merged, theirs)) {
          autosave.noteServerCopy(theirs);
          historyRef.current.rebase?.((doc) => (doc === merged ? theirs : doc));
          lastDoc.current = theirs;
          return theirs;
        }
        // The teacher's changes the row does not have yet: the next autosave sends the merged copy,
        // never the one it held from before the merge.
        autosave.noteServerCopy(theirs);
        // Any teacher's change in it is already marked; the merge itself adds none. A copy that
        // differs from the job's only in the editor's own stamps (the fit version set on open and
        // the body's `updatedAt`) is written quietly, so the indicator does not flip to "Unsaved
        // changes" and back with every row (P0 25 Oct).
        // Nothing of the teacher's in it (only the editor's repaint of the job's slides, or its
        // stamps): quiet, and the page holds it while the job writes (TEACH-251 part p).
        if (merged) {
          const quiet =
            onlyStampsDiffer(merged, theirs) ||
            (teachers !== undefined && onlyStampsDiffer(teachers, theirs));
          autosave.onChange(merged, { teacher: false, quiet });
        }
        return merged;
      },
      undo,
      goToSlide: (slideId) => {
        session.actions.setActiveSlide(slideId);
      },
      retheme: (themeId) => {
        const run = () => {
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
        };
        // Adaptive layouts re-lay in the new theme's faces: their template code first, once.
        if (layoutKit()) run();
        else void loadLayoutKit().then(run, run);
      },
    }),
    [session, autosave, undo],
  );

  const theme = useMemo(() => renderTheme(lesson), [lesson]);
  /** The open slide, once every word it has so far is on screen (`LiveSlide`), for the follow. */
  const [typedId, setTypedId] = useState<Id | undefined>(undefined);
  const slide = lesson ? resolveActiveSlide(lesson.slides, session.state.activeSlideId) : undefined;
  const follow = useFollowWriting({
    lead,
    revealing,
    slides: lesson?.slides,
    writingSlideIds,
    activeSlideId: session.state.activeSlideId,
    setActiveSlide: session.actions.setActiveSlide,
    startFollowing: initialSlideId === undefined,
    canvasFocused,
    typedId,
    ...(followPace ? { pace: followPace } : {}),
  });
  // One pill for the whole fill (jank audit #7): planning → writing N of M → finishing → gone,
  // never backwards, each text held long enough to read, at one place and one width.
  const slideIds = useMemo(() => lesson?.slides.map((s) => s.id) ?? [], [lesson?.slides]);
  const pill = useWritingPill(
    { active: !!writingSlideIds, done: writerDone, writingId: writingNowId, slideIds },
    pillPace ? { pace: pillPace } : undefined,
  );
  // The chip goes at once when following resumes; at the hand-over it fades with the pill.
  // Only the job's own end fades the chip with the pill; a stop removes both at once.
  const pillFading = !writingSlideIds && pill.text === FINISHING_TEXT;
  const chip = useLinger(!!follow.target && !follow.following, pillFading ? 200 : 0);

  // UX audit J1: the slide the teacher watched being written turns editable at the hand-over, and
  // its toolbar, actions and tabs would open by themselves. They wait for the teacher: a click or
  // focus on the canvas, or another slide opened.
  const shownWriting = !!slide && !!writingSlideIds?.has(slide.id);
  const [watched, setWatched] = useState<{ id?: Id; writing: boolean; quiet: boolean }>({
    writing: false,
    quiet: false,
  });
  if (watched.id !== slide?.id || watched.writing !== shownWriting) {
    setWatched({
      id: slide?.id,
      writing: shownWriting,
      quiet: watched.id === slide?.id && (watched.quiet || (watched.writing && !shownWriting)),
    });
  }
  const quietControls = watched.quiet && watched.id === slide?.id;
  const wake = useCallback(() => setWatched((w) => (w.quiet ? { ...w, quiet: false } : w)), []);
  useEffect(() => {
    if (canvasFocused) wake();
  }, [canvasFocused, wake]);

  /** Add an element to the active slide and select it — TeachDeck's `insertElement`. */
  const insert = useCallback(
    (el: SlideElement, options?: { edit?: boolean }) => {
      // A slide the generating job is still writing takes no new elements (ADR 0037).
      if (!slide || writingSlideIds?.has(slide.id)) return;
      history.dispatch(reducers.addElement, el, slide.id);
      session.actions.select([el.id]);
      // A new text box goes straight into edit: the placeholder is there to be typed over.
      if (options?.edit) session.actions.setEditingText(el.id);
    },
    [history.dispatch, session.actions, slide, writingSlideIds],
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
                  <FollowMarkContext.Provider value={follow.mark}>
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
                              teacherEdits={teacherEdits}
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
                            <SaveFailedBar autosave={autosave} />
                            {mobile && companion ? (
                              <aside data-editor-companion="mobile">{companion}</aside>
                            ) : null}
                            <div className="relative flex min-h-0 flex-1">
                              {mobile ? (
                                <MobileLessonEditor
                                  initialSlideId={initialSlideId}
                                  followId={follow.following ? follow.target : undefined}
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
                                    <div
                                      ref={setBubbleHost}
                                      className="relative flex min-h-0 flex-1"
                                      onPointerDownCapture={quietControls ? wake : undefined}
                                    >
                                      {/* One live region for the whole fill, mounted across slide changes, so moving
                                          between slides never drops an announcement. */}
                                      {pill.text !== null ? (
                                        <span
                                          role="status"
                                          aria-atomic="true"
                                          data-writing-status
                                          className="sr-only"
                                        >
                                          {pill.text}
                                        </span>
                                      ) : null}
                                      {slide && writingSlideIds?.has(slide.id) ? (
                                        <WritingBlocker />
                                      ) : null}
                                      {pill.text !== null ? (
                                        <WritingPill
                                          text={pill.text}
                                          visible={pill.visible}
                                          phase={pill.state.phase}
                                        />
                                      ) : null}
                                      {companion && !companionGone ? (
                                        <div
                                          data-editor-companion="desktop"
                                          aria-hidden
                                          className="pointer-events-none absolute right-2 bottom-14 z-0"
                                          style={{ width: paneMode === "docked" ? 160 : 120 }}
                                        >
                                          {companion}
                                        </div>
                                      ) : null}
                                      {chip.mounted ? (
                                        <FollowWritingChip
                                          onFollow={follow.resume}
                                          visible={chip.visible}
                                        />
                                      ) : null}
                                      {/* Always wrapped, so the canvas never remounts when a slide's state turns. */}
                                      <div
                                        className="contents"
                                        inert={!!slide && !!writingSlideIds?.has(slide.id)}
                                      >
                                        <LiveSlide
                                          store={drafts}
                                          slideId={slide?.id}
                                          slide={slide}
                                          writing={!!slide && !!writingSlideIds?.has(slide.id)}
                                          reveal={reveal}
                                          onTyped={setTypedId}
                                          typeIn={follow.following && !!writingSlideIds}
                                          hurry={follow.behind >= 2}
                                          render={(shown, live) => (
                                            <Canvas
                                              readOnly={
                                                live || (writingSlideIds?.has(slide.id) ?? false)
                                              }
                                              // While the view follows the writer, no slide's floating
                                              // toolbar opens: it swapped on every slide change (judge
                                              // 638). A click stops the follow and brings them back.
                                              controls={
                                                !quietControls &&
                                                !(writingSlideIds !== undefined && follow.following)
                                              }
                                              slide={
                                                // A draft wears the job's palette until it is the
                                                // lesson's own (a theme picked mid-fill).
                                                shown ? inLessonTheme(shown, lesson) : slide
                                              }
                                              theme={theme}
                                              onFocusChange={setCanvasFocused}
                                              onScaleChange={onScaleChange}
                                              onInsert={insert}
                                              images={images}
                                              lessonId={lessonId}
                                              bubble={!(chatAvailable && editChat.open)}
                                              fitInset={
                                                hasPane && paneMode === "docked" ? paneW : 0
                                              }
                                              clearRight={paneOpen ? paneW : 0}
                                            />
                                          )}
                                        />
                                      </div>
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
                                  bubbleHidden={factsOpen}
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
                  </FollowMarkContext.Provider>
                </ResidualFindingsContext.Provider>
              </ActiveEditorProvider>
            </EditingStateContext.Provider>
          </EditorHooksContext.Provider>
        </EditorSessionProvider>
      </HistoryProvider>
    </LessonProvider>
  );
}

/** Runs the editor's own bookkeeping: history changes inside are not the teacher's. */
function asSystem<T>(flag: { current: boolean }, run: () => T): T {
  flag.current = true;
  try {
    return run();
  } finally {
    flag.current = false;
  }
}

/**
 * Live writing P1 (TEACH-202 part e): the teacher left the slide being written; one click follows
 * it again. The shell's "Newest slide" (TEACH-252) in the editor's words. Bottom left: the docked
 * side pane covers the canvas's right edge.
 */
function FollowWritingChip({ onFollow, visible }: { onFollow: () => void; visible: boolean }) {
  return (
    <button
      type="button"
      data-follow-writing
      onClick={onFollow}
      disabled={!visible}
      style={{ opacity: visible ? 1 : 0 }}
      className="absolute bottom-4 left-4 z-20 flex transition-opacity duration-(--duration-base) ease-(--ease-standard) motion-reduce:transition-none items-center gap-2 rounded-full border border-border bg-background px-3 py-1 font-medium text-foreground text-meta shadow-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
    >
      <span
        aria-hidden
        className="block size-2 rounded-full bg-primary motion-safe:animate-pulse"
      />
      Follow writing
    </button>
  );
}

/**
 * Over a slide the generating job is still writing (UX ruling 189): the slide shows and nothing on
 * it can be picked. The pill that says why is `WritingPill`, mounted for the whole fill.
 */
function WritingBlocker() {
  return (
    <div
      aria-hidden
      // The read-only marker over a slide the job still owns (ADR 0037). The pill that says why is
      // `data-writing-pill`, which stays for the whole fill.
      data-slide-writing-overlay
      className="absolute inset-0 z-20"
      onPointerDownCapture={(e) => e.stopPropagation()}
    />
  );
}

/** How long the pill's old text stays to fade out under the new one (the fade's `--duration-fast`). */
const PILL_CROSSFADE_MS = 200;
/** The old text fades out over this long; the new one starts fading in this far into it. */
const PILL_ROLL_MS = 180;
/**
 * The pill's old text rolls up and out as the new one rolls in from below, a full line apart: the
 * two never sit on top of each other (judge 638: "Planning" and "Writing" garbled for a frame), and
 * one of them is always mostly there (no dot-only frame). Reduced motion: a plain swap.
 */
function roll(el: HTMLElement | null, way: "in" | "out") {
  if (!el || el.dataset.rolled) return;
  el.dataset.rolled = "1";
  if (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    if (way === "out") el.style.visibility = "hidden";
    return;
  }
  const frames =
    way === "in"
      ? [
          { transform: "translateY(100%)", opacity: 0.4 },
          { transform: "translateY(0)", opacity: 1 },
        ]
      : [
          { transform: "translateY(0)", opacity: 1 },
          { transform: "translateY(-100%)", opacity: 0.4 },
        ];
  el.animate?.(frames, { duration: PILL_ROLL_MS, easing: "ease-in-out", fill: "both" });
}

/**
 * The writing pill (jank audit #7): one element from the first slide to the hand-over, at the
 * bottom centre between the "Follow writing" chip and the zoom, at one width whatever it says, so
 * it never jumps between the top of a writing slide and the bottom of a done one. A new text fades
 * in; at the hand-over the pill fades out. The editor's one `data-writing-status` live region
 * announces it.
 */
function WritingPill({ text, visible, phase }: { text: string; visible: boolean; phase: string }) {
  // A new text crossfades with the one before, in the same place: the pill never shows only its dot
  // between two texts (Greg 26 Oct: one blank frame between "Planning 11" and "13").
  const [shownText, setShownText] = useState(text);
  const [leaving, setLeaving] = useState<{ text: string; n: number } | null>(null);
  const [n, setN] = useState(0);
  if (shownText !== text) {
    setLeaving({ text: shownText, n });
    setN(n + 1);
    setShownText(text);
  }
  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => setLeaving(null), PILL_CROSSFADE_MS);
    return () => clearTimeout(t);
  }, [leaving]);
  return (
    <div
      data-writing-pill={phase}
      className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center transition-opacity duration-(--duration-base) ease-(--ease-standard) motion-reduce:transition-none"
      style={{ opacity: visible ? 1 : 0 }}
    >
      <span
        aria-hidden
        className="flex min-w-[17.5rem] items-center justify-center gap-2 rounded-full border border-border bg-background px-3 py-1 font-medium text-foreground text-meta tabular-nums shadow-sm"
      >
        <span
          aria-hidden
          className="block size-2 shrink-0 rounded-full bg-primary motion-safe:animate-pulse"
        />
        <span className="grid justify-items-center overflow-hidden">
          {leaving ? (
            <span
              key={`out-${leaving.n}`}
              aria-hidden
              className="[grid-area:1/1]"
              ref={(el) => roll(el, "out")}
            >
              {leaving.text}
            </span>
          ) : null}
          <span
            key={`in-${n}`}
            data-pill-text
            // The first text comes with the pill itself (no dot-only frame as it mounts).
            className="[grid-area:1/1]"
            ref={n === 0 ? undefined : (el) => roll(el, "in")}
          >
            {text}
          </span>
        </span>
      </span>
    </div>
  );
}

/**
 * The job's slides in the teacher's theme (P1 26 Oct): a slide the merge took whole from the job
 * (matched by id) is drawn in the lesson's theme when it still wears the job's palette. A slide the
 * teacher changed keeps the teacher's copy as it is (ADR 0037: never overwritten). The result is
 * what the history holds and the autosave sends, so the saved lesson never keeps old-theme slides.
 */
function inTeachersTheme(merged: Lesson, theirs: Lesson, base?: Lesson): Lesson {
  const job = new Map(theirs.slides.map((s) => [s.id, s]));
  let changed = false;
  let measure: ReturnType<typeof createMeasurer> | undefined;
  // TEACH-247 part ag: only a slide still the job's (ADR 0037: `writing`, or finishing in this
  // round) is fitted to the teacher's theme; a `done` slide is the teacher's and is recoloured only.
  const jobs = (id: string) =>
    theirs.generation?.slideStates?.[id] === "writing" ||
    base?.generation?.slideStates?.[id] !== "done";
  const slides = merged.slides.map((s) => {
    const copy = job.get(s.id);
    if (copy === undefined || (copy !== s && !sameJson(copy, s))) return s;
    const fit = jobs(s.id);
    if (fit) measure ??= createMeasurer(renderTheme(merged));
    const next = inLessonTheme(s, merged, fit ? measure : undefined);
    if (next !== s) changed = true;
    return next;
  });
  return changed ? { ...merged, slides } : merged;
}

/**
 * `doc` with every slide a teacher's step changed since `prev` marked `teacherEdited` (ADR 0037,
 * TEACH-251 part p): the job's merge keeps those as the teacher's. Only for a generated lesson
 * (one a job may still write); a step that changed the theme is the editor redrawing every slide
 * and marks none.
 */
export function markTeacherEdited(prev: Lesson | undefined, doc: Lesson): Lesson {
  if (!prev || !doc.generation || prev.themeId !== doc.themeId) return doc;
  const before = new Map(prev.slides.map((s) => [s.id, s]));
  let changed = false;
  const slides = doc.slides.map((s) => {
    if (s.teacherEdited) return s;
    const was = before.get(s.id);
    if (was === s || (was !== undefined && sameJson(was, s))) return s;
    changed = true;
    return { ...s, teacherEdited: true as const };
  });
  return changed ? { ...doc, slides } : doc;
}

/** Whether two copies of a lesson differ only in the editor's stamps: `fitVersion`, `updatedAt`. */
function onlyStampsDiffer(a: Lesson, b: Lesson): boolean {
  const unstamped = (l: Lesson) => ({ ...l, fitVersion: 0, updatedAt: "" });
  return sameJson(unstamped(a), unstamped(b));
}
