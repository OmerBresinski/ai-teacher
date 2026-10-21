/**
 * panel-list's adapter (TEACH-75 part v): everything the template needs from theme v2 (TEACH-152
 * part b), the icon library (TEACH-310 part b) and picture fit (TEACH-25 part b), in one place, so
 * the template never reaches into them directly. All three are the real modules now (integration
 * of the pilot branches); this file flattens them into the names the template draws with.
 */
import type { Theme } from "@tj/domain/documents";
import { iconsLoaded, loadIcons } from "../icons/loader";
import { contrastRatio } from "../look";
import type { PictureFacts } from "../picture-fit";
import { ageProfileOf, v2Colors, v2Profile } from "../theme-v2";
import { keyStageOf, MIN_FONT_SIZE } from "../themes";
import type { SubjectBox } from "./index";

export { matchIcon, normalise } from "../icons/match";
export {
  cropFor,
  type FracRect,
  type PictureFacts,
  RES_FLOOR,
  SHAPES,
  type ShapeName,
  shapeMode,
  ZOOM_FILL,
} from "../picture-fit";

/* ------------------------------------------------------------------ */
/* Theme v2                                                            */
/* ------------------------------------------------------------------ */

export type AgeKey = "early" | "primary" | "secondary";
/** EYFS and KS1 read early, KS2 primary, KS3 to post-16 secondary (ruling 212). */
export const ageOf = (stage: string | undefined): AgeKey => ageProfileOf(stage);

/** What panel-list draws with, in slide points (960 x 540). */
export type PanelLook = {
  age: AgeKey;
  /** The layout's own ground, under the rows (TEACH-75 part ap). */
  paper: string;
  deep: string;
  onDeep: string;
  wash: string;
  rule: string;
  ink: string;
  muted: string;
  /** Ink on a category disc (a numeral when there are no icons). */
  onCategory: (fill: string) => string;
  /** On a wash disc: the numeral. */
  onWash: string;
  category: readonly string[];
  displayWeight: number;
  bodyWeight: number;
  lineHeights: { title: number; name: number; body: number };
  sizes: { titlePanel: number; name: number; body: number };
  floors: { body: number; name: number };
  comfort: { body: number; name: number };
  disc: number;
  discIcon: number;
  /**
   * A row icon's back: round ("disc"), or from KS3 a rounded square ("tile"; Greg's icon option 2,
   * 14 Oct). A row of numbers keeps its disc at every age.
   */
  medalShape: "disc" | "tile";
  radiusPicture: number;
};

const best = (fill: string, inks: string[]) =>
  inks.reduce((a, b) => (contrastRatio(b, fill) > contrastRatio(a, fill) ? b : a));

/** The look for `theme` at the key stage it is read at (`atKeyStage`); none reads primary. */
export function panelLook(theme: Theme): PanelLook {
  const p = v2Profile(theme);
  const col = v2Colors(theme);
  const c = theme.colors;
  const inks = [col.background, col.surface, c.onAccent, col.ink];
  // Never under master's reading floor (MIN_FONT_SIZE.body, ruling 140).
  const floorBody = Math.max(p.floors.body, MIN_FONT_SIZE.body);
  const floorName = Math.max(p.floors.name, MIN_FONT_SIZE.body);
  return {
    age: p.age,
    paper: col.background,
    deep: col.deep,
    onDeep: col.onDeep,
    wash: col.wash,
    rule: col.rule,
    ink: col.heading,
    muted: col.muted,
    onCategory: (fill) => best(fill, inks),
    onWash: best(col.wash, [col.deep, col.accent, col.ink]),
    category: col.category,
    displayWeight: p.displayWeight,
    bodyWeight: p.bodyWeight,
    lineHeights: { title: p.lineHeights.title, name: 1.08, body: p.lineHeights.body },
    sizes: { titlePanel: p.sizes.titlePanel, name: p.sizes.name, body: p.sizes.body },
    floors: { body: floorBody, name: floorName },
    comfort: {
      body: Math.max(p.comfort.body, floorBody),
      name: Math.max(p.comfort.name, floorName),
    },
    disc: p.disc,
    discIcon: p.discIcon,
    // Secondary medals are rounded tiles, earlier ones discs (icon option 2).
    medalShape: p.age === "secondary" ? "tile" : "disc",
    radiusPicture: p.radius.picture,
  };
}

/* ------------------------------------------------------------------ */
/* Icon library                                                        */
/* ------------------------------------------------------------------ */

/**
 * A library concept as an image `src` for a box of `boxPt`, in the theme's v2 icon slots. Until the
 * library has loaded (`../icons/loader`) it is "", the pending icon's placeholder: the medal draws
 * at its full size with no drawing in it, so nothing shifts, and the load starts for the next lay.
 */
export function iconSrc(id: string, theme: Theme, boxPt: number): string {
  const icons = iconsLoaded();
  if (!icons) {
    void loadIcons();
    return "";
  }
  const svg = icons.iconSvgForTheme(
    id,
    { colors: theme.colors, iconSlots: v2Colors(theme).icon, keyStage: keyStageOf(theme) },
    boxPt,
  );
  return svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : "";
}

/* ------------------------------------------------------------------ */
/* Picture fit                                                         */
/* ------------------------------------------------------------------ */

/** A product figure's facts: its aspect at a nominal 1000 px tall, the union of its subjects. */
export function factsOf(aspect: number, subjects?: SubjectBox[]): PictureFacts {
  const facts: PictureFacts = { width: Math.round(aspect * 1000), height: 1000 };
  if (!subjects?.length) return facts;
  const x0 = Math.min(...subjects.map((b) => b.x));
  const y0 = Math.min(...subjects.map((b) => b.y));
  const x1 = Math.max(...subjects.map((b) => b.x + b.w));
  const y1 = Math.max(...subjects.map((b) => b.y + b.h));
  return { ...facts, subject: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } };
}
