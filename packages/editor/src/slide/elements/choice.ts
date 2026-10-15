/**
 * Choice answers drawn as cards or boxes (TEACH-101 part b): the words that name one, and which
 * ones the reveal marks. Kept out of `kit.ts` so print chunks that never show a choice stay small.
 */
import type { ShapeElement, Slide, SlideElement, Theme } from "@tj/domain/documents";
import { richDocToPlainText as docToPlainText } from "@tj/domain/documents";
import { surfaceStyle } from "@tj/slides/surfaces";

/**
 * The words that name a choice or answer element: its own text, or, for a card or option box drawn
 * as a shape (the template hinge, choose and odd-one-out cards), the text elements inside it.
 */
export function choiceText(slide: Slide, id: string): string {
  const el = slide.elements.find((e) => e.id === id);
  if (!el) return "";
  // A card's marker disc is named after its card ("Marker: frog"): quote the card's word.
  if (el.type === "shape" && el.name?.startsWith("Marker: ")) return el.name.slice(8).trim();
  const own = "doc" in el && el.doc ? docToPlainText(el.doc).trim() : "";
  if (own) return own;
  // A card's picture (a sequence's order) is named by its alt text, which is the card's word.
  if (el.type === "image") return el.alt?.trim() ?? "";
  const inside = (e: SlideElement) => {
    const cx = e.x + e.w / 2;
    const cy = e.y + e.h / 2;
    return cx > el.x && cx < el.x + el.w && cy > el.y && cy < el.y + el.h;
  };
  return slide.elements
    .filter((e) => e.id !== id && (e.type === "text" || e.type === "gap-text") && inside(e))
    .map((e) => ("doc" in e && e.doc ? docToPlainText(e.doc).trim() : ""))
    .filter(Boolean)
    .join(" ");
}

/**
 * A choice question whose options are not `option` elements (cards and option boxes): the ids
 * the reveal marks, each dimmed in turn when wrong and ringed with a tick when right.
 */
export function choiceMarks(
  slide: Slide,
  revealAnswer: boolean,
  answerProgress: number,
): { id: string; state: "dim" | "right" }[] {
  const q = slide.question;
  if (q?.type !== "multiple-choice") return [];
  // A one-step reveal (the hinge): the one click fades every wrong option and marks the right one.
  const shown = revealAnswer || (q.oneStep === true && answerProgress > 0);
  const wrong = q.options.filter((o) => !o.correct);
  return q.options.flatMap((o): { id: string; state: "dim" | "right" }[] => {
    const el = slide.elements.find((e) => e.id === o.id);
    if (!el || el.type === "option") return [];
    if (o.correct) return shown ? [{ id: o.id, state: "right" as const }] : [];
    const rank = wrong.findIndex((w) => w.id === o.id);
    return shown || answerProgress > rank ? [{ id: o.id, state: "dim" as const }] : [];
  });
}

/** The hinge's element names (`@tj/slides` templates/hinge.ts `HINGE_NAMES`). */
const HINGE_KEY = "Hinge key";
const HINGE_ICON = "Option icon";
const HINGE_STAGE = "surface:field-b";

export type HingeMark = {
  wash: string;
  ring: string;
  keyFill: string;
  keyInk: string;
  radius: number;
  key: {
    x: number;
    y: number;
    w: number;
    h: number;
    radius: number;
    letter: string;
    fontSize: number;
  } | null;
  tick: { d: number; right: number; top: number };
};

/**
 * How the reveal marks a hinge card (TEACH-256 part b, v13 gold): ring, tick and the right card's
 * key in the theme's correct colour (`verdict-right` and `key:right` are built from it), a wrong card faded to about a third into
 * the sand stage. Null for any other choice card, which keeps the generic marks.
 */
export function hingeMarkOf(slide: Slide, theme: Theme, id: string): HingeMark | null {
  const card = slide.elements.find((e) => e.id === id);
  if (!card || card.type === "option") return null;
  const inside = (e: SlideElement) =>
    e.x >= card.x && e.y >= card.y && e.x + e.w <= card.x + card.w && e.y + e.h <= card.y + card.h;
  const keyEl = slide.elements.find((e) => e.name === HINGE_KEY && inside(e));
  if (!keyEl) return null;
  const right = surfaceStyle(theme, "verdict-right");
  const keyRight = surfaceStyle(theme, "key", "right");
  const stage = slide.elements.find((e) => e.name === HINGE_STAGE);
  const ground =
    stage && "fill" in stage && typeof stage.fill === "string"
      ? stage.fill
      : theme.colors.background;
  const tiles = slide.elements.some((e) => e.name === HINGE_ICON && inside(e));
  const d = Math.round(keyEl.w * 0.78);
  const radius = keyEl.type === "shape" && keyEl.radius ? keyEl.radius : Math.round(keyEl.w * 0.24);
  const fontSize = keyEl.type === "shape" ? Number(keyEl.textStyle?.fontSize ?? 20) : 20;
  return {
    // 66% of the stage over the card: the card reads at about a third (the gold's 0.34).
    ring: right.fill,
    keyFill: keyRight.fill,
    keyInk: keyRight.ink ?? theme.colors.onAccent,
    wash: `${ground.slice(0, 7)}A8`,
    radius:
      "radius" in card && typeof card.radius === "number"
        ? card.radius
        : Math.min(theme.radius, 16),
    key: {
      x: keyEl.x,
      y: keyEl.y,
      w: keyEl.w,
      h: keyEl.h,
      radius,
      letter: choiceText(slide, keyEl.id),
      fontSize,
    },
    tick: tiles ? { d, right: 16, top: 16 } : { d, right: 19, top: Math.round((card.h - d) / 2) },
  };
}

/** A slide whose answer shows in one click (the hinge): PowerPoint gives it one more build slide. */
export const oneStepReveal = (slide: Slide): boolean =>
  slide.question?.type === "multiple-choice" && slide.question.oneStep === true;

/**
 * The hinge's revealed state as plain shapes for the PowerPoint build slide (TEACH-256 part b):
 * a wash over each wrong card, a `verdict-right` ring on the right card, its key in `key:right`
 * and the tick disc, where the editor's `ChoiceMarks` draws them.
 */
export function hingeRevealShapes(slide: Slide, theme: Theme): ShapeElement[] {
  const out: ShapeElement[] = [];
  for (const { id, state } of choiceMarks(slide, true, Number.POSITIVE_INFINITY)) {
    const card = slide.elements.find((e) => e.id === id);
    const m = card ? hingeMarkOf(slide, theme, id) : null;
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
