/**
 * The hinge's one-click reveal as PowerPoint shapes (TEACH-256 part b), kept out of the slide
 * renderer's chunks: only the export draws it.
 */
import type { ShapeElement, Slide, Theme } from "@tj/domain/documents";
import { choiceMarks } from "../slide/elements/choice";
import { type HingeRoles, hingeMarkOf } from "../slide/elements/HingeMarks";

/** A slide whose answer shows in one click (the hinge): PowerPoint gives it one more build slide. */
export const oneStepReveal = (slide: Slide): boolean =>
  slide.question?.type === "multiple-choice" && slide.question.oneStep === true;

/**
 * The hinge's revealed state as plain shapes for the PowerPoint build slide (TEACH-256 part b):
 * a wash over each wrong card, a `verdict-right` ring on the right card, its key in `key:right`
 * and the tick disc, where the editor's `ChoiceMarks` draws them.
 */
export function hingeRevealShapes(slide: Slide, theme: Theme, roles: HingeRoles): ShapeElement[] {
  const out: ShapeElement[] = [];
  for (const { id, state } of choiceMarks(slide, true, Number.POSITIVE_INFINITY)) {
    const card = slide.elements.find((e) => e.id === id);
    const m = card ? hingeMarkOf(slide, theme, id, roles) : null;
    if (!card || !m) continue;
    const base = { x: card.x, y: card.y, w: card.w, h: card.h, radius: m.radius };
    if (state === "dim") {
      out.push({
        ...base,
        id: `${id}-wash`,
        type: "shape",
        shape: "rounded",
        fill: m.wash.slice(0, 7),
        opacity: 0.66,
        name: "Reveal wash",
      });
      continue;
    }
    out.push({
      ...base,
      id: `${id}-ring`,
      type: "shape",
      shape: "rounded",
      fill: "transparent",
      stroke: m.ring,
      strokeWidth: 3,
      name: "Reveal ring",
    });
    const k = m.key;
    if (k)
      out.push({
        id: `${id}-key`,
        type: "shape",
        shape: "rounded",
        x: k.x,
        y: k.y,
        w: k.w,
        h: k.h,
        radius: k.radius,
        fill: m.keyFill,
        name: "Reveal key",
        doc: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: k.letter }] }],
        },
        textStyle: {
          preset: "heading",
          fontSize: k.fontSize,
          fontWeight: 700,
          color: m.keyInk,
          align: "center",
          valign: "middle",
          padding: 0,
        },
      } as ShapeElement);
    out.push({
      id: `${id}-tick`,
      type: "shape",
      shape: "ellipse",
      x: card.x + card.w - m.tick.right - m.tick.d,
      y: card.y + m.tick.top,
      w: m.tick.d,
      h: m.tick.d,
      fill: m.ring,
      name: "Reveal tick",
      doc: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "✓" }] }],
      },
      textStyle: {
        preset: "body",
        fontSize: Math.round(m.tick.d * 0.6),
        fontWeight: 700,
        color: m.keyInk,
        align: "center",
        valign: "middle",
        padding: 0,
      },
    } as ShapeElement);
  }
  return out;
}
