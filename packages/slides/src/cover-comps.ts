import type {
  ImageElement,
  PathElement,
  ShapeElement,
  Slide,
  SlideElement,
  TextElement,
  Theme,
} from "@tj/domain/documents";
import { uid } from "./factories";
import { SAFE } from "./grid";
import { docPlainText } from "./sentences";
import { countLines } from "./text-measure";
import { MIN_FONT_SIZE } from "./themes";
import { hexagonPoints, innerSides, notchPoints, tornPoints } from "./themes/marks";
import { surfacesOf, titleBand } from "./themes/surfaces";

/*
 * Cover compositions (THEMING.md section 6 "cover family", round 5 `cover5.html`; TEACH-215 part
 * c rebuild). Each theme has one composition, set over the `split` title layout's parts (the
 * eyebrow, the title, the class line, the accent rule and the lesson's cover picture), so the
 * title keeps the box and line count `split` measured it at and fit never changes. Coordinates
 * are cover5.html's 1440px values over 1.5. A cover with no picture keeps its fixed fallback
 * (`look.ts` `cover`).
 *
 * - bleed (Poster): the picture full bleed, the title on a teal plate at the foot-left, the eyebrow
 *   on a yellow tab across the plate's top, the accent word in yellow.
 * - collage (Scrapbook): a torn kraft scrap, the picture in a white polaroid tilted 3° with tape,
 *   the eyebrow stamped in an outline.
 * - shape (Geometric): the picture cut to a hexagon with an offset hexagon outline, the eyebrow
 *   on an ink kicker with a cut corner.
 * - masthead (Calm): eyebrow and a hairline across the head, the title across the slide, the
 *   question under it on the left, the picture on the right, all following the title's real foot.
 * - framed (Storytime): the picture in a soft 26pt-radius frame inset from the edges.
 * - split (the dark themes) and type keep the layout as it is.
 */

const W = 960;
const H = 540;

type Parts = {
  photo: ImageElement;
  title?: TextElement;
  caption?: TextElement;
  subtitle?: TextElement;
  rule?: SlideElement;
  rest: SlideElement[];
};

function partsOf(slide: Slide): Parts | null {
  const photo = slide.elements.find(
    (e): e is ImageElement => e.type === "image" && e.name === "Photo",
  );
  if (!photo) return null;
  const texts = slide.elements.filter((e): e is TextElement => e.type === "text");
  const title = texts.find((e) => e.style.preset === "title");
  const caption = texts.find((e) => e.style.preset === "caption");
  const subtitle = texts.find((e) => e.style.preset === "subtitle" || e.name === "Subtitle");
  const rule = slide.elements.find((e) => e.name === "Accent rule");
  const used = new Set<SlideElement>([
    photo,
    ...[title, caption, subtitle, rule].filter((e) => e != null),
  ]);
  return {
    photo,
    title,
    caption,
    subtitle,
    rule,
    rest: slide.elements.filter((e) => !used.has(e)),
  };
}

const rect = (
  name: string,
  box: { x: number; y: number; w: number; h: number },
  fill: string,
  more: Partial<ShapeElement> = {},
): ShapeElement => ({
  id: uid(),
  type: "shape",
  shape: "rect",
  name,
  locked: true,
  ...box,
  fill,
  ...more,
});

const ink = (
  e: TextElement | undefined,
  color: string,
  more: Partial<TextElement["style"]> = {},
) => (e ? { ...e, style: { ...e.style, color, ...more } } : undefined);

/** Every colour mark equal to `from` set to `to` (the accent word on a plate). */
function recolour<T>(node: T, from: string, to: string): T {
  if (Array.isArray(node)) return node.map((n) => recolour(n, from, to)) as T;
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>))
    out[k] =
      k === "color" && typeof v === "string" && v.toUpperCase() === from.toUpperCase()
        ? to
        : recolour(v, from, to);
  return out as T;
}

/** The caption's laid width (its words in caps at the caption size), for a tab or stamp. */
function captionWidth(e: TextElement, t: Theme): number {
  const size = e.style.fontSize ?? t.sizes.caption;
  return Math.ceil(docPlainText(e.doc).length * size * 0.72) + 4;
}

const keep = (els: (SlideElement | undefined)[]): SlideElement[] =>
  els.filter((e): e is SlideElement => e != null);

function bleed(p: Parts, t: Theme): SlideElement[] {
  const band = titleBand(t);
  const plateFill = band?.fill ?? t.colors.ink;
  const plateInk = band?.ink ?? t.colors.background;
  const plate = { x: 0, y: 247, w: 600, h: H - 247 };
  const padX = 43;
  const sub = p.subtitle && { ...p.subtitle, x: padX, w: plate.w - 2 * padX };
  const subY = H - 37 - (sub?.h ?? 0);
  const title = p.title && {
    ...p.title,
    x: padX,
    w: plate.w - 2 * padX,
    y: Math.max(plate.y + 30, subY - 19 - p.title.h),
    doc: recolour(p.title.doc, t.colors.accent, band?.accent ?? t.colors.accent),
    style: { ...p.title.style, color: plateInk, valign: "bottom" as const },
  };
  const cap = p.caption;
  const tabH = cap ? Math.max(30, cap.h + 14) : 0;
  const tabW = cap ? captionWidth(cap, t) + 30 : 0;
  const tab = cap ? { x: padX, y: plate.y - tabH / 2, w: tabW, h: tabH } : null;
  return keep([
    { ...p.photo, x: 0, y: 0, w: W, h: H },
    rect("Cover plate", plate, plateFill),
    tab ? rect("Cover tab", tab, surfacesOf(t).roles["field-b"].fill) : undefined,
    cap && tab
      ? ink({ ...cap, x: tab.x + 15, y: tab.y + (tab.h - cap.h) / 2, w: tabW - 30 }, t.colors.ink, {
          fontWeight: 800,
        })
      : undefined,
    title,
    sub ? ink({ ...sub, y: subY }, plateInk) : undefined,
    ...p.rest,
  ]);
}

function collage(p: Parts, t: Theme): SlideElement[] {
  const s = surfacesOf(t);
  const scrap = { x: 547, y: 37, w: 360, h: 460 };
  const pol = { x: 580, y: 80, w: 293, h: 347 };
  const tilt = 3;
  const mat = 12;
  const foot = 36;
  const pic = { x: pol.x + mat, y: pol.y + mat, w: pol.w - 2 * mat, h: pol.h - mat - foot };
  // Rotate the picture's offset from the polaroid's centre with it, so the mat stays even.
  const pc = { x: pol.x + pol.w / 2, y: pol.y + pol.h / 2 };
  const off = { x: pic.x + pic.w / 2 - pc.x, y: pic.y + pic.h / 2 - pc.y };
  const a = (tilt * Math.PI) / 180;
  const rot = {
    x: off.x * Math.cos(a) - off.y * Math.sin(a),
    y: off.x * Math.sin(a) + off.y * Math.cos(a),
  };
  const picBox = { ...pic, x: pc.x + rot.x - pic.w / 2, y: pc.y + rot.y - pic.h / 2 };
  const torn: PathElement = {
    id: uid(),
    type: "path",
    name: "Cover scrap",
    locked: true,
    ...scrap,
    points: tornPoints(scrap.w, scrap.h, innerSides(scrap)),
    closed: true,
    fill: s.roles["field-b"].fill,
    strokeWidth: 0,
  };
  const cap = p.caption;
  const capW = cap ? captionWidth(cap, t) : 0;
  return keep([
    torn,
    rect("Polaroid", pol, t.colors.surface, {
      rotation: tilt,
      stroke: s.roles.card.line ?? t.colors.line,
      strokeWidth: 1,
    }),
    { ...p.photo, ...picBox, rotation: tilt, radius: 0 },
    rect("Tape", { x: pc.x - 47, y: pol.y - 11, w: 93, h: 23 }, s.marks.sticky?.fill ?? "#FFE45C", {
      rotation: -4,
      opacity: 0.75,
    }),
    cap
      ? rect("Stamp", { x: cap.x - 7, y: cap.y - 4, w: capW + 14, h: cap.h + 8 }, "transparent", {
          stroke: t.colors.accent,
          strokeWidth: 2,
        })
      : undefined,
    cap ? ink({ ...cap, w: capW + 2 }, t.colors.accent, { fontWeight: 700 }) : undefined,
    p.title,
    p.subtitle,
    ...p.rest,
  ]);
}

/**
 * The text column of a picture-beside cover, restacked on measured lines: the title at its own
 * size on the lines it really takes, the question under it in the small step on as many lines as
 * it needs (never clipped: it steps down to the floor, then the column grows into the foot room).
 * Round 5's cover question is the small body step, not the split layout's subtitle.
 */
export function coverColumn(
  p: Parts,
  t: Theme,
  width: number,
): { title?: TextElement; subtitle?: TextElement } {
  const foot = H - SAFE.y;
  // The column starts where the layout put the title (under the eyebrow) and never rises over it.
  const top0 = p.title?.y ?? (p.caption ? p.caption.y + p.caption.h + 12 : SAFE.y);
  const sub = p.subtitle;
  const words = sub ? docPlainText(sub.doc) : "";
  const lhS = t.lineHeights.small ?? 1.3;
  const subSize = t.sizes.small;
  const subH = (s: number) =>
    sub ? Math.ceil(countLines(words, "small", t, width, 400, s) * s * lhS) + 4 : 0;
  const title = p.title;
  const tSize0 = title?.style.fontSize ?? t.sizes.title;
  const tLh = title?.style.lineHeight ?? t.lineHeights.title;
  const titleH = (s: number) =>
    title
      ? Math.ceil(
          Math.max(
            1,
            countLines(docPlainText(title.doc), "title", t, width, title.style.fontWeight, s),
          ) *
            s *
            tLh,
        ) + 4
      : 0;
  // cover2's fixed title box: the size steps down to 62% (never below 56px = 37pt) before the
  // question does; the question then steps to the projector floor.
  const tFloor = Math.max(37, Math.round(tSize0 * 0.62));
  let ts = tSize0;
  let ss = subSize;
  const total = () => titleH(ts) + (sub ? 20 + subH(ss) : 0);
  while (top0 + total() > foot && ts > tFloor) ts -= 1;
  while (top0 + total() > foot && ss > Math.min(subSize, MIN_FONT_SIZE.small)) ss -= 1;
  const out: { title?: TextElement; subtitle?: TextElement } = {};
  let y = top0;
  if (title) {
    const h = titleH(ts);
    out.title = {
      ...title,
      y,
      w: width,
      h,
      // The size is only written when the ladder stepped it: an untouched title keeps its preset.
      style: { ...title.style, ...(ts === tSize0 ? {} : { fontSize: ts }), valign: "top" },
    };
    y += h;
  }
  if (sub)
    out.subtitle = {
      ...sub,
      y: y + 20,
      w: width,
      h: subH(ss),
      style: { ...sub.style, preset: "small", fontSize: ss, lineHeight: lhS, valign: "top" },
    };
  return out;
}

function hexShape(p: Parts, t: Theme): SlideElement[] {
  const hex = { x: 507, y: 71, w: 413, h: 373 };
  // cover5 `.col` is 600px (400pt) wide beside the hexagon.
  const col = coverColumn(p, t, Math.min(400, hex.x - 24 - (p.title?.x ?? SAFE.x)));
  const cap = p.caption;
  const capW = cap ? captionWidth(cap, t) : 0;
  // cover5 `.kick`: flush with the text margin, padding 12/22/12/18px, one 16px cut top right.
  const kick = cap ? { x: cap.x, y: cap.y - 5, w: capW + 27, h: cap.h + 10 } : null;
  return keep([
    {
      id: uid(),
      // Drawn as a stroked path (decoration, never a block in the overlap lint; box fractions, so
      // it mirrors for RTL).
      type: "path",
      name: "Cover outline",
      locked: true,
      x: hex.x + 20,
      y: hex.y + 20,
      w: hex.w,
      h: hex.h,
      points: hexagonPoints(),
      closed: true,
      stroke: t.colors.accent,
      strokeWidth: 2,
    } satisfies PathElement,
    { ...p.photo, ...hex, radius: 0, mask: "hexagon" },
    kick
      ? {
          id: uid(),
          type: "path",
          name: "Cover kicker",
          locked: true,
          ...kick,
          points: notchPoints(kick.w, kick.h, 10.67, "tr"),
          closed: true,
          fill: t.colors.ink,
          strokeWidth: 0,
        }
      : undefined,
    cap
      ? ink({ ...cap, x: cap.x + 12, w: capW + 2 }, t.colors.background, { fontWeight: 700 })
      : undefined,
    col.title,
    col.subtitle,
    // The photo-band variants' band backs text set on the photo; here the photo is in the hexagon.
    ...p.rest.filter((e) => e.name !== "Band"),
  ]);
}

function masthead(p: Parts, t: Theme): SlideElement[] {
  const x = SAFE.x;
  const w = W - 2 * x;
  const cap = p.caption && { ...p.caption, x, y: 48, w };
  const hr = rect("Masthead rule", { x, y: 85, w, h: 1.5 }, t.colors.line);
  let title = p.title;
  let bottom = 115;
  if (title) {
    const size = title.style.fontSize ?? t.sizes.title;
    const lh = title.style.lineHeight ?? t.lineHeights.title;
    const lines = Math.max(
      1,
      countLines(docPlainText(title.doc), "title", t, w, title.style.fontWeight, size),
    );
    const h = Math.ceil(lines * size * lh) + 4;
    title = { ...title, x, y: 115, w, h, style: { ...title.style, valign: "top" } };
    bottom = 115 + h;
  }
  // The parts below the title follow its real foot at the normal title gap (THEMING.md section 8).
  const top = Math.max(273, bottom + 24);
  const sub = p.subtitle && { ...p.subtitle, x, y: top + 6, w: 373 };
  const radius = surfacesOf(t).roles.frame.corner;
  const pic = {
    ...p.photo,
    x: 496,
    y: top,
    w: W - x - 496,
    h: Math.max(140, H - 48 - top),
    radius: typeof radius === "number" ? radius : 12,
  };
  return keep([hr, pic, cap, title, sub, ...p.rest]);
}

function framed(p: Parts, t: Theme): SlideElement[] {
  const textRight = Math.max(
    ...[p.title, p.caption, p.subtitle].filter((e) => e != null).map((e) => e.x + e.w),
    SAFE.x,
  );
  const x = Math.max(411, Math.ceil(textRight + 19));
  const inset = 32;
  const radius = 26;
  return keep([
    { ...p.photo, x, y: inset, w: W - inset - x, h: H - 2 * inset, radius },
    p.rule ? ({ ...p.rule, fill: t.colors.accent } as SlideElement) : undefined,
    ink(p.caption, t.colors.accent, { fontWeight: 700 }),
    p.title,
    p.subtitle,
    ...p.rest,
  ]);
}

/** A cover with a picture in the theme's composition; the slide as it was when it has none. */
export function composeCover(slide: Slide, t: Theme): Slide {
  const p = partsOf(slide);
  if (!p) return slide;
  const comp = surfacesOf(t).marks.cover;
  const elements =
    comp === "bleed"
      ? bleed(p, t)
      : comp === "collage"
        ? collage(p, t)
        : comp === "shape"
          ? hexShape(p, t)
          : comp === "masthead"
            ? masthead(p, t)
            : comp === "framed"
              ? framed(p, t)
              : null;
  return elements ? { ...slide, elements } : slide;
}
