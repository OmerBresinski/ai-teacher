import type { SlideElement, Theme } from "@tj/domain/documents";
import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuTrigger,
} from "@tj/ui";
import { ChevronDown } from "lucide-react";
import { type ComponentProps, type ReactNode, useMemo } from "react";
import * as reducers from "../../model/reducers";
import type { ElementPatch } from "../../model/reducers/elements";
import { useEditSession } from "../../model/use-edit-session";
import { useHistory } from "../document-context";

/*
 * What every toolbar shares (TeachDeck `ElementToolbars.tsx` `themePalette`, `ui2/DropTrigger`
 * and the store hooks): the theme's eight swatches, a chevron trigger over a radio-group
 * DropdownMenu, and the write helpers — `update` for a one-shot patch, `scrub` for a control that
 * fires continuously (a NumberInput drag, a typed field), which routes through an edit session so
 * the run is one undo step.
 */

export function themePalette(theme: Theme): string[] {
  return [
    theme.colors.ink,
    theme.colors.muted,
    theme.colors.accent,
    theme.colors.accent2,
    theme.colors.correct,
    theme.colors.incorrect,
    theme.colors.surface,
    theme.colors.background,
  ];
}

export function useThemePalette(theme: Theme): string[] {
  return useMemo(() => themePalette(theme), [theme]);
}

export const ICON = { size: 20, strokeWidth: 1.5 } as const;
export const ICON_SM = { size: 16, strokeWidth: 1.5 } as const;

/** The element-writing half of a toolbar: one patch, one undo step — or a scrub, one per run. */
export function useElementWrites(slideId: string) {
  const history = useHistory();
  const session = useEditSession(history);
  const update = <T extends SlideElement>(id: string, patch: ElementPatch<T>) =>
    history.dispatch(reducers.updateElement<T>, slideId, id, patch);
  const updateMany = (ids: string[], patch: Partial<SlideElement>) =>
    history.dispatch(reducers.updateElements, slideId, ids, patch);
  return {
    history,
    update,
    updateMany,
    /** Run a write inside the open session, opening one if needed. */
    scrub: session.run,
    /** Close the session now — the field blurred, the popover closed. */
    end: session.end,
  };
}

export type DropTriggerProps = {
  /** The menu's name, and the trigger's when it shows an icon rather than text. */
  label: string;
  /** The currently selected radio value. */
  value: string;
  /** Visible text on the trigger. */
  text?: ReactNode;
  /** An icon on the trigger instead of text. */
  icon?: ReactNode;
  chevron?: boolean;
  align?: ComponentProps<typeof DropdownMenuContent>["align"];
  className?: string;
  children: ReactNode;
};

/** The chevron trigger over a radio-group DropdownMenu that every toolbar menu uses. */
export function DropTrigger({
  label,
  value,
  text,
  icon,
  chevron = true,
  align = "start",
  className,
  children,
}: DropTriggerProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={text ? `${label}, ${typeof text === "string" ? text : ""}`.trim() : label}
          className={cn(
            "inline-flex h-8 items-center gap-0.5 rounded-control px-1.5 text-body text-foreground outline-none transition-colors duration-(--duration-fast) ease-(--ease-out-soft) hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=open]:bg-accent-active",
            className,
          )}
        >
          {icon ?? <span className="px-0.5">{text}</span>}
          {chevron ? (
            <ChevronDown aria-hidden size={14} strokeWidth={1.5} className="text-ink-3" />
          ) : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} aria-label={label}>
        <DropdownMenuRadioGroup value={value}>{children}</DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A plain text button in the bar (the popover triggers: "Alt", "Label", "Notes", "Answer"). */
export function BarButton({ className, ...rest }: ComponentProps<"button">) {
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        "inline-flex h-8 items-center gap-1 rounded-control px-2 text-body text-foreground outline-none transition-colors duration-(--duration-fast) ease-(--ease-out-soft) hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=open]:bg-accent-active",
        className,
      )}
    />
  );
}

/** A titled group inside a drawer. */
export function PanelSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <h3 className="m-0 font-semibold text-eyebrow text-ink-3 uppercase tracking-[0.08em]">
        {title}
      </h3>
      {children}
    </section>
  );
}
