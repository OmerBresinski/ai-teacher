import {
  type ImageElement,
  type PathElement,
  type RichDoc,
  type ShapeElement,
  type Slide,
  type SlideElement,
  styledRun,
  type TextElement,
  type Theme,
} from "@tj/domain/documents";
import { uid } from "./factories";
import { SAFE } from "./grid";
import { coverType } from "./layout-sizes";
import { layoutSlide } from "./layouts";
import { coverColours } from "./look";
import { docPlainText } from "./sentences";
import { countLines, runWidth } from "./text-measure";
import { resolveTextStyle } from "./text-style";
import { fontFloor, THEMES } from "./themes";
import { hexagonPoints, innerSides, notchPoints, tornPoints } from "./themes/marks";
import { isClear, SURFACE_TOKEN_SETS, surfacesOf, titleBand } from "./themes/surfaces";

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
 * - split (round 5 `prod-split` for the light prod themes and the darks, Paper's `split`, Beacon's
 *   `beacon`; TEACH-215 part g): the theme's ground, the picture as `cover-photo` says.
 * - type keeps the layout as it is.
 * A picture-failed cover takes the theme's `cover-fallback` (`composeCoverFallback`).
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
  return { ...textParts(slide), photo };
}

/** The cover's text parts, with or without a picture (the picture-failed cover has none). */
function textParts(slide: Slide): Omit<Parts, "photo"> {
  const photo = slide.elements.find(
    (e): e is ImageElement => e.type === "image" && e.name === "Photo",
  );
  const texts = slide.elements.filter((e): e is TextElement => e.type === "text");
  const title = texts.find((e) => e.style.preset === "title");
  const caption = texts.find((e) => e.style.preset === "caption");
  const subtitle = texts.find((e) => e.style.preset === "subtitle" || e.name === "Subtitle");
  const rule = slide.elements.find((e) => e.name === "Accent rule");
  const used = new Set<SlideElement>(
    [photo, title, caption, subtitle, rule].filter((e) => e != null),
  );
  return {
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
  // cover5 `.plate`: padding 64/64/56px, the stack on its foot; the title over at most two lines
  // (`--tlines: 2`) 28px over the question, sized by `coverColumn` at the plate's measure.
  const tPad = typeof p.title?.style.padding === "number" ? p.title.style.padding : 0;
  const col = coverColumn(
    { ...p, caption: undefined, title: p.title && { ...p.title, y: 0 } },
    t,
    plate.w - 2 * padX + 2 * tPad,
    {
      gap: 18.67,
      lines: 2,
      foot: H - SAFE.y - (plate.y + 30),
      shrink: true,
      subWidth: plate.w - 2 * padX,
    },
  );
  const foot = H - SAFE.y;
  const colH = col.subtitle ? col.subtitle.y + col.subtitle.h - tPad : (col.title?.h ?? 0) - tPad;
  const tabRoom = p.caption ? Math.max(30, p.caption.h + 14) : 0;
  let top = Math.max(plate.y + 30 + tabRoom, foot - colH) - tPad;
  // A column taller than the plate's room (a long question) takes the plate up with it.
  if (top + colH + tPad > foot) {
    const lift = top + colH + tPad - foot;
    plate.y = Math.max(SAFE.y, plate.y - lift);
    plate.h = H - plate.y;
    top = Math.max(plate.y + 30 + tabRoom, foot - colH) - tPad;
  }
  const sub = col.subtitle && {
    ...col.subtitle,
    x: padX,
    y: top + col.subtitle.y,
  };
  const title = col.title && {
    ...col.title,
    x: padX - tPad,
    y: top,
    doc: recolour(col.title.doc, t.colors.accent, band?.accent ?? t.colors.accent),
    // On its foot, so a title grown in the editor rises up the plate (`growFixedText`).
    style: { ...col.title.style, color: plateInk, valign: "bottom" as const },
  };
  const cap = p.caption;
  const tabH = cap ? Math.max(30, cap.h + 14) : 0;
  const tabW = cap ? captionWidth(cap, t) + 30 : 0;
  // cover5 straddles the plate's top edge with the tab; here it sits just inside it, so the tab
  // and its words are wholly on the plate (a part-overlap is a collision in the layout lint).
  const tab = cap ? { x: padX, y: plate.y, w: tabW, h: tabH } : null;
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
    sub ? ink(sub, plateInk) : undefined,
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
  /** The composition's own spacing: the title's drop under the eyebrow and the question's gap. */
  space: {
    drop?: number;
    gap?: number;
    lines?: number;
    foot?: number;
    /** A question past the cap steps down (1pt, to the type floor) until the column fits. */
    shrink?: boolean;
    /** The question's own measure when it is not the title's padded box (default `width`). */
    subWidth?: number;
  } = {},
): { title?: TextElement; subtitle?: TextElement } {
  const foot = space.foot ?? H - SAFE.y;
  // The column starts where the layout put the title (under the eyebrow) and never rises over it.
  const top0 =
    (p.title?.y ?? (p.caption ? p.caption.y + p.caption.h + 12 : SAFE.y)) + (space.drop ?? 0);
  const gap = space.gap ?? 20;
  const sub = p.subtitle;
  const words = sub ? docPlainText(sub.doc) : "";
  // The gold's cover type (ruling 21 A, `layout-sizes.ts`): the question at the stage's reading
  // floor, the title down its own ladder (top to floor in fixed steps) until the column fits and the
  // title holds the gold's line count. Both are drawn at exactly these sizes (`fixedSize`).
  const cv = coverType(t);
  const lhS = cv.questionLineHeight;
  let ss = cv.question;
  const subW = space.subWidth ?? width;
  const subH = (s: number) =>
    sub ? Math.ceil(countLines(words, "small", t, subW, 400, s) * s * lhS) + 4 : 0;
  const title = p.title;
  const tLh = cv.titleLineHeight;
  // A padded title (the template's ink margin, TEACH-152 part b) wraps inside its padding.
  const tPad = typeof title?.style.padding === "number" ? title.style.padding : 0;
  const lines = (s: number) =>
    title
      ? Math.max(
          1,
          countLines(
            docPlainText(title.doc),
            "title",
            t,
            width - 2 * tPad,
            title.style.fontWeight,
            s,
          ),
        )
      : 0;
  const titleH = (s: number) => (title ? Math.ceil(lines(s) * s * tLh) + 4 + 2 * tPad : 0);
  let ts = cv.title;
  const total = () => titleH(ts) + (sub ? gap + subH(ss) : 0);
  const maxLines = space.lines ?? cv.titleLines;
  while ((top0 + total() > foot || lines(ts) > maxLines) && ts - cv.titleStep >= cv.titleFloor)
    ts -= cv.titleStep;
  // A question a teacher made longer than the cap steps down rather than run off the slide (the
  // base cover grows its box; here it grows too, but never past the foot while a smaller step fits).
  if (space.shrink) while (top0 + total() > foot && ss - 1 >= fontFloor("body")) ss -= 1;
  // A column too tall for the gold's spacing even at the title floor closes up to the split stack.
  if ((space.drop || space.gap) && top0 + total() > foot)
    return coverColumn(p, t, width, {
      lines: space.lines,
      foot: space.foot,
      shrink: space.shrink,
      subWidth: space.subWidth,
    });
  const out: { title?: TextElement; subtitle?: TextElement } = {};
  let y = top0;
  if (title) {
    const h = titleH(ts);
    out.title = {
      ...title,
      y,
      w: width,
      h,
      style: { ...title.style, fontSize: ts, lineHeight: tLh, fixedSize: true, valign: "top" },
    };
    y += h;
  }
  if (sub)
    out.subtitle = {
      ...sub,
      y: y + gap,
      w: subW,
      h: subH(ss),
      style: {
        ...sub.style,
        preset: "small",
        fontSize: ss,
        lineHeight: lhS,
        fixedSize: true,
        valign: "top",
      },
    };
  return out;
}

/**
 * The split layout's caption and title boxes. The hexagon cover replaces whichever picture
 * variant it is given (split, photo-band, photo-band-long), so its column starts where the split
 * starts it (cover5 `.col`), not low in a band variant's photo band.
 */
function splitColumn(p: Parts, t: Theme): Parts {
  const split = layoutSlide("title", t.id, "split");
  const at = (preset: string) =>
    split.elements.find((e): e is TextElement => e.type === "text" && e.style.preset === preset);
  const move = (e: TextElement | undefined, to: TextElement | undefined) =>
    e && to ? { ...e, x: to.x, y: to.y, w: to.w, h: to.h } : e;
  return { ...p, caption: move(p.caption, at("caption")), title: move(p.title, at("title")) };
}

function hexShape(p0: Parts, t: Theme): SlideElement[] {
  const p = splitColumn(p0, t);
  const hex = { x: 507, y: 71, w: 413, h: 373 };
  // cover5 `.col` is 600px (400pt) wide beside the hexagon.
  // The gold's shape comp (cover5.html): the title 34px under the plate, the question 64px under
  // the title, measured on the gold's ink as 18pt and 38pt over the split layout's stack.
  const col = coverColumn(p, t, Math.min(400, hex.x - 24 - (p.title?.x ?? SAFE.x)), {
    drop: 18,
    gap: 38,
  });
  const cap = p.caption;
  // A theme's own kicker tracking (Geometric 0.10em) widens the caption by the extra per letter.
  const kTrack = surfacesOf(t).marks.kickerTracking;
  // The plate hugs the kicker's real width: its face's advances, 700, uppercase, tracked. The
  // kicker's middle dot (U+00B7) is outside the advance tables and fell back to an average letter,
  // 18px too wide at 1440 (Greg 17 Oct, item 23); in Lexend it is as wide as a full stop, so it is
  // measured as one (checked in Chromium: both strings 309.4px).
  const capW = cap
    ? Math.ceil(
        runWidth(
          docPlainText(cap.doc)
            .toUpperCase()
            .replace(/\u00B7/g, "."),
          resolveTextStyle({ ...cap.style, fontWeight: 700 }, t).fontFamily,
          700,
          cap.style.fontSize ?? t.sizes.caption,
          Number.parseFloat(kTrack ?? "0.08"),
        ) + 2,
      )
    : 0;
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
      // cover5 `.hexo` draws its 3px line inside its 620×560 box: the path is inset by half
      // the 2pt stroke, so the line's outer edge is the box's.
      x: hex.x + 20 + 1,
      y: hex.y + 20 + 1,
      w: hex.w - 2,
      h: hex.h - 2,
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
      ? ink({ ...cap, x: cap.x + 12, w: capW + 2 }, t.colors.background, {
          fontWeight: 700,
          ...(kTrack ? { letterSpacing: kTrack } : {}),
        })
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
  // cover5 masthead: one title across at the gold's size (ruling 21 A), over at most two lines.
  const tPad = typeof p.title?.style.padding === "number" ? p.title.style.padding : 0;
  const sized = coverColumn(
    {
      ...p,
      caption: undefined,
      subtitle: undefined,
      title: p.title && { ...p.title, y: 115 - tPad },
    },
    t,
    w + 2 * tPad,
    { lines: 2 },
  ).title;
  const title = sized && { ...sized, x: x - tPad };
  const bottom = title ? title.y + title.h - tPad : 115;
  // The parts below the title follow its real foot at the normal title gap (THEMING.md section 8).
  const top = Math.min(Math.max(273, bottom + 24), H - SAFE.y - 140);
  // The question at the cover's size on the lines it really takes; one a teacher made longer than
  // the cap steps down (1pt, to the type floor) rather than run past the foot.
  const cv = coverType(t);
  // With no picture block (the picture-failed cover) the question takes the room it leaves, so the
  // cover's no-picture cap (`cover-capacity.json`) still holds two lines.
  const qW = p.photo.id === "ghost" ? w : 373;
  const words = p.subtitle ? docPlainText(p.subtitle.doc) : "";
  const qh = (s: number) =>
    Math.ceil(countLines(words, "small", t, qW, 400, s) * s * cv.questionLineHeight) + 4;
  let qs = cv.question;
  while (top + 6 + qh(qs) > H - SAFE.y && qs - 1 >= fontFloor("body")) qs -= 1;
  const sub = p.subtitle && {
    ...p.subtitle,
    x,
    y: top + 6,
    w: qW,
    h: qh(qs),
    style: {
      ...p.subtitle.style,
      preset: "small" as const,
      fontSize: qs,
      lineHeight: cv.questionLineHeight,
      fixedSize: true,
      valign: "top" as const,
    },
  };
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

/* ---------------------------------------------------------------- round 5 split family */

/** A theme's own cover token (tokens.json `cover-photo`, `cover-fallback`), or undefined. */
const coverToken = (t: Pick<Theme, "id">, key: string): string | undefined =>
  SURFACE_TOKEN_SETS[t.id]?.[key];

/** The cover title's accent word: the theme's `title-accent` (cover5 `.title em`), else its accent. */
export function coverAccent(t: Theme): string {
  const k = coverToken(t, "title-accent");
  return k && !isClear(k) ? k : t.colors.accent;
}

/** The title's words with `word` in `colour` when it is an exact substring (cover5 `<em>`). */
export function coverTitleDoc(heading: string, word: string | null | undefined, colour: string) {
  const w = word?.trim();
  const at = w ? heading.indexOf(w) : -1;
  const runs =
    w && at >= 0
      ? [
          styledRun(heading.slice(0, at), {}),
          styledRun(w, { color: colour }),
          styledRun(heading.slice(at + w.length), {}),
        ]
      : [styledRun(heading, {})];
  return {
    type: "doc",
    content: [{ type: "paragraph", content: runs.filter((r) => "text" in r && r.text) }],
  } as RichDoc;
}

const titleInkOf = (t: Theme): string => {
  const k = coverToken(t, "title-ink");
  return k && !isClear(k) ? k : t.colors.ink;
};

/** A cover's text column: the room it is centred in, its rule, gaps and inks (cover5 `.col`). */
type Column = {
  x: number;
  w: number;
  top: number;
  bottom: number;
  /** The most lines the title may take (the comp's `--tlines`). */
  lines: number;
  /** cover5 prod `.rule`: a short accent bar above the eyebrow, and the gap under it. */
  rule?: { w: number; h: number; gap: number; fill: string };
  /** The eyebrow's foot to the title's ink, and the title's foot to the question. */
  capGap: number;
  qGap: number;
  ink: { cap: string; title: string; q: string; accent: string };
};

/**
 * The title stack (rule, eyebrow, title, question) centred in its room, as cover5's flex `.col`.
 * The title is sized by `coverColumn` (ruling 21 A sizes, the comp's width and line count).
 */
function column(p: Omit<Parts, "photo">, t: Theme, o: Column): SlideElement[] {
  const t0 = p.title;
  const tPad = typeof t0?.style.padding === "number" ? t0.style.padding : 0;
  const cap = p.caption;
  const head =
    (o.rule ? o.rule.h + o.rule.gap : 0) + (cap ? cap.h : 0) + (o.rule || cap ? o.capGap : 0);
  const sized = coverColumn(
    { ...p, caption: undefined, title: t0 && { ...t0, y: 0 } } as Parts,
    t,
    o.w + 2 * tPad,
    { gap: o.qGap, lines: o.lines, foot: o.bottom - o.top - head, shrink: true, subWidth: o.w },
  );
  const tt = sized.title;
  const sub = sized.subtitle;
  const body = sub ? sub.y + sub.h - tPad : tt ? tt.h - 2 * tPad : 0;
  // Centred in its room; a column taller than the room starts at the safe area's top, never above.
  const y0 = Math.round(
    Math.max(
      Math.min(o.top + (o.bottom - o.top - head - body) / 2, H - SAFE.y - head - body),
      Math.max(o.top, SAFE.y),
    ),
  );
  let y = y0;
  const out: SlideElement[] = [];
  if (o.rule) {
    out.push(rect("Accent rule", { x: o.x, y, w: o.rule.w, h: o.rule.h }, o.rule.fill));
    y += o.rule.h + o.rule.gap;
  }
  if (cap) {
    out.push(ink({ ...cap, x: o.x, y, w: o.w }, o.ink.cap, { fontWeight: 700 }) as TextElement);
    y += cap.h;
  }
  if (o.rule || cap) y += o.capGap;
  const ty = y - tPad;
  if (tt)
    out.push({
      ...tt,
      x: o.x - tPad,
      y: ty,
      doc: recolour(tt.doc, t.colors.accent, o.ink.accent),
      // A fixed box (as over a question), so a title a teacher lengthens steps down inside it.
      style: { ...tt.style, color: o.ink.title, autoHeight: false },
    });
  if (sub) out.push({ ...sub, x: o.x, y: ty + sub.y, style: { ...sub.style, color: o.ink.q } });
  return out;
}

/**
 * split (round 5 `prod-split`, Paper's `split`, Beacon's `beacon`), on the theme's own ground: the
 * picture as the theme's `cover-photo` says.
 * - right-half: the photograph bleeds over the right half; rule, eyebrow and title centred left
 *   on the theme's title art (cover5 `prod-split`: col 87px left, 604px wide, photo from 720px).
 * - panel (Paper): a sand field from 880px with the picture framed in it, 64/150px in.
 * - band (Beacon): the picture across the top 372px, a 10px ink bar, the title across below.
 */
function split(p0: Parts, t: Theme): SlideElement[] {
  // The photo-band variants' band backs text set on the photo; here the text is on the ground.
  const p = { ...p0, rest: p0.rest.filter((e) => e.name !== "Band") };
  const s = surfacesOf(t);
  const muted = s.titleMuted;
  const kind = coverToken(t, "cover-photo");
  const ruleOf = { w: 66.67, h: 4, gap: 20, fill: t.colors.accent };
  if (kind === "panel") {
    const side = { x: 586.67, y: 0, w: W - 586.67, h: H };
    const corner = s.roles.frame.corner;
    return keep([
      rect("Cover field", side, s.roles["field-b"].fill),
      {
        ...p.photo,
        x: side.x + 42.67,
        y: 100,
        w: side.w - 85.33,
        h: H - 200,
        radius: typeof corner === "number" ? corner : 0,
      },
      ...column(p, t, {
        x: 64,
        w: 474.67,
        top: 0,
        bottom: H,
        lines: 3,
        capGap: 21.33,
        qGap: 26.67,
        ink: { cap: t.colors.accent, title: titleInkOf(t), q: muted, accent: coverAccent(t) },
      }),
      ...p.rest,
    ]);
  }
  if (kind === "band") {
    return keep([
      { ...p.photo, x: 0, y: 0, w: W, h: 248, radius: 0 },
      rect("Cover bar", { x: 0, y: 248, w: W, h: 6.67 }, t.colors.ink),
      ...column(p, t, {
        x: 64,
        w: W - 128,
        top: 254.67,
        bottom: H - 20,
        lines: 2,
        capGap: 12,
        qGap: 14.67,
        ink: { cap: t.colors.accent, title: t.colors.ink, q: muted, accent: t.colors.accent },
      }),
      ...p.rest,
    ]);
  }
  return keep([
    { ...p.photo, x: W / 2, y: 0, w: W / 2, h: H, radius: 0 },
    ...column(p, t, {
      x: SAFE.x,
      w: 402.67,
      top: 0,
      bottom: H,
      lines: 3,
      rule: ruleOf,
      capGap: 12,
      qGap: 17.33,
      ink: { cap: muted, title: titleInkOf(t), q: muted, accent: coverAccent(t) },
    }),
    ...p.rest,
  ]);
}

/**
 * The picture-failed cover in the theme's own fallback (themes5.json `coverFallback`, tokens.json
 * `cover-fallback`), or null to keep the plain title card:
 * - title (cover5 `prod-title`): the theme's ground and title art, rule, eyebrow and the title
 *   across 1150px in two lines; `plain` the same without the rule.
 * - masthead (Calm): the masthead without its picture block.
 * - type (Poster): the sand ground, the title stack left, the title band's colour block right.
 * The golds' icon trio (magma, lava, ash) needs icon names the title input does not carry yet; see
 * the lane log. Returns the elements and the slide's background.
 */
export const hasCoverFallback = (t: Pick<Theme, "id">): boolean =>
  !!coverToken(t, "cover-fallback");

export function composeCoverFallback(
  slide: Slide,
  t: Theme,
): { elements: SlideElement[]; background: Slide["background"] } | null {
  const kind = coverToken(t, "cover-fallback");
  if (!kind || slide.elements.some((e) => e.type === "image")) return null;
  const p = textParts(slide);
  const muted = surfacesOf(t).titleMuted;
  if (kind === "masthead") {
    const ghost = { id: "ghost" } as ImageElement;
    return {
      elements: masthead({ ...p, photo: ghost }, t).filter((e) => e !== ghost && e.id !== "ghost"),
      background: {},
    };
  }
  if (kind === "type") {
    const band = titleBand(t);
    return {
      elements: keep([
        // cover5 `.block`: 400px (267pt) of the title band's colour on the right; 232pt here, 24pt
        // clear of the wider column.
        rect("Cover block", { x: 728, y: 0, w: W - 728, h: H }, band?.fill ?? t.colors.ink),
        ...column(p, t, {
          // cover5 `.col` is 820px (547pt); here 640pt, the plain cover's column, so the cover's
          // no-picture cap (`cover-capacity.json`) holds three lines at the floor in Poster's face.
          x: 64,
          w: 640,
          top: 42.67,
          bottom: H - 52,
          lines: 3,
          capGap: 24,
          qGap: 24,
          ink: { cap: t.colors.ink, title: t.colors.ink, q: t.colors.ink, accent: t.colors.accent },
        }),
        ...p.rest,
      ]),
      background: { color: coverToken(t, "sand") ?? t.colors.background },
    };
  }
  return {
    elements: keep([
      ...column(p, t, {
        x: SAFE.x,
        w: 766.67,
        top: 0,
        bottom: H,
        lines: 2,
        // `plain`: the golds whose column has no rule (Paper, Storytime, Scrapbook, Beacon).
        ...(kind === "plain" ? {} : { rule: { w: 66.67, h: 4, gap: 20, fill: t.colors.accent } }),
        capGap: 12,
        qGap: 17.33,
        ink: { cap: t.colors.accent, title: titleInkOf(t), q: muted, accent: coverAccent(t) },
      }),
      ...p.rest,
    ]),
    background: {},
  };
}

/**
 * What a composed cover still cannot hold, measured on the composed boxes (the title template's
 * own report was measured in its plain column, which the composition replaces): a title past the
 * gold's three lines at its size, or words past the slide's safe foot.
 */
export function coverOver(els: SlideElement[], t: Theme): string[] {
  const out: string[] = [];
  const cv = coverType(t);
  for (const e of els) {
    if (e.type !== "text") continue;
    if (e.name === "Title") {
      const pad = typeof e.style.padding === "number" ? e.style.padding : 0;
      const size = e.style.fontSize ?? cv.title;
      const n = countLines(
        docPlainText(e.doc),
        "title",
        t,
        e.w - 2 * pad,
        e.style.fontWeight,
        size,
      );
      if (n > cv.titleLines) out.push(`title does not fit at ${Math.round(size * 10) / 10}pt`);
    }
    // A question stepped under the cover's size to stay on the slide is past the cap (the base
    // cover reports its overlong column the same way); it still draws whole.
    if (e.name === "Subtitle" && (e.style.fontSize ?? cv.question) < cv.question - 0.01)
      out.push(`question stepped down to ${Math.round((e.style.fontSize ?? 0) * 10) / 10}pt`);
    if (e.y + e.h > H - SAFE.y + 1)
      out.push(`${e.name ?? "text"} past the foot (${Math.round(e.y + e.h)}pt)`);
  }
  return out;
}

/** The title's words fit its own box at its stored size (the layout's box, untouched). */
function holdsTitle(e: TextElement, t: Theme): boolean {
  const pad = typeof e.style.padding === "number" ? e.style.padding : 0;
  const size = e.style.fontSize ?? coverType(t).title;
  const lh =
    typeof e.style.lineHeight === "number" ? e.style.lineHeight : coverType(t).titleLineHeight;
  const n = countLines(docPlainText(e.doc), "title", t, e.w - 2 * pad, e.style.fontWeight, size);
  return n * size * lh + 2 * pad <= e.h + 1;
}

/** A cover ground a look painted (any theme's accent or plain-cover colour), not a teacher's. */
function lookGround(color: string): boolean {
  const c = color.toUpperCase();
  return THEMES.some(
    (th) => th.colors.accent.toUpperCase() === c || coverColours(th).fill.toUpperCase() === c,
  );
}

/**
 * Greg's call 36 (19 Oct 2026): the photo-right and Beacon picture covers draw no question, as
 * their golds have none. The cover question is the writer's `title.lead`, which is a subtitle line
 * that nothing else in the lesson reads, so it is not vital there. Other covers keep it.
 */
export function coverDropsQuestion(t: Theme): boolean {
  if (surfacesOf(t).marks.cover !== "split") return false;
  const kind = coverToken(t, "cover-photo");
  return kind === "right-half" || kind === "band";
}

/** A cover with a picture in the theme's composition; the slide as it was when it has none. */
export function composeCover(slide: Slide, t: Theme): Slide {
  const p = partsOf(slide);
  if (!p) return slide;
  const comp = surfacesOf(t).marks.cover;
  // A band variant (photo-band, photo-band-long) is set in the composition from the split's text
  // boxes; its band backs text on a photo, which no composition does.
  const split0 = layoutSlide("title", t.id, "split");
  const at = (preset: string) =>
    split0.elements.find((e): e is TextElement => e.type === "text" && e.style.preset === preset);
  const move = (e: TextElement | undefined, to: TextElement | undefined) =>
    e && to ? { ...e, x: to.x, y: to.y, w: to.w, h: to.h } : e;
  if (comp !== "shape" && p.rest.some((e) => e.name === "Band"))
    Object.assign(p, {
      caption: move(p.caption, at("caption")),
      title: move(p.title, at("title")),
      subtitle: move(p.subtitle, at("subtitle")),
      rest: p.rest.filter((e) => e.name !== "Band"),
    });
  const COMPS: Partial<Record<typeof comp, (p: Parts, t: Theme) => SlideElement[]>> = {
    bleed,
    collage,
    shape: hexShape,
    masthead,
    framed,
    split,
  };
  // A hand-made or saved cover's title is at its stored size in the layout's box: the collage and
  // the frame size it down their ladder in that box (three lines), the question under it, as the
  // other compositions do, so a long title never runs out of its box.
  if ((comp === "collage" || comp === "framed") && p.title && !holdsTitle(p.title, t)) {
    const x = p.subtitle?.x;
    const col = coverColumn(p, t, p.title.w, { lines: 3, shrink: true, gap: 20 });
    Object.assign(p, {
      title: col.title && { ...col.title, x: p.title.x },
      subtitle: col.subtitle && { ...col.subtitle, x: x ?? p.title.x },
    });
  }
  // A saved cover keeps the ink of its old look (cream on Paper's wine): the compositions that do
  // not set their own ink take the theme's title ink and muted question on the theme's ground.
  if (comp === "collage" || comp === "framed" || comp === "masthead")
    Object.assign(p, {
      title: ink(p.title, titleInkOf(t)),
      subtitle: ink(p.subtitle, surfacesOf(t).titleMuted),
    });
  const elements = COMPS[comp]?.(p, t) ?? null;
  // Geometric's hexagon is pinned to its gold check (post-582) as it was: its ground is untouched.
  if (!elements || comp === "shape") return elements ? { ...slide, elements } : slide;
  // A composition sets its own ground (the theme's, with its title art): a saved cover's old look
  // colour (Paper's wine from an earlier theme) would sit under the theme's ink unreadably. Only a
  // colour a look painted goes; a teacher's own colour or picture background stays theirs.
  const { color, ...rest } = slide.background ?? {};
  const keepColour = color && !lookGround(color);
  return { ...slide, elements, background: keepColour ? { ...rest, color } : rest };
}
