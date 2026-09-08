import type { ShapeElement, Theme } from "@tj/domain/documents";
import {
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
  Tooltip,
} from "@tj/ui";
import { memo, type ReactNode, useId } from "react";
import { ColorPicker } from "../../kit/Color";
import { Panel, PanelSeparator } from "../../kit/Panel";
import { docFromText } from "../../model/factories";
import { shapeRadius } from "../../slide/elements/ShapeView";
import { LabelTextControls } from "./LabelTextControls";
import { MoreDrawer } from "./MoreDrawer";
import { BarButton, OpacityControl, useElementWrites, useThemePalette } from "./shared";

/** The border widths on offer, slide points. 0 is "None". */
const BORDER_WIDTHS: readonly number[] = [0, 1, 2, 3, 4, 6, 8, 12];
/** Corner radii, slide points. Rectangles and speech bubbles have corners to round. */
const CORNER_RADII: readonly number[] = [0, 4, 8, 12, 16, 24];
const CORNERED: ReadonlySet<ShapeElement["shape"]> = new Set(["rect", "rounded", "speech"]);

/**
 * Fill, border, border width, corners (rectangles only), opacity, label, and once the shape has a
 * label its text controls (TeachDeck `ShapeToolbar`). Every control is a 32px ghost button at
 * weight 500; the two colours are a filled circle and a ring so the bar reads as fill-then-border
 * without a caption.
 */
export const ShapeToolbar = memo(function ShapeToolbar({
  element,
  theme,
  slideId,
}: {
  element: ShapeElement;
  theme: Theme;
  slideId: string;
}) {
  const { update, scrub, end } = useElementWrites(slideId);
  const palette = useThemePalette(theme);
  const labelId = useId();

  // Mirror ShapeView's defaults so the menu marks what is actually drawn.
  const borderWidth = element.strokeWidth ?? (element.stroke ? 2 : 0);
  const radius = shapeRadius(element, theme);

  return (
    <Panel as="bar" role="toolbar" aria-label="Shape" data-shape-toolbar>
      <ColorPicker
        label="Fill"
        swatch="circle"
        tooltip
        value={element.fill ?? theme.colors.accent2}
        palette={palette}
        onChange={(fill) => update<ShapeElement>(element.id, { fill })}
      />
      <ColorPicker
        label="Border"
        swatch="ring"
        tooltip
        value={element.stroke ?? theme.colors.ink}
        palette={palette}
        onChange={(stroke) => update<ShapeElement>(element.id, { stroke })}
      />
      <StepMenu
        label="Border width"
        value={borderWidth}
        steps={BORDER_WIDTHS}
        icon={<BorderWidthGlyph />}
        preview={(n) =>
          n === 0 ? (
            <span className="flex-1 text-ink-3">None</span>
          ) : (
            <span
              aria-hidden
              className="block flex-1 rounded-full bg-foreground"
              style={{ height: n }}
            />
          )
        }
        // A width with no colour would draw nothing: seed the theme ink the first time.
        onPick={(strokeWidth) =>
          update<ShapeElement>(element.id, {
            strokeWidth,
            ...(element.stroke || strokeWidth === 0 ? null : { stroke: theme.colors.ink }),
          })
        }
      />
      {CORNERED.has(element.shape) ? (
        <StepMenu
          label="Corners"
          value={radius}
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
          onPick={(radius) => update<ShapeElement>(element.id, { radius })}
        />
      ) : null}

      <PanelSeparator />

      <OpacityControl slideId={slideId} elements={[element]} />

      <Popover onOpenChange={(open) => !open && end()}>
        <Tooltip label="Label">
          <PopoverTrigger asChild>
            <BarButton className="font-medium">Label</BarButton>
          </PopoverTrigger>
        </Tooltip>
        {/*
         * Rows are 32px controls with `gap-3` between them and the kit's `p-3` around: every
         * control's 4px focus band (2px gap + 2px accent) fits inside the row gap and the padding
         * without touching the input row above or the popover edge. Nothing here sets
         * `overflow`, so the band, drawn as a box-shadow, is never clipped.
         */}
        <PopoverContent
          align="end"
          className="flex w-auto min-w-60 flex-col gap-3 p-3"
          aria-label="Label"
        >
          <div className="flex h-8 items-center justify-between gap-3">
            <Label htmlFor={labelId} className="text-ink-3 text-meta">
              Label
            </Label>
            <Input
              id={labelId}
              value={plainLabel(element)}
              placeholder="Optional"
              onChange={(e) =>
                scrub(() => update<ShapeElement>(element.id, { doc: docFromText(e.target.value) }))
              }
              onBlur={end}
              className="h-8 w-32"
            />
          </div>
          {/* Second row, once there is a label to style. */}
          <LabelTextControls element={element} theme={theme} slideId={slideId} />
        </PopoverContent>
      </Popover>

      <PanelSeparator />
      <MoreDrawer slideId={slideId} elements={[element]} theme={theme} />
    </Panel>
  );
});

/**
 * An icon trigger over a radio menu of numeric steps, each row a number and a drawn preview of
 * what that number looks like. The current value is the marked row.
 */
function StepMenu({
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

/** Three stacked lines of growing weight: the border-width glyph. */
function BorderWidthGlyph() {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden
      focusable="false"
    >
      <rect x={3} y={4} width={14} height={1} rx={0.5} />
      <rect x={3} y={8.5} width={14} height={2} rx={1} />
      <rect x={3} y={13.5} width={14} height={3} rx={1.5} />
    </svg>
  );
}

/** One rounded corner: the corners glyph. */
function CornersGlyph() {
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

function plainLabel(el: ShapeElement): string {
  const first = el.doc?.content?.[0]?.content?.[0];
  return typeof first?.text === "string" ? first.text : "";
}
