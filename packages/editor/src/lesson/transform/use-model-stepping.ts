import type { Id } from "@tj/domain/documents";
import { useEffect, useState } from "react";
import type { ElementBox } from "./hit-test";
import { type DiagramStep, isBuildingModel } from "./ModelStepper";

/**
 * Which model the build stepper sits on, and when its preview holds (TEACH-247 part u, UX ruling
 * 205). The stepper goes on the model it holds focus for, else the hovered one, else the single
 * selected one. A previewed build holds while that model is hovered or the stepper holds focus;
 * after a touch or pen press it also holds while the model stays selected, because a tap raises no
 * hover and Safari does not focus a button it taps, so on an iPad the build stays until the
 * teacher taps elsewhere. Anything else drops it back to the finished drawing.
 */
export function useModelStepping({
  enabled,
  hoverId,
  selectedId,
  boxOf,
  diagramStep,
  onDiagramStep,
}: {
  /** False mid-gesture, mid-marquee, while cropping, or on a slide the job is still writing. */
  enabled: boolean;
  hoverId: Id | null;
  /** The one selected element, or null for none or several. */
  selectedId: Id | null;
  boxOf: (id: Id) => ElementBox | undefined;
  diagramStep: DiagramStep | null;
  onDiagramStep?: (next: DiagramStep | null) => void;
}) {
  const [focusId, setFocusId] = useState<Id | null>(null);
  /** The last press on the slide was a touch or a pen, not a mouse. */
  const [touch, setTouch] = useState(false);
  const model = (id: Id | null) => {
    const b = id ? boxOf(id) : undefined;
    return b && isBuildingModel(b.el) ? { ...b, el: b.el } : undefined;
  };
  const stepping =
    enabled && onDiagramStep ? (model(focusId) ?? model(hoverId) ?? model(selectedId)) : undefined;
  const id = diagramStep?.id;
  const live =
    !!diagramStep &&
    stepping?.id === id &&
    (hoverId === id || focusId === id || (touch && selectedId === id));
  useEffect(() => {
    if (diagramStep && !live) onDiagramStep?.(null);
  }, [diagramStep, live, onDiagramStep]);
  return {
    stepping,
    setFocusId,
    /** Called with every press on the slide or the stepper. */
    notePress: (pointerType: string) => setTouch(pointerType === "touch" || pointerType === "pen"),
  };
}
