import { type RefObject, useEffect } from "react";
import { isInTextField, matchesBinding } from "./keys";

/**
 * Undo and redo, bound once for the whole editor. They work wherever focus is — the canvas, the
 * slide list, a bar menu, a popover, a drawer — except inside a text field or a text editor,
 * which keep their native undo (the Rename and Notes dialogs included). An open menu closes on
 * undo only if Radix closes it itself; nothing here forces it. The canvas key hook does not bind
 * these, so one press never undoes twice. Same modifiers as the shortcut table: `$mod+z` and
 * `$mod+Shift+z`, where `$mod` is ⌘ or Ctrl.
 */
export function useHistoryKeys(history: RefObject<{ undo: () => void; redo: () => void }>): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || isInTextField(e.target)) return;
      if (matchesBinding(e, "$mod+Shift+z")) history.current.redo();
      else if (matchesBinding(e, "$mod+z")) history.current.undo();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [history]);
}
