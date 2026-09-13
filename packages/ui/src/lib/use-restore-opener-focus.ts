import { useRef } from "react";

type FocusEventHandlers = {
  onOpenAutoFocus?: (event: Event) => void;
  onCloseAutoFocus?: (event: Event) => void;
};

/**
 * Focus restoration for a Radix dialog surface that may have no `Trigger` (TEACH-113). Radix's
 * default `onCloseAutoFocus` focuses the `Trigger` and nothing else, so a dialog controlled from a
 * plain button (Theme, Help, New series, every `ConfirmDialog`) dropped focus on `<body>` when it
 * closed. `onOpenAutoFocus` fires before Radix moves focus into the surface, so the element focused
 * then is the opener; on close it gets focus back. A caller's own handlers run first, and one that
 * prevents default keeps its target. An opener that has left the document (a menu item, a card
 * that was deleted) is left to Radix's default.
 */
export function useRestoreOpenerFocus({
  onOpenAutoFocus,
  onCloseAutoFocus,
}: FocusEventHandlers): Required<FocusEventHandlers> {
  const openerRef = useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus: (event) => {
      const active = document.activeElement;
      openerRef.current = active instanceof HTMLElement ? active : null;
      onOpenAutoFocus?.(event);
    },
    onCloseAutoFocus: (event) => {
      onCloseAutoFocus?.(event);
      if (event.defaultPrevented) return;
      const opener = openerRef.current;
      if (!opener?.isConnected || opener === document.body) return;
      event.preventDefault();
      opener.focus();
    },
  };
}
