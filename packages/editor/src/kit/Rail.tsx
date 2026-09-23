import { cn, IconButton, type IconButtonProps, Tooltip } from "@tj/ui";
import { createContext, type ReactNode, useContext } from "react";

const RailLabels = createContext(false);

/*
 * The insert rail's column and its buttons (TeachDeck `components/ui2/Rail.tsx`). No `@tj/ui`
 * twin: a 56px vertical toolbar (`--rail-width`) with 40px square buttons whose tooltips are forced
 * to the right, because the rail sits at the edge of the screen.
 */

export type RailProps = {
  children: ReactNode;
  /** The rail's accessible name. The editor's is "Insert". */
  "aria-label"?: string;
  className?: string;
  showLabels?: boolean;
};

/**
 * A toolbar, not a nav: these buttons insert things and switch tools, they do not navigate. White
 * with one hairline on the right over the app ground, so it reads as a raised strip.
 */
export function Rail({
  children,
  className,
  showLabels = false,
  "aria-label": ariaLabel = "Tools",
}: RailProps) {
  return (
    <RailLabels.Provider value={showLabels}>
      <div
        role="toolbar"
        aria-orientation="vertical"
        aria-label={ariaLabel}
        data-insert-rail
        className={cn(
          "flex w-(--rail-width) shrink-0 flex-col items-center gap-1 border-border border-r bg-background py-1.5",
          className,
        )}
      >
        {children}
      </div>
    </RailLabels.Provider>
  );
}

export type RailButtonProps = Omit<IconButtonProps, "size" | "noTooltip"> & {
  /** Shown in the tooltip after the label, e.g. "T". */
  shortcut?: string;
  /** Tooltip text when it has to say more than the button's name. */
  tooltipLabel?: string;
};

/** `IconButton` at the rail's 40px square with its tooltip on the right and an accent on-state. */
export function RailButton({
  active,
  className,
  shortcut,
  tooltipLabel,
  label,
  children,
  ...rest
}: RailButtonProps) {
  const showLabels = useContext(RailLabels);
  const button = (
    <IconButton
      {...rest}
      label={label}
      noTooltip
      active={active}
      className={cn(
        showLabels ? "rail-button-labelled" : "size-10 rounded-control",
        active && "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary",
        className,
      )}
    >
      {children}
      {showLabels ? <span>{label}</span> : null}
    </IconButton>
  );
  if (showLabels) return button;
  return (
    <Tooltip label={tooltipLabel ?? label} shortcut={shortcut} side="right">
      {button}
    </Tooltip>
  );
}

export function RailSeparator() {
  return <span aria-hidden className="my-1.5 h-px w-6 bg-border" />;
}
