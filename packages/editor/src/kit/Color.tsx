import { cn, Input, Popover, PopoverContent, PopoverTrigger, Tooltip } from "@tj/ui";
import { type ReactElement, type Ref, useState } from "react";
import { PanelLabel } from "./Panel";

/*
 * Colour swatch and picker (TeachDeck `components/ui2/Color.tsx`). No `@tj/ui` twin: a swatch is a
 * coloured square with a hairline ring, a picker is the theme palette, the recents and a hex field
 * behind one trigger. The floating half is the `@tj/ui` Popover (ADR 0022 §2).
 */

/** The swatch side, `--swatch` in TeachDeck; a number so it can go into inline styles. */
const SWATCH = 24;

// 45° checker for the transparent/empty case, tiled at 6px so it stays legible at 24px.
const CHECKER =
  "linear-gradient(45deg, var(--border) 25%, transparent 25%), " +
  "linear-gradient(-45deg, var(--border) 25%, transparent 25%), " +
  "linear-gradient(45deg, transparent 75%, var(--border) 75%), " +
  "linear-gradient(-45deg, transparent 75%, var(--border) 75%)";

/** Square is the picker grid; circle and ring are the toolbar's fill and border triggers. */
export type SwatchShape = "square" | "circle" | "ring";

export type ColorSwatchProps = {
  color: string;
  /** Default "square". A ring draws the colour as a 3px band around an empty centre. */
  shape?: SwatchShape;
  /** Default 24. */
  size?: number;
  selected?: boolean;
  title?: string;
  className?: string;
  onClick?: () => void;
  ref?: Ref<HTMLButtonElement>;
};

/**
 * A 24px square with a hairline ring; a checkerboard for `transparent`/`""`. A clickable swatch
 * grows a 32px hit area through `::before` rather than a wrapper.
 */
export function ColorSwatch({
  color,
  shape = "square",
  size = SWATCH,
  selected,
  title,
  className,
  onClick,
  ref,
}: ColorSwatchProps) {
  const isTransparent = !color || color === "transparent";
  const ring = shape === "ring";
  const classes = cn(
    "inline-block shrink-0",
    shape === "square" ? "rounded-key" : "rounded-full",
    !ring && "shadow-[inset_0_0_0_1px_var(--border-strong)]",
    selected && "outline-2 outline-offset-2 outline-primary",
    className,
  );
  const style = {
    width: size,
    height: size,
    background: isTransparent || ring ? undefined : color,
    backgroundImage: isTransparent ? CHECKER : undefined,
    backgroundSize: isTransparent ? "6px 6px" : undefined,
    backgroundPosition: isTransparent ? "0 0, 0 3px, 3px -3px, -3px 0px" : undefined,
    // Hairline, 3px colour band, hairline: the border swatch reads as a border.
    boxShadow: ring
      ? `inset 0 0 0 1px var(--border-strong), inset 0 0 0 4px ${isTransparent ? "transparent" : color}, inset 0 0 0 5px var(--border-strong)`
      : undefined,
  };

  // No onClick: purely decorative (e.g. inside the picker's own trigger) — a span, never a nested
  // interactive element.
  if (!onClick)
    return <span aria-hidden={!title} title={title} className={classes} style={style} />;

  return (
    <button
      ref={ref}
      type="button"
      title={title ?? color}
      aria-label={title ?? (color || "Transparent")}
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        classes,
        "relative outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        "before:absolute before:top-1/2 before:left-1/2 before:size-8 before:-translate-x-1/2 before:-translate-y-1/2 before:content-['']",
      )}
      style={style}
    />
  );
}

/** Browser preference: the last eight colours picked. */
export const RECENT_COLORS_KEY = "tj:recent-colors";
const MAX_RECENTS = 8;

function readRecents(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_COLORS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string").slice(0, MAX_RECENTS);
  } catch {
    return [];
  }
}

function writeRecents(colors: string[]) {
  try {
    localStorage.setItem(RECENT_COLORS_KEY, JSON.stringify(colors.slice(0, MAX_RECENTS)));
  } catch {
    // private mode / quota — recents are a convenience, not a requirement
  }
}

/** Tolerates a missing `#` and 3-digit shorthand. Returns null when invalid. */
export function normalizeHex(raw: string): string | null {
  let hex = raw.trim();
  if (hex.startsWith("#")) hex = hex.slice(1);
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    hex = hex
      .split("")
      .map((c) => c + c)
      .join("");
  }
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null;
  return `#${hex.toUpperCase()}`;
}

export type ColorPickerProps = {
  value: string;
  onChange: (hex: string) => void;
  /** The current slide theme's palette — always shown first. */
  palette?: string[];
  /** Swatch size inside the 32px trigger. Default 24. */
  size?: number;
  /** Trigger swatch shape. Default "square". */
  swatch?: SwatchShape;
  /** Accessible name, default "Colour". */
  label?: string;
  /** Also show `label` as a tooltip on the trigger (needs a TooltipProvider above). */
  tooltip?: boolean;
  disabled?: boolean;
  className?: string;
};

export function ColorPicker({
  value,
  onChange,
  palette = [],
  size = SWATCH,
  swatch = "square",
  label = "Colour",
  tooltip = false,
  disabled = false,
  className,
}: ColorPickerProps) {
  const [open, setOpen] = useState(false);
  // Lazy init reads localStorage once; refreshed (with hexDraft) whenever the popover opens.
  const [recents, setRecents] = useState<string[]>(() => readRecents());
  const [hexDraft, setHexDraft] = useState(value);

  const remember = (hex: string) => {
    setRecents((prev) => {
      const next = [hex, ...prev.filter((c) => c.toLowerCase() !== hex.toLowerCase())].slice(
        0,
        MAX_RECENTS,
      );
      writeRecents(next);
      return next;
    });
  };

  const pick = (hex: string) => {
    onChange(hex);
    remember(hex);
    setOpen(false);
  };

  const onHexChange = (raw: string) => {
    setHexDraft(raw);
    const normalized = normalizeHex(raw);
    if (normalized) onChange(normalized);
  };

  const previewColor = normalizeHex(hexDraft);
  const hexInvalid = hexDraft.length > 0 && previewColor === null;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setHexDraft(value);
          setRecents(readRecents());
        }
        setOpen(next);
      }}
    >
      <TriggerWrap tooltip={tooltip ? label : undefined}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            aria-label={label}
            data-color-picker
            className={cn(
              "inline-flex size-8 items-center justify-center rounded-control outline-none",
              "transition-colors duration-(--duration-fast) ease-(--ease-out-soft)",
              "hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 active:bg-accent-active",
              disabled && "pointer-events-none opacity-45",
              className,
            )}
          >
            <ColorSwatch color={value} size={size} title={value} shape={swatch} />
          </button>
        </PopoverTrigger>
      </TriggerWrap>
      <PopoverContent align="start" className="w-52 p-2" aria-label={label}>
        <div className="flex flex-col gap-2">
          {palette.length > 0 ? (
            <div className="flex flex-col gap-1">
              <PanelLabel>Theme</PanelLabel>
              <div className="grid grid-cols-8 gap-1">
                {palette.map((c) => (
                  <ColorSwatch
                    key={c}
                    color={c}
                    title={c}
                    selected={c.toLowerCase() === value.toLowerCase()}
                    onClick={() => pick(c)}
                  />
                ))}
              </div>
            </div>
          ) : null}

          {recents.length > 0 ? (
            <div className="flex flex-col gap-1">
              <PanelLabel>Recent</PanelLabel>
              <div className="flex flex-wrap gap-1">
                {recents.map((c) => (
                  <ColorSwatch
                    key={c}
                    color={c}
                    title={c}
                    selected={c.toLowerCase() === value.toLowerCase()}
                    onClick={() => pick(c)}
                  />
                ))}
              </div>
            </div>
          ) : null}

          <div className="flex items-center gap-1.5">
            <ColorSwatch color={previewColor ?? "transparent"} />
            <Input
              value={hexDraft}
              onChange={(e) => onHexChange(e.target.value)}
              aria-invalid={hexInvalid || undefined}
              placeholder="#RRGGBB"
              aria-label="Hex colour"
              spellCheck={false}
              autoComplete="off"
              className="h-8 flex-1"
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Tooltip's trigger clones the PopoverTrigger, which clones the button: one DOM node, two roots. */
function TriggerWrap({ tooltip, children }: { tooltip?: string; children: ReactElement }) {
  return tooltip ? <Tooltip label={tooltip}>{children}</Tooltip> : children;
}
