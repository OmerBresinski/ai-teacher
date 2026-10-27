/**
 * The figure slide (TEACH-239 part b, layout pilot C7; rulings 155, 180, 205, 229). Ported from the
 * pilot's `northstars-v13/figure/slide.html`, winner A "open stage": one figure fills the slide.
 *
 * - **Title** at the heading's place, one line (a second line takes the figure's room: flagged).
 *   The accent word is the one use of red.
 * - **Stage:** from 27 under the title (40 at 1440) to the foot, the gutter's width. The figure (a
 *   library model or one photo) is as large as its shape allows, centred across, and the free space
 *   above and below is split 40/60 so a wide figure stays near its title. No plate, card or frame:
 *   the model's own ground reads as the figure's ground.
 * - **Caption:** optional, one line in muted type (the scale's small step, the gold's body size), 16 under the figure (24 at 1440), at the
 *   gutter's left edge (the title's). It is a static element: it stays the same across the model's
 *   builds. Over one line it is flagged for repair (`over`, and `fields` over its cap): never
 *   wrapped to fit, never shrunk, never cut.
 * - **No figure** (the model failed and no picture took its place): the stage becomes a sand plate
 *   the figure's size with the topic's library icon in the age's medal (a disc on a halo at KS1-2, a
 *   quiet tile from KS3). With no icon either the plate is flagged, never left silently empty.
 *
 * Geometry is on the 960 x 540 grid (the pilot's px at 1440 x 2/3). The model keeps its own labels,
 * restyled into the slide's voice and body face by `restyleModelSvg` (steps-model, shared).
 */
import type { ImageElement, RichDoc, ShapeElement, TextElement } from "@tj/domain/documents";
import { styledRun } from "@tj/domain/documents";
import { uid } from "../factories";
import { FONT_STACKS } from "../fonts";
import { iconsLoaded, loadIcons } from "../icons/loader";
import FIGURE_CAPACITY from "./figure-capacity.json" with { type: "json" };
import {
  FIGURE_CAPTION_CAP,
  FIGURE_CAPTION_LINES,
  FIGURE_CAPTION_TWO_LINE_FITS,
  FIGURE_MIN_H,
  FIGURE_TOO_SMALL,
} from "./figure-rules";
import {
  type Ctx,
  type FieldReport,
  type Figure,
  G,
  kit,
  type Stage,
  type TemplateInput,
} from "./index";
import { iconImage, resolveIcons, v2Colors } from "./items-row-deps";
import { restyleModelSvg } from "./steps-model";

export type FigureAge = keyof typeof FIGURE_CAPTION_CAP;
export const figureAge = (stage: Stage): FigureAge =>
  stage === "ks1" ? "early" : stage === "ks2" ? "primary" : "secondary";

/** Title to stage (40 at 1440), figure to caption (24), the stage's foot (56 above the edge). */
export const FIGURE_GAP = 27;
export const FIGURE_CAPTION_GAP = 16;
export const FIGURE_FOOT = 540 - 37;
/** The share of the free height above the figure (the rest is below): 40/60. */
export const FIGURE_TOP_SHARE = 0.4;
/** A portrait photo is cropped to 3:4 at most, so it stays a picture, not a strip. */
const PHOTO_MIN_ASPECT = 0.75;
/** The plate's medal (240 at 1440) and its drawing's share of the face. */
const MEDAL = 160;
/**
 * The caption's role: the scale's small step, the size the gold's muted body is at 1440 (as the
 * steps-model do line); master's body step is a size larger and holds fewer characters a line.
 */
const CAPTION_ROLE = "small" as const;
const HALO = 10;
const TILE_RADIUS = 0.2;

export const FIGURE_NAMES = {
  title: "Heading",
  model: "Diagram",
  photo: "Photo",
  caption: "Caption",
  plate: "Figure plate",
  halo: "Medal halo",
  medal: "Circle",
  icon: "Icon",
} as const;

/** The caption's measured one-line fit (characters) per age, at the drawn size on every theme. */
export const FIGURE_CAPTION_FITS = FIGURE_CAPACITY as Record<FigureAge, number>;

const isModel = (f: Figure | undefined): f is Extract<Figure, { drawn: unknown }> =>
  !!f && "drawn" in f;
const isPhoto = (f: Figure | undefined): f is Extract<Figure, { photo: string }> =>
  !!f && "photo" in f && !!f.photo;

/**
 * KS1 labels in Andika (the infant a and g; gold finding 2): the page's own "Andika" face, named
 * first so the display and export helpers embed it into the drawing, then the stack's fallbacks.
 */
const KS1_LABEL_FACE = `"Andika", ${FONT_STACKS.andika}`;
/** The theme the model's labels are restyled in: the slide's body face, Andika at KS1. */
const labelTheme = (c: Ctx, stage: Stage): Ctx["t"] =>
  stage === "ks1" ? { ...c.t, fonts: { ...c.t.fonts, body: KS1_LABEL_FACE } } : c.t;

/** The heading's words with `word` in the accent when it is an exact substring (theme role). */
function accentDoc(heading: string, word: string | null | undefined, accent: string): RichDoc {
  const w = word?.trim();
  const at = w ? heading.indexOf(w) : -1;
  const parts =
    w && at >= 0
      ? [
          styledRun(heading.slice(0, at), {}),
          styledRun(w, { color: accent }),
          styledRun(heading.slice(at + w.length), {}),
        ]
      : [styledRun(heading, {})];
  return {
    type: "doc",
    content: [{ type: "paragraph", content: parts.filter((r) => "text" in r && r.text) }],
  } as RichDoc;
}

/** The figure's box in the stage: its own shape, as large as fits, centred, 40/60 free space. */
export function figureBox(
  stage: { x: number; y: number; w: number; h: number },
  aspect: number,
): { x: number; y: number; w: number; h: number } {
  let w = stage.w;
  let h = w / aspect;
  if (h > stage.h) {
    h = stage.h;
    w = h * aspect;
  }
  const free = stage.h - h;
  return {
    x: Math.round(stage.x + (stage.w - w) / 2),
    y: Math.round(stage.y + free * FIGURE_TOP_SHARE),
    w: Math.round(w),
    h: Math.round(h),
  };
}

/**
 * The caption's field report: its length against the measured two-line fit (TEACH-247 part bi);
 * past one line (the writer's per-line cap) it is tight, past two lines over.
 */
function captionField(caption: string, age: FigureAge, lines: number): FieldReport {
  const hardMax = FIGURE_CAPTION_TWO_LINE_FITS[age] ?? 0;
  const cap = Math.min(FIGURE_CAPTION_CAP[age], FIGURE_CAPTION_FITS[age] ?? 0, hardMax);
  const chars = caption.length;
  // A 0 cap is over for any caption, never "no cap"; a caption over two lines is over, whatever its count.
  const over = chars > hardMax || lines > FIGURE_CAPTION_LINES;
  return { field: "Caption", path: "lead", chars, cap, hardMax, tight: chars > cap, over };
}

/** The plate's medal: the topic's icon on the age's face (a disc on a halo, or a tile from KS3). */
function plateMedal(
  c: Ctx,
  concept: string,
  alt: string,
  cx: number,
  cy: number,
  d: number,
  tile: boolean,
  age: FigureAge,
) {
  const col = v2Colors(c.t);
  const x = Math.round(cx - d / 2);
  const y = Math.round(cy - d / 2);
  if (tile) {
    // From KS3 a quiet rounded tile (the items row's tile): the surface face, the drawing at 72%.
    c.els.push({
      id: uid(),
      type: "shape",
      shape: "rounded",
      x,
      y,
      w: d,
      h: d,
      fill: col.surface,
      radius: Math.round(d * TILE_RADIUS),
      name: FIGURE_NAMES.medal,
    } as ShapeElement);
    const g = Math.round(d * 0.72);
    const image = iconImage(
      concept,
      c.t,
      { x: Math.round(cx - g / 2), y: Math.round(cy - g / 2), w: g, h: g },
      col.accent,
      FIGURE_NAMES.icon,
      alt,
    );
    if (image.src) c.els.push(image);
    return;
  }
  // KS1-2: a paper halo, then the shared icon medal (TEACH-310 part c) with the theme's medal tokens.
  c.els.push({
    id: uid(),
    type: "shape",
    shape: "ellipse",
    x: x - HALO,
    y: y - HALO,
    w: d + 2 * HALO,
    h: d + 2 * HALO,
    fill: col.background,
    name: FIGURE_NAMES.halo,
  } as ShapeElement);
  // The medal is drawn by the lazily loaded icon library; before it loads, the face alone.
  const icons = iconsLoaded();
  if (!icons) void loadIcons();
  const src = icons
    ? icons.iconMedalImageSrc(concept, {
        medal: icons.medalColoursFor({
          dark: !!(c.t as { dark?: boolean }).dark,
          colors: c.t.colors,
        }),
        colours: col.icon,
        age,
      } as never)
    : "";
  if (src)
    c.els.push({
      id: uid(),
      type: "image",
      x,
      y,
      w: d,
      h: d,
      src,
      alt,
      fit: "contain",
      radius: Math.round(d / 2),
      name: FIGURE_NAMES.icon,
    } as ImageElement);
  else
    c.els.push({
      id: uid(),
      type: "shape",
      shape: "ellipse",
      x,
      y,
      w: d,
      h: d,
      fill: col.surface,
      name: FIGURE_NAMES.medal,
    } as ShapeElement);
}

/** The longest run of the caption's words that, with an ellipsis, stays within `n` lines. */
function withinLines(c: Ctx, caption: string, n: number): string {
  const words = caption.split(/\s+/);
  const lineH = c.s[CAPTION_ROLE] * kit.LH[CAPTION_ROLE];
  let lo = 1;
  let hi = words.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const t = `${words.slice(0, mid).join(" ")}…`;
    if (Math.round(kit.measure(c, t, CAPTION_ROLE, G.width) / lineH) <= n) lo = mid;
    else hi = mid - 1;
  }
  return `${words
    .slice(0, lo)
    .join(" ")
    .replace(/[,;:.]$/, "")}…`;
}

/** Lays the figure slide: title, the stage's one figure (or its plate), the caption. */
export function layoutFigure(c: Ctx, input: TemplateInput, stage: Stage) {
  // Laid from the measured heading down: the body band is not moved under a taller heading.
  c.bodyFromHeading = true;
  const age = figureAge(stage);
  const title = kit.heading(c, input.heading) as TextElement;
  if (input.accentWord) title.doc = accentDoc(input.heading, input.accentWord, c.t.colors.accent);
  const titleLines = Math.round(title.h / (c.s.heading * kit.LH.heading));
  if (titleLines > 1) c.over.push("figure title over one line");
  const top = title.y + title.h + FIGURE_GAP;
  // One wrapping paragraph: the writer's two lines of facts may come with a line break.
  const caption = (input.lead ?? "").replace(/\s+/g, " ").trim();
  const lineH = c.s[CAPTION_ROLE] * kit.LH[CAPTION_ROLE];
  const capLine = Math.ceil(lineH);
  const capH = caption ? kit.measure(c, caption, CAPTION_ROLE, G.width) : 0;
  const capLines = caption ? Math.round(capH / lineH) : 0;
  // The stage leaves the caption's lines, two at most (TEACH-247 part bi): a one-line caption keeps
  // the figure's old room, and a longer caption is flagged, never given more.
  const shownLines = Math.min(Math.max(capLines, 1), FIGURE_CAPTION_LINES);
  const st: { x: number; y: number; w: number; h: number } = {
    x: G.margin,
    y: top,
    w: G.width,
    h: Math.round(FIGURE_FOOT - (caption ? shownLines * capLine + FIGURE_CAPTION_GAP : 0) - top),
  };
  // The figure keeps its least height: a second caption line that would take it under is flagged,
  // and the writer's route sends the slide to the big layout (materialise).
  if (shownLines > 1 && st.h < FIGURE_MIN_H) c.over.push(FIGURE_TOO_SMALL);
  const f = input.figure;
  let box = st;
  if (isModel(f)) {
    box = figureBox(st, f.drawn.aspect || st.w / st.h);
    c.els.push({
      id: uid(),
      type: "image",
      name: FIGURE_NAMES.model,
      ...box,
      src: restyleModelSvg(f.drawn.src, labelTheme(c, stage)),
      alt: f.drawn.alt ?? "",
      fit: "contain",
      ...(f.drawn.source ? { diagram: f.drawn.source } : {}),
    } as ImageElement);
  } else if (isPhoto(f)) {
    const a = f.aspect ?? 4 / 3;
    box = figureBox(st, Math.max(PHOTO_MIN_ASPECT, a));
    if (a < PHOTO_MIN_ASPECT) {
      // A very tall photo is shown whole on the figure's sand plate (no blind crop), held at 3:4.
      kit.box(c, box, v2Colors(c.t).sand, { name: FIGURE_NAMES.plate, radius: c.t.radius });
      kit.photoBox(c, f, box, false);
    } else kit.photoBox(c, f, box);
  } else {
    // No figure: a sand plate the stage's size, the topic's icon in the age's medal at its centre.
    kit.box(c, st, v2Colors(c.t).sand, { name: FIGURE_NAMES.plate, radius: c.t.radius });
    const label = input.icon?.trim() ?? "";
    const concept = label ? resolveIcons([label]).ids[0] : null;
    if (label && !concept) c.iconMisses = [...(c.iconMisses ?? []), label];
    if (concept) {
      const d = Math.min(MEDAL, Math.round(st.h * 0.6));
      plateMedal(c, concept, label, st.x + st.w / 2, st.y + st.h / 2, d, age === "secondary", age);
    } else c.over.push("figure has no drawing and no icon");
  }
  if (caption) {
    // Over two lines the caption is flagged for repair; meanwhile it shows as two lines cut at a
    // word with an ellipsis (never three, never smaller). The full words stay in the field report.
    const over = capLines > FIGURE_CAPTION_LINES;
    const shown = over ? withinLines(c, caption, FIGURE_CAPTION_LINES) : caption;
    kit.text(
      c,
      shown,
      CAPTION_ROLE,
      { x: G.margin, y: box.y + box.h + FIGURE_CAPTION_GAP, w: G.width },
      { color: c.t.colors.muted, name: FIGURE_NAMES.caption },
    );
    if (over) c.over.push("figure caption over two lines");
    c.fields = [...(c.fields ?? []), captionField(caption, age, capLines)];
  }
}
