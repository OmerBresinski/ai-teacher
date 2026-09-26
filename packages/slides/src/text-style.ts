import type { TextPreset, TextStyle, Theme } from "@tj/domain/documents";
import { fontFloor, type TextRole, textRole } from "./themes";

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

/** The distinct sizes of the theme's ladder, largest first. */
export function ladderStops(theme: Theme): number[] {
  return Array.from(new Set(LADDER.map((p) => theme.sizes[p]))).sort((a, b) => b - a);
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
  if (override === undefined) return Math.max(theme.sizes[preset], fontFloor(preset, role));
  return Math.max(override, floorBelow(theme, preset, role));
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
