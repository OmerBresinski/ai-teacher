import { type ComponentProps, useEffect } from "react";
import { ChatThread, type ChatView } from "./ChatThread";
import type { EditChatBubble } from "./EditChatBubble";

/*
 * The edit chat's drawing parts, loaded after the editor's first paint as one chunk (TEACH-104
 * part d): the thread, the collapsed bubble and the Slides character they share. Their behaviour
 * stays in `EditChatPane.tsx`, which passes everything in as props.
 */
export { EditChatBubble } from "./EditChatBubble";

export type EditChatBubbleProps = ComponentProps<typeof EditChatBubble>;

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
