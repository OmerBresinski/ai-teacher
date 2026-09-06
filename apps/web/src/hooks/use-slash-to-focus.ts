import { type RefObject, useEffect } from "react";

function isEditable(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return (
    element?.tagName === "INPUT" ||
    element?.tagName === "TEXTAREA" ||
    element?.isContentEditable === true
  );
}

/**
 * `/` focuses `ref` unless the user is already typing somewhere or holding a modifier. One document
 * listener per mounted page; the effect exists because the listener target is `document`, not a
 * React element.
 */
export function useSlashToFocus(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
        return;
      }
      if (isEditable(event.target)) return;
      event.preventDefault();
      ref.current?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [ref]);
}
