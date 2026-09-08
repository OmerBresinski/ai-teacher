import type { ImageElement } from "@tj/domain/documents";
import {
  Button,
  IconButton,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Slider,
  Tooltip,
} from "@tj/ui";
import { FlipHorizontal2, FlipVertical2, RotateCw, ZoomIn } from "lucide-react";
import { memo, useId } from "react";
import { Panel, PanelSeparator } from "../../kit/Panel";
import { rectOf } from "../../model/geometry";
import {
  draftAspect,
  draftCrop,
  draftFlip,
  draftRotate,
  draftStraighten,
  draftZoom,
  RESET_DRAFT,
  STRAIGHTEN_MAX,
  ZOOM_MAX,
  ZOOM_MIN,
  zoomOf,
} from "../image-adjust";
import { announce } from "../transform/gesture-state";
import { useSessionActions, useSessionUi } from "../use-editor-session";
import { BarButton, ICON, ICON_SM } from "./shared";

/*
 * The crop bar (TEACH-153): what floats above a picture while crop mode is on, in place of the
 * image bar. Two value controls (Zoom, Straighten) open a slider with the value bubble and read
 * their value on the bar in tabular figures; three glyph actions turn and flip; Reset is the bar's
 * text action and Done its one primary. `CropBar` is the presentational half, so the kit gallery
 * can show it; `CropToolbar` wires it to the session's draft.
 */

/** A horizon line tilting against a level one: the straighten glyph. */
function StraightenGlyph() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" aria-hidden focusable="false">
      <path
        d="M2 8h12"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        opacity={0.4}
      />
      <path d="M2.5 10.5 13.5 5.5" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
      <path d="M13.5 5.5v3" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
    </svg>
  );
}

export type CropBarProps = {
  zoom: number;
  straighten: number;
  onZoom: (zoom: number) => void;
  onStraighten: (deg: number) => void;
  onRotate: () => void;
  onFlipH: () => void;
  onFlipV: () => void;
  onReset: () => void;
  onDone: () => void;
  /** Nothing to reset: the picture is untouched. */
  pristine?: boolean;
};

export function CropBar({
  zoom,
  straighten,
  onZoom,
  onStraighten,
  onRotate,
  onFlipH,
  onFlipV,
  onReset,
  onDone,
  pristine = false,
}: CropBarProps) {
  const zoomId = useId();
  const straightenId = useId();
  const zoomText = `${zoom.toFixed(1)}×`;
  const straightenText = `${straighten}°`;
  return (
    <Panel as="bar" role="toolbar" aria-label="Crop" data-crop-toolbar>
      <Popover>
        <Tooltip label="Zoom">
          <PopoverTrigger asChild>
            <BarButton aria-label={`Zoom, ${zoomText}`} className="tabular-nums">
              <ZoomIn aria-hidden {...ICON_SM} />
              {zoomText}
            </BarButton>
          </PopoverTrigger>
        </Tooltip>
        <PopoverContent align="start" className="w-64 p-3" aria-label="Zoom">
          <div className="flex items-center gap-3">
            <Label htmlFor={zoomId} className="text-ink-3 text-meta">
              Zoom
            </Label>
            <Slider
              id={zoomId}
              aria-label="Zoom"
              min={ZOOM_MIN}
              max={ZOOM_MAX}
              step={0.1}
              value={[Math.round(zoom * 10) / 10]}
              onValueChange={([v]) => {
                if (v !== undefined) onZoom(v);
              }}
              valueLabel={(v) => `${v.toFixed(1)}×`}
              className="flex-1"
            />
            <output htmlFor={zoomId} className="w-10 shrink-0 text-right text-meta tabular-nums">
              {zoomText}
            </output>
          </div>
        </PopoverContent>
      </Popover>

      <Popover>
        <Tooltip label="Straighten">
          <PopoverTrigger asChild>
            <BarButton aria-label={`Straighten, ${straightenText}`} className="tabular-nums">
              <StraightenGlyph />
              {straightenText}
            </BarButton>
          </PopoverTrigger>
        </Tooltip>
        <PopoverContent align="start" className="w-72 p-3" aria-label="Straighten">
          <div className="flex items-center gap-3">
            <Label htmlFor={straightenId} className="text-ink-3 text-meta">
              Straighten
            </Label>
            <Slider
              id={straightenId}
              aria-label="Straighten"
              min={-STRAIGHTEN_MAX}
              max={STRAIGHTEN_MAX}
              step={1}
              value={[straighten]}
              onValueChange={([v]) => {
                if (v !== undefined) onStraighten(v);
              }}
              valueLabel={(v) => `${v}°`}
              className="flex-1"
            />
            <output
              htmlFor={straightenId}
              className="w-10 shrink-0 text-right text-meta tabular-nums"
            >
              {straightenText}
            </output>
          </div>
        </PopoverContent>
      </Popover>

      <PanelSeparator />

      <IconButton label="Rotate 90°" onClick={onRotate}>
        <RotateCw aria-hidden {...ICON} />
      </IconButton>
      <IconButton label="Flip horizontal" onClick={onFlipH}>
        <FlipHorizontal2 aria-hidden {...ICON} />
      </IconButton>
      <IconButton label="Flip vertical" onClick={onFlipV}>
        <FlipVertical2 aria-hidden {...ICON} />
      </IconButton>

      <PanelSeparator />

      <BarButton onClick={onReset} disabled={pristine} className="disabled:opacity-50">
        Reset
      </BarButton>
      <Button variant="primary" size="sm" onClick={onDone} data-crop-done>
        Done
      </Button>
    </Panel>
  );
}

/** The bar wired to crop mode: reads the session draft, writes it, and Done ends the mode. */
export const CropToolbar = memo(function CropToolbar({ element }: { element: ImageElement }) {
  const { crop } = useSessionUi();
  const actions = useSessionActions();
  if (!crop) return null;
  const d = crop.draft;
  const box = d.box ?? rectOf(element);
  const aspect = draftAspect(d, box);
  const zoom = zoomOf(draftCrop(d, box), box, aspect);
  const straighten = Math.round(d.imageTransform?.straighten ?? 0);
  const pristine =
    !crop.dirty && !element.crop && !element.focal && !element.imageTransform && !d.reset;
  return (
    <CropBar
      zoom={zoom}
      straighten={straighten}
      pristine={pristine}
      onZoom={(z) => actions.updateCrop(draftZoom(d, box, z))}
      onStraighten={(deg) => actions.updateCrop(draftStraighten(d, deg))}
      onRotate={() => {
        actions.updateCrop(draftRotate(d, box));
        announce(`Turned to ${((d.imageTransform?.rotate ?? 0) + 90) % 360} degrees.`);
      }}
      onFlipH={() => {
        actions.updateCrop(draftFlip(d, box, "h"));
        announce("Flipped horizontally.");
      }}
      onFlipV={() => {
        actions.updateCrop(draftFlip(d, box, "v"));
        announce("Flipped vertically.");
      }}
      onReset={() => {
        actions.updateCrop(RESET_DRAFT);
        announce("Reset to the untouched picture.");
      }}
      onDone={() => actions.exitCrop()}
    />
  );
});
