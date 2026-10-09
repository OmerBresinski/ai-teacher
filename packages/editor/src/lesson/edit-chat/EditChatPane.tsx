import type { Slide, SlideElement, TextElement } from "@tj/domain/documents";
import { cn } from "@tj/ui";
import {
  createContext,
  type FormEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as reducers from "../../model/reducers";
import { useHistory, useLesson } from "../document-context";
import { type PromptEditAnswer, type PromptEditPartial, useProposals } from "../proposals-context";
import { sidePaneClass } from "../SidePaneDock";
import type { PaneMode } from "../shell-layout";
import {
  useActiveSlide,
  useSelection,
  useSessionActions,
  useSessionRead,
} from "../use-editor-session";
import { ChatThread, type ChatView } from "./ChatThread";
import { type BubbleState, EditChatBubble } from "./EditChatBubble";
import { EDIT_CHAT_LABEL } from "./edit-chat-context";
import {
  type Alternative,
  type BoxChange,
  canUndo,
  type EditScope,
  hasIdentifier,
  historyOf,
  lateIsCurrent,
  readThread,
  resolveFollowUp,
  type Suggestion,
  scopeLabel,
  scopeOf,
  slideNumber,
  splitLate,
  suggestionsFor,
  type Turn,
  writeThread,
} from "./thread";

/*
 * "Edit with Dayback" (TEACH-97; rulings 171–176): a chat pane docked on the right of the editor.
 * The chip above the composer shows what the next message acts on and follows the selection;
 * removing it widens the scope to the whole lesson. Each message gets a one-line reply naming what
 * changed and where; an applied change has Undo (that change exactly, never over a hand edit) and
 * "Show on slide". Changes apply at once (172). The thread is kept per lesson across reloads.
 * The pane reads as a familiar chat (`ChatThread`, chat-d); this file holds its behaviour.
 *
 * Streaming: the answer streams in (`onPromptEdit`'s `onPartial`, SSE from the route). Partials
 * fill the reply and its change card for display only; the slide changes, and Undo or Use this
 * enable, only when the checked answer arrives. Stop aborts the request, which stops the model.
 *
 * Paths: text edits on a box or a slide run the fast path (`onPromptEdit`). The agent path (slide
 * structure, pictures, diagrams, animation, the whole lesson) waits on the saved slide spec
 * (part c): those requests are answered in teacher words and their suggestions are not offered.
 */

export { EDIT_CHAT_LABEL } from "./edit-chat-context";

const WHOLE_LESSON =
  "I can’t change the whole lesson at once yet. I can change one slide at a time.";
const STOPPED = "Stopped. Nothing changed.";
const FAILED = "That edit didn’t work. Try again.";
const CHANGED_SINCE = "That text has changed since, so I left it as it is.";
const TYPED_MEANWHILE = "You changed that text while I was working, so I kept yours.";
export const TRY_AGAIN = "Try again on your text";
export const IDENTIFIER =
  "To protect personal data, I can’t send email addresses, ID numbers or pupils’ names. Take it out and try again.";
/** The server's instruction limit (`EDIT_INSTRUCTION_MAX`), as the composer's `maxLength`. */
const INSTRUCTION_MAX = 500;
const KEEP_SHORT = ". Keep it short.";

const newId = () => Math.random().toString(36).slice(2, 10);

/**
 * The pane's state and behaviour, owned at the editor level (`EditChatProvider`): a request
 * survives the pane unmounting for any reason (the bubble, a resize to the mobile layout) and is
 * cancelled only by Stop or by leaving the editor.
 */
function useEditChatController({
  lessonId,
  userId = "",
  open,
  onClose,
}: {
  lessonId: string;
  /** The signed-in user: the stored thread is kept per user and lesson. */
  userId?: string | undefined;
  open: boolean;
  onClose: () => void;
}) {
  const lesson = useLesson();
  const history = useHistory();
  const { onPromptEdit } = useProposals();
  // The slide on the canvas: the session's, or the first slide before one is picked.
  const activeSlideId = useActiveSlide(lesson.slides)?.id ?? null;
  const selection = useSelection();
  const actions = useSessionActions();
  const readSession = useSessionRead();

  const [thread, setThread] = useState<Turn[]>(() => readThread(lessonId, userId));
  const [draft, setDraft] = useState("");
  const [widened, setWidened] = useState(false);
  /** Answers as they stream in, by turn id: shown in the reply, never applied. */
  const [streams, setStreams] = useState<Record<string, PromptEditPartial>>({});
  const pending = useRef<{ id: string; controller: AbortController } | null>(null);
  const field = useRef<HTMLTextAreaElement | null>(null);
  const list = useRef<HTMLOListElement | null>(null);
  const lessonRef = useRef(lesson);
  lessonRef.current = lesson;

  useEffect(() => writeThread(lessonId, thread, userId), [lessonId, thread, userId]);
  // Closing the pane never cancels: it stays mounted as the bubble and the answer applies under
  // the usual rules. Only Stop, or leaving the editor, cancels; a turn cut off by leaving reads
  // back as "Stopped. Nothing changed." (`readThread`), which is then the truth (ruling 173).
  useEffect(
    () => () => {
      pending.current?.controller.abort();
      pending.current = null;
    },
    [],
  );
  // The chip follows the selection: a new selection undoes "Whole lesson".
  const selectionKey = selection.join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when the selection changes
  useEffect(() => setWidened(false), [activeSlideId, selectionKey]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on every new reply
  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread, streams]);

  const selectedScope = useMemo(
    () => scopeOf(lesson, activeSlideId, selection),
    [lesson, activeSlideId, selection],
  );
  const scope: EditScope = widened ? {} : selectedScope;
  const chip = scopeLabel(lesson, scope, widened ? 1 : selection.length);
  const suggestions = draft.trim() === "" ? suggestionsFor(lesson, scope) : [];
  const pendingId = thread.find((t) => t.reply.kind === "pending")?.id;
  const busy = pendingId !== undefined;

  // An answer that lands while the pane is closed leaves a dot on the bubble; opening the pane
  // shows that turn and clears it.
  const [unread, setUnread] = useState<{ id: string; failed: boolean; text: string } | null>(null);
  // Closed from the pane's own button: focus moves to the bubble rather than being lost.
  const closedHere = useRef(false);
  if (open) closedHere.current = false;
  const openRef = useRef(open);
  openRef.current = open;
  const lastPending = useRef(pendingId);
  useEffect(() => {
    const was = lastPending.current;
    lastPending.current = pendingId;
    if (!was || was === pendingId || openRef.current) return;
    const turn = thread.find((t) => t.id === was);
    if (!turn || turn.reply.kind === "pending" || turn.reply.kind === "stopped") return;
    const failed = turn.reply.kind === "failed";
    setUnread({
      id: was,
      failed,
      text: failed ? "Dayback: that edit didn’t work." : `Dayback: ${turn.reply.text}`,
    });
  }, [pendingId, thread]);
  useEffect(() => {
    if (!open || !unread) return;
    list.current
      ?.querySelector(`[data-edit-turn-id="${unread.id}"]`)
      ?.scrollIntoView({ block: "nearest" });
    setUnread(null);
  }, [open, unread]);
  // Slides at the top of the pane: working while a request is out, then how the last one ended.
  const last = thread[thread.length - 1];
  const castState = busy
    ? "working"
    : !last
      ? "idle"
      : last.reply.kind === "failed" || last.reply.kind === "stopped"
        ? "failed"
        : "done";
  const bubble: BubbleState = busy
    ? "working"
    : unread
      ? unread.failed
        ? "failed"
        : "reply"
      : "idle";

  const update = useCallback((id: string, patch: (t: Turn) => Turn) => {
    setThread((all) => all.map((t) => (t.id === id ? patch(t) : t)));
  }, []);

  /** Write boxes on a slide as one undo step (leaving an open text edit first). */
  const write = useCallback(
    (slideId: string, boxes: readonly BoxChange[]) => {
      // Leave an open text edit first, so the change is its own undo step (as `applyProposals`).
      const editing = readSession().editingTextId;
      if (editing && boxes.some((b) => b.elementId === editing)) actions.setEditingText(null);
      history.flushTransactions();
      history.beginTransaction();
      try {
        for (const b of boxes)
          history.dispatch(reducers.updateElement, slideId, b.elementId, {
            doc: b.after,
          } as Partial<TextElement>);
      } finally {
        history.endTransaction();
      }
    },
    [actions, history, readSession],
  );

  /**
   * Apply an answer's boxes as one undo step. A box the teacher typed in while the request was
   * out is never overwritten: it comes back in `kept`, with the answer's text as a suggestion.
   */
  const apply = useCallback(
    (sent: Slide, answer: Extract<PromptEditAnswer, { action: "edit" }>) => {
      const slide = lessonRef.current.slides.find((s) => s.id === sent.id);
      if (!slide) return null;
      const { apply: boxes, kept } = splitLate(sent, slide, answer.changes);
      if (boxes.length > 0) write(slide.id, boxes);
      return { boxes, kept };
    },
    [write],
  );

  /** "Use this": the kept suggestion goes into its boxes, as one undo step, while still current. */
  const applyLate = useCallback(
    (turn: Turn) => {
      const late = turn.late;
      if (!late || !lateIsCurrent(lessonRef.current, late)) return;
      write(late.slideId, late.boxes);
      const n = slideNumber(lessonRef.current, late.slideId);
      update(turn.id, (t) => ({
        ...t,
        reply: { kind: "edit", text: `Slide ${n}: ${late.summary}` },
        change: {
          slideId: late.slideId,
          boxes: [...(t.change?.boxes ?? []), ...late.boxes],
        },
        late: { ...late, used: true },
      }));
    },
    [write, update],
  );

  const undoTurn = useCallback(
    (turn: Turn) => {
      const change = turn.change;
      if (!change) return;
      const said = `Undid: ${turn.said}`;
      if (!canUndo(lessonRef.current, change)) {
        setThread((all) => [
          ...all,
          {
            id: newId(),
            said: "Undo",
            instruction: "undo",
            scope: { slideId: change.slideId },
            scopeLabel: scopeLabel(lessonRef.current, { slideId: change.slideId }),
            reply: { kind: "refuse", text: CHANGED_SINCE },
          },
        ]);
        return;
      }
      history.flushTransactions();
      history.beginTransaction();
      try {
        for (const b of change.boxes)
          history.dispatch(reducers.updateElement, change.slideId, b.elementId, {
            doc: b.before,
          } as Partial<SlideElement>);
      } finally {
        history.endTransaction();
      }
      setThread((all) => [
        ...all.map((t) =>
          t.id === turn.id && t.change ? { ...t, change: { ...t.change, undone: true } } : t,
        ),
        {
          id: newId(),
          said: "Undo",
          instruction: "undo",
          scope: { slideId: change.slideId },
          scopeLabel: scopeLabel(lessonRef.current, { slideId: change.slideId }),
          reply: { kind: "undo", text: said },
        },
      ]);
    },
    [history],
  );

  const showOnSlide = useCallback(
    (turn: Turn) => {
      const change = turn.change;
      if (!change) return;
      actions.setActiveSlide(change.slideId);
      actions.select(change.boxes.map((b) => b.elementId));
    },
    [actions],
  );

  const send = useCallback(
    async (said: string, sendScope: EditScope, label = said) => {
      const text = said.trim();
      if (text === "" || !onPromptEdit || pending.current) return;
      const current = lessonRef.current;
      const resolved = resolveFollowUp(current, thread, text, sendScope);
      setDraft("");
      if (resolved.kind === "undo") {
        if (resolved.turn) undoTurn({ ...resolved.turn });
        else
          setThread((all) => [
            ...all,
            {
              id: newId(),
              said: label,
              instruction: "undo",
              scope: sendScope,
              scopeLabel: scopeLabel(current, sendScope),
              reply: { kind: "no-change", text: "There is nothing to undo." },
            },
          ]);
        return;
      }
      const { instruction, scope: target } = resolved;
      const id = newId();
      const base: Turn = {
        id,
        said: label,
        instruction,
        scope: target,
        scopeLabel: scopeLabel(current, target),
        reply: { kind: "pending", text: "" },
      };
      if (hasIdentifier(instruction)) {
        setThread((all) => [...all, { ...base, reply: { kind: "refuse", text: IDENTIFIER } }]);
        return;
      }
      const slide = current.slides.find((s) => s.id === target.slideId);
      if (!slide) {
        // The whole lesson needs the agent path (part c): say so, and offer this slide instead.
        const here = activeSlideId ?? current.slides[0]?.id;
        const alternative: Alternative | undefined = here
          ? {
              label: `Change slide ${slideNumber(current, here)} instead`,
              instruction,
              scope: { slideId: here },
            }
          : undefined;
        setThread((all) => [
          ...all,
          { ...base, reply: { kind: "refuse", text: WHOLE_LESSON, alternative } },
        ]);
        return;
      }
      const n = slideNumber(current, slide.id);
      const box = target.elementId
        ? slide.elements.find((e) => e.id === target.elementId)
        : undefined;
      // Only text can change without the agent path: any other selection acts on the slide.
      const elementId = box?.type === "text" ? box.id : undefined;
      setThread((all) => [
        ...all,
        {
          ...base,
          reply: {
            kind: "pending",
            text: resolved.note
              ? `Doing “${resolved.note}” on slide ${n}…`
              : `Changing ${elementId ? "this text box" : "the text"} on slide ${n}…`,
          },
        },
      ]);
      const controller = new AbortController();
      pending.current = { id, controller };
      let answer: PromptEditAnswer;
      try {
        answer = await onPromptEdit(
          { slide, elementId, instruction, history: historyOf(current, thread) },
          controller.signal,
          (partial) => {
            if (!controller.signal.aborted) setStreams((all) => ({ ...all, [id]: partial }));
          },
        );
      } catch {
        answer = { action: "failed", reason: controller.signal.aborted ? STOPPED : FAILED };
      }
      // The streamed partial is display only: the checked answer replaces it, and Stop drops it.
      setStreams((all) => {
        if (!(id in all)) return all;
        const { [id]: _, ...rest } = all;
        return rest;
      });
      if (pending.current?.id !== id || controller.signal.aborted) return;
      pending.current = null;
      if (answer.action === "edit") {
        const result = apply(slide, answer);
        if (!result || (result.boxes.length === 0 && result.kept.length === 0)) {
          update(id, (t) => ({ ...t, reply: { kind: "no-change", text: "No change." } }));
          return;
        }
        const { boxes, kept } = result;
        const summary = answer.summary.trim() || "Changed the text.";
        // Boxes the teacher typed in keep their text; the answer waits as a preview to use.
        const late = kept.length > 0 ? { slideId: slide.id, summary, boxes: kept } : undefined;
        const retry: Alternative | undefined = late
          ? { label: TRY_AGAIN, instruction, scope: target }
          : undefined;
        update(id, (t) => ({
          ...t,
          reply:
            boxes.length > 0
              ? { kind: "edit", text: `Slide ${n}: ${summary}`, alternative: retry }
              : { kind: "refuse", text: TYPED_MEANWHILE, alternative: retry },
          change: boxes.length > 0 ? { slideId: slide.id, boxes } : undefined,
          late,
        }));
        return;
      }
      // An offer that names a pupil (or an email, an ID number) is dropped: tapping it could only
      // end in the "I can't send that" refusal.
      const offer = answer.offer && !hasIdentifier(answer.offer) ? answer.offer : undefined;
      const alternative: Alternative | undefined = offer
        ? { label: offer, instruction: offer, scope: target }
        : answer.check === "fit"
          ? {
              label: "Try a shorter version",
              instruction: `${instruction.slice(0, INSTRUCTION_MAX - KEEP_SHORT.length)}${KEEP_SHORT}`,
              scope: target,
            }
          : undefined;
      update(id, (t) => ({
        ...t,
        reply: {
          kind:
            answer.action === "no-change"
              ? "no-change"
              : answer.action === "failed"
                ? "failed"
                : "refuse",
          text: answer.reason,
          alternative,
        },
      }));
    },
    [onPromptEdit, thread, undoTurn, activeSlideId, apply, update],
  );

  const stop = useCallback(() => {
    const p = pending.current;
    if (!p) return;
    p.controller.abort();
    pending.current = null;
    update(p.id, (t) => ({ ...t, reply: { kind: "stopped", text: STOPPED } }));
  }, [update]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void send(draft, scope);
  };

  const close = () => {
    closedHere.current = true;
    onClose();
  };
  const view: ChatView = {
    lesson,
    thread,
    draft,
    setDraft,
    send: (said, s, label) => void send(said, s, label),
    submit,
    scope,
    chip,
    widen: scope.slideId ? () => setWidened(true) : undefined,
    suggestions,
    busy,
    stop,
    undo: undoTurn,
    show: showOnSlide,
    takeLate: applyLate,
    lateCurrent: (t) => (t.late ? lateIsCurrent(lesson, t.late) : false),
    castState,
    close,
    field,
    list,
    streams,
  };

  return { view, bubble, unread, closedHere };
}

type EditChatController = ReturnType<typeof useEditChatController>;
const EditChatControllerContext = createContext<EditChatController | null>(null);

/** Owns the chat for as long as the editor is open; the pane and the bubble read it. */
export function EditChatProvider({
  lessonId,
  userId,
  open,
  onClose,
  children,
}: {
  lessonId: string;
  userId?: string | undefined;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const controller = useEditChatController({ lessonId, userId, open, onClose });
  return (
    <EditChatControllerContext.Provider value={controller}>
      {children}
    </EditChatControllerContext.Provider>
  );
}

export function EditChatPane({
  open = true,
  onReopen,
  focusTick,
  bubbleHost,
  bubbleHidden = false,
  paneMode = "docked",
  paneWidth = 320,
}: {
  /** Layout A's shell rules (`shell-layout.ts`): reserved or over the filmstrip, and the fluid width. */
  paneMode?: PaneMode;
  paneWidth?: number;
  /** Layout A: the canvas row the bubble sits in (bottom right, on the zoom row). */
  bubbleHost?: HTMLElement | null;
  /** Another pane (Facts) holds the right slot: no bubble over it until it closes. */
  bubbleHidden?: boolean;
  /** Closed, the pane shows as the bubble; the request carries on in `EditChatProvider`. */
  open?: boolean;
  /** The bubble's click: open the pane again. */
  onReopen?: () => void;
  /** Bumped by `openAndFocus`: the composer takes the cursor. */
  focusTick: number;
}) {
  const controller = useContext(EditChatControllerContext);
  if (!controller) throw new Error("EditChatPane renders inside EditChatProvider");
  const { view, bubble, unread, closedHere } = controller;
  const close = view.close;
  // biome-ignore lint/correctness/useExhaustiveDependencies: focus on each bump only
  useEffect(() => {
    if (focusTick > 0) view.field.current?.focus();
  }, [focusTick]);
  // Escape from the top bar (where focus lands when ⋯ closes) or from nowhere closes the open pane
  // too, as it does from inside it. The canvas keeps its own Escape (deselect).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const target = e.target as Element | null;
      if (target !== document.body && !target?.closest?.("[data-topbar]")) return;
      // A menu or dialog still open owns this Escape. A top-bar tooltip (shown because focus came
      // back to its button) does not: it closes along with the pane.
      if (document.querySelector('[role="dialog"][data-state="open"], [role="menu"]')) return;
      e.preventDefault();
      close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);
  return (
    <>
      {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: Esc closes the pane from anywhere inside it */}
      <aside
        aria-label={EDIT_CHAT_LABEL}
        data-edit-chat
        data-side-pane={paneMode}
        hidden={!open}
        style={{ width: paneWidth }}
        className={cn(
          "shrink-0 flex-col bg-card text-foreground shadow-(--edit-chat-shadow)",
          open ? "flex" : "hidden",
          sidePaneClass(paneMode),
        )}
        onKeyDown={(e) => {
          if (e.key === "Escape" && !e.defaultPrevented) {
            e.preventDefault();
            close();
          }
        }}
      >
        <ChatThread view={view} />
      </aside>
      {open || bubbleHidden ? null : (
        <EditChatBubble
          state={bubble}
          announcement={unread?.text ?? ""}
          takeFocus={closedHere.current}
          onOpen={() => onReopen?.()}
          host={bubbleHost}
        />
      )}
    </>
  );
}
