import { cn } from "@tj/ui";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { SlidesActor } from "./cast/SlidesActor";

/*
 * The collapsed "Edit with Dayback" pane (TEACH-97): closing the pane never cancels a request; it
 * folds into this round button at the bottom right, over the canvas and above the zoom controls
 * (the canvas keeps its width).
 * While a request is out, Slides riffles its little stack of slides (a calm 1.6 s loop); when the
 * answer lands it gives one nod, then a small dot shows: the accent for a reply, the error colour
 * for a failure (Slides looks a little sheepish). Clicking it reopens the pane at that turn. The
 * live region says when it is done.
 *
 * The character is Slides from the homepage cast, animated by its cast module in the `bubble`
 * context (`./cast/slides.ts`): still under reduced motion, paused in a hidden tab.
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
  host,
}: {
  /**
   * Layout A: the canvas row; the bubble sits at its bottom right, centred on the zoom row. `null`
   * while the row is not mounted yet: nothing renders, so the bubble mounts once, in place.
   */
  host?: HTMLElement | null;
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
  const node = (
    <>
      <button
        ref={button}
        type="button"
        data-edit-chat-bubble={state}
        aria-label={bubbleLabel(state)}
        onClick={onOpen}
        className={cn(
          "z-40 inline-flex items-center justify-center rounded-full border border-border bg-card text-foreground shadow-[0_2px_10px_rgb(0_0_0/0.12)] focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2",
          // Layout A: 48 px, centred on the zoom row (bottom 16, 32 high), 16 px clear of the zoom
          // controls and 8 px above the filmstrip.
          host ? "absolute right-4 bottom-2 size-12" : "fixed right-4 bottom-19 size-14",
        )}
      >
        <SlidesActor
          context="bubble"
          state={state === "reply" ? "done" : state}
          className={host ? "size-[46px]" : "size-[54px]"}
        />
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
  if (host === null) return null;
  return host ? createPortal(node, host) : node;
}
