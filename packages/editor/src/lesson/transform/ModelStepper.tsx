import type { ImageElement, SlideElement } from "@tj/domain/documents";
import { IconButton, IconGroup } from "@tj/ui";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { Rect } from "../../model/geometry";

/**
 * A model build the editor is previewing (TEACH-247 part u): `build` of the model `id`, played by
 * the same `svgAtBuild` Present uses. Unset, the model shows its whole, finished drawing.
 */
export type DiagramStep = { id: string; build: number };

/** A drawn model that builds in Present: an image with at least one build after its first frame. */
export const isBuildingModel = (el: SlideElement): el is ImageElement =>
  el.type === "image" && (el.builds ?? 0) > 0;

/**
 * The step the stepper shows, 1-based, for a model with `builds` builds after its opening frame:
 * `builds + 1` frames in all, and the full view (no build) is the last.
 */
export function stepOf(builds: number, build: number | undefined): { n: number; of: number } {
  const of = Math.floor(builds) + 1;
  return { n: build === undefined ? of : Math.max(1, Math.min(of, Math.floor(build) + 1)), of };
}

/**
 * The build one step back or on from `build` (undefined is the full view). Stepping on to the last
 * frame lands on the full view, so the stepper never holds a frame the finished drawing already is.
 */
export function moveBuild(
  builds: number,
  build: number | undefined,
  by: -1 | 1,
): number | undefined {
  const last = Math.floor(builds);
  const at = build === undefined ? last : build;
  const next = Math.max(0, Math.min(last, at + by));
  return next >= last ? undefined : next;
}

/**
 * The build stepper on a drawn model in the editor (TEACH-247 part u, UX ruling 205): previous,
 * next and "Step N of M" on the foot of the model. The editor shows the finished drawing; this lets
 * the teacher page through the frames Present builds, and the model goes back to the full view as
 * soon as it is neither hovered nor holding focus (`SelectionLayer` owns that rule).
 *
 * It never takes focus on its own: it mounts only on an editable slide (never while the job is
 * still writing, ADR 0037) and only a teacher's Tab or click moves focus into it. Like the credit
 * badge it is zoom-invariant (counter-scaled), and a press on it never starts a canvas drag. Keys
 * stay inside it: Left and Right step, Escape returns to the full view, and none of them reaches
 * the canvas's nudge bindings.
 */
export function ModelStepper({
  element,
  rect,
  rotation = 0,
  scale,
  build,
  onStep,
  onHover,
  onFocusChange,
}: {
  element: ImageElement;
  rect: Rect;
  rotation?: number;
  scale: number;
  build: number | undefined;
  onStep: (build: number | undefined) => void;
  /** The pointer entered (true) or left (false) the stepper. */
  onHover: (over: boolean, to: EventTarget | null) => void;
  onFocusChange: (inside: boolean) => void;
}) {
  const builds = element.builds ?? 0;
  const { n, of } = stepOf(builds, build);
  const go = (by: -1 | 1) => onStep(moveBuild(builds, build, by));
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      go(e.key === "ArrowLeft" ? -1 : 1);
    } else if (e.key === "Escape") {
      onStep(undefined);
    } else if (e.key !== "Tab") return;
    // The canvas binds arrows, Escape and Delete on the window: a key meant for the stepper stays here.
    e.stopPropagation();
  };
  return (
    <div
      style={{
        position: "absolute",
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.h,
        transform: rotation ? `rotate(${rotation}deg)` : undefined,
        transformOrigin: "50% 50%",
        pointerEvents: "none",
      }}
    >
      {/* The group opts back in to the pointer; its own keys and focus never reach the stage. */}
      {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: a toolbar's arrow keys (ARIA toolbar pattern); the handlers also keep presses and keys off the stage */}
      <div
        data-model-stepper
        role="toolbar"
        aria-label="Model build stepper"
        style={{
          position: "absolute",
          left: "50%",
          // Centred on the model's foot, half over its edge: it covers as little of the drawing as
          // it can while the pointer still reaches it without leaving the model.
          top: "100%",
          transform: `translate(-50%, -50%) scale(${1 / scale})`,
          transformOrigin: "50% 50%",
          pointerEvents: "auto",
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onPointerEnter={(e) => onHover(true, e.relatedTarget)}
        onPointerLeave={(e) => onHover(false, e.relatedTarget)}
        onKeyDown={onKeyDown}
        onFocus={(e) => {
          e.stopPropagation();
          onFocusChange(true);
        }}
        onBlur={(e) => {
          e.stopPropagation();
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onFocusChange(false);
        }}
      >
        <IconGroup aria-label="Build steps" className="bg-card shadow-sm">
          <IconButton
            label="Previous build step"
            noTooltip
            size="sm"
            disabled={n <= 1}
            onClick={() => go(-1)}
          >
            <ChevronLeft aria-hidden size={16} strokeWidth={1.5} />
          </IconButton>
          <span
            data-tabular
            aria-live="polite"
            className="inline-flex items-center whitespace-nowrap px-2 text-ink-2 text-meta tabular-nums"
          >
            {`Step ${n} of ${of}`}
          </span>
          <IconButton
            label="Next build step"
            noTooltip
            size="sm"
            disabled={build === undefined}
            onClick={() => go(1)}
          >
            <ChevronRight aria-hidden size={16} strokeWidth={1.5} />
          </IconButton>
        </IconGroup>
      </div>
    </div>
  );
}
