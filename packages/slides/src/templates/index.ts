/**
 * TEMPLATE-SPIKE (6 Oct 2026): the homepage layout set. Thirteen templates with fixed geometry on
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
import { diagramElement, diagramFaults, fittedDiagramElement, withLongLabels } from "../diagrams";
import { uid } from "../factories";
import { countLines } from "../text-measure";
import { withKeyStage } from "../themes";

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
/* Type scale per key stage (homepage ratios: heading 1.75x, lead 1.08x) */
/* ------------------------------------------------------------------ */

export type Stage = "ks1" | "ks2" | "ks3" | "ks4" | "ks5";
export type Scale = { title: number; heading: number; lead: number; body: number; small: number };
export const SCALE: Record<Stage, Scale> = {
  ks1: { title: 64, heading: 50, lead: 32, body: 30, small: 24 },
  ks2: { title: 60, heading: 44, lead: 28, body: 26, small: 22 },
  ks3: { title: 56, heading: 40, lead: 26, body: 24, small: 20 },
  ks4: { title: 56, heading: 40, lead: 26, body: 24, small: 20 },
  ks5: { title: 52, heading: 38, lead: 24, body: 22, small: 19 },
};
const LH = { title: 1.06, heading: 1.12, lead: 1.35, body: 1.4, small: 1.35 };

/* ------------------------------------------------------------------ */
/* Inputs                                                              */
/* ------------------------------------------------------------------ */

/** `aspect`: the photo's own width / height, so a panel can take its shape and crop nothing. */
export type Figure = { photo: string; alt?: string; aspect?: number } | { diagram: unknown };
export type TemplateId =
  | "title"
  | "objectives"
  | "explain"
  | "picture-text"
  | "diagram-text"
  | "big-diagram"
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
  /** Support lines (explain, picture/diagram + text), steps, objectives. */
  points?: string[];
  /** Questions (question set, practice, exit ticket). */
  questions?: string[];
  /** Hinge: the stem and its 2-4 options. */
  stem?: string;
  options?: string[];
  /** Compare: 2-3 columns. */
  columns?: { label: string; text: string }[];
  /** The one quiet line under a question list. */
  instruction?: string;
  figure?: Figure;
};

export type TemplateResult = {
  slide: Pick<Slide, "kind" | "elements" | "background">;
  over: string[];
};

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

type Role = keyof Scale;
type Ctx = { t: Theme; s: Scale; over: string[]; els: SlideElement[] };

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

function heading(c: Ctx, value: string) {
  const el = text(
    c,
    value,
    "heading",
    { x: G.margin, y: G.headY, w: G.width },
    { name: "Heading" },
  );
  if (el.y + el.h > G.band.y - 6)
    c.over.push(`heading ${Math.round(el.h / (c.s.heading * LH.heading))} lines`);
}

/** The right-hand figure panel: a photo fills it; a diagram sits on the wash with air round it. */
function figurePanel(
  c: Ctx,
  f: Figure | undefined,
  rect = { x: G.panel.x, y: G.band.y, w: G.panel.w, h: G.band.h },
) {
  if (!f) return;
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
      fit: "cover",
      radius: c.t.radius,
    } as ImageElement);
    return;
  }
  box(c, rect, wash(c.t));
  const i = G.inset;
  const inner = { x: rect.x + i, y: rect.y + i, w: rect.w - 2 * i, h: rect.h - 2 * i };
  // Labels at reading size: the largest type (from the stage's small size down) that draws clean.
  for (let fs = c.s.small; fs >= 15; fs -= 1) {
    const size = { w: inner.w, h: inner.h, fs };
    const clean = withLongLabels(() => diagramFaults(f.diagram, c.t, size).length === 0);
    const el = clean
      ? withLongLabels(() => diagramElement(f.diagram, c.t, { ...inner, fs }))
      : undefined;
    if (el) {
      if (fs < c.s.small) c.over.push(`diagram labels ${fs}pt`);
      c.els.push(el);
      return;
    }
  }
  const r = fittedDiagramElement(f.diagram, c.t, inner);
  if (r.ok) {
    c.over.push(`diagram labels below 15pt`);
    c.els.push(r.element);
  } else c.over.push(`diagram did not draw (${r.reasons.slice(0, 2).join("; ")})`);
}

/** A column of blocks, centred on the band (or top-aligned at `top`), each measured first. */
type Block = { h: number; draw: (y: number) => void };
function stack(
  c: Ctx,
  blocks: Block[],
  gap: number,
  where: { top?: number; limit?: number; what: string },
) {
  const total = blocks.reduce((a, b) => a + b.h, 0) + gap * Math.max(0, blocks.length - 1);
  const limit = where.limit ?? G.band.h;
  if (total > limit) c.over.push(`${where.what} ${total}/${limit}pt`);
  let y = where.top ?? Math.max(G.band.y, Math.round(bandMid - total / 2 - 4));
  for (const b of blocks) {
    b.draw(y);
    y += b.h + gap;
  }
}

/** Lead + support points in a column `w` wide at `x`. */
function leadAndPoints(
  c: Ctx,
  lead: string | undefined,
  points: string[],
  x: number,
  w: number,
  what: string,
) {
  const blocks: Block[] = [];
  if (lead) {
    const h = measure(c, lead, "lead", w);
    blocks.push({
      h: h + 6,
      draw: (y) => text(c, lead, "lead", { x, y, w }, { color: c.t.colors.ink, name: "Lead" }),
    });
  }
  const d = Math.round(c.s.body * 0.36);
  const indent = Math.round(c.s.body * 1.0);
  for (const p of points) {
    const h = measure(c, p, "body", w - indent);
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
          p,
          "body",
          { x: x + indent, y, w: w - indent },
          { color: c.t.colors.ink, boldLabel: true, name: "Point" },
        );
      },
    });
  }
  stack(c, blocks, Math.round(c.s.body * 0.55), { what });
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
  const d = Math.round(c.s.body * 1.25);
  const indent = d + Math.round(c.s.body * 0.7);
  const pad = opts.ruled ? Math.round(c.s.body * 0.6) : Math.round(c.s.body * 0.35);
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
    blocks.push({
      h: h + 8,
      draw: (y) =>
        text(
          c,
          after,
          "small",
          { x: x + indent, y: y + 8, w: w - indent },
          { color: c.t.colors.muted, name: "Instruction" },
        ),
    });
  }
  stack(c, blocks, 0, { what, ...(opts.top ? { top: opts.top } : {}) });
}

/* ------------------------------------------------------------------ */
/* The thirteen templates                                              */
/* ------------------------------------------------------------------ */

const KIND: Record<TemplateId, SlideKind> = {
  title: "title",
  objectives: "objectives",
  explain: "content",
  "picture-text": "image-text",
  "diagram-text": "diagram",
  "big-diagram": "diagram",
  compare: "content",
  steps: "worked-example",
  hinge: "multiple-choice",
  "question-set": "starter",
  discussion: "discussion",
  practice: "open-response",
  "exit-ticket": "exit-ticket",
};

export function layoutTemplate(input: TemplateInput, theme: Theme, stage: Stage): TemplateResult {
  return withKeyStage(stage, () => {
    const c: Ctx = { t: theme, s: SCALE[stage], over: [], els: [] };
    const tpl = input.template;
    let background: Slide["background"];
    const pts = input.points ?? [];
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
        const fits = () =>
          countLines(input.heading, "title", theme, w, theme.weights.heading, size) <= (f ? 6 : 3);
        while (size > c.s.heading && !fits()) size -= 2;
        c.s = { ...c.s, title: size };
        if (size < SCALE[stage].title) c.over.push(`title stepped to ${size}pt`);
        const tH = measure(c, input.heading, "title", w);
        const lH = input.lead ? measure(c, input.lead, "lead", w, 400) : 0;
        const total = tH + (lH ? 20 + lH : 0);
        const y = Math.round(270 - total / 2);
        text(c, input.heading, "title", { x: G.margin, y, w }, { color: on, name: "Title" });
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
        leadAndPoints(c, input.lead, pts, G.margin, 680, "explain");
        break;
      case "picture-text":
      case "diagram-text":
        heading(c, input.heading);
        leadAndPoints(c, input.lead, pts, G.left.x, G.left.w, "text column");
        figurePanel(c, input.figure);
        break;
      case "big-diagram": {
        heading(c, input.heading);
        const line = input.lead;
        const lh = line ? measure(c, line, "body", G.width) + 14 : 0;
        if (line && lh > c.s.body * LH.body * 2 + 14) c.over.push("caption over 2 lines");
        figurePanel(c, input.figure, { x: G.margin, y: G.band.y, w: G.width, h: G.band.h - lh });
        if (line)
          text(
            c,
            line,
            "body",
            { x: G.margin, y: bandBottom - lh + 14, w: G.width },
            { color: theme.colors.muted, name: "Caption" },
          );
        break;
      }
      case "compare": {
        heading(c, input.heading);
        const cols = input.columns ?? [];
        const gap = 24;
        const w = Math.floor((G.width - gap * (cols.length - 1)) / Math.max(1, cols.length));
        const pad = 22;
        const hs = cols.map(
          (col) =>
            measure(c, col.label, "lead", w - 2 * pad, 700) +
            10 +
            measure(c, col.text, "body", w - 2 * pad),
        );
        const h = Math.max(...hs, 0) + 2 * pad;
        if (h > G.band.h) c.over.push(`compare ${h}/${G.band.h}pt`);
        const y = Math.max(G.band.y, Math.round(bandMid - h / 2 - 4));
        cols.forEach((col, k) => {
          const x = G.margin + k * (w + gap);
          box(c, { x, y, w, h }, theme.colors.surface, {
            stroke: theme.colors.line,
            strokeWidth: 1,
            radius: Math.min(theme.radius, 16),
          });
          const lab = text(
            c,
            col.label,
            "lead",
            { x: x + pad, y: y + pad, w: w - 2 * pad },
            { color: theme.colors.accent, weight: 700, name: "Label" },
          );
          text(
            c,
            col.text,
            "body",
            { x: x + pad, y: lab.y + lab.h + 10, w: w - 2 * pad },
            { color: theme.colors.ink, name: "Text" },
          );
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
        const gap = 18;
        const w = Math.floor((G.width - gap) / 2);
        const pad = 20;
        const d = Math.round(c.s.body * 1.25);
        const iw = w - 2 * pad - d - 14;
        const rowH = Math.max(...opts.map((o) => measure(c, o, "body", iw)), d) + 2 * pad;
        const rows = Math.ceil(opts.length / 2);
        const sH = stem ? measure(c, stem, "lead", G.width) + 22 : 0;
        const total = sH + rows * rowH + (rows - 1) * gap;
        if (total > G.band.h) c.over.push(`hinge ${total}/${G.band.h}pt`);
        let y = Math.max(G.band.y, Math.round(bandMid - total / 2 - 4));
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
          const x = G.margin + (k % 2) * (w + gap);
          const yy = y + Math.floor(k / 2) * (rowH + gap);
          box(c, { x, y: yy, w, h: rowH }, theme.colors.surface, {
            stroke: theme.colors.line,
            strokeWidth: 1,
            radius: Math.min(theme.radius, 16),
            name: "Option",
          });
          disc(c, String.fromCharCode(65 + k), x + pad, yy + rowH / 2 - d / 2, d);
          const th = measure(c, o, "body", iw);
          text(
            c,
            o,
            "body",
            { x: x + pad + d + 14, y: yy + rowH / 2 - th / 2, w: iw },
            { color: theme.colors.ink, name: "Option text" },
          );
        });
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
          leadAndPoints(c, prompt, pts, G.left.x, G.left.w, "discussion");
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
    };
  });
}
