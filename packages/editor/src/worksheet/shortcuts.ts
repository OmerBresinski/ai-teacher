import type { HelpShortcut } from "../lesson/shortcuts";

/**
 * The worksheet editor's key map, for its `?` sheet (the lesson editor's `HelpDialog`, fed these
 * instead of the slide maps). The bindings live in `WorksheetEditor.tsx` and `BlockTextEditor.tsx`;
 * this list is what the sheet shows, so it must say only what those handlers do.
 */

/** "Show answers" on / off (TEACH-195). Free in both editors' maps; works from inside a field. */
export const SHOW_ANSWERS_KEYS = "$mod+Shift+k";

export const WORKSHEET_SHORTCUTS: HelpShortcut[] = [
  { id: "slash", label: "Add a block, in an empty paragraph", keys: ["/"], group: "Blocks" },
  {
    id: "block-duplicate",
    label: "Duplicate the selected block",
    keys: ["$mod+d"],
    group: "Blocks",
  },
  {
    id: "block-delete",
    label: "Delete the selected block",
    keys: ["Delete", "Backspace"],
    group: "Blocks",
  },
  { id: "deselect", label: "Deselect", keys: ["Escape"], group: "Blocks" },

  { id: "show-answers", label: "Show answers on / off", keys: [SHOW_ANSWERS_KEYS], group: "View" },
  { id: "help", label: "Keyboard shortcuts", keys: ["?"], group: "View" },

  { id: "undo", label: "Undo", keys: ["$mod+z"], group: "History" },
  { id: "redo", label: "Redo", keys: ["$mod+Shift+z"], group: "History" },
];

export const WORKSHEET_HELP_GROUPS = ["Blocks", "View", "History"];

export const WORKSHEET_HELP_NOTES: Partial<Record<string, string>> = {
  Blocks: "With a block selected and nothing being typed.",
};
