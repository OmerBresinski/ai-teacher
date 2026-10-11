import type { Id } from "@tj/domain/documents";
import { createContext } from "react";

/**
 * Live writing P1 (TEACH-202 part e): the slide the follow itself just opened, so the strip can
 * tell a follow from the teacher's own move. The strip scrolls a followed row into view (only
 * while the teacher is not busy, `teacherBusy`) and never focuses it.
 */
export const FollowMarkContext = createContext<{ current: Id | null } | null>(null);

/** Popovers, pickers and menus (Radix poppers), and modal dialogs. */
const OPEN_PICKER =
  '[data-radix-popper-content-wrapper], [role="menu"], [role="dialog"][aria-modal="true"]';

/**
 * The teacher is in the middle of something a scroll would disturb: typing in a field or text,
 * holding a selection, or with a picker, popover, menu or modal open.
 */
export function teacherBusy(doc: Document = document): boolean {
  const active = doc.activeElement as HTMLElement | null;
  if (active && (active.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)))
    return true;
  const selection = doc.getSelection?.();
  if (selection && !selection.isCollapsed) return true;
  return doc.querySelector(OPEN_PICKER) !== null;
}
