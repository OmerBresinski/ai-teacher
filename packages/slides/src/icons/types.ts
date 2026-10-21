/** Age treatment (pilot ruling 212): early = EYFS-KS1, primary = KS2, secondary = KS3 onwards. */
export type IconAge = "early" | "primary" | "secondary";
/** Detail level: s drops gloss, shade, outline and detail (and uses the small drawing), l adds fine detail. */
export type IconSize = "s" | "m" | "l";

/**
 * The theme's icon colour slots (pilot tokens.css `--icon-*`), as literal CSS colours (#rrggbb).
 * A minimal local input: the theme's own type is not imported, so this module does not depend on
 * theme.ts while theme v2 (TEACH-152 part b) lands; that theme maps its `iconSlots` onto this.
 */
export interface IconColours {
  primary: string;
  primaryDark: string;
  secondary: string;
  secondaryDark: string;
  tint: string;
  ink: string;
  stroke: string;
}

export interface IconConcept {
  id: string;
  label: string;
  synonyms: readonly string[];
  lesson: string;
  keyStage: string;
}

/** One library drawing on a 240x240 box; `small` is the separate drawing used at size s. */
export interface IconDrawing {
  name: string;
  svg: () => string;
  small?: () => string;
  subject?: string;
  ks?: string;
  hard?: boolean;
}
