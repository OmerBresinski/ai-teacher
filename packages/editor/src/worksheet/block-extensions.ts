import type { AnyExtension } from "@tiptap/core";
import { baseExtensions } from "../text/extensions";

/**
 * The extension set for a worksheet block's editor (TeachDeck `lib/worksheet/block-extensions.ts`).
 *
 * It is `baseExtensions` with StarterKit's own undo/redo switched off, because a block editor must
 * not keep a second history. The Query cache is the single source of truth for the document
 * (ADR 0022 §4), so it has to be the single source of truth for undo as well: a Command-Z handled
 * inside ProseMirror would fire `onUpdate` and *append* an entry to the history instead of popping
 * one, and the two histories would then disagree about what the document is. Command-Z and
 * Command-Shift-Z are routed to the history by `WorksheetEditor`'s window key handler.
 */
export const blockExtensions: AnyExtension[] = baseExtensions.map((ext) =>
  ext.name === "starterKit" ? (ext as AnyExtension).configure({ undoRedo: false }) : ext,
);
