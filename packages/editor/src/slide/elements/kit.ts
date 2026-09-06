/**
 * Shared props and helpers for every element renderer.
 * Kept free of JSX so it can be imported from anywhere without cycles.
 */
import type {
  QuestionData,
  Slide,
  SlideElement,
  TextPreset,
  TextStyle,
  Theme,
} from "@tj/domain/documents";
import type { CSSProperties, ReactNode, Ref } from "react";
import { fontFloor, type TextRole, textRole } from "../../model/themes";

export type { TextRole };
/**
 * The floors themselves, and the preset-to-role mapping they hang off, live in
 * `lib/model/themes.ts` next to the type ladders they clamp. Re-exported here because
 * every renderer, measurer and exporter already imports its typography from this file.
 * The `MIN_FONT_SIZE` table is not: a caller that wants a floor wants the one for its
 * role, which is `fontFloor`, and a second name for the same table only invites the
 * two to drift.
 */
export { fontFloor, textRole };

export type SlideMode = "edit" | "view" | "present" | "capture" | "thumb";

/** The contract every `components/slide/elements/*` renderer implements. */
export type ElementViewProps<T extends SlideElement = SlideElement> = {
  element: T;
  theme: Theme;
  mode: SlideMode;
  /** Id of the slide this element belongs to, so writes are addressed, never ambient. */
  slideId: string;
  /** Beyond the current reveal step: kept mounted, made invisible outside edit mode. */
  hidden: boolean;
  /** Edit mode preview of a not-yet-revealed element. */
  ghost: boolean;
  /** Question slides: the answer state is showing. */
  revealAnswer: boolean;
  /** The slide's question data, if any. */
  question?: QuestionData;
  /** Current reveal step. Only `group` needs it, to forward to its children. */
  step?: number;
  /** Position of an `option` element among the slide's options, for order-based answers. */
  optionIndex?: number;
};

/** Modes that must never run timers, observers, iframes or animations. */
export const isStatic = (mode: SlideMode) => mode === "capture" || mode === "thumb";

/* ------------------------------------------------------------------ */
/* Colour                                                              */
/* ------------------------------------------------------------------ */

/** `#RRGGBB` (or `#RGB`) plus an alpha, as `rgb(r g b / a)`. Passes anything else through. */
export function withAlpha(color: string, alpha: number): string {
  const hex = color.trim();
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex);
  const digits = m?.[1];
  if (!digits) return color;
  const h = digits.length === 3 ? digits.replace(/./g, (c) => c + c) : digits;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgb(${r} ${g} ${b} / ${alpha})`;
}

export { clamp } from "../../model/geometry";

/* ------------------------------------------------------------------ */
/* Typography                                                          */
/* ------------------------------------------------------------------ */

const TITLE_FACE: TextPreset[] = ["title", "subtitle", "heading"];
const TRACKED: TextPreset[] = ["title", "subtitle", "heading"];

export type ResolvedText = {
  preset: TextPreset;
  /** What the text is doing on the slide, and therefore which floor it sits on. */
  role: TextRole;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  fontWeight: number;
  letterSpacing: string;
  textTransform: "none" | "uppercase";
  color: string;
  align: "left" | "center" | "right";
  valign: "top" | "middle" | "bottom";
  padding: number;
  background?: string;
  radius: number;
  autoHeight: boolean;
};

/**
 * The projector floor is a property of the role, not of the code path, so the theme's
 * own size and an author override are clamped to the same number. `role` is only passed
 * where the preset cannot say what the text is doing — an option card, set in `small`.
 */
export function resolveFontSize(
  theme: Theme,
  preset: TextPreset,
  override?: number,
  role?: TextRole,
): number {
  return Math.max(override ?? theme.sizes[preset], fontFloor(preset, role));
}

export function resolveTextStyle(
  style: TextStyle | Partial<TextStyle> | undefined,
  theme: Theme,
  fallbackPreset: TextPreset = "body",
  role?: TextRole,
): ResolvedText {
  const preset = style?.preset ?? fallbackPreset;
  const isTitleFace = TITLE_FACE.includes(preset);
  const weight =
    style?.fontWeight ??
    (preset === "title" || preset === "subtitle"
      ? theme.weights.title
      : preset === "heading"
        ? theme.weights.heading
        : preset === "caption"
          ? 600
          : theme.weights.body);

  return {
    preset,
    role: textRole(preset, role),
    fontFamily: style?.fontFamily ?? (isTitleFace ? theme.fonts.title : theme.fonts.body),
    fontSize: resolveFontSize(theme, preset, style?.fontSize, role),
    lineHeight: style?.lineHeight ?? theme.lineHeights[preset],
    fontWeight: weight,
    letterSpacing: TRACKED.includes(preset)
      ? theme.titleTracking
      : preset === "caption"
        ? "0.08em"
        : "normal",
    textTransform: preset === "caption" ? "uppercase" : "none",
    color: style?.color ?? (preset === "caption" ? theme.colors.muted : theme.colors.ink),
    align: style?.align ?? "left",
    valign: style?.valign ?? "top",
    padding: style?.padding ?? 0,
    background: style?.background,
    radius: style?.radius ?? 0,
    autoHeight: style?.autoHeight !== false,
  };
}

/** Inline style for the text body itself (not the box). */
export function textTypeCss(r: ResolvedText): CSSProperties {
  return {
    fontFamily: r.fontFamily,
    fontSize: r.fontSize,
    lineHeight: r.lineHeight,
    fontWeight: r.fontWeight,
    letterSpacing: r.letterSpacing,
    textTransform: r.textTransform,
    color: r.color,
    textAlign: r.align,
    ["--td-lh" as string]: String(r.lineHeight),
  };
}

export const JUSTIFY: Record<ResolvedText["valign"], "flex-start" | "center" | "flex-end"> = {
  top: "flex-start",
  middle: "center",
  bottom: "flex-end",
};

/* ------------------------------------------------------------------ */
/* Question helpers                                                    */
/* ------------------------------------------------------------------ */

export type OptionState = "correct" | "incorrect" | null;

/**
 * Whether an option element is the right answer.
 *
 * `multiple-choice` carries option ids. `true-false` carries only a boolean, so the card
 * is matched on its own text ("True" / "Yes" / "False" / "No") — never on the chip label,
 * which is a position marker (A, B) on every other question type. When the text says
 * neither, the card's position decides: the first option is the true card.
 */
export function optionState(
  element: { id: string; label?: string; doc?: unknown },
  question: QuestionData | undefined,
  text: string,
  optionIndex?: number,
): OptionState {
  if (!question) return null;
  if (question.type === "multiple-choice") {
    const opt = question.options.find((o) => o.id === element.id);
    if (!opt) return null;
    return opt.correct ? "correct" : "incorrect";
  }
  if (question.type === "true-false") {
    const word = text.trim().toLowerCase();
    const isTrue = word.startsWith("true") || word.startsWith("yes");
    const isFalse = word.startsWith("false") || word.startsWith("no");
    const asTrue = isTrue
      ? true
      : isFalse
        ? false
        : optionIndex != null && optionIndex < 2
          ? optionIndex === 0
          : null;
    if (asTrue === null) return null;
    return asTrue === question.correct ? "correct" : "incorrect";
  }
  return null;
}

/** Reveal copy shown beneath the options, if the question carries any. */
export function explanationText(question: QuestionData | undefined): string | null {
  if (!question) return null;
  if (question.type === "true-false" || question.type === "multiple-choice")
    return question.explanation?.trim() || null;
  if (question.type === "open-response") return question.modelAnswer?.trim() || null;
  return null;
}

/** `[[gap:id]]` tokens, as they appear in a gap-text doc. */
export const GAP_TOKEN = /\[\[gap:([A-Za-z0-9_-]+)\]\]/g;

export function gapAnswers(question: QuestionData | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (question?.type === "fill-gap") for (const g of question.gaps) map.set(g.id, g.answer);
  return map;
}

/** Position of each `option` element among the slide's options, top-level and in groups. */
export function optionPositions(slide: Slide): Map<string, number> {
  const map = new Map<string, number>();
  let n = 0;
  const walk = (els: readonly SlideElement[]) => {
    for (const el of els) {
      if (el.type === "option") map.set(el.id, n++);
      else if (el.type === "group") walk(el.children);
    }
  };
  walk(slide.elements);
  return map;
}

/** Correct position (1-based) of each element on a `sort` question slide. */
export function sortPositions(slide: Slide): Map<string, number> {
  const map = new Map<string, number>();
  if (slide.question?.type === "sort") {
    slide.question.order.forEach((id, i) => {
      map.set(id, i + 1);
    });
  }
  return map;
}

/** What an inline label editor hands back to the element view that hosts it (phase C). */
export type LabelParts = {
  /** The editing surface to drop into the element's text slot, or null when at rest. */
  editor: ReactNode;
  /** Attach to the static text body when `measure` is given, for auto-height. */
  bodyRef?: Ref<HTMLDivElement>;
  overflowing: boolean;
};
