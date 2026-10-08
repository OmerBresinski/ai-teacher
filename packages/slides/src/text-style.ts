import type { TextPreset, TextStyle, Theme } from "@tj/domain/documents";
import {
  displayBodyStop,
  fontFloor,
  type TextRole,
  type TypeScale,
  type TypeStep,
  textRole,
  typeScale,
} from "./themes";

/*
 * Resolving a text style against a theme (ADR 0025 §9). Moved verbatim from the editor's
 * `slide/elements/kit.ts` so the layout recipes and the "Why?" panel metrics can size text
 * without React; `kit.ts` re-exports these for the renderers.
 */

export const TITLE_FACE: TextPreset[] = ["title", "subtitle", "heading"];
export const TRACKED: TextPreset[] = ["title", "subtitle", "heading"];

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

/** The theme's own type ladder, largest first: the stops a step-down walks (`reflow.ts`). */
export const LADDER: readonly TextPreset[] = ["title", "subtitle", "heading", "body", "small"];

/** The distinct sizes of the theme's ladder, largest first, with the display body stop kept in it. */
export function ladderStops(theme: Theme): number[] {
  const sc = typeScale(theme);
  if (sc) return Array.from(new Set(Object.values(sc))).sort((a, b) => b - a);
  const sizes = LADDER.map((p) => theme.sizes[p]);
  const display = displayBodyStop(theme);
  if (display !== undefined) sizes.push(display);
  return Array.from(new Set(sizes)).sort((a, b) => b - a);
}

/** The presets a step-down touches; `title`, `subtitle` and `caption` never step, so their floor holds. */
export const STEPPABLE: readonly TextPreset[] = ["heading", "body", "small"];

/**
 * One stop of the theme's ladder below the role's projector floor, or the floor itself when the
 * ladder has nothing under it. UX ruling 91: when content does not fit at the floor, type may
 * step down one size, never more; an explicit size is therefore clamped here, not at the floor
 * (chalk: an option card 31 → 29, a question stem 38 → 36, body copy 26 → 24).
 */
export function floorBelow(theme: Theme, preset: TextPreset, role?: TextRole): number {
  const sc = typeScale(theme);
  if (sc) {
    const steps = roleSteps(sc, textRole(preset, role));
    return steps[steps.length - 1] as number;
  }
  const floor = fontFloor(preset, role);
  if (!STEPPABLE.includes(preset)) return floor;
  return ladderStops(theme).find((s) => s < floor - 0.5) ?? floor;
}

/**
 * The projector floor is a property of the role, not of the code path, so the theme's own size
 * is clamped to it whatever the code path; an explicit override may sit one ladder stop under
 * it (`floorBelow`, UX ruling 91) and no lower. `role` is only passed where the preset cannot
 * say what the text is doing — an option card, set in `small`.
 */
export function resolveFontSize(
  theme: Theme,
  preset: TextPreset,
  override?: number,
  role?: TextRole,
): number {
  const sc = typeScale(theme);
  if (sc) return stageSize(sc, preset, override, role).size;
  if (override === undefined) return Math.max(theme.sizes[preset], fontFloor(preset, role));
  return Math.max(override, floorBelow(theme, preset, role));
}

/**
 * The steps a role may sit on at a key stage, largest first: its own step, then the one step a fit
 * may take under it (UX ruling 91). Reading text (body, an option card, a question row, a card's
 * words, a footnote) is body or bodySmall; a heading or stem its stop or body; display text any
 * display stop down to the heading.
 */
export function roleSteps(sc: TypeScale, role: TextRole): number[] {
  const at = (...k: TypeStep[]) => k.map((s) => sc[s]);
  switch (role) {
    case "body":
    case "option":
      return at("body", "bodySmall");
    case "small":
      return at("bodySmall");
    case "caption":
      return at("caption");
    case "heading":
    case "question":
      return at("headingDisplay", "heading", "body");
    default:
      return at("title", "subtitle", "headingDisplay", "heading");
  }
}

/**
 * THE size function at a key stage: the scale step a text element draws at. No override: the
 * preset's own step (a card or a row of body reads at body; an option card at body). An override
 * snaps to the largest step of its role at or under it, so a stored size never sits between steps
 * or above the role's top step; `stepped` says the result is under the role's default step (a fit
 * step-down, which generation logs).
 */
export function stageSize(
  sc: TypeScale,
  preset: TextPreset,
  override?: number,
  role?: TextRole,
): { size: number; step: TypeStep; stepped: boolean } {
  const r = textRole(preset, role);
  const steps = roleSteps(sc, r);
  const def: TypeStep =
    r === "option"
      ? "body"
      : preset === "small" && r !== "small"
        ? "body"
        : (
            {
              title: "title",
              subtitle: "subtitle",
              heading: "heading",
              body: "body",
              small: "bodySmall",
              caption: "caption",
            } as const
          )[preset];
  const want = sc[def];
  const top = steps.includes(want) ? want : (steps[0] as number);
  let size = top;
  if (override !== undefined) {
    const allowed = steps.filter(
      (s) => s <= top || r === "heading" || r === "question" || r === "title",
    );
    size = allowed.find((s) => s <= override + 0.5) ?? (allowed[allowed.length - 1] as number);
  }
  const step = (Object.keys(sc) as TypeStep[]).find((k) => sc[k] === size) ?? def;
  return { size, step, stepped: size < want - 0.5 };
}

/**
 * Candidate sizes a layout tries, each put on the type scale (`resolveFontSize`), largest first and
 * without repeats: at a key stage a recipe's "a step larger" or "set large" lands on the role's own
 * step, so no layout sizes text off the scale.
 */
export function onScale(
  theme: Theme,
  preset: TextPreset,
  sizes: readonly number[],
  role?: TextRole,
): number[] {
  return Array.from(new Set(sizes.map((s) => resolveFontSize(theme, preset, s, role)))).sort(
    (a, b) => b - a,
  );
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
    color:
      style?.color ??
      (preset === "caption"
        ? theme.colors.muted
        : TRACKED.includes(preset)
          ? (theme.colors.heading ?? theme.colors.ink)
          : theme.colors.ink),
    align: style?.align ?? "left",
    valign: style?.valign ?? "top",
    padding: style?.padding ?? 0,
    background: style?.background,
    radius: style?.radius ?? 0,
    autoHeight: style?.autoHeight !== false,
  };
}

/**
 * Running text on a teaching slide (a lead, its points, a paragraph, a compare card): the theme's
 * body size, clamped to the projector floor (SPEC §7), and the lead set at that size in a heavier
 * weight rather than a step above it. Readable from the back of a classroom first (Greg, 26 Sept
 * 2026): the homepage examples set text smaller (a lead's cap height 2.8% of the slide's height,
 * ours 3.7% at 29), and we do not shrink to match them. Room comes from the leading instead.
 */
export const readingSize = (t: Theme): number => resolveFontSize(t, "body");

/** The leading of running text on a teaching slide: the theme's, at most 1.4 (the examples' ~1.44). */
export const readingLeading = (t: Theme): number => Math.min(t.lineHeights.body, 1.4);

type Sized = {
  type: string;
  style?: { preset?: TextPreset; fontSize?: number };
  textStyle?: { preset?: TextPreset; fontSize?: number };
  fontSize?: number;
  children?: Sized[];
};

/**
 * Every stored size on a slide put on the theme's key-stage scale (a no-op with no stage): text,
 * option cards (role `option`), labelled shapes, tables (`small`) and groups' children. The render
 * reads the same `resolveFontSize`, so what is stored is what is drawn.
 */
export function snapToScale<T extends { elements: readonly unknown[] }>(slide: T, theme: Theme): T {
  if (!typeScale(theme)) return slide;
  const one = (raw: unknown): unknown => {
    const e = raw as Sized;
    let out: Sized = e;
    if (e.style?.fontSize !== undefined) {
      const fontSize = resolveFontSize(theme, e.style.preset ?? "body", e.style.fontSize);
      if (fontSize !== e.style.fontSize) out = { ...out, style: { ...e.style, fontSize } };
    }
    if (e.textStyle?.fontSize !== undefined) {
      const role = e.type === "option" ? "option" : undefined;
      const fontSize = resolveFontSize(
        theme,
        e.textStyle.preset ?? "small",
        e.textStyle.fontSize,
        role,
      );
      if (fontSize !== e.textStyle.fontSize)
        out = { ...out, textStyle: { ...e.textStyle, fontSize } };
    }
    if (e.type === "table" && e.fontSize !== undefined) {
      const fontSize = resolveFontSize(theme, "small", e.fontSize);
      if (fontSize !== e.fontSize) out = { ...out, fontSize };
    }
    if (e.type === "group" && e.children)
      out = { ...out, children: e.children.map(one) as Sized[] };
    return out;
  };
  return { ...slide, elements: slide.elements.map(one) };
}

/**
 * The text on a slide drawn under its role's own step (a fit step-down), as "name: preset size<own":
 * empty with no stage or no step-down. Generation logs it; the type audit counts it.
 */
export function steppedDown(slide: { elements: readonly unknown[] }, theme: Theme): string[] {
  const sc = typeScale(theme);
  if (!sc) return [];
  const out: string[] = [];
  const walk = (els: readonly unknown[]) => {
    for (const raw of els) {
      const e = raw as Sized & { name?: string };
      const st = e.style ?? e.textStyle;
      if (st?.fontSize !== undefined) {
        const r = stageSize(
          sc,
          st.preset ?? "body",
          st.fontSize,
          e.type === "option" ? "option" : undefined,
        );
        if (r.stepped) out.push(`${e.name ?? e.type}: ${st.preset ?? "body"} ${r.size}`);
      }
      if (e.children) walk(e.children);
    }
  };
  walk(slide.elements);
  return out;
}
