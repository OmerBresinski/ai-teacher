import type { QueryKey } from "@tanstack/react-query";
import type { Lesson, RichDoc, SlideElement, Theme } from "@tj/domain/documents";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { makeLine, makeShape, makeText } from "../model/insert";
import * as reducers from "../model/reducers";
import { getTheme } from "../model/themes";
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
import { HelpDialog } from "./HelpDialog";
import { InsertRail } from "./InsertRail";
import { isInTextField, matchesBinding } from "./keys";
import { Navigator } from "./Navigator";
import { TopBar } from "./TopBar";
import { CANVAS_ROOT_SELECTOR } from "./transform/gesture-state";
import { useAutosave } from "./use-autosave";
import {
  EditorSessionProvider,
  resolveActiveSlide,
  useEditorSessionState,
} from "./use-editor-session";

/*
 * The lesson editor shell (TeachDeck `components/v2/editor/EditorShell.tsx`): TopBar over
 * InsertRail | Navigator | Canvas, with the shell's own shortcuts on one `keydown` listener and the
 * `?` help sheet. The document lives in the TanStack Query cache under `queryKey` and is edited
 * through `useDocumentHistory` (ADR 0022 §4); the session state — selection, zoom, clipboard — is
 * React state owned here and handed down through `EditorSessionProvider`. Saving is the app's
 * `onSave` (ADR 0022 §5), debounced by `useAutosave`.
 *
 * Not wired yet: `useFitMigration` (TEACH-106), the theme dialog (TEACH-105), in-place text editing
 * (TEACH-104) — the canvas renders text statically until then.
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
  /** The cache entry that holds the document — `queryKeys.libraryDocument(id)` in the app. */
  queryKey: QueryKey;
  /** Fetches the document for a first mount the loader has not filled (e.g. `fetchQuery(options)`). */
  queryFn?: () => Promise<unknown>;
  /** Persist the document: the mock store today, `PUT /documents/:id` later. */
  onSave: (lesson: Lesson) => Promise<void>;
  onBack: () => void;
  /** Called after the autosave has flushed, so present mode opens the deck as it is now. */
  onPresent: () => void;
  /** Where the export control sits once it exists (E1). */
  exportSlot?: ReactNode;
};

export function LessonEditor({
  lessonId,
  queryKey,
  queryFn,
  onSave,
  onBack,
  onPresent,
  exportSlot,
}: LessonEditorProps) {
  const autosave = useAutosave(onSave);
  const { lesson, ...history } = useDocumentHistory({
    queryKey,
    queryFn,
    onChange: autosave.onChange,
  });
  const session = useEditorSessionState();
  const [helpOpen, setHelpOpen] = useState(false);
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

  const theme = useMemo(() => getTheme(lesson?.themeId), [lesson?.themeId]);
  const slide = lesson ? resolveActiveSlide(lesson.slides, session.state.activeSlideId) : undefined;

  /** Add an element to the active slide and select it — TeachDeck's `insertElement`. */
  const insert = useCallback(
    (el: SlideElement) => {
      if (!slide) return;
      history.dispatch(reducers.addElement, el, slide.id);
      session.actions.select([el.id]);
    },
    [history.dispatch, session.actions, slide],
  );

  // The shell's own keys, on one listener. Insert only while the canvas has focus and nothing is
  // typing; zoom and help everywhere but inside a field.
  const focusedRef = useRef(canvasFocused);
  focusedRef.current = canvasFocused;
  const insertRef = useRef(insert);
  insertRef.current = insert;
  const { setZoom } = session.actions;
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
        const make = INSERT_KEYS[e.key];
        if (!make) return;
        e.preventDefault();
        insertRef.current(make(theme));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [readSession, setZoom, theme]);

  if (!lesson || !slide) return null;

  return (
    <LessonProvider value={lesson}>
      <HistoryProvider value={historyApi}>
        <EditorSessionProvider session={session}>
          <EditorHooksContext.Provider value={editorHooks}>
            <EditingStateContext.Provider value={editingState}>
              <ActiveEditorProvider>
                <div
                  className="flex h-dvh flex-col overflow-hidden bg-background"
                  data-lesson-editor={lessonId}
                >
                  <TopBar
                    onBack={onBack}
                    onPresent={onPresent}
                    exportSlot={exportSlot}
                    autosave={autosave}
                  />
                  <div className="flex min-h-0 flex-1">
                    <InsertRail theme={theme} onInsert={insert} onHelp={() => setHelpOpen(true)} />
                    <Navigator />
                    <Canvas
                      slide={slide}
                      theme={theme}
                      onFocusChange={setCanvasFocused}
                      onScaleChange={onScaleChange}
                    />
                  </div>
                  <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
                </div>
              </ActiveEditorProvider>
            </EditingStateContext.Provider>
          </EditorHooksContext.Provider>
        </EditorSessionProvider>
      </HistoryProvider>
    </LessonProvider>
  );
}
