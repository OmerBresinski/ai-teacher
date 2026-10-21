import { useEffect } from "react";
import { ChatThread, type ChatView } from "./ChatThread";
import { SlidesActor } from "./cast/SlidesActor";
import type { BubbleState } from "./EditChatBubble";

/*
 * The edit chat's drawing parts, loaded after the editor's first paint as one chunk (TEACH-104
 * part d): the thread and the Slides character it shares with the bubble. Their behaviour
 * stays in `EditChatPane.tsx`, which passes everything in as props.
 */
export type BubbleFaceProps = { state: BubbleState; inHost: boolean };

/** The Slides character inside the bubble (the bubble's button is static, so it mounts once). */
export function BubbleFace({ state, inHost }: BubbleFaceProps) {
  return (
    <SlidesActor
      context="bubble"
      state={state === "reply" ? "done" : state}
      className={inHost ? "size-[46px]" : "size-[54px]"}
    />
  );
}

export type ChatThreadPartProps = {
  view: ChatView;
  /** Called once the thread (and its composer) has mounted: a focus asked for earlier lands. */
  onMounted: () => void;
};

export function ChatThreadPart({ view, onMounted }: ChatThreadPartProps) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, on mount
  useEffect(() => {
    onMounted();
  }, []);
  return <ChatThread view={view} />;
}
