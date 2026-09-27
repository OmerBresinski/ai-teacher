import {
  SLIDE_W,
  type Slide,
  type SlideArt,
  type SlideElement,
  type Theme,
  type ThemeArtLayer,
  type ThemeArtRole,
} from "@tj/domain/documents";
import { figureGroupOf } from "./figures";
import { DIAGRAM_NAME } from "./look";

/*
 * Theme art per slide role (UX ruling 107). The title slide wears the theme's fullest art, the
 * teaching, activity and question slides a lighter variant kept to the margins, and a slide with
 * a photo or diagram only a small motif on the side away from the picture. Decoration never sits
 * behind text, a card or a picture: the layers are drawn at declared boxes, and a layer whose box
 * meets an element's is left out (`background.test.ts` checks the designed art needs no such cut
 * on any layout). The editor renderer and the PPTX export both ask `slideBackground`.
 */

export type ArtSide = "left" | "right" | "full";
export type ArtBox = { x: number; y: number; w: number; h: number };

/** Kinds whose composition is built around a picture, whatever elements they hold today. */
const PICTURE_KINDS = new Set<Slide["kind"]>(["image-text", "diagram", "image-match"]);

/** A picture spanning more than this share of the width leaves no side for a motif. */
const FULL_SHARE = 0.62;

/**
 * The boxes on a slide that hold a picture: photos and drawn figures. An undrawn diagram slot is
 * not one: outside the editor it is taken away and the words widen (`withoutDiagramSlot`), so the
 * slide wears the same art in the editor as in front of the class.
 */
function pictureBoxes(slide: Slide): ArtBox[] {
  const figure = figureGroupOf(slide);
  return slide.elements.filter(
    (e) => (e.type === "image" && e.name !== DIAGRAM_NAME) || e === figure,
  );
}

/**
 * The one place a slide's kind and slots map to an art role, and which side its picture is on
 * (TEACH-19's `slotSide` will move the slot; the side is read from where the picture actually is,
 * so the motif follows it).
 */
export function slideArtRole(slide: Slide): { role: ThemeArtRole; side?: ArtSide } {
  const boxes = pictureBoxes(slide);
  if (boxes.length > 0 || PICTURE_KINDS.has(slide.kind)) {
    if (boxes.length === 0) return { role: "picture", side: "full" };
    const x0 = Math.min(...boxes.map((b) => b.x));
    const x1 = Math.max(...boxes.map((b) => b.x + b.w));
    const side: ArtSide =
      x1 - x0 > SLIDE_W * FULL_SHARE ? "full" : (x0 + x1) / 2 < SLIDE_W / 2 ? "left" : "right";
    return { role: "picture", side };
  }
  return { role: slide.kind === "title" ? "title" : "content" };
}

/** The art a theme draws for a role, mirrored when the picture sits on the right. */
export function themeArt(
  theme: Theme,
  role: ThemeArtRole,
  side: ArtSide = "left",
): ThemeArtLayer[] {
  if (side === "full" && role === "picture") return [];
  const layers = theme.backgrounds?.[role] ?? [];
  if (role !== "picture" || side !== "right") return layers;
  return layers.map((l) => ({ ...l, image: l.flipped ?? l.image, x: SLIDE_W - l.x - l.w }));
}

const meets = (a: ArtBox, b: ArtBox) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Element boxes the art must stay clear of. Every element counts: text, cards, pictures, rules. */
export function elementBoxes(slide: Slide): ArtBox[] {
  return slide.elements.map((e: SlideElement) => ({ x: e.x, y: e.y, w: e.w, h: e.h }));
}

/** The layers of `art` that meet an element on the slide. */
export function artCollisions(art: ThemeArtLayer[], slide: Slide): ThemeArtLayer[] {
  const boxes = elementBoxes(slide);
  return art.filter((l) => boxes.some((b) => meets(l, b)));
}

/** The role a slide's art choice asks for, or null for the plain ground. */
function requested(slide: Slide): { role: ThemeArtRole; side?: ArtSide } | null {
  const choice: SlideArt = slide.background?.art ?? "auto";
  if (choice === "plain") return null;
  const auto = slideArtRole(slide);
  if (choice === "auto") return auto;
  // A forced picture motif on a slide without a picture goes on the right, as for a photo left.
  return { role: choice, side: choice === "picture" ? (auto.side ?? "left") : undefined };
}

/** The layers a slide draws: its chosen role's art, less any layer that would meet an element. */
export function slideArtLayers(theme: Theme, slide: Slide): ThemeArtLayer[] {
  const want = requested(slide);
  if (!want) return [];
  const art = themeArt(theme, want.role, want.side);
  const hit = new Set(artCollisions(art, slide));
  return art.filter((l) => !hit.has(l));
}

/** One layer as a CSS `background` layer. */
const cssLayer = (l: ThemeArtLayer) =>
  `${l.image} left ${l.x}px top ${l.y}px / ${l.w}px ${l.h}px no-repeat`;

/**
 * The theme art a slide wears, as a CSS `background` value in slide points, or undefined for the
 * plain ground. A slide's own colour or image wins outright (there must be a way off the art).
 * A theme without per-role art keeps its single `backgroundImage` on every slide.
 */
export function slideBackground(theme: Theme, slide: Slide): string | undefined {
  if (slide.background?.color || slide.background?.image) return undefined;
  if (!theme.backgrounds) {
    return slide.background?.art === "plain" ? undefined : theme.backgroundImage;
  }
  const layers = slideArtLayers(theme, slide);
  return layers.length ? layers.map(cssLayer).join(", ") : undefined;
}

/** Whether a theme has art variants a teacher can choose between. */
export const hasArtVariants = (theme: Theme): boolean =>
  !!theme.backgrounds && Object.values(theme.backgrounds).some((l) => l && l.length > 0);

/**
 * The art choices worth offering on this slide: auto, every role whose art fits the slide whole
 * (no layer would have to be left out) and differs from what auto draws, and plain.
 */
export function artChoices(theme: Theme, slide: Slide): SlideArt[] {
  if (!hasArtVariants(theme)) return [];
  const auto = slideArtRole(slide);
  const autoArt = themeArt(theme, auto.role, auto.side);
  const roles = (["title", "content", "picture"] as const).filter((role) => {
    const side = role === "picture" ? (auto.side ?? "left") : undefined;
    const art = themeArt(theme, role, side);
    return art.length > 0 && art !== autoArt && artCollisions(art, slide).length === 0;
  });
  return ["auto", ...roles, "plain"];
}
