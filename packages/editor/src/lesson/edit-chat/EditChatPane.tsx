import {
  richDocToPlainText,
  type Slide,
  type SlideElement,
  type TextElement,
} from "@tj/domain/documents";
import { Button, cn, IconButton, Spinner, Textarea } from "@tj/ui";
import { ArrowUp, Sparkles, X } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as reducers from "../../model/reducers";
import { getTheme } from "../../model/themes";
import { useHistory, useLesson } from "../document-context";
import { type PromptEditAnswer, useProposals } from "../proposals-context";
import {
  useActiveSlide,
  useSelection,
  useSessionActions,
  useSessionRead,
} from "../use-editor-session";
import { type BubbleState, EditChatBubble } from "./EditChatBubble";
import { EDIT_CHAT_LABEL } from "./edit-chat-context";
import { SlidesAtWork } from "./SlidesAtWork";
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
const TYPED_IN_ONE = "You changed one of those boxes while I was working, so I kept yours.";
const OUT_OF_DATE = "Out of date: that text has changed again.";
const TRY_AGAIN = "Try again on your text";
const IDENTIFIER =
  "To protect personal data, I can’t send email addresses, ID numbers or pupils’ names. Take it out and try again.";
/** The server's instruction limit (`EDIT_INSTRUCTION_MAX`), as the composer's `maxLength`. */
const INSTRUCTION_MAX = 500;
const KEEP_SHORT = ". Keep it short.";

const newId = () => Math.random().toString(36).slice(2, 10);

export function EditChatPane({
  lessonId,
  open = true,
  onClose,
  onReopen,
  focusTick,
}: {
  lessonId: string;
  /** Closed, the pane stays mounted (a request carries on) and shows as the bubble. */
  open?: boolean;
  onClose: () => void;
  /** The bubble's click: open the pane again. */
  onReopen?: () => void;
  /** Bumped by `openAndFocus`: the composer takes the cursor. */
  focusTick: number;
}) {
  const lesson = useLesson();
  const history = useHistory();
  const { onPromptEdit } = useProposals();
  // The slide on the canvas: the session's, or the first slide before one is picked.
  const activeSlideId = useActiveSlide(lesson.slides)?.id ?? null;
  const selection = useSelection();
  const actions = useSessionActions();
  const readSession = useSessionRead();

  const [thread, setThread] = useState<Turn[]>(() => readThread(lessonId));
  const [draft, setDraft] = useState("");
  const [widened, setWidened] = useState(false);
  const pending = useRef<{ id: string; controller: AbortController } | null>(null);
  const field = useRef<HTMLTextAreaElement | null>(null);
  const list = useRef<HTMLOListElement | null>(null);
  const lessonRef = useRef(lesson);
  lessonRef.current = lesson;

  useEffect(() => writeThread(lessonId, thread), [lessonId, thread]);
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
  useEffect(() => {
    if (focusTick > 0) field.current?.focus();
  }, [focusTick]);
  // The chip follows the selection: a new selection undoes "Whole lesson".
  const selectionKey = selection.join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when the selection changes
  useEffect(() => setWidened(false), [activeSlideId, selectionKey]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on every new reply
  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread]);

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
  const pendingTurn = thread.find((t) => t.id === pendingId);
  const castSlideId = pendingTurn?.scope.slideId ?? last?.change?.slideId ?? activeSlideId;
  const castSlide = lesson.slides.find((s) => s.id === castSlideId);
  const theme = useMemo(() => getTheme(lesson.themeId), [lesson.themeId]);
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
        );
      } catch {
        answer = { action: "failed", reason: controller.signal.aborted ? STOPPED : FAILED };
      }
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

  return (
    <>
      <aside
        aria-label={EDIT_CHAT_LABEL}
        data-edit-chat
        hidden={!open}
        className={cn(
          "w-(--edit-chat-width,360px) shrink-0 flex-col border-border border-l bg-card",
          open ? "flex" : "hidden",
        )}
      >
        <header className="flex h-10 shrink-0 items-center gap-2 border-border border-b px-3">
          <Sparkles aria-hidden size={16} strokeWidth={1.5} className="text-ink-3" />
          <h2 className="m-0 font-semibold text-body">{EDIT_CHAT_LABEL}</h2>
          <IconButton
            label="Close Edit with Dayback"
            size="sm"
            className="ml-auto"
            onClick={() => {
              closedHere.current = true;
              onClose();
            }}
          >
            <X aria-hidden size={16} strokeWidth={1.5} />
          </IconButton>
        </header>
        <SlidesAtWork state={castState} slide={castSlide} theme={theme} />
        <ol
          ref={list}
          aria-label="Edits"
          aria-live="polite"
          className="m-0 flex flex-1 list-none flex-col gap-3 overflow-y-auto p-3"
        >
          {thread.length === 0 ? (
            <li className="text-ink-3 text-meta">
              Say what to change. Select a text box or a slide first, or ask about the slide you are
              on.
            </li>
          ) : null}
          {thread.map((t) => (
            <TurnItem
              key={t.id}
              turn={t}
              onUndo={() => undoTurn(t)}
              onShow={() => showOnSlide(t)}
              onStop={stop}
              onAlternative={(a) => void send(a.instruction, a.scope, a.label)}
              onUseLate={() => applyLate(t)}
              lateCurrent={t.late ? lateIsCurrent(lesson, t.late) : false}
              busy={busy}
            />
          ))}
        </ol>
        <form
          onSubmit={submit}
          className="flex shrink-0 flex-col gap-2 border-border border-t p-3"
          data-edit-chat-composer
        >
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              data-edit-chat-scope
              className="inline-flex items-center gap-1 rounded-full border border-border bg-background py-0.5 pr-1 pl-2.5 text-meta"
            >
              {chip}
              {scope.slideId ? (
                <button
                  type="button"
                  aria-label={`Remove ${chip}: edit the whole lesson`}
                  className="inline-flex size-5 items-center justify-center rounded-full text-ink-3 hover:bg-muted hover:text-foreground"
                  onClick={() => setWidened(true)}
                >
                  <X aria-hidden size={12} strokeWidth={1.75} />
                </button>
              ) : (
                <span className="w-1.5" />
              )}
            </span>
          </div>
          {suggestions.length > 0 ? (
            <div className="flex flex-wrap gap-1.5" data-edit-chat-suggestions>
              {suggestions.map((s: Suggestion) => (
                <Button
                  key={s.label}
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  onClick={() => void send(s.instruction, scope, s.label)}
                >
                  {s.label}
                </Button>
              ))}
            </div>
          ) : null}
          <div className="flex items-end gap-1.5">
            <Textarea
              ref={field}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send(draft, scope);
                }
              }}
              placeholder="Say what to change"
              aria-label="What to change"
              maxLength={500}
              rows={2}
              className="min-h-0 resize-none"
            />
            <IconButton label="Send" type="submit" disabled={busy || draft.trim() === ""}>
              <ArrowUp aria-hidden size={18} strokeWidth={1.75} />
            </IconButton>
          </div>
        </form>
      </aside>
      {open ? null : (
        <EditChatBubble
          state={bubble}
          announcement={unread?.text ?? ""}
          takeFocus={closedHere.current}
          onOpen={() => onReopen?.()}
        />
      )}
    </>
  );
}

function TurnItem({
  turn,
  onUndo,
  onShow,
  onStop,
  onAlternative,
  onUseLate,
  lateCurrent,
  busy,
}: {
  turn: Turn;
  onUndo: () => void;
  onShow: () => void;
  onStop: () => void;
  onAlternative: (a: Alternative) => void;
  onUseLate: () => void;
  /** Whether the kept suggestion can still be used (its boxes unchanged since it arrived). */
  lateCurrent: boolean;
  busy: boolean;
}) {
  const { reply, late } = turn;
  const pendingLate = late && !late.used ? late : undefined;
  return (
    <li className="flex flex-col gap-1.5" data-edit-turn={reply.kind} data-edit-turn-id={turn.id}>
      <div className="flex flex-col items-end gap-0.5">
        <p className="m-0 max-w-[85%] rounded-lg bg-muted px-2.5 py-1.5 text-body">{turn.said}</p>
        <span className="text-ink-3 text-meta">{turn.scopeLabel}</span>
      </div>
      <div className="flex flex-col gap-1.5" data-edit-reply>
        {reply.kind === "pending" ? (
          <div className="flex items-center gap-2 text-ink-3 text-meta">
            <Spinner size={16} />
            <span>{reply.text}</span>
            <Button type="button" variant="ghost" size="xs" className="ml-auto" onClick={onStop}>
              Stop
            </Button>
          </div>
        ) : (
          <p
            className={cn(
              "m-0 text-body",
              reply.kind === "edit" && turn.change?.undone && "text-ink-3 line-through",
              (reply.kind === "stopped" || reply.kind === "no-change") && "text-ink-3",
            )}
            role={reply.kind === "refuse" || reply.kind === "failed" ? "alert" : undefined}
          >
            {reply.text}
          </p>
        )}
        {pendingLate && reply.kind === "edit" ? (
          <p className="m-0 text-body">{TYPED_IN_ONE}</p>
        ) : null}
        {pendingLate ? <LatePreview boxes={pendingLate.boxes} current={lateCurrent} /> : null}
        {reply.kind === "edit" && turn.change && !(pendingLate && lateCurrent) ? (
          <div className="flex gap-1.5">
            <Button
              type="button"
              variant="secondary"
              size="xs"
              disabled={turn.change.undone === true}
              onClick={onUndo}
            >
              {turn.change.undone ? "Undone" : "Undo"}
            </Button>
            <Button type="button" variant="ghost" size="xs" onClick={onShow}>
              Show on slide
            </Button>
          </div>
        ) : null}
        {pendingLate ? (
          <div className="flex flex-wrap gap-1.5">
            {lateCurrent ? (
              <Button type="button" variant="primary" size="xs" onClick={onUseLate}>
                Use this
              </Button>
            ) : null}
            {reply.alternative ? (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                disabled={busy}
                onClick={() => reply.alternative && onAlternative(reply.alternative)}
              >
                {reply.alternative.label}
              </Button>
            ) : null}
          </div>
        ) : reply.alternative ? (
          <div className="min-w-0">
            {/* An offer is a sentence: it wraps inside the pane rather than running off it. */}
            <Button
              type="button"
              variant="secondary"
              size="xs"
              data-edit-offer
              className="h-auto max-w-full justify-start whitespace-normal py-1 text-left leading-snug"
              disabled={busy}
              onClick={() => reply.alternative && onAlternative(reply.alternative)}
            >
              {reply.alternative.label}
            </Button>
          </div>
        ) : null}
      </div>
    </li>
  );
}

/**
 * A kept late answer, quietly: the teacher's text as it is (struck through, muted) and the
 * suggested text under it. Out of date once the box has changed again.
 */
function LatePreview({ boxes, current }: { boxes: readonly BoxChange[]; current: boolean }) {
  return (
    <div className="flex flex-col gap-1 text-meta" data-edit-late={current ? "current" : "stale"}>
      {boxes.map((b) => (
        <div key={b.elementId} className="flex flex-col gap-0.5">
          <p className="m-0 text-ink-3 line-through" data-edit-late-before>
            {richDocToPlainText(b.before)}
          </p>
          <p className={cn("m-0", current ? "text-foreground" : "text-ink-3")} data-edit-late-after>
            {richDocToPlainText(b.after)}
          </p>
        </div>
      ))}
      {current ? null : <p className="m-0 text-ink-3">{OUT_OF_DATE}</p>}
    </div>
  );
}
