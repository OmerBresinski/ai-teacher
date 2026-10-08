import { cn } from "@tj/ui";
import { type HTMLAttributes, type ReactNode, useSyncExternalStore } from "react";
import { PANE_MIN, type PaneMode, paneWidth } from "./shell-layout";

/*
 * Where the Dayback pane sits in the editor; the rules are in `shell-layout.ts`. The pane always
 * lies at the right of the editor body. Docked, the canvas has already fitted the slide clear of it
 * and the filmstrip makes room; overlay, it lies over the filmstrip and the canvas edge. The pane's
 * content (thread, edits, the collapsed bubble) comes in as `children`.
 */

/** The pane's fluid width at this viewport (`shell-layout.ts`, rule 1). */
const readWidth = () => (typeof window === "undefined" ? PANE_MIN : paneWidth(window.innerWidth));
const subscribeResize = (change: () => void) => {
  window.addEventListener("resize", change);
  return () => window.removeEventListener("resize", change);
};
export const usePaneWidth = () => useSyncExternalStore(subscribeResize, readWidth, () => PANE_MIN);

export type SidePaneDockProps = Omit<HTMLAttributes<HTMLElement>, "children"> & {
  open: boolean;
  /** The pane's accessible name. */
  label: string;
  /** Reserved (docked) or over the filmstrip and the canvas edge (overlay): `paneMode`. */
  mode: PaneMode;
  /**
   * Kept mounted while closed (hidden), so work the pane started carries on and its thread is
   * still there when it opens again.
   */
  children: ReactNode;
};

/** The pane's box: full height of the editor body at the right, over the filmstrip's end. */
export const sidePaneClass = (mode: PaneMode) =>
  cn("absolute inset-y-0 right-0 z-30", mode === "overlay" && "shadow-(--shadow-lift)");

export function SidePaneDock({
  open,
  label,
  mode,
  children,
  className,
  ...rest
}: SidePaneDockProps) {
  const width = usePaneWidth();
  return (
    <aside
      {...rest}
      aria-label={label}
      hidden={!open}
      data-side-pane={mode}
      style={{ width }}
      className={cn("flex flex-col border-border border-l bg-card", sidePaneClass(mode), className)}
    >
      {children}
    </aside>
  );
}
