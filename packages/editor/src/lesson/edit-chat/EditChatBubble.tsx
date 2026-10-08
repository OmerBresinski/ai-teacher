import { cn } from "@tj/ui";
import { useEffect, useRef } from "react";

/*
 * The collapsed "Edit with Dayback" pane (TEACH-97): closing the pane never cancels a request; it
 * folds into this round button at the bottom right, over the canvas and above the zoom controls
 * (the canvas keeps its width).
 * It shows a quiet busy ring while a request is out (a still arc under reduced motion), then a
 * small dot when the answer lands while closed: the accent for a reply, the error colour for a
 * failure. Clicking it reopens the pane at that turn. The live region says when it is done.
 *
 * The character is the Slides character from the homepage cast (`homepage/motion/characters.js`,
 * key `slides`), drawn still at bubble size.
 */

export type BubbleState = "idle" | "working" | "reply" | "failed";

export const bubbleLabel = (state: BubbleState): string =>
  state === "working"
    ? "Dayback, working"
    : state === "reply"
      ? "Dayback, 1 new reply"
      : state === "failed"
        ? "Dayback, 1 new reply: that edit didn’t work"
        : "Open Edit with Dayback";

export function EditChatBubble({
  state,
  announcement,
  onOpen,
  takeFocus = false,
}: {
  state: BubbleState;
  /** Read out once when an answer lands while the pane is closed. */
  announcement: string;
  onOpen: () => void;
  /** The pane was closed from inside: the bubble takes the focus. */
  takeFocus?: boolean;
}) {
  const button = useRef<HTMLButtonElement | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: only when the bubble appears
  useEffect(() => {
    if (takeFocus) button.current?.focus();
  }, []);
  return (
    <>
      <button
        ref={button}
        type="button"
        data-edit-chat-bubble={state}
        aria-label={bubbleLabel(state)}
        onClick={onOpen}
        className="fixed right-4 bottom-19 z-40 inline-flex size-14 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-[0_2px_10px_rgb(0_0_0/0.12)] transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 motion-reduce:transition-none motion-reduce:hover:scale-100"
      >
        <SlidesCharacter happy={state === "reply"} />
        {state === "working" ? (
          <span
            aria-hidden
            data-edit-chat-busy
            className="pointer-events-none absolute -inset-[3px] rounded-full border-2 border-transparent border-t-primary/70 motion-safe:animate-spin motion-safe:[animation-duration:1.8s]"
          />
        ) : null}
        {state === "reply" || state === "failed" ? (
          <span
            aria-hidden
            data-edit-chat-dot={state}
            className={cn(
              "pointer-events-none absolute top-0.5 right-0.5 size-2.5 rounded-full ring-2 ring-card",
              state === "failed" ? "bg-destructive" : "bg-primary",
            )}
          />
        ) : null}
      </button>
      <span role="status" className="sr-only" data-edit-chat-announce>
        {announcement}
      </span>
    </>
  );
}

function SlidesCharacter({ happy }: { happy: boolean }) {
  return (
    <svg
      viewBox="10 40 280 250"
      aria-hidden="true"
      className="size-10"
      fill="none"
      stroke="currentColor"
      strokeWidth={7}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M60 221 51 274 32 277M223 217 240 268 260 268" />
      <path d="M55 105Q24 96 19 130" />
      <path d="M244 117Q275 123 277 94" />
      <path d="m44 68 200-9 8 164-200 7Z" fill="#faf5df" />
      <path d="m52 62 201-8 7 164-200 7Z" fill="#f5c054" />
      <path d="m57 64 199-7 5 160-199 8Z" />
      <path d="m83 88 147-6" />
      <circle cx="119" cy="127" r="6" fill="currentColor" stroke="none" />
      <circle cx="155" cy="125" r="6" fill="currentColor" stroke="none" />
      {happy ? <path d="M124 139q15 18 29-3" /> : <path d="M127 141q11 10 23-2" />}
      <path d="m89 186 27-25 24 15 30-32 54 39Z" fill="#e88f52" />
      <circle cx="207" cy="113" r="14" fill="#fff3cb" />
    </svg>
  );
}
