import { createContext, useContext } from "react";

/*
 * Opens the "Edit with Dayback" pane from anywhere in the editor (TEACH-97): the top bar's button
 * toggles it, the text toolbar's sparkle opens it with the composer focused. `available` is false
 * when the app has not wired `onPromptEdit` (no pane, no buttons).
 */
export type EditChatApi = {
  available: boolean;
  open: boolean;
  toggle: () => void;
  /** Open the pane and put the cursor in the composer. */
  openAndFocus: () => void;
};

export const EDIT_CHAT_LABEL = "Edit with Dayback";

const noop = () => {};

export const EditChatContext = createContext<EditChatApi>({
  available: false,
  open: false,
  toggle: noop,
  openAndFocus: noop,
});

export const useEditChat = (): EditChatApi => useContext(EditChatContext);
