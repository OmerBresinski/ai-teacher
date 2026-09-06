import { CANVAS_SHORTCUTS, type CanvasShortcut } from "./transform/use-canvas-keys";

/** The shell's own groups sit alongside the transform layer's `ShortcutGroup`. */
export type HelpShortcut = { id: string; label: string; keys: string[]; group: string };

/** Everything the shell binds itself, over and above `CANVAS_SHORTCUTS` (TeachDeck `shortcuts.ts`). */
export const SHELL_SHORTCUTS: HelpShortcut[] = [
  { id: "insert-text", label: "Text box", keys: ["t"], group: "Insert" },
  { id: "insert-image", label: "Image", keys: ["i"], group: "Insert" },
  { id: "insert-rect", label: "Rectangle", keys: ["r"], group: "Insert" },
  { id: "insert-ellipse", label: "Ellipse", keys: ["o"], group: "Insert" },
  { id: "insert-line", label: "Line", keys: ["l"], group: "Insert" },

  {
    id: "slide-move-sel",
    label: "Next / previous slide",
    keys: ["ArrowDown", "ArrowUp"],
    group: "Slides",
  },
  {
    id: "slide-extend",
    label: "Extend the slide selection",
    keys: ["Shift+ArrowUp", "Shift+ArrowDown"],
    group: "Slides",
  },
  { id: "slide-add", label: "Add a slide of the same kind", keys: ["Enter"], group: "Slides" },
  // Bound in the navigator and again in `useCanvasKeys`, where it duplicates the slide whenever
  // nothing on it is selected — the action pill promises ⌘D.
  {
    id: "slide-duplicate",
    label: "Duplicate slide, when nothing is selected",
    keys: ["$mod+d"],
    group: "Slides",
  },
  {
    id: "slide-move",
    label: "Move slide up / down",
    keys: ["$mod+ArrowUp", "$mod+ArrowDown"],
    group: "Slides",
  },
  {
    id: "slide-ends-move",
    label: "Move slide to top / bottom",
    keys: ["$mod+Shift+ArrowUp", "$mod+Shift+ArrowDown"],
    group: "Slides",
  },
  { id: "slide-ends", label: "First / last slide", keys: ["Home", "End"], group: "Slides" },

  { id: "zoom-100", label: "Zoom to 100%", keys: ["$mod+0"], group: "View" },
  { id: "zoom-fit", label: "Fit to window", keys: ["$mod+Alt+0"], group: "View" },
  { id: "zoom-in", label: "Zoom in", keys: ["$mod+Equal"], group: "View" },
  { id: "zoom-out", label: "Zoom out", keys: ["$mod+Minus"], group: "View" },
  { id: "pan", label: "Pan: hold Space and drag", keys: ["Space"], group: "View" },
  { id: "help", label: "Keyboard shortcuts", keys: ["?"], group: "View" },
];

/** Group order for the help sheet: the shell's groups first, then the canvas's. */
export const HELP_GROUPS = ["Insert", "Slides", "View", "Selection", "Edit", "Arrange", "History"];

/**
 * Not every group fires everywhere: Insert only responds while the canvas has DOM focus and Slides
 * only while the navigator rail does — the help sheet states both so the bindings it lists actually
 * work when the reader tries them.
 */
export const HELP_GROUP_NOTES: Partial<Record<string, string>> = {
  Insert: "While the canvas has focus.",
  Slides: "While the navigator rail has focus. Duplicate slide works on the canvas too.",
};

export const ALL_SHORTCUTS: (HelpShortcut | CanvasShortcut)[] = [
  ...SHELL_SHORTCUTS,
  ...CANVAS_SHORTCUTS,
];
