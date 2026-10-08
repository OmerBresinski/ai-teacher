import { IconButton } from "@tj/ui";
import { Sparkles } from "lucide-react";
import { EDIT_CHAT_LABEL, useEditChat } from "../edit-chat/edit-chat-context";

/*
 * The text toolbar's sparkle (TEACH-97): opens the "Edit with Dayback" pane with the cursor in its
 * composer. The pane's chip already names the selected text box, so the next message acts on it.
 */

export const PROMPT_EDIT_LABEL = EDIT_CHAT_LABEL;

const ICON = { size: 20, strokeWidth: 1.5 } as const;

export function PromptEditControl() {
  const chat = useEditChat();
  if (!chat.available) return null;
  return (
    <IconButton label={PROMPT_EDIT_LABEL} active={chat.open} onClick={chat.openAndFocus}>
      <Sparkles aria-hidden {...ICON} />
    </IconButton>
  );
}
