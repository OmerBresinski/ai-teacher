/**
 * Editor session state (ADR 0022 §4): everything about *this editing session* that is not the
 * document — selection, active slide, zoom, preview step, clipboard. TeachDeck kept it in the
 * zustand `UiState` (`lesson-store.ts` :26-49, minus `dirty` and `linkSharing`); here it is a
 * `useReducer` owned by `LessonEditor` and handed down through split contexts so a component that
 * reads the selection does not re-render when the zoom changes.
 *
 * Document edits are not here: they are pure reducers dispatched through `useDocumentHistory`.
 * Actions that TeachDeck composed in the store (`selectAll`, `copy`, `cut`, `paste`) take their
 * document half as an argument or are composed by the caller (`use-canvas-keys.ts`).
 */

import { type Id, type Slide, type SlideElement, slideStepCount } from "@tj/domain/documents";
import {
  createContext,
  createElement,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  useRef,
} from "react";

export type Zoom = number | "fit";

export type SessionState = {
  /** `null` until the teacher picks one; readers fall back to the first slide. */
  activeSlideId: Id | null;
  selection: Id[];
  editingTextId: Id | null;
  /**
   * Slide whose "Why?" explanation is being typed into, if any. The panel is not an element, so it
   * cannot use `editingTextId`, which addresses element ids.
   */
  editingExplanation: Id | null;
  zoom: Zoom;
  clipboard: SlideElement[] | null;
  clipboardSlide: Slide | null;
  previewStep: number;
  previewAnswer: boolean;
  showGuides: boolean;
  snap: boolean;
};

export const INITIAL_SESSION: SessionState = {
  activeSlideId: null,
  selection: [],
  editingTextId: null,
  editingExplanation: null,
  zoom: "fit",
  clipboard: null,
  clipboardSlide: null,
  previewStep: 0,
  previewAnswer: false,
  showGuides: true,
  snap: true,
};

export type SessionAction =
  | { type: "select"; ids: Id[] }
  | { type: "toggleSelect"; id: Id }
  | { type: "clearSelection" }
  | { type: "setActiveSlide"; id: Id }
  | { type: "setEditingText"; id: Id | null }
  | { type: "setEditingExplanation"; slideId: Id | null }
  | { type: "setZoom"; zoom: Zoom }
  | { type: "setPreviewStep"; step: number }
  | { type: "setPreviewAnswer"; showing: boolean }
  | { type: "toggleGuides" }
  | { type: "toggleSnap" }
  | { type: "copy"; elements: SlideElement[] }
  | { type: "copySlide"; slide: Slide };

export function sessionReducer(s: SessionState, a: SessionAction): SessionState {
  switch (a.type) {
    case "select":
      return { ...s, selection: a.ids, editingTextId: null };
    case "toggleSelect":
      return {
        ...s,
        selection: s.selection.includes(a.id)
          ? s.selection.filter((x) => x !== a.id)
          : [...s.selection, a.id],
      };
    case "clearSelection":
      return s.selection.length === 0 && !s.editingTextId
        ? s
        : { ...s, selection: [], editingTextId: null };
    case "setActiveSlide":
      // Changing slide drops everything that addressed the old one.
      return s.activeSlideId === a.id
        ? s
        : {
            ...s,
            activeSlideId: a.id,
            selection: [],
            editingTextId: null,
            editingExplanation: null,
            previewStep: 0,
            previewAnswer: false,
          };
    case "setEditingText":
      return { ...s, editingTextId: a.id, selection: a.id ? [a.id] : s.selection };
    case "setEditingExplanation":
      return { ...s, editingExplanation: a.slideId };
    case "setZoom":
      return s.zoom === a.zoom ? s : { ...s, zoom: a.zoom };
    case "setPreviewStep":
      return s.previewStep === a.step ? s : { ...s, previewStep: a.step };
    case "setPreviewAnswer":
      // Leaving the answer state takes the panel away, so it must take the caret with it.
      return a.showing
        ? { ...s, previewAnswer: true }
        : { ...s, previewAnswer: false, editingExplanation: null };
    case "toggleGuides":
      return { ...s, showGuides: !s.showGuides };
    case "toggleSnap":
      return { ...s, snap: !s.snap };
    case "copy":
      return a.elements.length === 0 ? s : { ...s, clipboard: a.elements };
    case "copySlide":
      return { ...s, clipboardSlide: a.slide };
  }
}

/** The UI half of TeachDeck's `Actions`, as stable callbacks. */
export type SessionActions = {
  select: (ids: Id[]) => void;
  toggleSelect: (id: Id) => void;
  clearSelection: () => void;
  setActiveSlide: (id: Id) => void;
  setEditingText: (id: Id | null) => void;
  setEditingExplanation: (slideId: Id | null) => void;
  setZoom: (zoom: Zoom) => void;
  setPreviewStep: (step: number) => void;
  setPreviewAnswer: (showing: boolean) => void;
  toggleGuides: () => void;
  toggleSnap: () => void;
  /** Keep these elements as the clipboard (`cut` is copy + `deleteElements` in the caller). */
  copy: (elements: SlideElement[]) => void;
  copySlide: (slide: Slide) => void;
};

export type EditorSession = {
  state: SessionState;
  actions: SessionActions;
  /** The latest state for event handlers that must not re-subscribe (drags, key handlers). */
  read: () => SessionState;
};

export function useEditorSessionState(initial: Partial<SessionState> = {}): EditorSession {
  const [state, dispatch] = useReducer(sessionReducer, initial, (seed) => ({
    ...INITIAL_SESSION,
    ...seed,
  }));
  const ref = useRef(state);
  ref.current = state;
  const read = useCallback(() => ref.current, []);
  const actions = useMemo<SessionActions>(
    () => ({
      select: (ids) => dispatch({ type: "select", ids }),
      toggleSelect: (id) => dispatch({ type: "toggleSelect", id }),
      clearSelection: () => dispatch({ type: "clearSelection" }),
      setActiveSlide: (id) => dispatch({ type: "setActiveSlide", id }),
      setEditingText: (id) => dispatch({ type: "setEditingText", id }),
      setEditingExplanation: (slideId) => dispatch({ type: "setEditingExplanation", slideId }),
      setZoom: (zoom) => dispatch({ type: "setZoom", zoom }),
      setPreviewStep: (step) => dispatch({ type: "setPreviewStep", step }),
      setPreviewAnswer: (showing) => dispatch({ type: "setPreviewAnswer", showing }),
      toggleGuides: () => dispatch({ type: "toggleGuides" }),
      toggleSnap: () => dispatch({ type: "toggleSnap" }),
      copy: (elements) => dispatch({ type: "copy", elements }),
      copySlide: (slide) => dispatch({ type: "copySlide", slide }),
    }),
    [],
  );
  return useMemo(() => ({ state, actions, read }), [state, actions, read]);
}

/* ------------------------------------------------------------------ */
/* Contexts                                                            */
/* ------------------------------------------------------------------ */

/** The hot slices get their own context so a zoom change does not re-render the navigator. */
const SelectionContext = createContext<Id[]>(INITIAL_SESSION.selection);
const ActiveSlideContext = createContext<Id | null>(null);
const ZoomContext = createContext<Zoom>("fit");
/** Everything else, changed rarely: editing ids, preview, guides, snap, clipboards. */
export type SessionUi = Omit<SessionState, "selection" | "activeSlideId" | "zoom">;
const UiContext = createContext<SessionUi | null>(null);
const ActionsContext = createContext<SessionActions | null>(null);
const ReadContext = createContext<(() => SessionState) | null>(null);

export function EditorSessionProvider({
  session,
  children,
}: {
  session: EditorSession;
  children: ReactNode;
}) {
  const { state, actions, read } = session;
  const {
    selection,
    activeSlideId,
    zoom,
    editingTextId,
    editingExplanation,
    clipboard,
    clipboardSlide,
    previewStep,
    previewAnswer,
    showGuides,
    snap,
  } = state;
  const ui = useMemo<SessionUi>(
    () => ({
      editingTextId,
      editingExplanation,
      clipboard,
      clipboardSlide,
      previewStep,
      previewAnswer,
      showGuides,
      snap,
    }),
    [
      editingTextId,
      editingExplanation,
      clipboard,
      clipboardSlide,
      previewStep,
      previewAnswer,
      showGuides,
      snap,
    ],
  );
  return createElement(
    ReadContext.Provider,
    { value: read },
    createElement(
      ActionsContext.Provider,
      { value: actions },
      createElement(
        UiContext.Provider,
        { value: ui },
        createElement(
          ZoomContext.Provider,
          { value: zoom },
          createElement(
            ActiveSlideContext.Provider,
            { value: activeSlideId },
            createElement(SelectionContext.Provider, { value: selection }, children),
          ),
        ),
      ),
    ),
  );
}

function required<T>(value: T | null, name: string): T {
  if (value === null) throw new Error(`${name} is only available inside <EditorSessionProvider>`);
  return value;
}

export const useSelection = (): Id[] => useContext(SelectionContext);
export const useActiveSlideId = (): Id | null => useContext(ActiveSlideContext);
export const useZoom = (): Zoom => useContext(ZoomContext);
export const useSessionUi = (): SessionUi => required(useContext(UiContext), "useSessionUi");
export const useSessionActions = (): SessionActions =>
  required(useContext(ActionsContext), "useSessionActions");
/** `read()` returns the latest state without subscribing — for pointer and key handlers. */
export const useSessionRead = (): (() => SessionState) =>
  required(useContext(ReadContext), "useSessionRead");

/* ------------------------------------------------------------------ */
/* Derived readers over `lesson` + session                             */
/* ------------------------------------------------------------------ */

/** The slide `activeSlideId` names, else the first — derived at read time, never stored. */
export function resolveActiveSlide(
  slides: readonly Slide[],
  activeSlideId: Id | null,
): Slide | undefined {
  return (activeSlideId ? slides.find((s) => s.id === activeSlideId) : undefined) ?? slides[0];
}

export function useActiveSlide(slides: readonly Slide[]): Slide | undefined {
  const id = useActiveSlideId();
  return useMemo(() => resolveActiveSlide(slides, id), [slides, id]);
}

/**
 * Is the slide showing its answer? Two routes into that state, and they are equal: the Answer tab
 * (`previewAnswer`), and standing on the last reveal step, which *is* the answer reveal (TeachDeck
 * SPEC §6). Every reader asks here so the tabs, the canvas and the panel can never disagree.
 */
export function answerShowing(
  slide: Slide | null | undefined,
  previewAnswer: boolean,
  previewStep: number,
): boolean {
  if (!slide?.question) return false;
  if (previewAnswer) return true;
  const steps = slideStepCount(slide);
  return steps > 0 && previewStep >= steps;
}

export function useAnswerShowing(slide: Slide | null | undefined): boolean {
  const { previewAnswer, previewStep } = useSessionUi();
  return answerShowing(slide, previewAnswer, previewStep);
}

const EMPTY: SlideElement[] = [];

/** The selected elements of the active slide (TeachDeck `useSelectedElements`). */
export function useSelectedElements(slide: Slide | undefined): SlideElement[] {
  const selection = useSelection();
  return useMemo(() => {
    if (!slide || selection.length === 0) return EMPTY;
    const picked = new Set(selection);
    return slide.elements.filter((e) => picked.has(e.id));
  }, [slide, selection]);
}
