/**
 * BAKEOFF arm K (6 Oct 2026): blocks + recipes. The model writes a slide as typed blocks and names
 * one arrangement recipe; this module places them. Coordinates, spacing, type sizes and colours come
 * from here, never from the model.
 *
 * Geometry is the homepage set (`templates/index.ts` G, measured in TEMPLATE-SPIKE/STUDY.md):
 * heading top-left, one body band (y 160-488), a figure panel 392 wide beside a 392 text column.
 * Type is the deck's one key-stage scale (`typeScale`): heading = display heading, a lead is body set
 * bold, captions and instructions are body-small. Unlike a template, a recipe adapts to the blocks
 * present: counts flex within the recipe's limits and every zone is measured, then centred.
 *
 * Fit: laid out at the stage's own sizes and judged by the shared ruler (`slideFits`, step 0); if it
 * does not fit, laid out once more one stop down (UX ruling 91) and judged at step 1. Never throws:
 * a wrong block for the recipe falls back to the recipe the blocks suit, and is reported in `faults`.
 */
import type {
  ImageElement,
  RichDoc,
  ShapeElement,
  Slide,
  SlideElement,
  SlideKind,
  TextElement,
  TextPreset,
  Theme,
} from "@tj/domain/documents";
import { diagramElement, diagramFaults, fittedDiagramElement, withLongLabels } from "../diagrams";
import { uid } from "../factories";
import { slideFits } from "../fit-check";
import { G, mix } from "../templates";
import { countLines } from "../text-measure";
import { ladderStops } from "../text-style";
import { typeScale, withKeyStage } from "../themes";

/* ------------------------------------------------------------------ */
/* Inputs                                                              */
/* ------------------------------------------------------------------ */

export type Stage = "ks1" | "ks2" | "ks3" | "ks4" | "ks5";
/** A picture: `src` "" is an open slot (the picture is still being found). `aspect` = w / h. */
export type Pic = { src: string; alt?: string; aspect?: number };

export type Block =
  | { type: "heading"; text: string }
  | { type: "text"; text: string }
  | { type: "points"; items: string[]; numbered?: boolean }
  | { type: "picture"; picture: Pic }
  | { type: "picture-sequence"; items: { picture: Pic; caption: string }[] }
  | { type: "diagram"; diagram: unknown }
  | { type: "question"; text: string }
  | { type: "options"; items: string[] }
  | { type: "callout"; text: string; label?: string }
  | { type: "card"; label: string; text: string; picture?: Pic }
  | { type: "table"; header: string[]; rows: string[][] };
export type BlockType = Block["type"];

export type RecipeId =
  | "title"
  | "stack"
  | "media-right"
  | "media-left"
  | "big-media"
  | "compare"
  | "sequence"
  | "question-options";

export type BlockSlide = { recipe: RecipeId | string; blocks: Block[]; kind?: SlideKind };

export type LayoutResult = {
  slide: Pick<Slide, "kind" | "elements" | "background">;
  /** The recipe actually used (differs from the input when it fell back). */
  recipe: RecipeId;
  /** 0: own sizes; 1: one stop down. */
  step: 0 | 1;
  /** The shared ruler's verdict at `step`, and no zone over its height. */
  fits: boolean;
  /** Zones over their height (the engine's own measure). */
  over: string[];
  /** Input problems: blocks the recipe does not take, counts out of range, missing heading. */
  faults: string[];
};

/** Block counts per recipe: [min, max]. A type not listed is not accepted. */
export const RECIPES: Record<RecipeId, { accepts: Partial<Record<BlockType, [number, number]>> }> =
  {
    title: { accepts: { heading: [1, 1], text: [0, 1], picture: [0, 1] } },
    stack: {
      accepts: {
        heading: [1, 1],
        text: [0, 2],
        points: [0, 1],
        question: [0, 4],
        callout: [0, 1],
        table: [0, 1],
      },
    },
    "media-right": {
      accepts: {
        heading: [1, 1],
        text: [0, 2],
        points: [0, 1],
        question: [0, 3],
        callout: [0, 1],
        picture: [0, 1],
        diagram: [0, 1],
      },
    },
    "media-left": {
      accepts: {
        heading: [1, 1],
        text: [0, 2],
        points: [0, 1],
        question: [0, 3],
        callout: [0, 1],
        picture: [0, 1],
        diagram: [0, 1],
      },
    },
    "big-media": { accepts: { heading: [1, 1], picture: [0, 1], diagram: [0, 1], text: [0, 1] } },
    compare: { accepts: { heading: [1, 1], text: [0, 1], card: [2, 3] } },
    sequence: {
      accepts: { heading: [1, 1], text: [0, 1], "picture-sequence": [0, 1], card: [0, 4] },
    },
    "question-options": {
      accepts: {
        heading: [1, 1],
        question: [1, 1],
        options: [1, 1],
        picture: [0, 1],
        diagram: [0, 1],
      },
    },
  };
export const RECIPE_IDS = Object.keys(RECIPES) as RecipeId[];

/** Item limits inside a block (all recipes). */
export const ITEM_LIMITS = {
  points: [2, 5],
  options: [2, 4],
  "picture-sequence": [2, 4],
  tableCols: [2, 4],
  tableRows: [1, 4],
} as const;

/* ------------------------------------------------------------------ */
/* Type                                                                */
/* ------------------------------------------------------------------ */

type Role = "title" | "heading" | "lead" | "body" | "small";
type Sizes = Record<Role, number>;
const LH: Record<Role, number> = { title: 1.06, heading: 1.12, lead: 1.35, body: 1.4, small: 1.35 };
const PRESET: Record<Role, TextPreset> = {
  title: "title",
  heading: "heading",
  lead: "body",
  body: "body",
  small: "small",
};

/** The stage's sizes, or each one stop down the theme's ladder (`step` 1). */
export function blockSizes(theme: Theme, stage: Stage, step: 0 | 1 = 0): Sizes {
  return withKeyStage(stage, () => {
    const s = typeScale(theme);
    if (!s) throw new Error(`no type scale for ${stage}`);
    const own: Sizes = {
      title: s.title,
      heading: s.headingDisplay,
      lead: s.body,
      body: s.body,
      small: s.bodySmall,
    };
    if (step === 0) return own;
    const stops = ladderStops(theme);
    const down = (v: number) => stops.find((x) => x < v - 0.5) ?? v;
    return {
      title: down(own.title),
      heading: down(own.heading),
      lead: down(own.lead),
      body: down(own.body),
      small: down(own.small),
    };
  });
}

/* ------------------------------------------------------------------ */
/* Drawing helpers                                                     */
/* ------------------------------------------------------------------ */

type Ctx = { t: Theme; z: Sizes; over: string[]; els: SlideElement[] };
type Rect = { x: number; y: number; w: number; h: number };
type Piece = { h: number; draw: (y: number) => void };

/**
 * The homepage band (y 160-488) less 4pt: the shared ruler pads every box by 4 % (`withSafety`), so
 * a full-band panel must end by 484 to stay inside the safe area (497).
 */
const BAND_H = G.band.h - 4;
const band = { y: G.band.y, h: BAND_H, bottom: G.band.y + BAND_H, mid: G.band.y + BAND_H / 2 };
const wash = (t: Theme, k = 0.1) => mix(t.colors.accent, t.colors.background, k);

function runs(text: string, boldLabel: boolean) {
  const out: { type: "text"; text: string; marks?: { type: "bold" }[] }[] = [];
  let rest = text;
  const m = boldLabel ? rest.match(/^([^:]{2,32}):\s+/) : null;
  if (m) {
    out.push({ type: "text", text: `${m[1]}: `, marks: [{ type: "bold" }] });
    rest = rest.slice(m[0].length);
  }
  for (const part of rest.split(/(\*\*[^*]+\*\*)/)) {
    if (!part) continue;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4)
      out.push({ type: "text", text: part.slice(2, -2), marks: [{ type: "bold" }] });
    else out.push({ type: "text", text: part });
  }
  return out;
}
const plain = (text: string) => text.replace(/\*\*/g, "");
const doc = (text: string, boldLabel = false): RichDoc =>
  ({ type: "doc", content: [{ type: "paragraph", content: runs(text, boldLabel) }] }) as RichDoc;
const weightOf = (r: Role, t: Theme) =>
  r === "title" || r === "heading" ? t.weights.heading : r === "lead" ? 700 : t.weights.body;

function measure(c: Ctx, text: string, role: Role, w: number, weight?: number): number {
  const size = c.z[role];
  const lines = countLines(plain(text), PRESET[role], c.t, w, weight ?? weightOf(role, c.t), size);
  return Math.ceil(Math.max(1, lines) * size * LH[role]);
}

function text(
  c: Ctx,
  value: string,
  role: Role,
  r: { x: number; y: number; w: number },
  o: {
    color?: string;
    weight?: number;
    align?: "left" | "center";
    label?: boolean;
    name?: string;
  } = {},
): TextElement {
  const el = {
    id: uid(),
    type: "text",
    x: Math.round(r.x),
    y: Math.round(r.y),
    w: Math.round(r.w),
    h: measure(c, value, role, r.w, o.weight),
    doc: doc(value, o.label),
    name: o.name ?? role,
    style: {
      preset: PRESET[role],
      autoHeight: true,
      fontSize: c.z[role],
      lineHeight: LH[role],
      fontWeight: o.weight ?? weightOf(role, c.t),
      padding: 0,
      ...(o.color ? { color: o.color } : {}),
      ...(o.align ? { align: o.align } : {}),
    },
  } as TextElement;
  c.els.push(el);
  return el;
}

function box(c: Ctx, r: Rect, fill: string, extra: Partial<ShapeElement> = {}): ShapeElement {
  const el = {
    id: uid(),
    type: "shape",
    shape: "rounded",
    x: Math.round(r.x),
    y: Math.round(r.y),
    w: Math.round(r.w),
    h: Math.round(r.h),
    fill,
    radius: c.t.radius,
    name: "Panel",
    ...extra,
  } as ShapeElement;
  c.els.push(el);
  return el;
}
const card = (c: Ctx, r: Rect, name = "Card") =>
  box(c, r, c.t.colors.surface, {
    stroke: c.t.colors.line,
    strokeWidth: 1,
    radius: Math.min(c.t.radius, 16),
    name,
  });

function disc(c: Ctx, label: string, x: number, y: number, d: number) {
  c.els.push({
    id: uid(),
    type: "shape",
    shape: "ellipse",
    x: Math.round(x),
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

function hairline(c: Ctx, x: number, y: number, w: number) {
  c.els.push({
    id: uid(),
    type: "shape",
    shape: "rect",
    x: Math.round(x),
    y: Math.round(y),
    w: Math.round(w),
    h: 1,
    fill: c.t.colors.line,
    name: "Rule",
  } as ShapeElement);
}

function photo(c: Ctx, p: Pic, r: Rect, cover: boolean, align: "right" | "left" | "center") {
  let f = r;
  if (!cover && p.src && p.aspect) {
    const w = Math.min(r.w, Math.round(r.h * p.aspect));
    const h = Math.min(r.h, Math.round(w / p.aspect));
    const x = align === "right" ? r.x + r.w - w : align === "left" ? r.x : r.x + (r.w - w) / 2;
    f = { x, y: r.y + (r.h - h) / 2, w, h };
  }
  c.els.push({
    id: uid(),
    type: "image",
    name: "Photo",
    x: Math.round(f.x),
    y: Math.round(f.y),
    w: Math.round(f.w),
    h: Math.round(f.h),
    src: p.src,
    alt: p.alt ?? "",
    fit: "cover",
    radius: c.t.radius,
  } as ImageElement);
}

/** A picture at its own shape, or a diagram on the wash with air round it, in `r`. */
function media(c: Ctx, m: Block | undefined, r: Rect, align: "right" | "left" | "center") {
  if (!m) return;
  if (m.type === "picture") return photo(c, m.picture, r, false, align);
  if (m.type !== "diagram") return;
  box(c, r, wash(c.t));
  const i = G.inset;
  const inner = { x: r.x + i, y: r.y + i, w: r.w - 2 * i, h: r.h - 2 * i };
  try {
    for (let fs = c.z.small; fs >= 15; fs -= 1) {
      const clean = withLongLabels(
        () => diagramFaults(m.diagram, c.t, { w: inner.w, h: inner.h, fs }).length === 0,
      );
      const el = clean
        ? withLongLabels(() => diagramElement(m.diagram, c.t, { ...inner, fs }))
        : undefined;
      if (el) {
        if (fs < c.z.small) c.over.push(`diagram labels ${fs}pt`);
        c.els.push(el);
        return;
      }
    }
    const f = fittedDiagramElement(m.diagram, c.t, inner);
    if (f.ok) {
      c.over.push("diagram labels below 15pt");
      c.els.push(f.element);
    } else c.over.push(`diagram did not draw (${f.reasons.slice(0, 2).join("; ")})`);
  } catch (e) {
    c.over.push(`diagram did not draw (${String(e).slice(0, 80)})`);
  }
}

/** Pieces in a column, centred on the band (or at `top`), with `gap` between. */
function place(c: Ctx, pieces: Piece[], gap: number, what: string, top?: number, limit = band.h) {
  const total = pieces.reduce((a, p) => a + p.h, 0) + gap * Math.max(0, pieces.length - 1);
  if (total > limit) c.over.push(`${what} ${total}/${limit}pt`);
  let y = top ?? Math.max(band.y, Math.round(band.mid - total / 2 - 4));
  for (const p of pieces) {
    p.draw(y);
    y += p.h + gap;
  }
  return total;
}

function heading(c: Ctx, value: string) {
  // A two-line heading rises (to y 30 at most) so it keeps clear of the band.
  const h = measure(c, value, "heading", G.width);
  const y = Math.max(30, Math.min(G.headY, band.y - 6 - h));
  const el = text(c, value, "heading", { x: G.margin, y, w: G.width }, { name: "Heading" });
  if (el.y + el.h > band.y - 6)
    c.over.push(`heading ${Math.round(el.h / (c.z.heading * LH.heading))} lines`);
}

/* ------------------------------------------------------------------ */
/* Pieces: one per body block (or run of questions)                    */
/* ------------------------------------------------------------------ */

const gapOf = (c: Ctx) => Math.round(c.z.body * 0.75);

function leadPiece(c: Ctx, s: string, x: number, w: number, muted = false): Piece {
  const role: Role = muted ? "small" : "lead";
  return {
    h: measure(c, s, role, w),
    draw: (y) =>
      text(
        c,
        s,
        role,
        { x, y, w },
        {
          color: muted ? c.t.colors.muted : c.t.colors.ink,
          name: muted ? "Instruction" : "Lead",
        },
      ),
  };
}

function bulletsPiece(c: Ctx, items: string[], x: number, w: number): Piece {
  const d = Math.round(c.z.body * 0.36);
  const indent = Math.round(c.z.body * 1.0);
  const gap = Math.round(c.z.body * 0.45);
  const hs = items.map((p) => measure(c, p, "body", w - indent));
  return {
    h: hs.reduce((a, b) => a + b, 0) + gap * Math.max(0, items.length - 1),
    draw: (y0) => {
      let y = y0;
      items.forEach((p, k) => {
        c.els.push({
          id: uid(),
          type: "shape",
          shape: "ellipse",
          x: x + 2,
          y: Math.round(y + (c.z.body * LH.body) / 2 - d / 2),
          w: d,
          h: d,
          fill: c.t.colors.accent,
          name: "Bullet",
        } as ShapeElement);
        text(
          c,
          p,
          "body",
          { x: x + indent, y, w: w - indent },
          {
            color: c.t.colors.ink,
            label: true,
            name: "Point",
          },
        );
        y += (hs[k] ?? 0) + gap;
      });
    },
  };
}

/** Disc-numbered rows (numbered points, questions); hairlines between when `ruled`. */
function numberedPiece(
  c: Ctx,
  items: string[],
  x: number,
  w: number,
  o: { ruled?: boolean; letters?: boolean; start?: number; name?: string } = {},
): Piece {
  const d = Math.round(c.z.body * 1.25);
  const indent = d + Math.round(c.z.body * 0.7);
  const pad = o.ruled ? Math.round(c.z.body * 0.4) : Math.round(c.z.body * 0.3);
  const hs = items.map((q) => Math.max(d, measure(c, q, "body", w - indent)) + 2 * pad);
  return {
    h: hs.reduce((a, b) => a + b, 0),
    draw: (y0) => {
      let y = y0;
      items.forEach((q, k) => {
        if (o.ruled && k > 0) hairline(c, x, y, w);
        const top = y + pad;
        const label = o.letters ? String.fromCharCode(65 + k) : String((o.start ?? 1) + k);
        disc(c, label, x, top + Math.max(0, (c.z.body * LH.body - d) / 2), d);
        text(
          c,
          q,
          "body",
          { x: x + indent, y: top, w: w - indent },
          {
            color: c.t.colors.ink,
            name: o.name ?? "Item",
          },
        );
        y += hs[k] ?? 0;
      });
    },
  };
}

function calloutPiece(c: Ctx, b: { text: string; label?: string }, x: number, w: number): Piece {
  const pad = Math.round(c.z.body * 0.7);
  const bar = 6;
  const iw = w - 2 * pad - bar;
  const lh = b.label ? measure(c, b.label, "lead", iw) + 4 : 0;
  const th = measure(c, b.text, "body", iw);
  return {
    h: lh + th + 2 * pad,
    draw: (y) => {
      box(c, { x, y, w, h: lh + th + 2 * pad }, wash(c.t, 0.14), { name: "Callout" });
      box(c, { x, y, w: bar, h: lh + th + 2 * pad }, c.t.colors.accent, {
        radius: 3,
        name: "Callout bar",
      });
      if (b.label)
        text(
          c,
          b.label,
          "lead",
          { x: x + bar + pad, y: y + pad, w: iw },
          {
            color: c.t.colors.accent,
            name: "Callout label",
          },
        );
      text(
        c,
        b.text,
        "body",
        { x: x + bar + pad, y: y + pad + lh, w: iw },
        {
          color: c.t.colors.ink,
          name: "Callout text",
        },
      );
    },
  };
}

function tablePiece(
  c: Ctx,
  b: { header: string[]; rows: string[][] },
  x: number,
  w: number,
): Piece {
  const n = Math.max(1, b.header.length, ...b.rows.map((r) => r.length));
  const cw = w / n;
  const px = Math.round(c.z.body * 0.5);
  const py = Math.round(c.z.body * 0.25);
  const rows = [b.header, ...b.rows];
  const hs = rows.map(
    (r, i) =>
      Math.max(
        ...Array.from({ length: n }, (_, k) =>
          measure(c, r[k] ?? "", i === 0 ? "lead" : "body", cw - 2 * px),
        ),
      ) +
      2 * py,
  );
  const total = hs.reduce((a, h) => a + h, 0);
  return {
    h: total,
    draw: (y0) => {
      card(c, { x, y: y0, w, h: total }, "Table");
      box(c, { x, y: y0, w, h: hs[0] ?? 0 }, wash(c.t, 0.16), {
        radius: Math.min(c.t.radius, 16),
        name: "Table header",
      });
      let y = y0;
      rows.forEach((r, i) => {
        if (i > 1) hairline(c, x, y, w);
        for (let k = 0; k < n; k++)
          text(
            c,
            r[k] ?? "",
            i === 0 ? "lead" : "body",
            { x: x + k * cw + px, y: y + py, w: cw - 2 * px },
            {
              color: c.t.colors.ink,
              name: i === 0 ? "Table head" : "Table cell",
            },
          );
        y += hs[i] ?? 0;
      });
    },
  };
}

/** Body blocks (in order) as pieces for a column `w` wide; a run of questions is one numbered list. */
function columnPieces(c: Ctx, blocks: Block[], x: number, w: number, wide: boolean): Piece[] {
  const out: Piece[] = [];
  let k = 0;
  let asked = 0;
  while (k < blocks.length) {
    const b = blocks[k] as Block;
    if (b.type === "question") {
      const run: string[] = [];
      while (k < blocks.length && blocks[k]?.type === "question") {
        run.push((blocks[k] as { text: string }).text);
        k++;
      }
      out.push(numberedPiece(c, run, x, w, { ruled: wide, start: asked + 1, name: "Question" }));
      asked += run.length;
      continue;
    }
    k++;
    if (b.type === "text") {
      // A line after the questions is the quiet instruction under them.
      const afterQs = asked > 0 && blocks.slice(0, k - 1).some((p) => p.type === "question");
      out.push(leadPiece(c, b.text, x, w, afterQs));
    } else if (b.type === "points")
      out.push(
        b.numbered
          ? numberedPiece(c, b.items, x, w, { name: "Point" })
          : bulletsPiece(c, b.items, x, w),
      );
    else if (b.type === "callout") out.push(calloutPiece(c, b, x, w));
    else if (b.type === "table") out.push(tablePiece(c, b, x, w));
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Recipes                                                             */
/* ------------------------------------------------------------------ */

const STACK_W = 720;
const isMedia = (b: Block) => b.type === "picture" || b.type === "diagram";
const isBody = (b: Block) => b.type !== "heading" && !isMedia(b);

function drawTitle(c: Ctx, head: string, blocks: Block[]) {
  const on = c.t.colors.onAccent;
  const sub = blocks.find((b) => b.type === "text") as { text: string } | undefined;
  const pic = blocks.find((b) => b.type === "picture") as { picture: Pic } | undefined;
  const aspect = pic ? (pic.picture.aspect ?? 1) : 0;
  // The picture takes at most 400 wide, so the title keeps a column it can be read in.
  let ph = 444;
  let pw = Math.round(ph * aspect);
  if (pw > 400) {
    pw = 400;
    ph = Math.max(300, Math.round(pw / aspect));
  }
  if (pic && pw < 240) pw = 240;
  const px = G.right - pw;
  const w = pic ? Math.max(300, px - G.margin - 44) : 720;
  const maxLines = pic ? 5 : 3;
  const lines = countLines(plain(head), "title", c.t, w, c.t.weights.heading, c.z.title);
  if (lines > maxLines) c.over.push(`title ${lines}/${maxLines} lines`);
  const tH = measure(c, head, "title", w);
  const lH = sub ? measure(c, sub.text, "lead", w, 400) : 0;
  const total = tH + (lH ? 20 + lH : 0);
  if (total > 444) c.over.push(`title ${total}/444pt`);
  const y = Math.max(48, Math.round(270 - total / 2));
  text(c, head, "title", { x: G.margin, y, w }, { color: on, name: "Title" });
  if (sub)
    text(
      c,
      sub.text,
      "lead",
      { x: G.margin, y: y + tH + 20, w },
      {
        color: on,
        weight: 400,
        name: "Subtitle",
      },
    );
  if (pic)
    photo(c, pic.picture, { x: px, y: Math.round(270 - ph / 2), w: pw, h: ph }, false, "right");
}

function drawStack(c: Ctx, blocks: Block[]) {
  const body = blocks.filter(isBody);
  // One question alone is a discussion prompt: the focal element, large, on the wash.
  if (body.length === 1 && body[0]?.type === "question") {
    const q = body[0].text;
    const w = 680;
    const h = measure(c, q, "heading", w);
    box(c, { x: G.margin, y: band.y, w: G.width, h: band.h }, wash(c.t));
    if (h > band.h - 48) c.over.push(`prompt ${h}/${band.h - 48}pt`);
    text(
      c,
      q,
      "heading",
      { x: G.margin + 76, y: band.mid - h / 2, w },
      {
        color: c.t.colors.ink,
        weight: 600,
        name: "Prompt",
      },
    );
    return;
  }
  const hasTable = body.some((b) => b.type === "table");
  const w = hasTable ? G.width : STACK_W;
  place(c, columnPieces(c, body, G.margin, w, true), gapOf(c), "stack");
}

function drawMedia(c: Ctx, blocks: Block[], side: "right" | "left") {
  const m = blocks.find(isMedia);
  const col = side === "right" ? G.left.x : G.panel.x;
  const panel = side === "right" ? G.panel.x : G.left.x;
  if (!m) {
    // No media after all: the column becomes a full stack.
    place(c, columnPieces(c, blocks.filter(isBody), G.margin, STACK_W, true), gapOf(c), "stack");
    return;
  }
  place(c, columnPieces(c, blocks.filter(isBody), col, G.left.w, false), gapOf(c), "text column");
  media(
    c,
    m,
    { x: panel, y: band.y, w: G.panel.w, h: band.h },
    side === "right" ? "right" : "left",
  );
}

function drawBigMedia(c: Ctx, blocks: Block[]) {
  const m = blocks.find(isMedia);
  const cap = blocks.find((b) => b.type === "text") as { text: string } | undefined;
  const ch = cap ? measure(c, cap.text, "body", G.width) + 14 : 0;
  if (cap && ch > c.z.body * LH.body * 2 + 15) c.over.push("caption over 2 lines");
  media(c, m, { x: G.margin, y: band.y, w: G.width, h: band.h - ch }, "center");
  if (cap)
    text(
      c,
      cap.text,
      "body",
      { x: G.margin, y: band.bottom - ch + 14, w: G.width },
      {
        color: c.t.colors.muted,
        align: m?.type === "picture" ? "center" : "left",
        name: "Caption",
      },
    );
}

/** Cards in a row: optional picture on top, label, text; `numbered` puts a disc before the label. */
function cardsPiece(
  c: Ctx,
  cards: { label: string; text: string; picture?: Pic }[],
  numbered: boolean,
  picH: number,
): Piece {
  const n = Math.max(1, cards.length);
  const gap = 24;
  const w = Math.floor((G.width - gap * (n - 1)) / n);
  const pad = Math.round(c.z.body * 0.75);
  const iw = w - 2 * pad;
  const d = Math.round(c.z.body * 1.25);
  const anyPic = cards.some((k) => k.picture);
  const ph = anyPic ? picH : 0;
  const labelW = numbered ? iw - d - 12 : iw;
  const hs = cards.map(
    (k) =>
      Math.max(numbered ? d : 0, measure(c, k.label, "lead", labelW)) +
      10 +
      measure(c, k.text, "body", iw),
  );
  const h = Math.max(...hs, 0) + 2 * pad + ph;
  return {
    h,
    draw: (y) => {
      cards.forEach((k, i) => {
        const x = G.margin + i * (w + gap);
        card(c, { x, y, w, h });
        if (k.picture) photo(c, k.picture, { x, y, w, h: ph }, true, "center");
        let ty = y + ph + pad;
        if (numbered) disc(c, String(i + 1), x + pad, ty, d);
        const lab = text(
          c,
          k.label,
          "lead",
          {
            x: x + pad + (numbered ? d + 12 : 0),
            y: ty + (numbered ? Math.max(0, (d - c.z.lead * LH.lead) / 2) : 0),
            w: labelW,
          },
          {
            color: c.t.colors.accent,
            name: "Card label",
          },
        );
        ty = Math.max(lab.y + lab.h, numbered ? ty + d : 0) + 10;
        text(
          c,
          k.text,
          "body",
          { x: x + pad, y: ty, w: iw },
          {
            color: c.t.colors.ink,
            label: true,
            name: "Card text",
          },
        );
      });
    },
  };
}

/** Pictures in a row with arrows between and a caption under each. */
function sequencePiece(c: Ctx, items: { picture: Pic; caption: string }[], avail: number): Piece {
  const n = Math.max(1, items.length);
  const gap = 44;
  const w = Math.floor((G.width - gap * (n - 1)) / n);
  const capH = Math.max(...items.map((it) => measure(c, it.caption, "body", w)), 0);
  const ph = Math.max(80, Math.min(Math.round(w * 0.8), avail - capH - 12));
  const h = ph + 12 + capH;
  return {
    h,
    draw: (y) => {
      items.forEach((it, i) => {
        const x = G.margin + i * (w + gap);
        photo(c, it.picture, { x, y, w, h: ph }, true, "center");
        text(
          c,
          it.caption,
          "body",
          { x, y: y + ph + 12, w },
          {
            color: c.t.colors.ink,
            align: "center",
            name: "Caption",
          },
        );
        if (i < n - 1)
          c.els.push({
            id: uid(),
            type: "icon",
            icon: "arrow-right",
            color: c.t.colors.accent,
            strokeWidth: 2.5,
            x: x + w + 8,
            y: Math.round(y + ph / 2 - 14),
            w: 28,
            h: 28,
            name: "Arrow",
          } as unknown as SlideElement);
      });
    },
  };
}

function drawCompareOrSequence(c: Ctx, blocks: Block[], recipe: "compare" | "sequence") {
  const lead = blocks.find((b) => b.type === "text") as { text: string } | undefined;
  const call = blocks.find((b) => b.type === "callout") as
    | { text: string; label?: string }
    | undefined;
  const cards = blocks.filter((b) => b.type === "card") as {
    label: string;
    text: string;
    picture?: Pic;
  }[];
  const seq = blocks.find((b) => b.type === "picture-sequence") as
    | { items: { picture: Pic; caption: string }[] }
    | undefined;
  const gap = gapOf(c);
  const top: Piece[] = [];
  if (lead) top.push(leadPiece(c, lead.text, G.margin, G.width));
  const bottom: Piece[] = [];
  if (call) bottom.push(calloutPiece(c, call, G.margin, G.width));
  const used = [...top, ...bottom].reduce((a, p) => a + p.h + gap, 0);
  const avail = band.h - used;
  const mid: Piece[] = [];
  if (seq?.items.length) mid.push(sequencePiece(c, seq.items, avail));
  else if (cards.length) {
    const textH = cardsPiece(c, cards, recipe === "sequence", 0).h;
    const picH = Math.max(90, Math.min(170, avail - textH));
    mid.push(cardsPiece(c, cards, recipe === "sequence", picH));
  }
  place(c, [...top, ...mid, ...bottom], gap, recipe);
}

function drawQuestionOptions(c: Ctx, blocks: Block[]) {
  const q = blocks.find((b) => b.type === "question") as { text: string } | undefined;
  const opts =
    (blocks.find((b) => b.type === "options") as { items: string[] } | undefined)?.items ?? [];
  const m = blocks.find(isMedia);
  const gap = gapOf(c);
  if (m) {
    const pieces: Piece[] = [];
    if (q) pieces.push(leadPiece(c, q.text, G.left.x, G.left.w));
    pieces.push(optionRows(c, opts, G.left.x, G.left.w));
    place(c, pieces, gap, "question column");
    media(c, m, { x: G.panel.x, y: band.y, w: G.panel.w, h: band.h }, "right");
    return;
  }
  const pieces: Piece[] = [];
  if (q) pieces.push(leadPiece(c, q.text, G.margin, G.width));
  pieces.push(optionGrid(c, opts));
  place(c, pieces, gap + 6, "question");
}

/** Options as lettered cards, one per row, in a column. */
function optionRows(c: Ctx, opts: string[], x: number, w: number): Piece {
  const pad = Math.round(c.z.body * 0.35);
  const d = Math.round(c.z.body * 1.15);
  const iw = w - 2 * pad - d - 12;
  const gap = 10;
  const hs = opts.map((o) => Math.max(d, measure(c, o, "body", iw)) + 2 * pad);
  return {
    h: hs.reduce((a, b) => a + b, 0) + gap * Math.max(0, opts.length - 1),
    draw: (y0) => {
      let y = y0;
      opts.forEach((o, k) => {
        const h = hs[k] ?? 0;
        card(c, { x, y, w, h }, "Option");
        disc(c, String.fromCharCode(65 + k), x + pad, y + h / 2 - d / 2, d);
        const th = measure(c, o, "body", iw);
        text(
          c,
          o,
          "body",
          { x: x + pad + d + 12, y: y + h / 2 - th / 2, w: iw },
          {
            color: c.t.colors.ink,
            name: "Option text",
          },
        );
        y += h + gap;
      });
    },
  };
}

/** Options as a 2-column grid of lettered cards. */
function optionGrid(c: Ctx, opts: string[]): Piece {
  const gap = 18;
  const w = Math.floor((G.width - gap) / 2);
  const pad = Math.round(c.z.body * 0.5);
  const d = Math.round(c.z.body * 1.25);
  const iw = w - 2 * pad - d - 14;
  const rowH = Math.max(d, ...opts.map((o) => measure(c, o, "body", iw))) + 2 * pad;
  const rows = Math.ceil(opts.length / 2);
  return {
    h: rows * rowH + (rows - 1) * gap,
    draw: (y0) => {
      opts.forEach((o, k) => {
        const x = G.margin + (k % 2) * (w + gap);
        const y = y0 + Math.floor(k / 2) * (rowH + gap);
        card(c, { x, y, w, h: rowH }, "Option");
        disc(c, String.fromCharCode(65 + k), x + pad, y + rowH / 2 - d / 2, d);
        const th = measure(c, o, "body", iw);
        text(
          c,
          o,
          "body",
          { x: x + pad + d + 14, y: y + rowH / 2 - th / 2, w: iw },
          {
            color: c.t.colors.ink,
            name: "Option text",
          },
        );
      });
    },
  };
}

/* ------------------------------------------------------------------ */
/* Validation and fallback                                             */
/* ------------------------------------------------------------------ */

/** Problems with `blocks` for `recipe` (empty when it takes them as they are). */
export function recipeFaults(recipe: RecipeId, blocks: Block[]): string[] {
  const rule = RECIPES[recipe].accepts;
  const out: string[] = [];
  const counts = new Map<BlockType, number>();
  for (const b of blocks) counts.set(b.type, (counts.get(b.type) ?? 0) + 1);
  for (const [t, n] of counts) {
    const lim = rule[t];
    if (!lim) out.push(`${recipe} does not take ${t}`);
    else if (n > lim[1]) out.push(`${recipe} takes at most ${lim[1]} ${t}`);
  }
  for (const [t, lim] of Object.entries(rule) as [BlockType, [number, number]][])
    if ((counts.get(t) ?? 0) < lim[0]) out.push(`${recipe} needs ${lim[0]} ${t}`);
  const media = (counts.get("picture") ?? 0) + (counts.get("diagram") ?? 0);
  if (["media-right", "media-left", "big-media"].includes(recipe) && media !== 1)
    out.push(`${recipe} needs exactly one picture or diagram`);
  if (recipe === "sequence" && !counts.get("picture-sequence") && (counts.get("card") ?? 0) < 3)
    out.push("sequence needs a picture-sequence or 3-4 cards");
  if (recipe === "sequence" && counts.get("picture-sequence") && counts.get("card"))
    out.push("sequence takes a picture-sequence or cards, not both");
  if ((recipe === "media-right" || recipe === "media-left") && !blocks.some(isBody))
    out.push(`${recipe} needs text beside the media`);
  for (const b of blocks) {
    const lim = (k: keyof typeof ITEM_LIMITS, n: number) => {
      const [lo, hi] = ITEM_LIMITS[k];
      if (n < lo || n > hi) out.push(`${k} ${n} items (${lo}-${hi})`);
    };
    if (b.type === "points") lim("points", b.items.length);
    if (b.type === "options") lim("options", b.items.length);
    if (b.type === "picture-sequence") lim("picture-sequence", b.items.length);
    if (b.type === "table") {
      lim("tableCols", b.header.length);
      lim("tableRows", b.rows.length);
    }
  }
  return out;
}

/** The recipe these blocks suit, for a slide whose named recipe does not take them. */
export function suitedRecipe(blocks: Block[]): RecipeId {
  const has = (t: BlockType) => blocks.some((b) => b.type === t);
  const n = (t: BlockType) => blocks.filter((b) => b.type === t).length;
  if (has("options")) return "question-options";
  if (has("picture-sequence") || n("card") >= 4) return "sequence";
  if (n("card") >= 2) return "compare";
  if (has("picture") || has("diagram"))
    return blocks.filter(isBody).length === 0 ||
      (blocks.filter(isBody).length === 1 && has("text") && !has("points"))
      ? "big-media"
      : "media-right";
  return "stack";
}

const isRecipe = (r: string): r is RecipeId => r in RECIPES;

/** Shape the input so drawing cannot fail: strings everywhere, empty arrays for missing lists. */
function clean(blocks: unknown): Block[] {
  if (!Array.isArray(blocks)) return [];
  const s = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
  const arr = (v: unknown) => (Array.isArray(v) ? v.map(s) : []);
  const pic = (v: unknown): Pic => {
    const p = (v ?? {}) as Partial<Pic>;
    return {
      src: s(p.src),
      alt: s(p.alt),
      ...(typeof p.aspect === "number" && p.aspect > 0 ? { aspect: p.aspect } : {}),
    };
  };
  const out: Block[] = [];
  for (const raw of blocks) {
    const b = (raw ?? {}) as Record<string, unknown>;
    switch (b.type) {
      case "heading":
      case "text":
      case "question":
        out.push({ type: b.type, text: s(b.text) });
        break;
      case "points":
        out.push({
          type: "points",
          items: arr(b.items),
          ...(b.numbered ? { numbered: true } : {}),
        });
        break;
      case "options":
        out.push({ type: "options", items: arr(b.items) });
        break;
      case "callout":
        out.push({ type: "callout", text: s(b.text), ...(b.label ? { label: s(b.label) } : {}) });
        break;
      case "card":
        out.push({
          type: "card",
          label: s(b.label),
          text: s(b.text),
          ...(b.picture ? { picture: pic(b.picture) } : {}),
        });
        break;
      case "picture":
        out.push({ type: "picture", picture: pic(b.picture) });
        break;
      case "diagram":
        out.push({ type: "diagram", diagram: b.diagram });
        break;
      case "picture-sequence":
        out.push({
          type: "picture-sequence",
          items: (Array.isArray(b.items) ? b.items : []).map((it: unknown) => {
            const i = (it ?? {}) as Record<string, unknown>;
            return { picture: pic(i.picture), caption: s(i.caption) };
          }),
        });
        break;
      case "table": {
        const header = arr(b.header);
        const rows = (Array.isArray(b.rows) ? b.rows : []).map(arr);
        out.push({ type: "table", header, rows });
        break;
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Entry                                                               */
/* ------------------------------------------------------------------ */

function kindOf(recipe: RecipeId, blocks: Block[]): SlideKind {
  const has = (t: BlockType) => blocks.some((b) => b.type === t);
  switch (recipe) {
    case "title":
      return "title";
    case "question-options":
      return "multiple-choice";
    case "big-media":
    case "media-left":
    case "media-right":
      return has("diagram") ? "diagram" : has("question") ? "open-response" : "image-text";
    case "stack": {
      const qs = blocks.filter((b) => b.type === "question").length;
      if (qs === 1 && blocks.filter(isBody).length === 1) return "discussion";
      return qs > 0 ? "open-response" : "content";
    }
    default:
      return "content";
  }
}

function draw(theme: Theme, stage: Stage, step: 0 | 1, recipe: RecipeId, blocks: Block[]) {
  const c: Ctx = { t: theme, z: blockSizes(theme, stage, step), over: [], els: [] };
  const head =
    (blocks.find((b) => b.type === "heading") as { text: string } | undefined)?.text ?? "";
  let background: Slide["background"];
  if (recipe === "title") {
    background = { color: theme.colors.accent };
    drawTitle(c, head, blocks);
  } else {
    heading(c, head);
    if (recipe === "stack") drawStack(c, blocks);
    else if (recipe === "media-right") drawMedia(c, blocks, "right");
    else if (recipe === "media-left") drawMedia(c, blocks, "left");
    else if (recipe === "big-media") drawBigMedia(c, blocks);
    else if (recipe === "compare" || recipe === "sequence")
      drawCompareOrSequence(c, blocks, recipe);
    else drawQuestionOptions(c, blocks);
  }
  for (const el of c.els) (el as { authoredBy?: string }).authoredBy = "ai";
  return { c, background };
}

export function layoutBlocks(input: BlockSlide, theme: Theme, stage: Stage): LayoutResult {
  const blocks = clean(input?.blocks);
  const faults: string[] = [];
  let recipe: RecipeId = isRecipe(String(input?.recipe))
    ? (input.recipe as RecipeId)
    : suitedRecipe(blocks);
  if (!isRecipe(String(input?.recipe))) faults.push(`unknown recipe ${String(input?.recipe)}`);
  const named = recipeFaults(recipe, blocks);
  if (named.length) {
    faults.push(...named);
    const alt = suitedRecipe(blocks);
    if (alt !== recipe && recipeFaults(alt, blocks).length < named.length) {
      faults.push(`laid out as ${alt}`);
      recipe = alt;
    }
  }
  if (!blocks.some((b) => b.type === "heading")) faults.push("no heading");

  let last: LayoutResult | undefined;
  for (const step of [0, 1] as const) {
    try {
      const { c, background } = draw(theme, stage, step, recipe, blocks);
      const slide = {
        kind: input?.kind ?? kindOf(recipe, blocks),
        elements: c.els,
        ...(background ? { background } : {}),
      };
      const ruler = withKeyStage(stage, () =>
        slideFits({ id: "k", ...slide } as Slide, theme, step),
      );
      const fits = ruler.ok && c.over.length === 0;
      const over = [...c.over];
      if (!ruler.ok)
        over.push(
          `ruler: overflow ${ruler.overflow.length}, overlaps ${ruler.overlaps}, steps ${ruler.steps}`,
        );
      last = { slide, recipe, step, fits, over, faults };
      if (fits) return last;
    } catch (e) {
      faults.push(`layout threw at step ${step}: ${String(e).slice(0, 120)}`);
    }
  }
  return (
    last ?? {
      slide: { kind: "content", elements: [] },
      recipe,
      step: 1,
      fits: false,
      over: ["nothing drawn"],
      faults,
    }
  );
}

/** One layout at a fixed step with the ruler's full verdict (for tests and the catalogue). */
export function layoutAt(input: BlockSlide, theme: Theme, stage: Stage, step: 0 | 1) {
  const blocks = clean(input.blocks);
  const recipe = input.recipe as RecipeId;
  const { c, background } = draw(theme, stage, step, recipe, blocks);
  const slide = {
    id: "k",
    kind: kindOf(recipe, blocks),
    elements: c.els,
    ...(background ? { background } : {}),
  } as Slide;
  return { slide, over: c.over, ruler: withKeyStage(stage, () => slideFits(slide, theme, step)) };
}
