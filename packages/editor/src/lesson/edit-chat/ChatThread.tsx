import { type Lesson, richDocToPlainText } from "@tj/domain/documents";
import { cn } from "@tj/ui";
import { ArrowUp, ChevronDown, X } from "lucide-react";
import {
  type ButtonHTMLAttributes,
  type FormEvent,
  type ReactNode,
  type RefObject,
  useLayoutEffect,
  useState,
} from "react";
import type { PromptEditPartial } from "../proposals-context";
import { SlidesActor } from "./cast/SlidesActor";
import type { CastState } from "./cast/slides";
import type { BoxChange, EditScope, Suggestion, Turn } from "./thread";

/*
 * The open "Edit with Dayback" pane as a familiar chat (TEACH-97, chat-d; Greg, 9 Oct). Your
 * messages sit right-aligned in a soft bubble with what they acted on as small meta beneath;
 * Slides' replies sit on the left with Slides as the avatar, which plays its approved bubble beats
 * (riffle while working, a nod when done, sorry on a failure). A change is one contained card: the
 * new text, "Was:" collapsed beneath, a primary action (Undo, or Use this for a late answer) and a
 * secondary one. While the answer streams in, its words fill the reply and the card as they come;
 * the actions stay disabled and the slide is untouched until the checked answer arrives.
 *
 * Rhythm: a 4 px grid; body 14/20, meta 12/16. Surfaces are the kit's (`card` for the pane,
 * `accent` for your bubble, `muted` for a change card) and every control has the kit focus ring.
 * Motion (the shimmer, the arrival rise, the caret) sits behind `prefers-reduced-motion`; Slides'
 * runtime stills itself there too.
 */

/** Everything the thread needs from the pane: its state and handlers, unchanged. */
export type ChatView = {
  lesson: Lesson;
  thread: Turn[];
  draft: string;
  setDraft: (v: string) => void;
  send: (said: string, scope: EditScope, label?: string) => void;
  submit: (e: FormEvent) => void;
  scope: EditScope;
  chip: string;
  /** Present when the scope names a slide: widen to the whole lesson. */
  widen: (() => void) | undefined;
  suggestions: readonly Suggestion[];
  busy: boolean;
  stop: () => void;
  undo: (t: Turn) => void;
  show: (t: Turn) => void;
  takeLate: (t: Turn) => void;
  lateCurrent: (t: Turn) => boolean;
  castState: CastState;
  close: () => void;
  field: RefObject<HTMLTextAreaElement | null>;
  list: RefObject<HTMLOListElement | null>;
  /** Answers streaming in, by turn id (display only). */
  streams: Record<string, PromptEditPartial>;
};

export const TYPED_IN_ONE = "You changed one of those boxes while I was working, so I kept yours.";
export const OUT_OF_DATE = "Out of date: that text has changed again.";

const plain = richDocToPlainText;

const CSS = `
[data-edit-chat] { --edit-chat-shadow: -1px 0 0 rgb(41 59 50 / 0.06), -16px 0 32px -24px rgb(41 59 50 / 0.24); }
[data-theme="dark"] [data-edit-chat] { --edit-chat-shadow: -1px 0 0 rgb(255 255 255 / 0.06), -16px 0 32px -20px rgb(0 0 0 / 0.6); }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) [data-edit-chat] { --edit-chat-shadow: -1px 0 0 rgb(255 255 255 / 0.06), -16px 0 32px -20px rgb(0 0 0 / 0.6); } }
.ec-field, .ec-field:focus, .ec-field:focus-visible { outline: none !important; box-shadow: none !important; border: 0 !important; }
.ec-field::placeholder { color: var(--color-ink-3); opacity: 1; }
.ec-scroll { scrollbar-width: thin; scrollbar-color: transparent transparent; }
.ec-scroll:hover, .ec-scroll:focus-within { scrollbar-color: var(--color-border) transparent; }
.ec-working { color: var(--color-ink-3); }
@media (prefers-reduced-motion: no-preference) {
  .ec-working { background: linear-gradient(90deg, var(--color-ink-3) 0 38%, var(--color-foreground) 50%, var(--color-ink-3) 62% 100%); background-size: 260% 100%; -webkit-background-clip: text; background-clip: text; color: transparent; animation: ec-working 2.2s linear infinite; }
  @keyframes ec-working { from { background-position: 100% 0; } to { background-position: -160% 0; } }
  .ec-rise { animation: ec-rise var(--duration-arrive, 300ms) cubic-bezier(.2,.8,.2,1) both; }
  @keyframes ec-rise { from { opacity: 0; transform: translateY(var(--arrive-rise, 6px)); } to { opacity: 1; transform: none; } }
  .ec-caret { animation: ec-caret 1s steps(2, start) infinite; }
  @keyframes ec-caret { to { visibility: hidden; } }
}
`;

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2";

function Pill({
  tone,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone: "primary" | "secondary" }) {
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        "inline-flex h-8 cursor-pointer items-center rounded-full text-[13px] leading-4 transition-colors disabled:cursor-default disabled:opacity-50",
        focusRing,
        tone === "primary"
          ? "bg-primary-fill px-3 font-semibold text-primary-foreground enabled:hover:bg-primary-fill-hover"
          : "px-2 font-medium text-ink-2 enabled:hover:bg-accent enabled:hover:text-foreground",
        className,
      )}
    />
  );
}

function Chip({ className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        "inline-flex h-8 cursor-pointer items-center rounded-full bg-card px-3 text-[13px] text-ink-2 leading-4 shadow-[0_0_0_1px_var(--color-border)] transition-colors enabled:hover:bg-accent enabled:hover:text-foreground disabled:cursor-default disabled:opacity-50",
        focusRing,
        className,
      )}
    />
  );
}

function castFor(turn: Turn, fallback: CastState): CastState {
  const k = turn.reply.kind;
  if (k === "pending") return "working";
  if (k === "failed" || k === "stopped") return "failed";
  if (k === "edit" || k === "undo") return "done";
  return fallback === "working" ? "idle" : fallback;
}

export function ChatThread({ view }: { view: ChatView }) {
  const { thread } = view;
  const lastId = thread[thread.length - 1]?.id;
  const empty = thread.length === 0;
  return (
    <>
      <style>{CSS}</style>
      <div className="flex h-12 shrink-0 items-center gap-2 pr-2 pl-4">
        <SlidesActor context="bubble" state="idle" className="size-6 text-foreground" />
        <h2 className="m-0 font-semibold text-[15px] text-foreground leading-5">Dayback</h2>
        <button
          type="button"
          aria-label="Close Edit with Dayback"
          title="Close (Esc)"
          onClick={view.close}
          className={cn(
            "ml-auto inline-flex size-8 cursor-pointer items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-accent hover:text-foreground",
            focusRing,
          )}
        >
          <X aria-hidden size={16} strokeWidth={1.75} />
        </button>
      </div>
      <ol
        ref={view.list}
        aria-label="Edits"
        aria-live="polite"
        className="ec-scroll m-0 flex min-h-0 flex-1 list-none flex-col gap-6 overflow-y-auto px-4 pt-4 pb-6 [mask-image:linear-gradient(to_bottom,transparent,black_24px,black_calc(100%-12px),transparent)]"
      >
        {empty ? <Welcome view={view} /> : null}
        {thread.map((t) => (
          <Exchange key={t.id} turn={t} view={view} live={t.id === lastId} />
        ))}
      </ol>
      <Composer view={view} empty={empty} />
    </>
  );
}

function Welcome({ view }: { view: ChatView }) {
  return (
    <li className="flex flex-1 flex-col items-center justify-center gap-3 px-4 pb-6 text-center">
      <SlidesActor context="bubble" state="idle" className="size-20 text-foreground" />
      <p className="m-0 font-semibold text-[17px] text-foreground leading-6">
        Hi! What shall we change?
      </p>
      <p className="m-0 max-w-[30ch] text-[14px] text-ink-3 leading-5">
        {view.scope.slideId
          ? "Pick a suggestion below, or tell me in your own words."
          : "Select a text box or a slide, then tell me what to change."}
      </p>
    </li>
  );
}

function Exchange({ turn, view, live }: { turn: Turn; view: ChatView; live: boolean }) {
  const { reply, late, change } = turn;
  const pendingLate = late && !late.used ? late : undefined;
  const lateCurrent = view.lateCurrent(turn);
  const alert = reply.kind === "refuse" || reply.kind === "failed";
  const text = reply.kind === "edit" ? reply.text.replace(/^Slide \d+: /, "") : reply.text;
  const retry = reply.alternative;
  const stream = reply.kind === "pending" ? view.streams[turn.id] : undefined;
  const streamed = stream ? stream.texts.filter((t) => t.text !== "") : [];
  return (
    <li
      className="ec-rise flex flex-col gap-4"
      data-edit-turn={reply.kind}
      data-edit-turn-id={turn.id}
    >
      <div className="flex flex-col items-end gap-1 pl-10">
        <p className="m-0 whitespace-pre-wrap break-words rounded-[18px] rounded-br-md bg-accent px-3.5 py-2 text-[14px] text-foreground leading-5">
          {turn.said}
        </p>
        <span className="pr-1 text-[12px] text-ink-3 leading-4">{turn.scopeLabel}</span>
      </div>
      <div className="flex gap-3" data-edit-reply>
        <div className="w-8 shrink-0">
          <SlidesActor
            context="bubble"
            state={live ? castFor(turn, view.castState) : "idle"}
            className="size-8 text-foreground"
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-3 pt-1.5">
          {reply.kind === "pending" ? (
            stream && (stream.summary !== "" || streamed.length > 0) ? (
              <>
                <p
                  className="m-0 text-pretty text-[14px] text-foreground leading-5"
                  data-edit-streaming
                >
                  {stream.summary || <span className="ec-working">{reply.text}</span>}
                  {streamed.length === 0 ? <Caret /> : null}
                </p>
                {streamed.map((b, i) => (
                  <ChangeCard
                    key={b.elementId}
                    boxes={[
                      { id: b.elementId, after: b.text, before: beforeOf(view, turn, b.elementId) },
                    ]}
                    dim={false}
                    streaming={i === streamed.length - 1}
                    primary={
                      <Pill tone="primary" disabled>
                        Undo
                      </Pill>
                    }
                    secondary={
                      <Pill tone="secondary" onClick={view.stop}>
                        Stop
                      </Pill>
                    }
                  />
                ))}
                {streamed.length === 0 ? <StopLink onClick={view.stop} /> : null}
              </>
            ) : (
              <p className="m-0 text-[14px] leading-5">
                <span className="ec-working">{reply.text}</span> <StopLink onClick={view.stop} />
              </p>
            )
          ) : (
            <p
              className={cn(
                "m-0 text-pretty text-[14px] leading-5",
                reply.kind === "stopped" || reply.kind === "no-change" || reply.kind === "undo"
                  ? "text-ink-3"
                  : "text-foreground",
              )}
              role={alert ? "alert" : undefined}
            >
              {pendingLate && reply.kind === "edit" ? `${text} ${TYPED_IN_ONE}` : text}
            </p>
          )}

          {reply.kind === "edit" && change && !pendingLate ? (
            <ChangeCard
              boxes={change.boxes.map(toCard)}
              dim={change.undone === true}
              primary={
                <Pill
                  tone={change.undone ? "secondary" : "primary"}
                  disabled={change.undone === true}
                  onClick={() => view.undo(turn)}
                >
                  {change.undone ? "Undone" : "Undo"}
                </Pill>
              }
              secondary={
                <Pill tone="secondary" onClick={() => view.show(turn)}>
                  Show on slide
                </Pill>
              }
            />
          ) : null}

          {pendingLate ? (
            <ChangeCard
              boxes={pendingLate.boxes.map(toCard)}
              dim={!lateCurrent}
              late
              note={lateCurrent ? undefined : OUT_OF_DATE}
              primary={
                lateCurrent ? (
                  <Pill tone="primary" onClick={() => view.takeLate(turn)}>
                    Use this
                  </Pill>
                ) : null
              }
              secondary={
                retry ? (
                  <Pill
                    tone="secondary"
                    disabled={view.busy}
                    onClick={() => view.send(retry.instruction, retry.scope, retry.label)}
                  >
                    {retry.label}
                  </Pill>
                ) : null
              }
            />
          ) : null}

          {!pendingLate && retry ? (
            <Chip
              data-edit-offer
              disabled={view.busy}
              className="h-auto min-h-8 self-start whitespace-normal py-1.5 text-left"
              onClick={() => view.send(retry.instruction, retry.scope, retry.label)}
            >
              {retry.label}
            </Chip>
          ) : null}
        </div>
      </div>
    </li>
  );
}

type CardBox = { id: string; before: string; after: string };
const toCard = (b: BoxChange): CardBox => ({
  id: b.elementId,
  before: plain(b.before),
  after: plain(b.after),
});
function beforeOf(view: ChatView, turn: Turn, id: string): string {
  const el = view.lesson.slides
    .find((s) => s.id === turn.scope.slideId)
    ?.elements.find((e) => e.id === id);
  return el?.type === "text" ? plain(el.doc) : "";
}

function Caret() {
  return (
    <span
      aria-hidden
      className="ec-caret ml-0.5 inline-block h-4 w-[7px] translate-y-[3px] rounded-[2px] bg-foreground/60"
    />
  );
}

function StopLink({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "cursor-pointer self-start rounded-sm font-medium text-[14px] text-ink-2 leading-5 underline decoration-ink-4 underline-offset-2 hover:text-foreground",
        focusRing,
      )}
    >
      Stop
    </button>
  );
}

function ChangeCard({
  boxes,
  dim,
  streaming,
  late,
  note,
  primary,
  secondary,
}: {
  boxes: readonly CardBox[];
  dim: boolean;
  streaming?: boolean;
  late?: boolean;
  note?: string | undefined;
  primary: ReactNode;
  secondary: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="flex flex-col gap-3 rounded-(--radius-card) bg-muted p-3"
      data-edit-late={late ? (dim ? "stale" : "current") : undefined}
      data-edit-card
    >
      {late ? (
        <span className="font-medium text-[12px] text-ink-3 leading-4">Suggested text</span>
      ) : null}
      {boxes.slice(0, 3).map((b) => (
        <div key={b.id} className="flex flex-col gap-2">
          <p
            className={cn(
              "m-0 whitespace-pre-line text-pretty text-[14px] leading-5",
              dim ? "text-ink-3" : "text-foreground",
            )}
            data-edit-late-after
          >
            {b.after}
            {streaming ? <Caret /> : null}
          </p>
          {b.before ? (
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
              className={cn(
                "flex cursor-pointer items-start gap-1 rounded-sm text-left text-[12px] text-ink-3 leading-4 hover:text-ink-2",
                focusRing,
              )}
            >
              <span className="shrink-0 font-medium">{late ? "Yours:" : "Was:"}</span>
              <span
                className={cn("min-w-0", open ? "whitespace-pre-line" : "line-clamp-1")}
                data-edit-late-before
              >
                {b.before}
              </span>
              <ChevronDown
                aria-hidden
                size={14}
                strokeWidth={1.75}
                className={cn("mt-px shrink-0 transition-transform", open && "rotate-180")}
              />
            </button>
          ) : null}
        </div>
      ))}
      {note ? <p className="m-0 text-[12px] text-ink-3 leading-4">{note}</p> : null}
      {primary || secondary ? (
        <div className="flex flex-wrap items-center gap-1">
          {primary}
          {secondary}
        </div>
      ) : null}
    </div>
  );
}

function Composer({ view, empty }: { view: ChatView; empty: boolean }) {
  // Grow the field with its text, up to six lines.
  // biome-ignore lint/correctness/useExhaustiveDependencies: measure on every value
  useLayoutEffect(() => {
    const el = view.field.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 6 * 20)}px`;
  }, [view.draft]);
  const ready = view.draft.trim() !== "" && !view.busy;
  const showChips = view.suggestions.length > 0 && !view.busy && view.draft.trim() === "";
  return (
    <form
      onSubmit={view.submit}
      className="flex shrink-0 flex-col gap-2 px-3 pt-2 pb-3"
      data-edit-chat-composer
    >
      {showChips ? (
        <div
          className={cn("flex flex-wrap gap-2", empty && "justify-center")}
          data-edit-chat-suggestions
        >
          {view.suggestions.map((s) => (
            <Chip key={s.label} onClick={() => view.send(s.instruction, view.scope, s.label)}>
              {s.label}
            </Chip>
          ))}
        </div>
      ) : null}
      <div className="flex flex-col gap-2 rounded-[20px] bg-background p-2 shadow-[0_0_0_1px_var(--color-border),0_2px_8px_rgb(0_0_0/0.04)] transition-shadow focus-within:shadow-[0_0_0_2px_var(--color-ring),0_2px_8px_rgb(0_0_0/0.06)]">
        <span
          data-edit-chat-scope
          className="inline-flex h-6 items-center gap-0.5 self-start rounded-full bg-muted pr-0.5 pl-2.5 text-[12px] text-ink-2 leading-4"
        >
          {view.chip}
          {view.widen ? (
            <button
              type="button"
              aria-label={`Remove ${view.chip}: edit the whole lesson`}
              onClick={view.widen}
              className={cn(
                "inline-flex size-5 cursor-pointer items-center justify-center rounded-full text-ink-3 hover:bg-accent-active hover:text-foreground",
                focusRing,
              )}
            >
              <X aria-hidden size={12} strokeWidth={2} />
            </button>
          ) : (
            <span className="w-2" />
          )}
        </span>
        <div className="flex items-end gap-2 pl-2">
          <textarea
            ref={view.field}
            value={view.draft}
            onChange={(e) => view.setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                view.send(view.draft, view.scope);
              }
            }}
            placeholder="Ask Slides to change something…"
            aria-label="What to change"
            maxLength={500}
            rows={1}
            className="ec-field mb-1.5 block min-h-5 w-full resize-none border-0 bg-transparent p-0 text-[14px] text-foreground leading-5 shadow-none outline-none"
          />
          <button
            type="submit"
            aria-label="Send"
            disabled={!ready}
            className={cn(
              "inline-flex size-8 shrink-0 items-center justify-center rounded-full transition-colors",
              focusRing,
              ready
                ? "cursor-pointer bg-primary-fill text-primary-foreground hover:bg-primary-fill-hover"
                : "cursor-default bg-muted text-ink-3",
            )}
          >
            <ArrowUp aria-hidden size={16} strokeWidth={2.25} />
          </button>
        </div>
      </div>
    </form>
  );
}
