/**
 * What items-row (TEACH-75 part u) reads from theme v2 (TEACH-152 part b) and the icon library
 * (TEACH-310 part b), behind one small adapter: `v2Profile` / `v2Colors` / `ageProfileOf` come
 * from `../theme-v2`, matching and drawing from `../icons`. The row adds its medal shape and the
 * placeholder icon a teacher-added blank item carries.
 *
 * Every size here is in slide points (960 x 540): the pilot's px at 1440 x 2/3.
 */
import type { AgeProfileKey, ImageElement, Theme } from "@tj/domain/documents";
import { uid } from "../factories";
import { iconsLoaded, loadIcons } from "../icons/loader";
import { resolveIcons as resolveLibraryIcons } from "../icons/match";
import {
  ageProfileOf,
  type V2Profile as ThemeV2Profile,
  v2Profile as themeProfile,
  type V2Colors,
  v2Colors,
} from "../theme-v2";
import { V2_AGE_PROFILES } from "../theme-v2-paper";
import { keyStageOf } from "../themes";
import { mix } from "./index";

export { ageProfileOf, type V2Colors, v2Colors };

export type Age = AgeProfileKey;

/**
 * Theme v2's resolved age profile, plus the icon's container: a round medal on a tint halo
 * ("disc"), or from KS3 a quiet rounded-square tile with a hairline edge and no halo ("tile";
 * Greg's icon option 2, 14 Oct).
 */
export type V2Profile = ThemeV2Profile & { medalShape: "disc" | "tile" };

const withShape = (p: ThemeV2Profile): V2Profile => ({
  ...p,
  medalShape: p.age === "secondary" ? "tile" : "disc",
});

/** The gold age profiles (`V2_AGE_PROFILES`) as the row reads them, for tests and capacity. */
export const GOLD_PROFILES: Record<Age, V2Profile> = Object.fromEntries(
  (Object.keys(V2_AGE_PROFILES) as Age[]).map((age) => {
    const { colors: _neutrals, ...p } = V2_AGE_PROFILES[age];
    return [age, withShape({ ...p, age })];
  }),
) as Record<Age, V2Profile>;

/** `v2Profile(theme)` at the theme's key stage, with the row's medal shape. */
export function v2Profile(theme: Theme): V2Profile {
  return withShape(themeProfile(theme));
}

/**
 * The neutral icon a teacher-added blank item carries (key `placeholder`): it counts as an icon for
 * the all-or-none rule, so adding an item to an icon row keeps every other icon. Never a writer
 * fallback: a writer's label that misses still numbers the row and is reported.
 */
export const PLACEHOLDER_ICON = "placeholder";
export type IconResolution = { ids: (string | null)[]; misses: string[]; complete: boolean };
/** The library's `resolveIcons`, plus the placeholder: one id per label, the misses once each. */
export function resolveIcons(labels: readonly string[]): IconResolution {
  const lib = resolveLibraryIcons(labels);
  const ids = labels.map((l, i) =>
    l.trim() === PLACEHOLDER_ICON ? PLACEHOLDER_ICON : (lib.ids[i] ?? null),
  );
  const misses = [...new Set(labels.filter((_, i) => ids[i] === null))];
  return { ids, misses, complete: misses.length === 0 };
}

/**
 * The concept as an image `src` for a box of `boxPt`: the library's drawing in the theme's icon
 * slots and age, or the placeholder in `colour`; "" while the library is still loading.
 */
export function iconSrc(id: string, theme: Theme, boxPt: number, colour: string): string {
  // Until the drawings have loaded (`../icons/loader`) a library concept is "": the medal keeps
  // its face and size with no drawing, and the load starts so the next lay draws it.
  const icons = id === PLACEHOLDER_ICON ? null : iconsLoaded();
  if (id !== PLACEHOLDER_ICON && !icons) {
    void loadIcons();
    return "";
  }
  const svg =
    id === PLACEHOLDER_ICON
      ? placeholderSvg(colour)
      : (icons?.iconSvgForTheme(
          id,
          {
            colors: theme.colors,
            iconSlots: v2Colors(theme).icon,
            keyStage: keyStageOf(theme) ?? undefined,
          },
          boxPt,
        ) ?? "");
  return svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : "";
}

/**
 * The placeholder's drawing, in the library's manner (240 box, soft tint, one outline weight):
 * a calm rounded square on a tint disc in the item's slot colour, so it reads as "an icon goes
 * here" without naming anything.
 */
export function placeholderSvg(colour: string): string {
  const tint = mix(colour, "#ffffff", 0.18);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" data-icon="${PLACEHOLDER_ICON}"><circle cx="120" cy="120" r="88" fill="${tint}"/><rect x="78" y="78" width="84" height="84" rx="22" fill="none" stroke="${colour}" stroke-width="10" stroke-linejoin="round"/><circle cx="120" cy="120" r="12" fill="${colour}"/></svg>`;
}

/** The icon placed as an image element. */
export function iconImage(
  id: string,
  theme: Theme,
  rect: { x: number; y: number; w: number; h: number },
  colour: string,
  name: string,
  alt: string,
): ImageElement {
  return {
    id: uid(),
    type: "image",
    ...rect,
    src: iconSrc(id, theme, rect.w, colour),
    alt,
    fit: "contain",
    // Round, so the image view's box never squares off the medal's ring.
    radius: Math.round(rect.w / 2),
    name,
  };
}
