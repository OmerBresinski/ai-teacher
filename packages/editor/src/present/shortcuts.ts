/**
 * The present-mode key map (SPEC §8, research/03 §1). One list, used both by the
 * `?` sheet and as the documentation of what the handler implements — so the two
 * can never drift.
 */

export type PresentShortcutGroup = "Moving" | "Screen" | "Tools" | "Panels";

export type PresentShortcut = {
  id: string;
  label: string;
  /** Display strings, already formatted for the sheet. */
  keys: string[];
  group: PresentShortcutGroup;
};

export const PRESENT_SHORTCUTS: PresentShortcut[] = [
  {
    id: "next",
    label: "Next step, then slide",
    keys: ["Space", "→", "Page Down", "Enter"],
    group: "Moving",
  },
  { id: "prev", label: "Previous step, then slide", keys: ["←", "Page Up"], group: "Moving" },
  { id: "first", label: "First slide", keys: ["Home"], group: "Moving" },
  { id: "last", label: "Last slide", keys: ["End"], group: "Moving" },
  { id: "jump", label: "Type a slide number, then go", keys: ["0–9", "Enter"], group: "Moving" },
  { id: "overview", label: "Overview grid", keys: ["O"], group: "Moving" },

  { id: "black", label: "Black screen. Any key brings it back", keys: ["B"], group: "Screen" },
  { id: "white", label: "White screen. Any key brings it back", keys: ["W"], group: "Screen" },
  { id: "fullscreen", label: "Fullscreen", keys: ["F"], group: "Screen" },
  { id: "collapse", label: "Collapse or expand the controls", keys: ["C"], group: "Screen" },
  { id: "exit", label: "Close panel, then exit", keys: ["Esc"], group: "Screen" },

  { id: "pen", label: "Pen", keys: ["P"], group: "Tools" },
  { id: "highlighter", label: "Highlighter", keys: ["H"], group: "Tools" },
  { id: "laser", label: "Laser pointer", keys: ["L"], group: "Tools" },
  { id: "eraser", label: "Eraser", keys: ["E"], group: "Tools" },
  { id: "clear", label: "Clear annotations on this slide", keys: ["X"], group: "Tools" },

  { id: "timer", label: "Timer", keys: ["T"], group: "Panels" },
  { id: "notes", label: "Presenter notes", keys: ["N"], group: "Panels" },
  { id: "shortcuts", label: "This list", keys: ["?", "/"], group: "Panels" },
];

export const PRESENT_SHORTCUT_GROUPS: PresentShortcutGroup[] = [
  "Moving",
  "Screen",
  "Tools",
  "Panels",
];
