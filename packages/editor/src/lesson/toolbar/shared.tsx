import type { SlideElement, Theme } from "@tj/domain/documents";
import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuTrigger,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Slider,
  Tooltip,
} from "@tj/ui";
import { ChevronDown } from "lucide-react";
import { type ComponentProps, type ReactNode, useId, useMemo } from "react";
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

/* --- Opacity ------------------------------------------------------ */

/** What the selection's opacity reads as: the common value, or the first element's marked mixed. */
export function opacityOf(elements: SlideElement[]): { value: number; mixed: boolean } {
  const pct = (el: SlideElement | undefined) => Math.round((el?.opacity ?? 1) * 100);
  const value = pct(elements[0]);
  return { value, mixed: elements.some((el) => pct(el) !== value) };
}

/** A circle half filled: the opacity glyph. */
export function OpacityGlyph() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden
      focusable="false"
    >
      <circle cx={8} cy={8} r={6.25} />
      <path d="M8 1.75A6.25 6.25 0 0 1 8 14.25Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** The slider with its readout, shared by the bar popover and the More drawer. */
export function OpacityField({
  id,
  value,
  mixed,
  onChange,
  onCommit,
  className,
}: {
  id?: string;
  /** Percent, 0 to 100. */
  value: number;
  /** The selected elements disagree; the readout shows the first one's value. */
  mixed: boolean;
  onChange: (percent: number) => void;
  onCommit: () => void;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Slider
        id={id}
        aria-label="Opacity"
        min={0}
        max={100}
        step={1}
        value={[value]}
        onValueChange={([v]) => {
          if (v !== undefined) onChange(v);
        }}
        onValueCommit={onCommit}
        valueLabel={(v) => `${v}%`}
        className="flex-1"
      />
      <output htmlFor={id} className="w-10 shrink-0 text-right text-meta tabular-nums">
        {value}%
      </output>
      {mixed ? (
        <span data-opacity-mixed className="shrink-0 text-ink-3 text-meta">
          Mixed
        </span>
      ) : null}
    </div>
  );
}

/**
 * The bar control: the glyph and the percent, opening the slider. Writes to every element given,
 * so a multi-selection scrubs as one; the run is one undo step and ends on release.
 */
export function OpacityControl({
  slideId,
  elements,
}: {
  slideId: string;
  elements: SlideElement[];
}) {
  const { updateMany, scrub, end } = useElementWrites(slideId);
  const id = useId();
  const { value, mixed } = opacityOf(elements);
  const ids = elements.map((e) => e.id);
  return (
    <Popover onOpenChange={(open) => !open && end()}>
      <Tooltip label="Opacity">
        <PopoverTrigger asChild>
          <BarButton
            data-opacity-control
            aria-label={`Opacity, ${value}%${mixed ? ", mixed" : ""}`}
            className="font-medium tabular-nums"
          >
            <OpacityGlyph />
            {value}%
          </BarButton>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent align="start" className="w-64 p-3" aria-label="Opacity">
        <div className="flex items-center gap-3">
          <Label htmlFor={id} className="text-ink-3 text-meta">
            Opacity
          </Label>
          <OpacityField
            id={id}
            value={value}
            mixed={mixed}
            onChange={(v) => scrub(() => updateMany(ids, { opacity: v / 100 }))}
            onCommit={end}
            className="flex-1"
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
