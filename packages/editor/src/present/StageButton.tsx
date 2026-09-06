import { cn, IconButton } from "@tj/ui";
import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { STAGE_SCOPE_CLASS } from "./stage-tokens";

/*
 * The on-stage icon button (TeachDeck `components/v2/present/StageButton.tsx`): the kit's
 * `IconButton` inside the stage scope, plus the two states it has no prop for. `active` is a tool
 * doing something to the slide — the accent glyph on the bare pill, and only that. `open` is a
 * trigger whose panel is showing — the press wash with the paper glyph. Neither wears a frame or a
 * ring: on the stage the pill is the container.
 *
 * DO NOT put a wash behind the active glyph: measured over a cream slide it fell to 1.98:1, under
 * the 3:1 floor for a graphical object; the accent on the unwashed pill is 3.17:1.
 */

export type StageButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** The button's accessible name; icon-only buttons have no other one. */
  label: string;
  /** A live tool: the pen is down, the laser is on. */
  active?: boolean;
  /** A panel is open under this trigger. */
  open?: boolean;
  children: ReactNode;
  ref?: Ref<HTMLButtonElement>;
};

export function StageButton({
  label,
  active,
  open,
  className,
  children,
  ...rest
}: StageButtonProps) {
  return (
    <IconButton
      label={label}
      tooltipClassName={STAGE_SCOPE_CLASS}
      aria-pressed={active}
      aria-expanded={open}
      className={cn(
        // Doubled selector beats the ghost variant's own colours.
        active ? "[&&]:text-primary" : open ? "[&&]:bg-accent-active [&&]:text-foreground" : null,
        className,
      )}
      {...rest}
    >
      {children}
    </IconButton>
  );
}

export function StageDivider() {
  return <span aria-hidden className="mx-0.5 h-4 w-px shrink-0 bg-border-control" />;
}
