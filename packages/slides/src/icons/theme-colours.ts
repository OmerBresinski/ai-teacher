/*
 * A slide theme -> the icon colour slots and age (TEACH-310 part b, rulings 211-212). Typed
 * structurally so this module does not import the theme type: theme v2 (TEACH-152 part b) adds
 * its own `iconSlots`, which win over the slots derived here from the accent and ink, as the
 * pilot's theme-v2.css derived them.
 */
import { ICON_LIBRARY, iconSizeFor, iconSvg } from "./library";
import { DEFAULT_ICON_COLOURS, mixOklab, parseHex, safeHex } from "./treatment";
import type { IconAge, IconColours } from "./types";

export interface IconThemeInput {
  colors: { accent: string; ink: string };
  iconSlots?: Partial<IconColours>;
  /** set on a theme read at a key stage (`atKeyStage` in `@tj/slides/themes`) */
  keyStage?: string;
}

const BLUE = { secondary: "#2F7FD1", secondaryDark: "#1F5C9E" };
const AMBER = { secondary: "#E8A33A", secondaryDark: "#B87A1E" };

/** Hue in degrees of an #rrggbb colour. */
function hue(hex: string): number {
  const [r, g, b] = parseHex(hex);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

export function iconColoursFor(theme: IconThemeInput): IconColours {
  // a theme colour that is not hex (or is hostile) falls back to the default slots
  const accent = safeHex(theme.colors?.accent, DEFAULT_ICON_COLOURS.primary);
  const ink = safeHex(theme.colors?.ink, DEFAULT_ICON_COLOURS.ink);
  const h = hue(accent);
  // the pilot's partners: a red or orange accent takes blue, any other accent takes amber
  const partner = h < 60 || h >= 330 ? BLUE : AMBER;
  return {
    primary: accent,
    primaryDark: mixOklab(accent, "#000000", 0.7),
    tint: mixOklab(accent, "#ffffff", 0.16),
    ...partner,
    ink,
    stroke: ink,
    ...theme.iconSlots,
  };
}

/** The age treatment for a key stage (`keyStageOf(theme)` in `@tj/slides/themes`). */
export function iconAgeFor(keyStage: string | undefined): IconAge {
  if (keyStage === "ks1") return "early";
  if (keyStage === "ks3" || keyStage === "ks4" || keyStage === "ks5") return "secondary";
  return "primary";
}

/**
 * A library concept drawn for a slide theme: its icon slots, its key stage's age, and the size
 * level for a drawn box of `boxPt`. Null when the library has no such concept. `px` sets an
 * intrinsic size for rasterisers.
 */
export function iconSvgForTheme(
  id: string,
  theme: IconThemeInput,
  boxPt: number,
  px?: number,
): string | null {
  if (!Object.hasOwn(ICON_LIBRARY, id)) return null;
  return iconSvg(id, {
    colours: iconColoursFor(theme),
    age: iconAgeFor(theme.keyStage),
    size: iconSizeFor(boxPt),
    ...(px ? { px } : {}),
  });
}
