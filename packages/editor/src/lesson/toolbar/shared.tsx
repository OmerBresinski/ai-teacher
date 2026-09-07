import type { SlideElement, Theme } from "@tj/domain/documents";
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Slider,
  Tooltip,
} from "@tj/ui";
import { ChevronDown } from "lucide-react";
import { type ComponentProps, type ReactNode, useId, useMemo, useRef, useState } from "react";
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

/**
 * An icon trigger over a radio menu of numeric steps, each row a number and a drawn preview of
 * what that number looks like. The current value is the marked row.
 */
export function StepMenu({
  label,
  value,
  steps,
  icon,
  preview,
  onPick,
}: {
  label: string;
  value: number;
  steps: readonly number[];
  icon: ReactNode;
  preview: (n: number) => ReactNode;
  onPick: (n: number) => void;
}) {
  return (
    <DropdownMenu>
      <Tooltip label={label}>
        <DropdownMenuTrigger asChild>
          <BarButton
            aria-label={`${label}, ${value}`}
            className="w-8 justify-center px-0 font-medium"
          >
            {icon}
          </BarButton>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent align="start" aria-label={label} className="min-w-44">
        <DropdownMenuRadioGroup value={String(value)}>
          {steps.map((n) => (
            <DropdownMenuRadioItem
              key={n}
              value={String(n)}
              onSelect={() => onPick(n)}
              className="gap-3 pr-3 font-medium"
            >
              <span className="w-5 text-right tabular-nums">{n}</span>
              {preview(n)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* --- Corners ------------------------------------------------------ */

/** Corner radii, slide points, for anything with corners to round: rectangles and images. */
export const CORNER_RADII: readonly number[] = [0, 4, 8, 12, 16, 24];

/** One rounded corner: the corners glyph. */
export function CornersGlyph() {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      aria-hidden
      focusable="false"
    >
      <path d="M4 16V9.5A5.5 5.5 0 0 1 9.5 4H16" />
    </svg>
  );
}

/**
 * The "Corners" menu the shape and image bars share: 0 Square, 4, 8, 12, 16, 24, each row a
 * rounded-box preview, the current radius marked.
 */
export function CornersMenu({
  value,
  onPick,
}: {
  value: number;
  onPick: (radius: number) => void;
}) {
  return (
    <StepMenu
      label="Corners"
      value={value}
      steps={CORNER_RADII}
      icon={<CornersGlyph />}
      preview={(n) => (
        <span className="flex flex-1 items-center gap-3">
          <span
            aria-hidden
            className="block h-4 w-7 border-[1.5px] border-foreground"
            style={{ borderRadius: Math.min(n / 2, 8) }}
          />
          {n === 0 ? <span className="text-ink-3">Square</span> : null}
        </span>
      )}
      onPick={onPick}
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
export type SliderRowProps = {
  id?: string;
  /** Names the slider and, as "<label> value", the field. */
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** What Reset writes; the button only shows while `value` differs from it. */
  defaultValue: number;
  /** Formats the slider's bubble and `aria-valuetext`. */
  format?: (value: number) => string;
  /** Called with each new value, from the slider, the field and Reset. */
  onChange: (value: number) => void;
  /** The gesture or the typed entry is over: the caller closes its undo step. */
  onCommit: () => void;
  /** Trailing content after Reset, such as a "Mixed" note. */
  children?: ReactNode;
  className?: string;
};

/**
 * A slider with two ways back to an exact number, which a thumb makes hard to hit: a numeric
 * field (commits on Enter and on blur, clamped to the range and rounded to the step; Escape
 * throws the draft away) and a quiet Reset that writes `defaultValue`, shown only while the value
 * is off it. The slider grows; the field and Reset keep their width. Every write goes through the
 * same `onChange` and `onCommit`, so a typed number is one undo step like a drag.
 */
export function SliderRow({
  id,
  label,
  value,
  min,
  max,
  step = 1,
  defaultValue,
  format,
  onChange,
  onCommit,
  children,
  className,
}: SliderRowProps) {
  // `null` while not typing: the field shows the live value.
  const [draft, setDraft] = useState<string | null>(null);
  // A pointer scrub on the slider, from its first value change after pointer-down until Radix
  // commits it. Safari and iOS defer the field's blur, so a stale draft could otherwise commit
  // mid-drag, clobbering the live value and closing the undo step early: while a scrub is on, a
  // blur drops the draft and the field re-syncs to the live value. Enter commits as usual.
  const pointerHeld = useRef(false);
  const scrubbing = useRef(false);

  const commitDraft = () => {
    if (draft === null) return;
    setDraft(null);
    const parsed = Number(draft.trim());
    if (!Number.isFinite(parsed)) return;
    const next = Math.min(max, Math.max(min, Math.round(parsed / step) * step));
    onChange(next);
    onCommit();
  };

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Slider
        id={id}
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={[value]}
        resetTo={defaultValue}
        onPointerDown={() => {
          pointerHeld.current = true;
        }}
        onPointerCancel={() => {
          pointerHeld.current = false;
          scrubbing.current = false;
        }}
        onValueChange={([v]) => {
          if (v === undefined) return;
          if (pointerHeld.current) scrubbing.current = true;
          onChange(v);
        }}
        onValueCommit={() => {
          pointerHeld.current = false;
          scrubbing.current = false;
          onCommit();
        }}
        valueLabel={format}
        className="flex-1"
      />
      <Input
        aria-label={`${label} value`}
        inputMode="numeric"
        pattern="-?[0-9]*"
        value={draft ?? String(value)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (scrubbing.current) setDraft(null);
          else commitDraft();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commitDraft();
          } else if (e.key === "Escape" && draft !== null) {
            e.preventDefault();
            e.stopPropagation();
            setDraft(null);
          }
        }}
        className="w-12 shrink-0 px-2 text-right text-meta tabular-nums"
      />
      {value !== defaultValue ? (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          data-slider-reset
          className="shrink-0"
          onClick={() => {
            setDraft(null);
            onChange(defaultValue);
            onCommit();
          }}
        >
          Reset
        </Button>
      ) : null}
      {children}
    </div>
  );
}

/** The opacity row: 0 to 100 percent, Reset to 100. */
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
    <SliderRow
      id={id}
      label="Opacity"
      min={0}
      max={100}
      step={1}
      defaultValue={100}
      value={value}
      format={(v) => `${v}%`}
      onChange={onChange}
      onCommit={onCommit}
      className={className}
    >
      {mixed ? (
        <span data-opacity-mixed className="shrink-0 text-ink-3 text-meta">
          Mixed
        </span>
      ) : null}
    </SliderRow>
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
      <PopoverContent align="start" className="w-72 p-3" aria-label="Opacity">
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
