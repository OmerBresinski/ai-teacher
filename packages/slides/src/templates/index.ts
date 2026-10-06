/**
 * TEMPLATE-SPIKE (6 Oct 2026): the homepage layout set. Fifteen templates with fixed geometry on
 * the 960x540 grid, taken from the homepage example slides (`homepage/assets/examples`, measured in
 * `TEMPLATE-SPIKE/STUDY.md`), one type scale per key stage, and a stated capacity per zone.
 *
 * Every template is: heading at the top-left, then one body band (y 160-488). A figure (photo or
 * diagram) is always the same right-hand panel. Text beside it is centred on the panel. Without a
 * figure the body is a full-width structure (discs, cards, 2x2), centred in the band.
 * No chrome: no eyebrow, no kind tag, no page count (ruling 159).
 */
import type {
  ImageElement,
  RichDoc,
  ShapeElement,
  Slide,
  SlideElement,
  SlideKind,
  TextElement,
  Theme,
} from "@tj/domain/documents";
import { drawDiagram } from "../diagrams";
import { uid } from "../factories";
import { countLines } from "../text-measure";
import { typeScale, withKeyStage } from "../themes";

/* ------------------------------------------------------------------ */
/* Geometry (960 x 540)                                                */
/* ------------------------------------------------------------------ */

export const G = {
  margin: 64,
  right: 896,
  width: 832,
  headY: 46,
  band: { y: 160, h: 328 },
  left: { x: 64, w: 392 },
  panel: { x: 504, w: 392 },
  inset: 22,
} as const;
const bandBottom = G.band.y + G.band.h;
const bandMid = G.band.y + G.band.h / 2;

/* ------------------------------------------------------------------ */
/* Type: the one key-stage scale (FIX-TYPE, `themes.ts` `typeScale`)   */
/* ------------------------------------------------------------------ */

export type Stage = "ks1" | "ks2" | "ks3" | "ks4" | "ks5";
export type Scale = { title: number; heading: number; lead: number; body: number; small: number };
/**
 * The template roles on the deck's one type scale: the slide heading is the scale's display
 * heading, the lead is body set bold (no size of its own), small is the one step under body.
 */
export function templateScale(theme: Theme, stage: Stage): Scale {
  const s = withKeyStage(stage, () => typeScale(theme));
  if (!s) throw new Error(`no type scale for ${stage}`);
  return {
    title: s.title,
    heading: s.headingDisplay,
    lead: s.body,
    body: s.body,
    small: s.bodySmall,
  };
}
const LH = { title: 1.06, heading: 1.12, lead: 1.35, body: 1.4, small: 1.35 };

/* ------------------------------------------------------------------ */
/* Inputs                                                              */
/* ------------------------------------------------------------------ */

/** `aspect`: the photo's own width / height, so a panel can take its shape and crop nothing. */
/** A photo whose `photo` is "" is an open slot (the picture is still being found): the image view draws its placeholder. */
export type Figure =
  | {
      photo: string;
      alt?: string;
      aspect?: number;
      /** The picture director's request text, kept on the image element for the eval. */
      request?: string;
      /** The must-see subjects' boxes in the picture (fractions 0..1), from the vision judge. */
      subjects?: SubjectBox[];
    }
  | { diagram: unknown }
  /** A diagram already drawn (an SVG `src` at its own `aspect`): offline re-layouts reuse it. */
  | { drawn: { src: string; aspect: number; alt?: string } };
export type TemplateId =
  | "title"
  | "objectives"
  | "explain"
  | "picture-text"
  | "diagram-text"
  | "big-diagram"
  | "big-picture"
  | "picture-sequence"
  | "compare"
  | "steps"
  | "hinge"
  | "question-set"
  | "discussion"
  | "practice"
  | "exit-ticket";

export type TemplateInput = {
  template: TemplateId;
  heading: string;
  /** Title slide: the enquiry line under the title. Others: the one lead sentence. */
  lead?: string;
  /**
   * Support lines (explain, picture/diagram + text), steps, objectives. A support point may carry a
   * short `label`: one or two labelled points in a lead + points column are set as key cards.
   */
  points?: TemplatePoint[];
  /** Questions (question set, practice, exit ticket). */
  questions?: string[];
  /** Hinge: the stem and its 2-4 options. */
  stem?: string;
  options?: string[];
  /** Compare: 2-3 columns, each with an optional photo over its text. */
  columns?: { label: string; text: string; figure?: Figure }[];
  /** Picture sequence: 2-4 pictures in a row, a short caption under each, arrows between. */
  sequence?: { caption: string; figure?: Figure }[];
  /** The one quiet line under a question list. */
  instruction?: string;
  figure?: Figure;
};

/** A point: plain words, or words with a short label (a key card in a lead + points column). */
export type TemplatePoint = string | { text: string; label?: string };
export const pointText = (p: TemplatePoint): string => (typeof p === "string" ? p : p.text);
export const pointLabel = (p: TemplatePoint): string | undefined =>
  typeof p === "string" ? undefined : p.label?.trim() || undefined;

export type TemplateResult = {
  slide: Pick<Slide, "kind" | "elements" | "background">;
  over: string[];
  /** Round 2: why a diagram on this slide could not draw (drawDiagram's reasons); the slide was laid out without it. */
  diagram?: string[];
};

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

type Role = keyof Scale;
type Ctx = { t: Theme; s: Scale; over: string[]; els: SlideElement[]; fails?: string[] };

const hex = (c: string) => [1, 3, 5].map((i) => Number.parseInt(c.slice(i, i + 2), 16));
/** `a` over `b` at `k` (0..1): the wash of a hue on the ground. */
export const mix = (a: string, b: string, k: number) =>
  `#${hex(a)
    .map((v, i) => Math.round(v * k + (hex(b)[i] ?? 0) * (1 - k)))
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("")}`;
const wash = (t: Theme) => mix(t.colors.accent, t.colors.background, 0.1);

/** Inline `**bold**` and a leading `Label:` become bold runs. */
function runs(text: string, boldLabel = false) {
  const out: { type: "text"; text: string; marks?: { type: "bold" }[] }[] = [];
  let rest = text;
  const m = boldLabel ? rest.match(/^([^:]{2,32}):\s+/) : null;
  if (m) {
    out.push({ type: "text", text: `${m[1]}: `, marks: [{ type: "bold" }] });
    rest = rest.slice(m[0].length);
  }
  for (const part of rest.split(/(\*\*[^*]+\*\*)/)) {
    if (!part) continue;
    if (part.startsWith("**"))
      out.push({ type: "text", text: part.slice(2, -2), marks: [{ type: "bold" }] });
    else out.push({ type: "text", text: part });
  }
  return out;
}
const plain = (text: string) => text.replace(/\*\*/g, "");
const doc = (text: string, boldLabel = false): RichDoc =>
  ({ type: "doc", content: [{ type: "paragraph", content: runs(text, boldLabel) }] }) as RichDoc;

const presetOf = (r: Role) => (r === "title" ? "title" : r === "heading" ? "heading" : "body");
const weightOf = (r: Role, t: Theme) =>
  r === "title" || r === "heading" ? t.weights.heading : r === "lead" ? 700 : t.weights.body;

/** Height of `text` set in `role` at width `w`. */
function measure(c: Ctx, text: string, role: Role, w: number, weight?: number): number {
  const size = c.s[role];
  const lines = countLines(
    plain(text),
    presetOf(role),
    c.t,
    w,
    weight ?? weightOf(role, c.t),
    size,
  );
  return Math.ceil(lines * size * LH[role]);
}

function text(
  c: Ctx,
  value: string,
  role: Role,
  rect: { x: number; y: number; w: number },
  extra: {
    color?: string;
    weight?: number;
    align?: "left" | "center";
    boldLabel?: boolean;
    name?: string;
  } = {},
): TextElement {
  const h = measure(c, value, role, rect.w, extra.weight);
  const el: TextElement = {
    id: uid(),
    type: "text",
    x: rect.x,
    y: Math.round(rect.y),
    w: rect.w,
    h,
    doc: doc(value, extra.boldLabel),
    name: extra.name ?? role,
    style: {
      preset: presetOf(role),
      autoHeight: true,
      fontSize: c.s[role],
      lineHeight: LH[role],
      fontWeight: extra.weight ?? weightOf(role, c.t),
      padding: 0,
      ...(extra.color ? { color: extra.color } : {}),
      ...(extra.align ? { align: extra.align } : {}),
    },
  };
  c.els.push(el);
  return el;
}

function box(
  c: Ctx,
  rect: { x: number; y: number; w: number; h: number },
  fill: string,
  extra: Partial<ShapeElement> = {},
): ShapeElement {
  const el: ShapeElement = {
    id: uid(),
    type: "shape",
    shape: "rounded",
    ...rect,
    y: Math.round(rect.y),
    h: Math.round(rect.h),
    fill,
    radius: c.t.radius,
    name: "Panel",
    ...extra,
  };
  c.els.push(el);
  return el;
}

/** A filled disc with a centred numeral or letter (the homepage's list marker). */
function disc(c: Ctx, label: string, x: number, y: number, d: number) {
  c.els.push({
    id: uid(),
    type: "shape",
    shape: "ellipse",
    x,
    y: Math.round(y),
    w: d,
    h: d,
    fill: c.t.colors.accent,
    name: "Marker",
    doc: doc(label),
    textStyle: {
      preset: "body",
      fontSize: Math.round(d * 0.55),
      fontWeight: 700,
      color: c.t.colors.onAccent,
      align: "center",
      valign: "middle",
      padding: 0,
    },
  } as ShapeElement);
}

function rule(c: Ctx, x: number, y: number, w: number) {
  c.els.push({
    id: uid(),
    type: "shape",
    shape: "rect",
    x,
    y: Math.round(y),
    w,
    h: 1,
    fill: c.t.colors.line,
    name: "Rule",
  });
}

/** Every word of `text` fits on one line `w` wide at `size`: no word is ever broken inside itself. */
function wordsFit(c: Ctx, text: string, role: Role, w: number, size: number, weight?: number) {
  return plain(text)
    .split(/\s+/)
    .filter(Boolean)
    .every(
      (word) => countLines(word, presetOf(role), c.t, w, weight ?? weightOf(role, c.t), size) === 1,
    );
}

function heading(c: Ctx, value: string) {
  // A word too long for the line steps the heading down (never split mid-word).
  const full = c.s.heading;
  let size = full;
  while (size > c.s.body && !wordsFit(c, value, "heading", G.width, size)) size -= 2;
  c.s = { ...c.s, heading: size };
  const el = text(
    c,
    value,
    "heading",
    { x: G.margin, y: G.headY, w: G.width },
    { name: "Heading" },
  );
  if (el.y + el.h > G.band.y - 6)
    c.over.push(`heading ${Math.round(el.h / (c.s.heading * LH.heading))} lines`);
  c.s = { ...c.s, heading: full };
  return el;
}

export type SubjectBox = { name: string; x: number; y: number; w: number; h: number };
export type Placement =
  | { mode: "cover"; crop?: { x: number; y: number; w: number; h: number } }
  | { mode: "contain" };
/** A centred crop may lose at most this share of the picture's width or height when no subject boxes are known. */
export const BLIND_CROP_KEEP = 0.85;

/**
 * PICTURE-FIT (Greg, 6 Oct: animals cropped out of compare cards). How a photo of `photoAspect`
 * fills a box of `slotAspect`: covering it, with a crop window (fractions of the picture) placed
 * round the must-see subjects so none is cut; or, when no window of the box's shape keeps them all,
 * the whole picture contained on a soft panel. With no boxes known, only a mild centred crop (at
 * most 15 % off one dimension) is taken; anything more is contained, so no subject is ever cut blind.
 */
export function placePhoto(
  photoAspect: number,
  slotAspect: number,
  subjects?: SubjectBox[],
): Placement {
  const k = photoAspect / slotAspect;
  if (Math.abs(k - 1) < 0.03) return { mode: "cover" };
  // The window: full height and part of the width (a wider picture), or the reverse.
  const wide = k > 1;
  const span = wide ? 1 / k : k;
  if (!subjects?.length) {
    if (span < BLIND_CROP_KEEP) return { mode: "contain" };
    const off = (1 - span) / 2;
    return {
      mode: "cover",
      crop: wide ? { x: off, y: 0, w: span, h: 1 } : { x: 0, y: off, w: 1, h: span },
    };
  }
  const lo = Math.min(...subjects.map((b) => (wide ? b.x : b.y)));
  const hi = Math.max(...subjects.map((b) => (wide ? b.x + b.w : b.y + b.h)));
  if (hi - lo > span + 1e-6) return { mode: "contain" };
  // Centred on the subjects, clamped to the picture.
  const start = Math.min(1 - span, Math.max(0, (lo + hi) / 2 - span / 2));
  return {
    mode: "cover",
    crop: wide ? { x: start, y: 0, w: span, h: 1 } : { x: 0, y: start, w: 1, h: span },
  };
}

/** The subjects a crop window cuts (any part of a box outside it): the PICTURE-FIT gate. */
export function cutSubjects(
  crop: { x: number; y: number; w: number; h: number } | undefined,
  subjects: SubjectBox[] | undefined,
): string[] {
  if (!crop || !subjects) return [];
  const e = 1e-3;
  return subjects
    .filter(
      (b) =>
        b.x < crop.x - e ||
        b.y < crop.y - e ||
        b.x + b.w > crop.x + crop.w + e ||
        b.y + b.h > crop.y + crop.h + e,
    )
    .map((b) => b.name);
}

/**
 * A photo in a fixed box. `cover`: it fills the box, cropped only as `placePhoto` allows (round the
 * must-see subjects), else the whole picture is contained on a soft panel. Not `cover`: at its own
 * shape inside the box. An open slot (placeholder src, no aspect yet) takes the whole box.
 */
function photoBox(
  c: Ctx,
  f: { photo: string; alt?: string; aspect?: number; request?: string; subjects?: SubjectBox[] },
  rect: { x: number; y: number; w: number; h: number },
  cover = true,
) {
  let r = rect;
  let crop: { x: number; y: number; w: number; h: number } | undefined;
  const contain = (inner: typeof rect) => {
    const a = f.aspect ?? inner.w / inner.h;
    const w = Math.min(inner.w, Math.round(inner.h * a));
    const h = Math.min(inner.h, Math.round(w / a));
    return { x: inner.x + (inner.w - w) / 2, y: inner.y + (inner.h - h) / 2, w, h };
  };
  if (f.photo && f.aspect) {
    if (!cover) r = contain(rect);
    else {
      const p = placePhoto(f.aspect, rect.w / rect.h, f.subjects);
      if (p.mode === "contain") {
        // The whole picture on a soft panel the box's size, so a row of cards stays even.
        box(c, rect, wash(c.t), { name: "Photo panel" });
        r = contain(rect);
      } else crop = p.crop;
    }
  }
  c.els.push({
    id: uid(),
    type: "image",
    name: "Photo",
    x: Math.round(r.x),
    y: Math.round(r.y),
    w: Math.round(r.w),
    h: Math.round(r.h),
    src: f.photo,
    alt: f.alt ?? "",
    ...(f.request ? { request: f.request } : {}),
    ...(f.subjects ? { subjects: f.subjects } : {}),
    ...(crop ? { crop } : {}),
    fit: "cover",
    radius: c.t.radius,
  } as ImageElement);
}

/** The right-hand figure panel: a photo fills it; a diagram sits on the wash with air round it. */
function figurePanel(
  c: Ctx,
  f: Figure | undefined,
  rect: { x: number; y: number; w: number; h: number } = {
    x: G.panel.x,
    y: G.band.y,
    w: G.panel.w,
    h: G.band.h,
  },
): boolean {
  if (!f) return false;
  if ("drawn" in f) {
    if (!svgDrawsSomething(f.drawn.src)) return false;
    box(c, rect, wash(c.t));
    const i = G.inset;
    const inner = { x: rect.x + i, y: rect.y + i, w: rect.w - 2 * i, h: rect.h - 2 * i };
    const a = f.drawn.aspect || inner.w / inner.h;
    const w = Math.min(inner.w, Math.round(inner.h * a));
    const h = Math.min(inner.h, Math.round(w / a));
    c.els.push({
      id: uid(),
      type: "image",
      name: "Diagram",
      x: Math.round(inner.x + (inner.w - w) / 2),
      y: Math.round(inner.y + (inner.h - h) / 2),
      w,
      h,
      src: f.drawn.src,
      alt: f.drawn.alt ?? "",
      fit: "contain",
    } as ImageElement);
    return true;
  }
  if ("photo" in f) {
    // The photo keeps its own shape inside the panel box (right-aligned, centred on the band), so
    // nothing is cropped; a photo the box's shape fills it exactly.
    const a = f.aspect ?? rect.w / rect.h;
    const w = Math.min(rect.w, Math.round(rect.h * a));
    const h = Math.min(rect.h, Math.round(w / a));
    const fitted = { x: rect.x + rect.w - w, y: Math.round(rect.y + (rect.h - h) / 2), w, h };
    c.els.push({
      id: uid(),
      type: "image",
      name: "Photo",
      ...fitted,
      src: f.photo,
      alt: f.alt ?? "",
      ...(f.request ? { request: f.request } : {}),
      fit: "cover",
      radius: c.t.radius,
    } as ImageElement);
    return true;
  }
  // A diagram the drawer (or the spec call) reports as failed, or one that draws nothing but its
  // title, is no diagram: the caller lays the slide out without the panel (no empty panels ever).
  if (diagramFailed(f.diagram)) return false;
  const i = G.inset;
  const inner = { x: rect.x + i, y: rect.y + i, w: rect.w - 2 * i, h: rect.h - 2 * i };
  // drawDiagram (round 1, DIAGRAMS.md) tries the spec, then each simpler form, from the stage's
  // small size down to its floor, and answers ok only for a drawing with no readability fault.
  // Anything else is a failure: no panel, no wash, and the caller takes the words-only sibling.
  const draw = (): { el: SlideElement; note?: string } | undefined => {
    const r = drawDiagram(f.diagram, c.t, { ...inner, fs: c.s.small });
    if (!r.ok) {
      c.fails?.push(...r.reasons);
      return undefined;
    }
    return { el: r.element, ...(r.fs < c.s.small ? { note: `diagram labels ${r.fs}pt` } : {}) };
  };
  const d = draw();
  if (!d || !elementDrawsSomething(d.el)) return false;
  box(c, rect, wash(c.t));
  if (d.note) c.over.push(d.note);
  c.els.push(d.el);
  return true;
}

/**
 * DIAGRAM FALLBACK contract (BAKEOFF round 1, `round1/DIAGRAMS.md`): a diagram spec or drawer result
 * carrying `ok: false` is a failed diagram. The template never draws its panel.
 */
export function diagramFailed(spec: unknown): boolean {
  return !spec || (typeof spec === "object" && (spec as { ok?: unknown }).ok === false);
}

/** An SVG that draws at least one mark besides its title (the y7 s8/s9 empty panels drew none). */
export function svgDrawsSomething(src: string): boolean {
  let svg = src;
  try {
    const body = src.slice(src.indexOf(",") + 1);
    svg = /;base64,/.test(src.slice(0, 60)) ? atob(body) : decodeURIComponent(body);
  } catch {}
  // Drop the accessible <title> and any text before the first group (the diagram's own title).
  const g = svg.replace(/<title>[\s\S]*?<\/title>/g, "").indexOf("<g");
  if (g < 0) return false;
  const inner = svg.replace(/<title>[\s\S]*?<\/title>/g, "").slice(g);
  return /<(rect|circle|ellipse|path|line|polyline|polygon|image|text|foreignObject)\b/.test(inner);
}

function elementDrawsSomething(el: SlideElement): boolean {
  const src = (el as { src?: unknown }).src;
  return typeof src === "string" && src.startsWith("data:image/svg")
    ? svgDrawsSomething(src)
    : true;
}

/** Would this figure draw in `rect`? (A dry run: nothing is added to the slide.) */
function figureDraws(c: Ctx, f: Figure | undefined, rect?: Parameters<typeof figurePanel>[2]) {
  if (!f) return false;
  if ("photo" in f) return true;
  return figurePanel({ ...c, els: [], over: [] }, f, rect);
}

/** A column of blocks, centred on the band (or top-aligned at `top`), each measured first. */
type Block = { h: number; draw: (y: number) => void };
/**
 * The fit ladder (round 1: T y5 s12, y9 s9, y10 s8 cut their last line). A column is built at full
 * size first; when it does not fit the band, the gaps close up, then the body type takes one step
 * down to the stage's small size. Words never move or go: only spacing and one type step. A column
 * that still does not fit is reported in `over` (the repair's job).
 */
const RUNGS = [
  { space: 1, small: false },
  { space: 0.6, small: false },
  { space: 0.6, small: true },
] as const;
type Rung = (typeof RUNGS)[number];
let fullSizeOnly = false;
/**
 * Lay out with the ladder off: a column fits only at full size. The catalogue's capacities are
 * measured this way (fit-first: the model plans to fit at full size; the ladder is a net).
 */
export function atFullSize<T>(f: () => T): T {
  const was = fullSizeOnly;
  fullSizeOnly = true;
  try {
    return f();
  } finally {
    fullSizeOnly = was;
  }
}
function ladder(
  c: Ctx,
  build: (r: Rung) => { blocks: Block[]; gap: number },
  where: { top?: number; limit?: number; what: string },
) {
  const limit = where.limit ?? G.band.h;
  const full = c.s;
  const rungs = fullSizeOnly ? RUNGS.slice(0, 1) : RUNGS;
  for (const [k, r] of rungs.entries()) {
    c.s = r.small ? { ...full, body: full.small, lead: full.small } : full;
    const { blocks, gap } = build(r);
    const total = blocks.reduce((a, b) => a + b.h, 0) + gap * Math.max(0, blocks.length - 1);
    if (total <= limit || k === rungs.length - 1) {
      if (total > limit) c.over.push(`${where.what} ${total}/${limit}pt`);
      // Optical centre: a little above the band's middle, so a short column sits with its heading.
      let y = where.top ?? Math.max(G.band.y, Math.round(bandMid - G.band.h * 0.06 - total / 2));
      for (const b of blocks) {
        b.draw(y);
        y += b.h + gap;
      }
      c.s = full;
      return;
    }
  }
  c.s = full;
}

/**
 * Lead + support points in a column `w` wide at `x`. When one or two points carry a `label`, those
 * points are set as key cards, the label over its line on a washed card with an accent edge (arm
 * K's y5/y7 callouts, which Greg ranked first); unlabelled points stay bulleted. Three or more
 * labelled points are too many cards for a column: they are bulleted with the label in bold.
 */
function leadAndPoints(
  c: Ctx,
  lead: string | undefined,
  points: TemplatePoint[],
  x: number,
  w: number,
  what: string,
) {
  const labelled = points.filter((p) => pointLabel(p)).length;
  const cards = labelled >= 1 && labelled <= 2;
  ladder(
    c,
    (r) => {
      const blocks: Block[] = [];
      const gap = Math.round(c.s.body * 0.55 * r.space);
      if (lead) {
        const h = measure(c, lead, "lead", w);
        blocks.push({
          h: h + Math.round(6 * r.space),
          draw: (y) => text(c, lead, "lead", { x, y, w }, { color: c.t.colors.ink, name: "Lead" }),
        });
      }
      const pad = Math.round(c.s.body * 0.7);
      const bar = 5;
      const iw = w - 2 * pad - bar;
      const d = Math.round(c.s.body * 0.36);
      const indent = Math.round(c.s.body * 1.0);
      for (const p of points) {
        const label = pointLabel(p);
        if (cards && label) {
          const body = pointText(p);
          const lh = measure(c, label, "lead", iw, 700);
          const bh = measure(c, body, "body", iw);
          const h = 2 * pad + lh + 4 + bh;
          blocks.push({
            h,
            draw: (y) => {
              box(c, { x, y, w, h }, wash(c.t), {
                name: "Key card",
                radius: Math.min(c.t.radius, 12),
              });
              box(c, { x, y, w: bar, h }, c.t.colors.accent, {
                name: "Key edge",
                shape: "rect",
                radius: 0,
              });
              const l = text(
                c,
                label,
                "lead",
                { x: x + bar + pad, y: y + pad, w: iw },
                { color: c.t.colors.accent, weight: 700, name: "Key label" },
              );
              text(
                c,
                body,
                "body",
                { x: x + bar + pad, y: l.y + l.h + 4, w: iw },
                { color: c.t.colors.ink, name: "Point" },
              );
            },
          });
          continue;
        }
        const words = label ? `${label}: ${pointText(p)}` : pointText(p);
        const h = measure(c, words, "body", w - indent);
        blocks.push({
          h,
          draw: (y) => {
            c.els.push({
              id: uid(),
              type: "shape",
              shape: "ellipse",
              x: x + 2,
              y: Math.round(y + (c.s.body * LH.body) / 2 - d / 2),
              w: d,
              h: d,
              fill: c.t.colors.accent,
              name: "Bullet",
            });
            text(
              c,
              words,
              "body",
              { x: x + indent, y, w: w - indent },
              { color: c.t.colors.ink, boldLabel: true, name: "Point" },
            );
          },
        });
      }
      return { blocks, gap: cards ? Math.round(c.s.body * 0.8 * r.space) : gap };
    },
    { what },
  );
}

/** Numbered disc rows, full width or in a column; hairlines between when `ruled`. */
function numbered(
  c: Ctx,
  items: string[],
  x: number,
  w: number,
  what: string,
  opts: { ruled?: boolean; after?: string; top?: number } = {},
) {
  ladder(
    c,
    (r) => {
      const d = Math.round(c.s.body * 1.25);
      const indent = d + Math.round(c.s.body * 0.7);
      const pad = Math.round(c.s.body * (opts.ruled ? 0.6 : 0.35) * r.space);
      const blocks: Block[] = items.map((q, k) => {
        const h = Math.max(d, measure(c, q, "body", w - indent));
        return {
          h: h + 2 * pad,
          draw: (y) => {
            if (opts.ruled && k > 0) rule(c, x, y, w);
            const top = y + pad;
            disc(c, String(k + 1), x, top + Math.max(0, (c.s.body * LH.body - d) / 2), d);
            text(
              c,
              q,
              "body",
              { x: x + indent, y: top, w: w - indent },
              { color: c.t.colors.ink, name: "Item" },
            );
          },
        };
      });
      if (opts.after) {
        const after = opts.after;
        const h = measure(c, after, "small", w - indent);
        const gapAbove = Math.round(8 * r.space);
        blocks.push({
          h: h + gapAbove,
          draw: (y) =>
            text(
              c,
              after,
              "small",
              { x: x + indent, y: y + gapAbove, w: w - indent },
              { color: c.t.colors.muted, name: "Instruction" },
            ),
        });
      }
      return { blocks, gap: 0 };
    },
    { what, ...(opts.top ? { top: opts.top } : {}) },
  );
}

/* ------------------------------------------------------------------ */
/* The templates                                              */
/* ------------------------------------------------------------------ */

const KIND: Record<TemplateId, SlideKind> = {
  title: "title",
  objectives: "objectives",
  explain: "content",
  "picture-text": "image-text",
  "diagram-text": "diagram",
  "big-diagram": "diagram",
  "big-picture": "image-text",
  "picture-sequence": "image-text",
  compare: "content",
  steps: "worked-example",
  hinge: "multiple-choice",
  "question-set": "starter",
  discussion: "discussion",
  practice: "open-response",
  "exit-ticket": "exit-ticket",
};

/**
 * No empty panels ever: a figure that cannot draw (a failed diagram, an empty drawing) is dropped
 * and the slide takes its words-only sibling, as a failed picture already does in the arm.
 */
function withoutFailedFigures(c: Ctx, input: TemplateInput): TemplateInput {
  const f = input.figure;
  let out = input;
  if (f && !("photo" in f) && !figureDraws(c, f)) {
    const { figure: _, ...rest } = input;
    out =
      input.template === "picture-text" || input.template === "diagram-text"
        ? { ...rest, template: "explain" }
        : input.template === "big-picture" || input.template === "big-diagram"
          ? { ...rest, template: "explain", lead: input.lead ?? "" }
          : rest;
  }
  if (
    out.columns?.some(
      (col) => col.figure && !("photo" in col.figure) && !figureDraws(c, col.figure),
    )
  )
    out = { ...out, columns: out.columns.map(({ figure: _, ...col }) => col) };
  if (out.sequence?.some((x) => x.figure && !("photo" in x.figure) && !figureDraws(c, x.figure)))
    out = { template: "steps", heading: out.heading, points: out.sequence.map((x) => x.caption) };
  return out;
}

export function layoutTemplate(input: TemplateInput, theme: Theme, stage: Stage): TemplateResult {
  return withKeyStage(stage, () => {
    const c: Ctx = { t: theme, s: templateScale(theme, stage), over: [], els: [], fails: [] };
    input = withoutFailedFigures(c, input);
    const tpl = input.template;
    let background: Slide["background"];
    const raw = input.points ?? [];
    const pts = raw.map(pointText);
    switch (tpl) {
      case "title": {
        // Full-bleed hue ground (homepage). The photo is a full-height side panel at its own
        // shape (no crop: a portrait archive photo keeps its faces); the title wraps in what is left.
        background = { color: theme.colors.accent };
        const on = theme.colors.onAccent;
        const f = input.figure;
        const aspect = f && "photo" in f ? (f.aspect ?? 1) : 0;
        let ph = 444;
        let pw = Math.round(ph * aspect);
        if (pw > 520) {
          pw = 520;
          ph = Math.max(300, Math.round(pw / aspect));
        }
        if (aspect && pw < 240) pw = 240;
        const px = G.right - pw;
        const w = f ? Math.max(300, px - G.margin - 44) : 640;
        // The title steps down from the stage's title size until its words fit the column (6 lines max).
        let size = c.s.title;
        // ...and until every word fits its line whole: a title never breaks inside a word (y9
        // "hyperinfla/tion"). Stepping down is the design, not a fault.
        // Round 2 (y10 title 521/444): the title and subtitle together must fit the 444pt column,
        // so a long title keeps stepping down (words whole) to the floor; only past it is it flagged.
        const height = () => {
          const t = Math.ceil(
            countLines(input.heading, "title", theme, w, theme.weights.heading, size) *
              size *
              LH.title,
          );
          return t + (input.lead ? 20 + measure(c, input.lead, "lead", w, 400) : 0);
        };
        const fits = () =>
          countLines(input.heading, "title", theme, w, theme.weights.heading, size) <=
            (f ? 6 : 3) &&
          wordsFit(c, input.heading, "title", w, size) &&
          height() <= 444;
        const floor = Math.round(c.s.heading * 0.8);
        while (size > floor && !fits()) size -= 2;
        c.s = { ...c.s, title: size };
        if (!fits()) c.over.push(`title does not fit at ${size}pt`);
        const tH = measure(c, input.heading, "title", w);
        const lH = input.lead ? measure(c, input.lead, "lead", w, 400) : 0;
        const total = tH + (lH ? 20 + lH : 0);
        const y = Math.round(270 - total / 2);
        const titleEl = text(
          c,
          input.heading,
          "title",
          { x: G.margin, y, w },
          { color: on, name: "Title" },
        );
        // The ruler measures a line or so more than the browser may draw: the title sits on the
        // foot of its measured box, so any spare room falls above it, not between it and the subtitle.
        if (input.lead) titleEl.style = { ...titleEl.style, valign: "bottom", autoHeight: false };
        if (input.lead)
          text(
            c,
            input.lead,
            "lead",
            { x: G.margin, y: y + tH + 20, w },
            { color: on, weight: 400, name: "Subtitle" },
          );
        if (total > 444) c.over.push(`title ${total}/444pt`);
        if (f) figurePanel(c, f, { x: px, y: Math.round(270 - ph / 2), w: pw, h: ph });
        break;
      }
      case "objectives":
        heading(c, input.heading);
        numbered(c, pts, G.margin, 720, "objectives");
        break;
      case "explain":
        heading(c, input.heading);
        leadAndPoints(c, input.lead, raw, G.margin, 680, "explain");
        break;
      case "picture-text":
      case "diagram-text":
        heading(c, input.heading);
        leadAndPoints(c, input.lead, raw, G.left.x, G.left.w, "text column");
        figurePanel(c, input.figure);
        break;
      case "big-diagram": {
        heading(c, input.heading);
        const line = input.lead;
        const lh = line ? measure(c, line, "body", G.width) + 14 : 0;
        if (line && lh > Math.ceil(c.s.body * LH.body * 2) + 14)
          c.over.push("caption over 2 lines");
        // A graph or chart stretched across the full width reads squashed (T y11 s10): a plot's panel
        // is at most 1.7 times as wide as it is tall, centred, as arm R's readable y11 graphs were.
        const f = input.figure;
        const kind =
          f && "diagram" in f ? String((f.diagram as { kind?: unknown })?.kind ?? "") : "";
        const plot = /graph|chart|profile|plot|axes/.test(kind);
        const pw = plot ? Math.min(G.width, Math.round((G.band.h - lh) * 1.7)) : G.width;
        const lh2 = line ? measure(c, line, "body", pw) + 14 : 0;
        const ph = G.band.h - lh2;
        figurePanel(c, input.figure, {
          x: G.margin + Math.round((G.width - pw) / 2),
          y: G.band.y,
          w: pw,
          h: ph,
        });
        if (line)
          text(
            c,
            line,
            "body",
            { x: G.margin + Math.round((G.width - pw) / 2), y: bandBottom - lh2 + 14, w: pw },
            { color: theme.colors.muted, name: "Caption" },
          );
        break;
      }
      case "compare": {
        const s0 = c.s;
        const head = heading(c, input.heading);
        const cols = input.columns ?? [];
        const gap = 24;
        const colW = Math.floor((G.width - gap * (cols.length - 1)) / Math.max(1, cols.length));
        // Every card has its picture or none does (round 2 y9 s6: one picture over three cards left
        // two blank picture bands). Cards without a picture for every column are text cards.
        const pics = cols.length > 0 && cols.every((col) => col.figure);
        if (pics) {
          // Picture first (Greg 6 Oct): equal columns across the content width from the heading's
          // left edge; each card is a 4:3 picture band at the card's full inner width, then the label
          // and a short line. Words wrap inside the card and never change its width; words too long
          // for the full 4:3 band are a fault (the band shrinks only to keep the card on the slide).
          const pad = 10;
          const top = Math.max(G.band.y - 48, Math.round(head.y + head.h + 12));
          const bottom = G.band.y + G.band.h + 32;
          const iw = colW - 2 * pad;
          const wordsH = () =>
            Math.max(
              ...cols.map(
                (col) =>
                  measure(c, col.label, "lead", iw, 700) +
                  (col.text ? 4 + measure(c, col.text, "body", iw) : 0),
              ),
              0,
            );
          const full = Math.round(iw * 0.75);
          // Round 2: on the fit ladder. Words too long for the full 4:3 band set one step down first.
          let words = wordsH();
          if (bottom - top - 2 * pad - 8 - words < Math.floor(full * 0.96)) {
            c.s = { ...s0, body: s0.small, lead: s0.small };
            words = wordsH();
          }
          const picH = Math.min(full, bottom - top - 2 * pad - 8 - words);
          if (picH < Math.floor(full * 0.96))
            c.over.push(`compare picture ${picH}/${full}pt (under 4:3)`);
          const bh = Math.max(picH, 60);
          const h = bh + 2 * pad + 8 + words;
          const y = Math.max(top, Math.round((top + bottom) / 2 - h / 2));
          cols.forEach((col, k) => {
            const x = G.margin + k * (colW + gap);
            box(c, { x, y, w: colW, h }, theme.colors.surface, {
              stroke: theme.colors.line,
              strokeWidth: 1,
              radius: Math.min(theme.radius, 16),
            });
            const band = { x: x + pad, y: y + pad, w: iw, h: bh };
            if (col.figure && "photo" in col.figure) photoBox(c, col.figure, band);
            else if (col.figure) figurePanel(c, col.figure, band);
            const lab = text(
              c,
              col.label,
              "lead",
              { x: x + pad, y: band.y + band.h + 8, w: iw },
              { color: theme.colors.accent, weight: 700, name: "Label" },
            );
            if (col.text)
              text(
                c,
                col.text,
                "body",
                { x: x + pad, y: lab.y + lab.h + 4, w: iw },
                { color: theme.colors.ink, name: "Text" },
              );
          });
          c.s = s0;
          break;
        }
        // Round 2: text cards on the fit ladder (padding closes up, then body one step down).
        let pad = 22;
        const textH = (col: { label: string; text: string }) =>
          measure(c, col.label, "lead", colW - 2 * pad, 700) +
          10 +
          (col.text ? measure(c, col.text, "body", colW - 2 * pad) : 0);
        let h = 0;
        for (const [k, r] of RUNGS.entries()) {
          c.s = r.small ? { ...s0, body: s0.small, lead: s0.small } : s0;
          pad = Math.max(14, Math.round(22 * r.space));
          h = Math.max(...cols.map(textH), 0) + 2 * pad;
          if (h <= G.band.h || k === RUNGS.length - 1) break;
        }
        if (h > G.band.h) c.over.push(`compare ${h}/${G.band.h}pt`);
        const y = Math.max(G.band.y, Math.round(bandMid - h / 2 - 4));
        cols.forEach((col, k) => {
          const x = G.margin + k * (colW + gap);
          box(c, { x, y, w: colW, h }, theme.colors.surface, {
            stroke: theme.colors.line,
            strokeWidth: 1,
            radius: Math.min(theme.radius, 16),
          });
          const lab = text(
            c,
            col.label,
            "lead",
            { x: x + pad, y: y + pad, w: colW - 2 * pad },
            { color: theme.colors.accent, weight: 700, name: "Label" },
          );
          if (col.text)
            text(
              c,
              col.text,
              "body",
              { x: x + pad, y: lab.y + lab.h + 10, w: colW - 2 * pad },
              { color: theme.colors.ink, name: "Text" },
            );
        });
        c.s = s0;
        break;
      }
      case "big-picture": {
        // One photo across the band at its own shape, centred; an optional one-line caption under.
        heading(c, input.heading);
        const line = input.lead;
        const lh = line ? measure(c, line, "body", G.width) + 14 : 0;
        if (line && lh > Math.ceil(c.s.body * LH.body * 2) + 14)
          c.over.push("caption over 2 lines");
        const f = input.figure;
        if (f && "photo" in f) {
          const room = { w: G.width, h: G.band.h - lh };
          const a = f.aspect ?? 4 / 3;
          const w = Math.min(room.w, Math.round(room.h * a));
          const h = Math.min(room.h, Math.round(w / a));
          photoBox(c, f, { x: Math.round(G.margin + (G.width - w) / 2), y: G.band.y, w, h });
          if (line)
            text(
              c,
              line,
              "body",
              { x: G.margin, y: G.band.y + h + 14, w: G.width },
              { color: theme.colors.muted, name: "Caption", align: "center" },
            );
        } else if (f) figurePanel(c, f, { x: G.margin, y: G.band.y, w: G.width, h: G.band.h - lh });
        break;
      }
      case "picture-sequence": {
        // 2-4 pictures in a row, the same size, a short caption under each, an arrow between
        // (life cycles, changes over time).
        heading(c, input.heading);
        const seq = (input.sequence ?? []).slice(0, 4);
        if ((input.sequence ?? []).length > 4) c.over.push("sequence over 4 pictures");
        const n = Math.max(1, seq.length);
        const arrowW = 44;
        const w = Math.floor((G.width - arrowW * (n - 1)) / n);
        const capH = Math.max(0, ...seq.map((s) => measure(c, s.caption, "body", w, 600)));
        if (capH > Math.ceil(c.s.body * LH.body * 2))
          c.over.push(`sequence caption ${Math.round(capH / (c.s.body * LH.body))} lines`);
        const picH = Math.min(Math.round(w * 0.9), G.band.h - capH - 14);
        const total = picH + 14 + capH;
        const y = Math.max(G.band.y, Math.round(bandMid - total / 2));
        seq.forEach((s, k) => {
          const x = G.margin + k * (w + arrowW);
          if (s.figure && "photo" in s.figure) photoBox(c, s.figure, { x, y, w, h: picH }, true);
          else if (s.figure) figurePanel(c, s.figure, { x, y, w, h: picH });
          text(
            c,
            s.caption,
            "body",
            { x, y: y + picH + 14, w },
            { color: theme.colors.ink, weight: 600, align: "center", name: "Caption" },
          );
          if (k < n - 1)
            c.els.push({
              id: uid(),
              type: "line",
              name: "Arrow",
              x: x + w + 8,
              y: Math.round(y + picH / 2 - 10),
              w: arrowW - 16,
              h: 20,
              from: { x: 0, y: 0.5 },
              to: { x: 1, y: 0.5 },
              stroke: theme.colors.accent,
              strokeWidth: 4,
              arrowEnd: true,
            } as SlideElement);
        });
        break;
      }
      case "steps":
        heading(c, input.heading);
        if (input.figure) {
          numbered(c, pts, G.left.x, G.left.w, "steps");
          figurePanel(c, input.figure);
        } else numbered(c, pts, G.margin, 720, "steps");
        break;
      case "hinge": {
        heading(c, input.heading);
        const opts = input.options ?? [];
        const stem = input.stem;
        // Round 2 (y11 s11 ran to the foot): the hinge is on the fit ladder. Full size first, then
        // closer gaps and padding, then body (stem and options) one step down; flagged only past that.
        const full = c.s;
        let gap = 18;
        let pad = 20;
        let d = 0;
        let sH = 0;
        // Options never leave a hole: 2 in a row, 4 as 2x2, 3 as a row of 3 when they fit it,
        // else one column (fit2: three options as 2 + 1 left a gap).
        const grid = (perRow: number) => {
          const w = Math.floor((G.width - gap * (perRow - 1)) / perRow);
          const iw = w - 2 * pad - d - 14;
          const rowH = Math.max(...opts.map((o) => measure(c, o, "body", iw)), d) + 2 * pad;
          const rows = Math.ceil(opts.length / perRow);
          return { perRow, w, iw, rowH, rows, total: sH + rows * rowH + (rows - 1) * gap };
        };
        let g = grid(1);
        for (const [k, r] of RUNGS.entries()) {
          c.s = r.small ? { ...full, body: full.small, lead: full.small } : full;
          gap = Math.round(18 * r.space);
          pad = Math.max(10, Math.round(20 * r.space));
          d = Math.round(c.s.body * 1.25);
          sH = stem ? measure(c, stem, "lead", G.width) + Math.round(22 * r.space) : 0;
          g = grid(opts.length === 3 ? 3 : opts.length === 1 ? 1 : 2);
          if (opts.length === 3) {
            const twoLines = Math.ceil(c.s.body * LH.body * 2) + 2 * pad;
            if (g.rowH > twoLines || g.total > G.band.h) g = grid(1);
            // Three options in one column that do not fit may fit as a row of three.
            if (g.total > G.band.h && grid(3).total < g.total) g = grid(3);
          }
          if (g.total <= G.band.h || k === RUNGS.length - 1) break;
        }
        if (g.total > G.band.h) c.over.push(`hinge ${g.total}/${G.band.h}pt`);
        let y = Math.max(G.band.y, Math.round(bandMid - g.total / 2 - 4));
        if (stem) {
          text(
            c,
            stem,
            "lead",
            { x: G.margin, y, w: G.width },
            { color: theme.colors.ink, name: "Stem" },
          );
          y += sH;
        }
        opts.forEach((o, k) => {
          const x = G.margin + (k % g.perRow) * (g.w + gap);
          const yy = y + Math.floor(k / g.perRow) * (g.rowH + gap);
          box(c, { x, y: yy, w: g.w, h: g.rowH }, theme.colors.surface, {
            stroke: theme.colors.line,
            strokeWidth: 1,
            radius: Math.min(theme.radius, 16),
            name: "Option",
          });
          disc(c, String.fromCharCode(65 + k), x + pad, yy + g.rowH / 2 - d / 2, d);
          const th = measure(c, o, "body", g.iw);
          text(
            c,
            o,
            "body",
            { x: x + pad + d + 14, y: yy + g.rowH / 2 - th / 2, w: g.iw },
            { color: theme.colors.ink, name: "Option text" },
          );
        });
        c.s = full;
        break;
      }
      case "question-set":
      case "exit-ticket":
      case "practice": {
        heading(c, input.heading);
        const qs = input.questions ?? [];
        if (input.figure) {
          numbered(c, qs, G.left.x, G.left.w, tpl, {
            ...(input.instruction ? { after: input.instruction } : {}),
          });
          figurePanel(c, input.figure);
        } else
          numbered(c, qs, G.margin, 760, tpl, {
            ruled: true,
            ...(input.instruction ? { after: input.instruction } : {}),
          });
        break;
      }
      case "discussion": {
        heading(c, input.heading);
        const prompt = input.lead ?? "";
        if (input.figure) {
          leadAndPoints(c, prompt, raw, G.left.x, G.left.w, "discussion");
          figurePanel(c, input.figure);
        } else {
          // No figure: the prompt is the focal element, large, on the wash panel.
          const w = 680;
          const h = measure(c, prompt, "heading", w) + 2 * 40;
          box(c, { x: G.margin, y: G.band.y, w: G.width, h: G.band.h }, wash(theme));
          if (h > G.band.h) c.over.push(`discussion ${h}/${G.band.h}pt`);
          text(
            c,
            prompt,
            "heading",
            { x: G.margin + 76, y: bandMid - h / 2 + 40, w },
            { color: theme.colors.ink, weight: 600, name: "Prompt" },
          );
        }
        break;
      }
    }
    return {
      slide: { kind: KIND[tpl], elements: c.els, ...(background ? { background } : {}) },
      over: c.over,
      ...(c.fails?.length ? { diagram: [...new Set(c.fails)] } : {}),
    };
  });
}
