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
