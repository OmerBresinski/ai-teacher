/**
 * BAKEOFF arm R (6 Oct 2026): reference-slide editing (PPTAgent). About twenty designer-made
 * reference slides on the homepage grid (960x540; `TEMPLATE-SPIKE/STUDY.md`) plus Chalkie's best
 * patterns (bleed photo, picture sequence, key-point bar). The model picks a reference per slide
 * and replaces the content of its slots; it may delete a list item or an optional slot. It never
 * places, moves or resizes anything: every panel, column, card and region is fixed by the
 * reference (per key stage, since the type scale differs). Text inside a fixed region is set at
 * its role size and aligned as the reference says (most centre on the band, as the homepage does).
 *
 * Fit: a slot whose text runs past its region (or its line cap) is set one type step down; if it
 * still does not fit it is flagged in `over` and drawn anyway. The finished slide is then judged by
 * the shared ruler (`slideFits`, step-down 1), whose faults are added to `over`.
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
import { slideFits } from "../fit-check";
import { G, mix, type Scale, type Stage } from "../templates";
import { countLines, measureHeadless } from "../text-measure";
import { getTheme, KEY_STAGE_TYPE, typeScale, withKeyStage } from "../themes";

export type { Stage };
/** A resolved picture: a photo (its own aspect, if known) or a diagram spec for the drawer. */
export type Figure = { photo: string; alt?: string; aspect?: number } | { diagram: unknown };
type Role = keyof Scale;
const LH: Record<Role, number> = { title: 1.06, heading: 1.12, lead: 1.3, body: 1.38, small: 1.35 };
/** One type step down per role (UX ruling 91: one step, then flag). */
const DOWN: Record<Role, (s: Scale) => number> = {
  title: (s) => Math.round(s.title * 0.86),
  heading: (s) => Math.round(s.heading * 0.88),
  lead: (s) => s.body,
  body: (s) => s.small,
  small: (s) => s.small,
};

/**
 * The type scale at a key stage, from the theme's own ladder (lab/fix-type `typeScale`): title,
 * heading and body are its stops; lead is body x 1.08 (the homepage's lead step, set 600);
 * small is bodySmall, which is also the stage's reading floor, so nothing steps below it.
 */
export function scaleFor(t: Theme, st: Stage): Scale {
  const ts = withKeyStage(st, () => typeScale(t));
  const body = KEY_STAGE_TYPE[st].body;
  return {
    title: ts?.title ?? 60,
    heading: ts?.heading ?? 40,
    lead: Math.round(body * 1.08),
    body,
    small: ts?.bodySmall ?? Math.round(body * 0.85),
  };
}
const themeFor = (st: Stage) => getTheme(st === "ks1" || st === "ks2" ? "splash" : "studio", st);

/* ------------------------------------------------------------------ */
/* Slot schema (what the catalogue publishes and the model fills)       */
/* ------------------------------------------------------------------ */

type TextCap = { role: Role; w: number; lines: number; weight?: number };
export type SlotDef =
  | { id: string; kind: "text"; optional?: boolean; cap: TextCap; note?: string }
  | {
      id: string;
      kind: "list";
      optional?: boolean;
      min: number;
      max: number;
      cap: TextCap;
      note?: string;
    }
  | {
      id: string;
      kind: "items";
      optional?: boolean;
      min: number;
      max: number;
      /** Fields of each item; caps per field. `picture` fields are photo slots. */
      fields: Record<string, TextCap | { picture: "photo" | "figure"; aspect: number }>;
      note?: string;
    }
  | {
      id: string;
      kind: "photo" | "diagram" | "figure";
      optional?: boolean;
      /** Box width / height, so the picture director can ask for the right shape. */
      aspect: number;
      note?: string;
    };

type Values = Record<string, unknown>;
type Ctx = {
  t: Theme;
  st: Stage;
  s: Scale;
  els: SlideElement[];
  over: Map<string, string>;
  down: Set<string>;
};

export type RefDef = {
  id: string;
  kind: SlideKind;
  useWhen: string;
  /** Key stages it suits best (all when absent). */
  suits?: Stage[];
  background?: (t: Theme) => Slide["background"];
  slots: (st: Stage) => SlotDef[];
  draw: (c: Ctx, v: Values, slots: SlotDef[]) => void;
};

/* ------------------------------------------------------------------ */
/* Text primitives                                                     */
/* ------------------------------------------------------------------ */

const wash = (t: Theme) => mix(t.colors.accent, t.colors.background, 0.1);
const plain = (text: string) => text.replace(/\*\*/g, "");
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
const doc = (text: string, boldLabel = false): RichDoc =>
  ({ type: "doc", content: [{ type: "paragraph", content: runs(text, boldLabel) }] }) as RichDoc;
const presetOf = (r: Role) => (r === "title" ? "title" : r === "heading" ? "heading" : "body");
const weightOf = (r: Role, t: Theme) =>
  r === "title" || r === "heading" ? t.weights.heading : r === "lead" ? 600 : t.weights.body;

const sizeOf = (c: Ctx, slot: string, role: Role) =>
  c.down.has(slot) ? DOWN[role](c.s) : c.s[role];
/** Height of `text` as the shared ruler measures it (bold runs at 700; a leading label bold). */
function heightOf(c: Ctx, slot: string, text: string, role: Role, w: number, weight?: number) {
  const size = sizeOf(c, slot, role);
  const preset = presetOf(role);
  return Math.ceil(
    measureHeadless(c.t)({
      doc: doc(text, true),
      width: w,
      style: {
        preset,
        fontSize: size,
        lineHeight: LH[role],
        fontWeight: weight ?? weightOf(role, c.t),
        padding: 0,
      },
      preset,
      fontSize: size,
      inset: 0,
      chrome: 0,
    }),
  );
}
const lineH = (c: Ctx, slot: string, role: Role) => sizeOf(c, slot, role) * LH[role];
const linesOf = (c: Ctx, slot: string, text: string, role: Role, w: number, weight?: number) =>
  Math.max(1, Math.round(heightOf(c, slot, text, role, w, weight) / lineH(c, slot, role)));
const flag = (c: Ctx, slot: string, why: string) => {
  if (!c.over.has(slot)) c.over.set(slot, why);
};
/** Flag `slot` when `text` runs past `max` lines. */
function capLines(c: Ctx, slot: string, text: string, cap: TextCap, max = cap.lines) {
  const n = linesOf(c, slot, text, cap.role, cap.w, cap.weight);
  if (n > max) flag(c, slot, `${n}/${max} lines`);
}

type TextOpts = {
  color?: string;
  weight?: number;
  align?: "left" | "center";
  valign?: "top" | "middle" | "bottom";
  boldLabel?: boolean;
  name?: string;
  h?: number;
};
function put(
  c: Ctx,
  slot: string,
  value: string,
  role: Role,
  rect: { x: number; y: number; w: number },
  o: TextOpts = {},
): TextElement {
  const size = sizeOf(c, slot, role);
  const h = o.h ?? heightOf(c, slot, value, role, rect.w, o.weight);
  const el: TextElement = {
    id: uid(),
    type: "text",
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    w: Math.round(rect.w),
    h: Math.round(h),
    doc: doc(value, o.boldLabel),
    name: o.name ?? slot,
    style: {
      preset: presetOf(role),
      autoHeight: o.h === undefined,
      fontSize: size,
      lineHeight: LH[role],
      fontWeight: o.weight ?? weightOf(role, c.t),
      padding: 0,
      ...(o.color ? { color: o.color } : {}),
      ...(o.align ? { align: o.align } : {}),
      ...(o.valign ? { valign: o.valign } : {}),
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
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    w: Math.round(rect.w),
    h: Math.round(rect.h),
    fill,
    radius: c.t.radius,
    name: "Panel",
    ...extra,
  };
  c.els.push(el);
  return el;
}
const card = (c: Ctx, rect: { x: number; y: number; w: number; h: number }, name = "Card") =>
  box(c, rect, c.t.colors.surface, {
    stroke: c.t.colors.line,
    strokeWidth: 1,
    radius: Math.min(c.t.radius, 16),
    name,
  });

function disc(c: Ctx, label: string, x: number, y: number, d: number, fill?: string) {
  c.els.push({
    id: uid(),
    type: "shape",
    shape: "ellipse",
    x: Math.round(x),
    y: Math.round(y),
    w: d,
    h: d,
    fill: fill ?? c.t.colors.accent,
    name: "Marker",
    doc: doc(label),
    textStyle: {
      preset: "body",
      fontSize: Math.round(d * 0.52),
      fontWeight: 700,
      color: c.t.colors.onAccent,
      align: "center",
      valign: "middle",
      padding: 0,
    },
  } as ShapeElement);
}
function dot(c: Ctx, x: number, y: number, d: number, fill?: string, name = "Bullet") {
  c.els.push({
    id: uid(),
    type: "shape",
    shape: "ellipse",
    x: Math.round(x),
    y: Math.round(y),
    w: d,
    h: d,
    fill: fill ?? c.t.colors.accent,
    name,
  });
}
function rule(c: Ctx, x: number, y: number, w: number, h = 1, fill?: string) {
  c.els.push({
    id: uid(),
    type: "shape",
    shape: "rect",
    x: Math.round(x),
    y: Math.round(y),
    w: Math.round(w),
    h,
    fill: fill ?? c.t.colors.line,
    name: "Rule",
  });
}

/* ------------------------------------------------------------------ */
/* Regions: blocks stacked in a fixed box, aligned as the reference says */
/* ------------------------------------------------------------------ */

type Block = { h: number; slots: string[]; draw: (y: number) => void };
function region(
  c: Ctx,
  blocks: Block[],
  r: { y: number; h: number },
  gap: number,
  align: "middle" | "top" = "middle",
) {
  const total = blocks.reduce((a, b) => a + b.h, 0) + gap * Math.max(0, blocks.length - 1);
  if (total > r.h)
    for (const s of new Set(blocks.flatMap((b) => b.slots)))
      flag(c, s, `region ${Math.round(total)}/${r.h}pt`);
  let y = align === "top" ? r.y : Math.max(r.y, Math.round(r.y + (r.h - total) / 2 - 4));
  for (const b of blocks) {
    b.draw(y);
    y += b.h + gap;
  }
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const strs = (v: unknown) =>
  Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean) : [];
const objs = (v: unknown) =>
  Array.isArray(v)
    ? (v.filter((x) => x && typeof x === "object") as Record<string, unknown>[])
    : [];
const fig = (v: unknown): Figure | undefined =>
  v && typeof v === "object" && ("photo" in v || "diagram" in v) ? (v as Figure) : undefined;

function leadBlock(c: Ctx, slot: string, text: string, x: number, w: number, o: TextOpts = {}) {
  const role: Role = "lead";
  return {
    h: heightOf(c, slot, text, role, w, o.weight) + 4,
    slots: [slot],
    draw: (y: number) =>
      put(c, slot, text, role, { x, y, w }, { color: c.t.colors.ink, name: "Lead", ...o }),
  } as Block;
}
function lineBlock(
  c: Ctx,
  slot: string,
  text: string,
  role: Role,
  x: number,
  w: number,
  o: TextOpts = {},
) {
  return {
    h: heightOf(c, slot, text, role, w, o.weight),
    slots: [slot],
    draw: (y: number) => put(c, slot, text, role, { x, y, w }, o),
  } as Block;
}
function bulletBlocks(
  c: Ctx,
  slot: string,
  items: string[],
  x: number,
  w: number,
  maxLines: number,
) {
  const role: Role = "body";
  const d = Math.round(c.s.body * 0.34);
  const indent = Math.round(c.s.body * 0.95);
  return items.map((p) => {
    const n = linesOf(c, slot, p, role, w - indent);
    if (n > maxLines) flag(c, slot, `item ${n}/${maxLines} lines`);
    return {
      h: Math.ceil(n * lineH(c, slot, role)),
      slots: [slot],
      draw: (y: number) => {
        dot(c, x + 2, y + lineH(c, slot, role) / 2 - d / 2, d);
        put(
          c,
          slot,
          p,
          role,
          { x: x + indent, y, w: w - indent },
          {
            color: c.t.colors.ink,
            boldLabel: true,
            name: "Point",
          },
        );
      },
    } as Block;
  });
}
function numberedBlocks(
  c: Ctx,
  slot: string,
  items: string[],
  x: number,
  w: number,
  maxLines: number,
  o: { ruled?: boolean; role?: Role; letters?: boolean } = {},
) {
  const role = o.role ?? "body";
  const d = Math.round(c.s.body * 1.2);
  const indent = d + Math.round(c.s.body * 0.65);
  const pad = o.ruled ? Math.round(c.s.body * 0.55) : Math.round(c.s.body * 0.3);
  return items.map((q, k) => {
    const n = linesOf(c, slot, q, role, w - indent);
    if (n > maxLines) flag(c, slot, `item ${n}/${maxLines} lines`);
    const th = Math.ceil(n * lineH(c, slot, role));
    return {
      h: Math.max(d, th) + 2 * pad,
      slots: [slot],
      draw: (y: number) => {
        if (o.ruled && k > 0) rule(c, x, y, w);
        const top = y + pad;
        disc(
          c,
          o.letters ? String.fromCharCode(65 + k) : String(k + 1),
          x,
          top + Math.max(0, (lineH(c, slot, role) - d) / 2),
          d,
        );
        put(
          c,
          slot,
          q,
          role,
          { x: x + indent, y: top, w: w - indent },
          {
            color: c.t.colors.ink,
            boldLabel: true,
            name: "Item",
          },
        );
      },
    } as Block;
  });
}

/** A fixed figure box: a photo covers it; a diagram sits on the wash with air round it. */
function figureBox(
  c: Ctx,
  slot: string,
  f: Figure | undefined,
  rect: { x: number; y: number; w: number; h: number },
  o: { radius?: number; ground?: string; inset?: number } = {},
) {
  if (!f) return;
  if ("photo" in f) {
    c.els.push({
      id: uid(),
      type: "image",
      name: "Photo",
      ...rect,
      src: f.photo,
      alt: f.alt ?? "",
      fit: "cover",
      radius: o.radius ?? c.t.radius,
    } as ImageElement);
    return;
  }
  box(c, rect, o.ground ?? wash(c.t), { radius: o.radius ?? c.t.radius });
  const i = o.inset ?? 22;
  const inner = { x: rect.x + i, y: rect.y + i, w: rect.w - 2 * i, h: rect.h - 2 * i };
  for (let fs = c.s.small; fs >= 15; fs -= 1) {
    const clean = withLongLabels(
      () => diagramFaults(f.diagram, c.t, { w: inner.w, h: inner.h, fs }).length === 0,
    );
    const el = clean
      ? withLongLabels(() => diagramElement(f.diagram, c.t, { ...inner, fs }))
      : undefined;
    if (el) {
      if (fs < c.s.small - 3) flag(c, slot, `diagram labels ${fs}pt`);
      c.els.push(el);
      return;
    }
  }
  const r = fittedDiagramElement(f.diagram, c.t, inner);
  if (r.ok) {
    flag(c, slot, "diagram labels below 15pt");
    c.els.push(r.element);
  } else flag(c, slot, `diagram did not draw (${r.reasons.slice(0, 2).join("; ")})`);
}

/* ------------------------------------------------------------------ */
/* Shared geometry                                                     */
/* ------------------------------------------------------------------ */

const BAND: { y: number; h: number } = { y: G.band.y, h: G.band.h }; // 160..488
const COL = { x: G.left.x, w: G.left.w }; // 64, 392
const PANEL = { x: G.panel.x, y: G.band.y, w: G.panel.w, h: G.band.h }; // 504..896
const FULL = { x: G.margin, w: G.width }; // 64, 832
const PROSE = 760; // full-width text measure (homepage lists never run the whole 832)
const isPrimary = (st: Stage) => st === "ks1" || st === "ks2";
/** Body-line count a column of height h holds at the stage. */
const linesIn = (st: Stage, h: number, role: Role = "body") =>
  Math.floor(h / (scaleFor(themeFor(st), st)[role] * LH[role]));

const HEADING: SlotDef = {
  id: "heading",
  kind: "text",
  cap: { role: "heading", w: G.width, lines: 2 },
  note: "Slide heading. One line is best.",
};
function heading(c: Ctx, v: Values) {
  const h = str(v.heading);
  if (!h) return;
  capLines(c, "heading", h, { role: "heading", w: G.width, lines: 2 });
  put(c, "heading", h, "heading", { x: G.margin, y: G.headY, w: G.width }, { name: "Heading" });
}

/** The key-point bar (Chalkie's callout, homepage quiet): wash, accent rule, one bold line. */
const BAR = { y: 404, h: 84 };
function keyBar(c: Ctx, slot: string, text: string | undefined) {
  if (!text) return;
  box(c, { x: FULL.x, y: BAR.y, w: FULL.w, h: BAR.h }, wash(c.t), {
    radius: Math.min(c.t.radius, 14),
    name: "Key point",
  });
  rule(c, FULL.x, BAR.y + 14, 6, BAR.h - 28, c.t.colors.accent);
  const w = FULL.w - 64;
  capLines(c, slot, text, { role: "lead", w, lines: 2 });
  put(
    c,
    slot,
    text,
    "lead",
    { x: FULL.x + 34, y: BAR.y, w },
    {
      color: c.t.colors.ink,
      valign: "middle",
      h: BAR.h,
      boldLabel: true,
      name: "Key point text",
    },
  );
}

/** Column text (lead + bullets) for a split slide. */
function columnText(
  c: Ctx,
  v: Values,
  x: number,
  w: number,
  r = BAND,
  leadSlot = "lead",
  pts = "points",
) {
  const blocks: Block[] = [];
  const lead = str(v[leadSlot]);
  if (lead) blocks.push(leadBlock(c, leadSlot, lead, x, w));
  blocks.push(...bulletBlocks(c, pts, strs(v[pts]), x, w, 3));
  region(c, blocks, r, Math.round(c.s.body * 0.5));
}

/* ------------------------------------------------------------------ */
/* The references                                                      */
/* ------------------------------------------------------------------ */

const TITLE_PANEL = { x: 496, y: 48, w: 400, h: 444 };
const BLEED = { x: 504, y: 0, w: 456, h: 540 };
const BIG = { x: FULL.x, y: BAND.y, w: FULL.w, h: 262 };
const BIG_CAP = { y: BIG.y + BIG.h + 14, h: 488 - (BIG.y + BIG.h + 14) };

function seqGeom(n: number) {
  const gap = 24;
  const w = Math.floor((FULL.w - gap * (n - 1)) / n);
  const ph = n <= 2 ? 216 : n === 3 ? 196 : 160;
  return { gap, w, ph };
}

export const REFERENCES: RefDef[] = [
  {
    id: "title",
    kind: "title",
    useWhen:
      "Slide 1 of every lesson: the lesson title and its enquiry question, beside one picture.",
    background: (t) => ({ color: t.colors.accent }),
    slots: () => [
      {
        id: "title",
        kind: "text",
        cap: { role: "title", w: 392, lines: 4 },
        note: "Lesson title.",
      },
      {
        id: "subtitle",
        kind: "text",
        optional: true,
        cap: { role: "lead", w: 392, lines: 3, weight: 400 },
        note: "The enquiry question or a one-line promise.",
      },
      {
        id: "picture",
        kind: "figure",
        optional: true,
        aspect: 400 / 444,
        note: "One photo or a simple diagram that says the topic at a glance.",
      },
    ],
    draw: (c, v) => {
      const on = c.t.colors.onAccent;
      const title = str(v.title) ?? "";
      const sub = str(v.subtitle);
      const w = 392;
      capLines(c, "title", title, { role: "title", w, lines: 4 });
      const blocks: Block[] = [
        lineBlock(c, "title", title, "title", G.margin, w, { color: on, name: "Title" }),
      ];
      if (sub)
        blocks.push(
          lineBlock(c, "subtitle", sub, "lead", G.margin, w, {
            color: on,
            weight: 400,
            name: "Subtitle",
          }),
        );
      region(c, blocks, { y: 48, h: 444 }, 22);
      figureBox(c, "picture", fig(v.picture), TITLE_PANEL, {
        ground: mix(c.t.colors.onAccent, c.t.colors.accent, 0.9),
        radius: Math.max(c.t.radius, 18),
      });
    },
  },
  {
    id: "hook-bleed",
    kind: "content",
    useWhen:
      "A hook or story opener (starter): a short scene or puzzle told beside one big photo that bleeds off the right edge. Best at KS1-2 and for any 'imagine...' opener.",
    slots: (st) => [
      {
        id: "heading",
        kind: "text",
        cap: { role: "heading", w: 400, lines: 2 },
        note: "A question or a hook phrase.",
      },
      {
        id: "story",
        kind: "text",
        cap: { role: "body", w: 400, lines: isPrimary(st) ? 5 : 6 },
        note: "2-3 short sentences: the scene or puzzle.",
      },
      {
        id: "question",
        kind: "text",
        optional: true,
        cap: { role: "lead", w: 400, lines: 2 },
        note: "The question pupils think about.",
      },
      {
        id: "picture",
        kind: "photo",
        aspect: BLEED.w / BLEED.h,
        note: "A real photo of the scene; portrait works.",
      },
    ],
    draw: (c, v) => {
      const w = 400;
      const blocks: Block[] = [];
      const h = str(v.heading);
      if (h) {
        capLines(c, "heading", h, { role: "heading", w, lines: 2 });
        blocks.push({
          ...lineBlock(c, "heading", h, "heading", G.margin, w, {
            name: "Heading",
            color: c.t.colors.accent,
          }),
          h: heightOf(c, "heading", h, "heading", w) + 8,
        });
      }
      const story = str(v.story);
      if (story)
        blocks.push(
          lineBlock(c, "story", story, "body", G.margin, w, {
            color: c.t.colors.ink,
            name: "Story",
          }),
        );
      const q = str(v.question);
      if (q) blocks.push(leadBlock(c, "question", q, G.margin, w));
      region(c, blocks, { y: 40, h: 460 }, Math.round(c.s.body * 0.7));
      figureBox(c, "picture", fig(v.picture), BLEED, { radius: 0 });
    },
  },
  {
    id: "objectives",
    kind: "objectives",
    useWhen: "The lesson's learning objectives (or success criteria), numbered.",
    slots: (st) => [
      HEADING,
      {
        id: "items",
        kind: "list",
        min: 2,
        max: isPrimary(st) ? 3 : 4,
        cap: { role: "body", w: PROSE - 60, lines: 2 },
        note: "One objective each, pupil-facing ('I can ...').",
      },
    ],
    draw: (c, v) => {
      heading(c, v);
      region(c, numberedBlocks(c, "items", strs(v.items), FULL.x, PROSE, 2), BAND, 4);
    },
  },
  {
    id: "explain-picture",
    kind: "image-text",
    useWhen:
      "Teach one idea with a real photo that shows it: a bold lead sentence, up to 3 short support lines, photo on the right.",
    slots: (st) => [
      HEADING,
      {
        id: "lead",
        kind: "text",
        cap: { role: "lead", w: COL.w, lines: isPrimary(st) ? 3 : 4 },
        note: "The one idea, in one sentence. **bold** one key phrase.",
      },
      {
        id: "points",
        kind: "list",
        optional: true,
        min: 0,
        max: isPrimary(st) ? 2 : 3,
        cap: { role: "body", w: COL.w - 24, lines: 3 },
        note: `Support lines. Lead + points together fit about ${linesIn(st, BAND.h)} body lines.`,
      },
      {
        id: "picture",
        kind: "photo",
        aspect: PANEL.w / PANEL.h,
        note: "A real photo of exactly what the lead says.",
      },
    ],
    draw: (c, v) => {
      heading(c, v);
      columnText(c, v, COL.x, COL.w);
      figureBox(c, "picture", fig(v.picture), PANEL);
    },
  },
  {
    id: "explain-diagram",
    kind: "diagram",
    useWhen:
      "Teach one idea that a drawing explains better than a photo (a process, a structure, a graph): lead + support beside a diagram panel.",
    slots: (st) => [
      HEADING,
      {
        id: "lead",
        kind: "text",
        cap: { role: "lead", w: COL.w, lines: isPrimary(st) ? 3 : 4 },
        note: "The one idea, in one sentence.",
      },
      {
        id: "points",
        kind: "list",
        optional: true,
        min: 0,
        max: isPrimary(st) ? 2 : 3,
        cap: { role: "body", w: COL.w - 24, lines: 3 },
        note: `Support lines. Lead + points together fit about ${linesIn(st, BAND.h)} body lines.`,
      },
      {
        id: "picture",
        kind: "diagram",
        aspect: (PANEL.w - 44) / (PANEL.h - 44),
        note: "The diagram (drawer spec).",
      },
    ],
    draw: (c, v) => {
      heading(c, v);
      columnText(c, v, COL.x, COL.w);
      figureBox(c, "picture", fig(v.picture), PANEL);
    },
  },
  {
    id: "explain-keypoint",
    kind: "content",
    useWhen:
      "Teach an idea with no picture: lead + up to 3 points across the slide, and the one thing to remember in a key-point bar at the foot.",
    slots: (st) => [
      HEADING,
      {
        id: "lead",
        kind: "text",
        cap: { role: "lead", w: PROSE, lines: 2 },
        note: "The idea in one sentence.",
      },
      {
        id: "points",
        kind: "list",
        optional: true,
        min: 0,
        max: 3,
        cap: { role: "body", w: PROSE - 24, lines: 2 },
        note: `Lead + points fit about ${linesIn(st, BAR.y - 12 - BAND.y)} body lines.`,
      },
      {
        id: "keypoint",
        kind: "text",
        cap: { role: "lead", w: FULL.w - 64, lines: 2 },
        note: "The one thing to remember. 'Label: text' bolds the label.",
      },
    ],
    draw: (c, v) => {
      heading(c, v);
      columnText(c, v, FULL.x, PROSE, { y: BAND.y, h: BAR.y - 12 - BAND.y });
      keyBar(c, "keypoint", str(v.keypoint));
    },
  },
  {
    id: "big-picture",
    kind: "image-text",
    useWhen:
      "The picture is the content (a place, an object, a source to look at closely): one wide photo with a caption line.",
    slots: () => [
      HEADING,
      {
        id: "picture",
        kind: "photo",
        aspect: BIG.w / BIG.h,
        note: "A wide real photo (landscape).",
      },
      {
        id: "caption",
        kind: "text",
        optional: true,
        cap: { role: "body", w: FULL.w, lines: 1 },
        note: "What to look at, one line.",
      },
    ],
    draw: (c, v) => {
      heading(c, v);
      figureBox(c, "picture", fig(v.picture), BIG);
      const cap = str(v.caption);
      if (cap) {
        capLines(c, "caption", cap, { role: "body", w: FULL.w, lines: 1 });
        region(
          c,
          [
            lineBlock(c, "caption", cap, "body", FULL.x, FULL.w, {
              color: c.t.colors.muted,
              name: "Caption",
            }),
          ],
          BIG_CAP,
          0,
          "top",
        );
      }
    },
  },
  {
    id: "big-diagram",
    kind: "diagram",
    useWhen:
      "The diagram is the content and needs the whole width (a cycle, a timeline graph, a labelled cross-section): diagram across the slide, caption line under.",
    slots: () => [
      HEADING,
      {
        id: "picture",
        kind: "diagram",
        aspect: (BIG.w - 44) / (BIG.h - 44),
        note: "A wide diagram.",
      },
      {
        id: "caption",
        kind: "text",
        optional: true,
        cap: { role: "body", w: FULL.w, lines: 1 },
        note: "The one-line takeaway.",
      },
    ],
    draw: (c, v) => {
      heading(c, v);
      figureBox(c, "picture", fig(v.picture), BIG);
      const cap = str(v.caption);
      if (cap) {
        capLines(c, "caption", cap, { role: "body", w: FULL.w, lines: 1 });
        region(
          c,
          [
            lineBlock(c, "caption", cap, "body", FULL.x, FULL.w, {
              color: c.t.colors.muted,
              name: "Caption",
            }),
          ],
          BIG_CAP,
          0,
          "top",
        );
      }
    },
  },
  {
    id: "picture-sequence",
    kind: "image-text",
    useWhen:
      "2-4 things side by side, each with its own photo: stages of a change, examples of a group, then-and-now. Picture-led; strong at KS1-2.",
    slots: (st) => [
      HEADING,
      {
        id: "frames",
        kind: "items",
        min: 2,
        max: 4,
        fields: {
          picture: { picture: "photo", aspect: seqGeom(3).w / seqGeom(3).ph },
          caption: { role: isPrimary(st) ? "body" : "body", w: seqGeom(3).w, lines: 3 },
        },
        note: "Each frame: a photo and a caption (**bold** the key word). Caption width shrinks at 4 frames (small type).",
      },
    ],
    draw: (c, v) => {
      heading(c, v);
      const fr = objs(v.frames).slice(0, 4);
      const n = Math.max(1, fr.length);
      const g = seqGeom(n);
      const role: Role = n === 4 ? "small" : "body";
      const capH = Math.max(
        0,
        ...fr.map((f) => heightOf(c, "frames", str(f.caption) ?? "", role, g.w)),
      );
      const total = g.ph + 14 + capH;
      if (total > BAND.h) flag(c, "frames", `frames ${total}/${BAND.h}pt`);
      fr.forEach((f) => {
        const t = str(f.caption) ?? "";
        if (linesOf(c, "frames", t, role, g.w) > 3) flag(c, "frames", "caption over 3 lines");
      });
      const y = Math.max(BAND.y, Math.round(BAND.y + (BAND.h - total) / 2 - 4));
      fr.forEach((f, k) => {
        const x = FULL.x + k * (g.w + g.gap);
        figureBox(c, "frames", fig(f.picture), { x, y, w: g.w, h: g.ph });
        const t = str(f.caption);
        if (t)
          put(
            c,
            "frames",
            t,
            role,
            { x, y: y + g.ph + 14, w: g.w },
            { color: c.t.colors.ink, name: "Caption" },
          );
      });
    },
  },
  {
    id: "compare",
    kind: "content",
    useWhen:
      "Compare or contrast 2-3 things (causes, sides, states, methods): one card each with a label and its text.",
    slots: (st) => [
      HEADING,
      {
        id: "columns",
        kind: "items",
        min: 2,
        max: 3,
        fields: {
          label: { role: "lead", w: 360, lines: 1, weight: 700 },
          text: { role: "body", w: 360, lines: linesIn(st, 300 - 2 * 26 - 40) },
        },
        note: "Label 1-3 words. With 3 columns each text is about 60% as wide (cap the text at ~2/3 of the 2-column figure).",
      },
    ],
    draw: (c, v) => {
      heading(c, v);
      const cols = objs(v.columns).slice(0, 3);
      const n = Math.max(1, cols.length);
      const gap = 24;
      const w = Math.floor((FULL.w - gap * (n - 1)) / n);
      const pad = 26;
      const y = 172;
      const h = 300;
      cols.forEach((col, k) => {
        const x = FULL.x + k * (w + gap);
        card(c, { x, y, w, h });
        const lab = str(col.label) ?? "";
        const txt = str(col.text) ?? "";
        const iw = w - 2 * pad;
        const lh = heightOf(c, "columns", lab, "lead", iw, 700);
        const th = heightOf(c, "columns", txt, "body", iw);
        if (lh + 12 + th > h - 2 * pad) flag(c, "columns", `card ${lh + 12 + th}/${h - 2 * pad}pt`);
        put(
          c,
          "columns",
          lab,
          "lead",
          { x: x + pad, y: y + pad, w: iw },
          { color: c.t.colors.accent, weight: 700, name: "Label" },
        );
        put(
          c,
          "columns",
          txt,
          "body",
          { x: x + pad, y: y + pad + lh + 12, w: iw },
          { color: c.t.colors.ink, name: "Text" },
        );
      });
    },
  },
  {
    id: "steps",
    kind: "worked-example",
    useWhen:
      "A method, worked example or process in numbered steps, with a picture or diagram that shows the working.",
    slots: (st) => [
      HEADING,
      {
        id: "steps",
        kind: "list",
        min: 2,
        max: isPrimary(st) ? 4 : 5,
        cap: { role: "body", w: COL.w - 46, lines: 3 },
        note: `Numbered steps; the last can be the answer in **bold**. All steps together fit about ${linesIn(st, BAND.h - 40)} body lines.`,
      },
      {
        id: "picture",
        kind: "figure",
        aspect: PANEL.w / PANEL.h,
        note: "The working drawn (diagram) or a photo of the practical.",
      },
    ],
    draw: (c, v) => {
      heading(c, v);
      region(c, numberedBlocks(c, "steps", strs(v.steps), COL.x, COL.w, 3), BAND, 2);
      figureBox(c, "picture", fig(v.picture), PANEL);
    },
  },
  {
    id: "steps-wide",
    kind: "worked-example",
    useWhen:
      "A method or worked example with no picture: numbered steps across the slide, the result in a bar at the foot.",
    slots: (st) => [
      HEADING,
      {
        id: "steps",
        kind: "list",
        min: 2,
        max: st === "ks1" ? 3 : 4,
        cap: { role: "body", w: PROSE - 46, lines: 2 },
        note: `Steps fit about ${linesIn(st, BAR.y - 12 - BAND.y)} body lines.`,
      },
      {
        id: "result",
        kind: "text",
        optional: true,
        cap: { role: "lead", w: FULL.w - 64, lines: 2 },
        note: "The answer or rule, e.g. 'Answer: 1/4 of 12 is 3'.",
      },
    ],
    draw: (c, v) => {
      heading(c, v);
      const r = str(v.result) ? { y: BAND.y, h: BAR.y - 12 - BAND.y } : BAND;
      region(c, numberedBlocks(c, "steps", strs(v.steps), FULL.x, PROSE, 2), r, 2);
      keyBar(c, "result", str(v.result));
    },
  },
  {
    id: "timeline",
    kind: "content",
    useWhen: "Events in time order (history, a life cycle, a story): 3-6 dated points on one line.",
    slots: (st) => [
      HEADING,
      {
        id: "events",
        kind: "items",
        min: 3,
        max: isPrimary(st) ? 5 : 6,
        fields: {
          when: { role: "lead", w: Math.floor(FULL.w / 5) - 12, lines: 1, weight: 700 },
          what: { role: "small", w: Math.floor(FULL.w / 5) - 12, lines: 4 },
        },
        note: "`when` is a date or stage (≤ 10 characters); `what` a short phrase. Widths are for 5 events; 6 is narrower, 3-4 wider.",
      },
    ],
    draw: (c, v) => {
      heading(c, v);
      const ev = objs(v.events).slice(0, 6);
      const n = Math.max(1, ev.length);
      const slot = FULL.w / n;
      const w = Math.floor(slot) - 12;
      const lineY = 300;
      rule(c, FULL.x, lineY, FULL.w, 2, mix(c.t.colors.accent, c.t.colors.background, 0.35));
      ev.forEach((e, k) => {
        const cx = FULL.x + slot * (k + 0.5);
        const when = str(e.when) ?? "";
        const what = str(e.what) ?? "";
        if (linesOf(c, "events", when, "lead", w, 700) > 1) flag(c, "events", "date over 1 line");
        const wh = heightOf(c, "events", what, "small", w);
        if (lineY + 28 + wh > 488) flag(c, "events", `event text ${wh}pt`);
        put(
          c,
          "events",
          when,
          "lead",
          { x: cx - w / 2, y: lineY - 26 - lineH(c, "events", "lead"), w },
          { color: c.t.colors.accent, weight: 700, align: "center", name: "When" },
        );
        c.els.push({
          id: uid(),
          type: "shape",
          shape: "ellipse",
          x: Math.round(cx - 11),
          y: lineY - 10,
          w: 22,
          h: 22,
          fill: c.t.colors.background,
          stroke: c.t.colors.accent,
          strokeWidth: 4,
          name: "Node",
        } as ShapeElement);
        put(
          c,
          "events",
          what,
          "small",
          { x: cx - w / 2, y: lineY + 28, w },
          { color: c.t.colors.ink, align: "center", name: "What" },
        );
      });
    },
  },
  {
    id: "key-words",
    kind: "content",
    useWhen: "Key words or terms with their meanings (2-4), as cards.",
    slots: (st) => [
      HEADING,
      {
        id: "terms",
        kind: "items",
        min: 2,
        max: 4,
        fields: {
          term: { role: "lead", w: 360, lines: 1, weight: 700 },
          meaning: { role: "body", w: 360, lines: st === "ks1" ? 1 : 2 },
        },
        note: "Pupil-friendly meanings, one sentence each.",
      },
    ],
    draw: (c, v) => {
      heading(c, v);
      const terms = objs(v.terms).slice(0, 4);
      const gap = 16;
      const w = Math.floor((FULL.w - gap) / 2);
      const pad = isPrimary(c.st) ? 18 : 24;
      const iw = w - 2 * pad;
      const rows = Math.ceil(terms.length / 2);
      const mLines = isPrimary(c.st) ? 1 : 2;
      const h = Math.min(
        Math.floor((BAND.h - gap) / 2),
        Math.round(lineH(c, "_", "lead") + 6 + mLines * lineH(c, "_", "body") + 2 * pad),
      );
      const total = rows * h + (rows - 1) * gap;
      const y0 = Math.max(BAND.y, Math.round(BAND.y + (BAND.h - total) / 2 - 4));
      if (total > BAND.h) flag(c, "terms", `cards ${total}/${BAND.h}pt`);
      terms.forEach((t, k) => {
        const x = FULL.x + (k % 2) * (w + gap);
        const y = y0 + Math.floor(k / 2) * (h + gap);
        card(c, { x, y, w, h });
        const term = str(t.term) ?? "";
        const m = str(t.meaning) ?? "";
        const th = heightOf(c, "terms", term, "lead", iw, 700);
        const mh = heightOf(c, "terms", m, "body", iw);
        if (linesOf(c, "terms", m, "body", iw) > mLines) flag(c, "terms", "meaning over cap");
        const top = y + Math.max(pad, Math.round((h - th - 6 - mh) / 2));
        put(
          c,
          "terms",
          term,
          "lead",
          { x: x + pad, y: top, w: iw },
          { color: c.t.colors.accent, weight: 700, name: "Term" },
        );
        put(
          c,
          "terms",
          m,
          "body",
          { x: x + pad, y: top + th + 6, w: iw },
          { color: c.t.colors.ink, name: "Meaning" },
        );
      });
    },
  },
  {
    id: "hinge",
    kind: "multiple-choice",
    useWhen:
      "A hinge or multiple-choice question: the question as the heading, 4 options in a 2x2 grid with letters, one instruction line.",
    slots: (st) => [
      { ...HEADING, note: "The question itself." },
      {
        id: "stem",
        kind: "text",
        optional: true,
        cap: { role: "lead", w: FULL.w, lines: isPrimary(st) ? 1 : 2 },
        note: "Context the question needs (a number, a quote). Delete when the heading is the whole question.",
      },
      {
        id: "options",
        kind: "list",
        min: 2,
        max: 4,
        cap: {
          role: "body",
          w: Math.floor((FULL.w - 16) / 2) - 40 - Math.round(KEY_STAGE_TYPE[st].body * 1.2) - 14,
          lines: isPrimary(st) ? 1 : 2,
        },
        note: "Four options is the reference; 2 makes one row.",
      },
      {
        id: "instruction",
        kind: "text",
        optional: true,
        cap: { role: "small", w: FULL.w, lines: 1 },
        note: "e.g. 'Hold up the letter. Be ready to explain.'",
      },
    ],
    draw: (c, v) => {
      heading(c, v);
      const opts = strs(v.options).slice(0, 4);
      const stem = str(v.stem);
      const ins = str(v.instruction);
      const gap = 16;
      const w = Math.floor((FULL.w - gap) / 2);
      const pad = 20;
      const d = Math.round(c.s.body * 1.2);
      const iw = w - 2 * pad - d - 14;
      const rowH = Math.round(
        Math.max(d, (isPrimary(c.st) ? 1 : 2) * lineH(c, "options", "body")) + 2 * pad,
      );
      const rows = Math.ceil(opts.length / 2);
      const blocks: Block[] = [];
      if (stem) {
        capLines(c, "stem", stem, { role: "lead", w: FULL.w, lines: isPrimary(c.st) ? 1 : 2 });
        blocks.push(leadBlock(c, "stem", stem, FULL.x, FULL.w));
      }
      blocks.push({
        h: rows * rowH + (rows - 1) * gap,
        slots: ["options"],
        draw: (y) =>
          opts.forEach((o, k) => {
            const x = FULL.x + (k % 2) * (w + gap);
            const yy = y + Math.floor(k / 2) * (rowH + gap);
            card(c, { x, y: yy, w, h: rowH }, "Option");
            disc(c, String.fromCharCode(65 + k), x + pad, yy + rowH / 2 - d / 2, d);
            const n = linesOf(c, "options", o, "body", iw);
            if (n > (isPrimary(c.st) ? 1 : 2)) flag(c, "options", `option ${n} lines`);
            put(
              c,
              "options",
              o,
              "body",
              { x: x + pad + d + 14, y: yy + pad, w: iw },
              { color: c.t.colors.ink, name: "Option text", valign: "middle", h: rowH - 2 * pad },
            );
          }),
      });
      if (ins) {
        capLines(c, "instruction", ins, { role: "small", w: FULL.w, lines: 1 });
        blocks.push({
          ...lineBlock(c, "instruction", ins, "small", FULL.x, FULL.w, {
            color: c.t.colors.muted,
            name: "Instruction",
          }),
          h: heightOf(c, "instruction", ins, "small", FULL.w) + 10,
          draw: (y) =>
            put(
              c,
              "instruction",
              ins,
              "small",
              { x: FULL.x, y: y + 10, w: FULL.w },
              { color: c.t.colors.muted, name: "Instruction" },
            ),
        });
      }
      region(c, blocks, BAND, 18);
    },
  },
  {
    id: "question-set",
    kind: "starter",
    useWhen:
      "3-5 questions to answer (retrieval starter, practice questions): numbered, ruled rows across the slide, one quiet instruction line.",
    slots: (st) => [
      HEADING,
      {
        id: "questions",
        kind: "list",
        min: 2,
        max: st === "ks1" ? 3 : 4,
        cap: { role: "body", w: PROSE - 50, lines: 2 },
        note: `All rows fit about ${linesIn(st, BAND.h - 40) - 2} body lines with their rules.`,
      },
      {
        id: "instruction",
        kind: "text",
        optional: true,
        cap: { role: "small", w: PROSE - 50, lines: 1 },
        note: "e.g. 'Answer in full sentences.'",
      },
    ],
    draw: (c, v) => {
      heading(c, v);
      const blocks = numberedBlocks(c, "questions", strs(v.questions), FULL.x, PROSE, 2, {
        ruled: true,
      });
      const ins = str(v.instruction);
      const indent = Math.round(c.s.body * 1.2) + Math.round(c.s.body * 0.65);
      if (ins)
        blocks.push({
          h: heightOf(c, "instruction", ins, "small", PROSE - indent) + 12,
          slots: ["instruction"],
          draw: (y) =>
            put(
              c,
              "instruction",
              ins,
              "small",
              { x: FULL.x + indent, y: y + 12, w: PROSE - indent },
              { color: c.t.colors.muted, name: "Instruction" },
            ),
        });
      region(c, blocks, BAND, 0);
    },
  },
  {
    id: "question-figure",
    kind: "open-response",
    useWhen:
      "Questions about a picture, source, graph or diagram that pupils must look at to answer (data questions, source analysis, exam practice).",
    slots: (st) => [
      HEADING,
      {
        id: "questions",
        kind: "list",
        min: 1,
        max: isPrimary(st) ? 3 : 4,
        cap: { role: "body", w: COL.w - 46, lines: 3 },
        note: `Questions fit about ${linesIn(st, BAND.h - 40)} body lines together. Marks in [brackets] are fine.`,
      },
      {
        id: "instruction",
        kind: "text",
        optional: true,
        cap: { role: "small", w: COL.w - 46, lines: 2 },
        note: "e.g. 'Use the words limiting factor.'",
      },
      {
        id: "picture",
        kind: "figure",
        aspect: PANEL.w / PANEL.h,
        note: "The thing the questions are about.",
      },
    ],
    draw: (c, v) => {
      heading(c, v);
      const blocks = numberedBlocks(c, "questions", strs(v.questions), COL.x, COL.w, 3);
      const ins = str(v.instruction);
      const indent = Math.round(c.s.body * 1.2) + Math.round(c.s.body * 0.65);
      if (ins)
        blocks.push({
          h: heightOf(c, "instruction", ins, "small", COL.w - indent) + 10,
          slots: ["instruction"],
          draw: (y) =>
            put(
              c,
              "instruction",
              ins,
              "small",
              { x: COL.x + indent, y: y + 10, w: COL.w - indent },
              { color: c.t.colors.muted, name: "Instruction" },
            ),
        });
      region(c, blocks, BAND, 2);
      figureBox(c, "picture", fig(v.picture), PANEL);
    },
  },
  {
    id: "discussion",
    kind: "discussion",
    useWhen:
      "One big question for talk (think-pair-share, debate): the prompt large on a calm panel, one quiet support line.",
    slots: (st) => [
      HEADING,
      {
        id: "prompt",
        kind: "text",
        cap: { role: "heading", w: 700, lines: isPrimary(st) ? 3 : 4, weight: 600 },
        note: "The discussion question.",
      },
      {
        id: "support",
        kind: "text",
        optional: true,
        cap: { role: "body", w: 700, lines: 2 },
        note: "A sentence starter or what to talk about.",
      },
    ],
    draw: (c, v) => {
      heading(c, v);
      box(c, { x: FULL.x, y: BAND.y, w: FULL.w, h: BAND.h }, wash(c.t));
      rule(c, FULL.x + 66, BAND.y + 56, 48, 5, c.t.colors.accent);
      const p = str(v.prompt) ?? "";
      const sup = str(v.support);
      const w = 700;
      capLines(c, "prompt", p, { role: "heading", w, lines: isPrimary(c.st) ? 3 : 4, weight: 600 });
      const blocks: Block[] = [
        lineBlock(c, "prompt", p, "heading", FULL.x + 66, w, {
          color: c.t.colors.ink,
          weight: 600,
          name: "Prompt",
        }),
      ];
      if (sup)
        blocks.push(
          lineBlock(c, "support", sup, "body", FULL.x + 66, w, {
            color: c.t.colors.muted,
            name: "Support",
          }),
        );
      region(c, blocks, { y: BAND.y + 72, h: BAND.h - 100 }, 18);
    },
  },
  {
    id: "discussion-picture",
    kind: "discussion",
    useWhen:
      "A talk question about something pupils can see (a photo or simple drawing): prompt left, picture right.",
    slots: (st) => [
      HEADING,
      {
        id: "prompt",
        kind: "text",
        cap: { role: "lead", w: COL.w, lines: isPrimary(st) ? 4 : 5 },
        note: "The question to discuss.",
      },
      {
        id: "support",
        kind: "text",
        optional: true,
        cap: { role: "body", w: COL.w, lines: 3 },
        note: "What to look for, or a starter.",
      },
      { id: "picture", kind: "figure", aspect: PANEL.w / PANEL.h, note: "What they talk about." },
    ],
    draw: (c, v) => {
      heading(c, v);
      const blocks: Block[] = [];
      const p = str(v.prompt);
      if (p) blocks.push(leadBlock(c, "prompt", p, COL.x, COL.w));
      const sup = str(v.support);
      if (sup)
        blocks.push(
          lineBlock(c, "support", sup, "body", COL.x, COL.w, {
            color: c.t.colors.muted,
            name: "Support",
          }),
        );
      region(c, blocks, BAND, 14);
      figureBox(c, "picture", fig(v.picture), PANEL);
    },
  },
  {
    id: "task",
    kind: "open-response",
    useWhen:
      "An independent or paired task: what to do in one line, up to 4 numbered parts, and a sentence starter in a card.",
    slots: (st) => [
      HEADING,
      {
        id: "lead",
        kind: "text",
        cap: { role: "lead", w: PROSE, lines: 2 },
        note: "The task in one sentence.",
      },
      {
        id: "parts",
        kind: "list",
        optional: true,
        min: 0,
        max: isPrimary(st) ? 2 : 3,
        cap: { role: "body", w: PROSE - 46, lines: 2 },
        note: "Numbered parts or success criteria.",
      },
      {
        id: "starter",
        kind: "text",
        optional: true,
        cap: { role: "body", w: FULL.w - 56, lines: 2 },
        note: "'Start with: ...' (the label is bolded).",
      },
    ],
    draw: (c, v) => {
      heading(c, v);
      const blocks: Block[] = [];
      const lead = str(v.lead);
      if (lead) blocks.push(leadBlock(c, "lead", lead, FULL.x, PROSE));
      blocks.push(...numberedBlocks(c, "parts", strs(v.parts), FULL.x, PROSE, 2));
      const s = str(v.starter);
      if (s) {
        const iw = FULL.w - 56;
        const th = heightOf(c, "starter", s, "body", iw);
        blocks.push({
          h: th + 40 + 8,
          slots: ["starter"],
          draw: (y) => {
            card(c, { x: FULL.x, y: y + 8, w: FULL.w, h: th + 40 }, "Starter card");
            put(
              c,
              "starter",
              s,
              "body",
              { x: FULL.x + 28, y: y + 28, w: iw },
              { color: c.t.colors.ink, boldLabel: true, name: "Starter" },
            );
          },
        });
      }
      region(c, blocks, BAND, Math.round(c.s.body * 0.45));
    },
  },
  {
    id: "exit-ticket",
    kind: "exit-ticket",
    useWhen: "The last slide: 2-3 exit questions on a ticket card, with how to hand it in.",
    slots: (st) => [
      HEADING,
      {
        id: "questions",
        kind: "list",
        min: 1,
        max: 3,
        cap: { role: "body", w: FULL.w - 80 - 46, lines: 2 },
        note: `Questions fit about ${linesIn(st, BAND.h - 90)} body lines together.`,
      },
      {
        id: "instruction",
        kind: "text",
        optional: true,
        cap: { role: "small", w: FULL.w - 80, lines: 1 },
        note: "e.g. 'Answer on your slip, then hand it in.'",
      },
    ],
    draw: (c, v) => {
      heading(c, v);
      const ins = str(v.instruction);
      box(c, { x: FULL.x, y: BAND.y, w: FULL.w, h: BAND.h }, c.t.colors.surface, {
        stroke: mix(c.t.colors.accent, c.t.colors.background, 0.45),
        strokeWidth: 2,
        dash: "dashed",
        radius: Math.min(c.t.radius, 18),
        name: "Ticket",
      } as Partial<ShapeElement>);
      const x = FULL.x + 40;
      const w = FULL.w - 80;
      const insH = ins ? 52 : 0;
      region(
        c,
        numberedBlocks(c, "questions", strs(v.questions), x, w, 2),
        { y: BAND.y + 24, h: BAND.h - 48 - insH },
        6,
      );
      if (ins) {
        capLines(c, "instruction", ins, { role: "small", w, lines: 1 });
        rule(c, x, BAND.y + BAND.h - insH - 8, w);
        put(
          c,
          "instruction",
          ins,
          "small",
          { x, y: BAND.y + BAND.h - insH + 6, w },
          { color: c.t.colors.muted, name: "Instruction" },
        );
      }
    },
  },
];

export const REFERENCE_IDS = REFERENCES.map((r) => r.id);
export const referenceById = (id: string) => REFERENCES.find((r) => r.id === id);

/* ------------------------------------------------------------------ */
/* The edit engine                                                     */
/* ------------------------------------------------------------------ */

export type ReferenceInput = { reference: string; slots: Values };
export type ReferenceResult = {
  slide: Pick<Slide, "kind" | "elements" | "background">;
  /** Slots still over after one step down (`slot: why`), plus ruler faults (`ruler: ...`). */
  over: string[];
  /** Slots set one step down. */
  stepped: string[];
};

function drawOnce(def: RefDef, v: Values, theme: Theme, st: Stage, down: Set<string>) {
  const s = scaleFor(theme, st);
  const c: Ctx = { t: theme, st, s, els: [], over: new Map(), down };
  def.draw(c, v, def.slots(st));
  return c;
}

/** Reference id + slot contents -> standard slide elements. Nothing is placed by the caller. */
export function editReference(
  input: ReferenceInput,
  theme: Theme,
  stage: Stage,
  o: { ruler?: boolean } = {},
): ReferenceResult {
  return withKeyStage(stage, () => {
    const def = referenceById(input.reference);
    if (!def) throw new Error(`unknown reference ${input.reference}`);
    const v = input.slots ?? {};
    let c = drawOnce(def, v, theme, stage, new Set());
    const stepped = [...c.over.keys()];
    if (stepped.length) c = drawOnce(def, v, theme, stage, new Set(stepped));
    const over = [...c.over.entries()].map(([k, why]) => `${k}: ${why}`);
    const slide = {
      kind: def.kind,
      elements: c.els,
      ...(def.background ? { background: def.background(theme) } : {}),
    };
    if (o.ruler !== false) {
      const fit = slideFits({ id: "r", ...slide } as Slide, theme, 1);
      if (!fit.ok)
        over.push(
          `ruler: ${[...fit.overflow, ...(fit.overlaps ? [`${fit.overlaps} overlaps`] : []), ...fit.lane].join("; ") || `steps ${fit.steps}`}`,
        );
    }
    return { slide, over, stepped };
  });
}

/* ------------------------------------------------------------------ */
/* Capacity for the catalogue                                          */
/* ------------------------------------------------------------------ */

const SAMPLE =
  "The water evaporates from the sea and rises as vapour into the cooler air where it condenses into tiny droplets that form clouds over the land and later fall as rain on the hills and run back to the sea again";
/** Characters of ordinary prose that fit one line `w` wide in `role` at the stage. */
export function charsPerLine(theme: Theme, st: Stage, role: Role, w: number, weight?: number) {
  return withKeyStage(st, () => {
    const size = scaleFor(theme, st)[role];
    let lo = 1;
    let hi = SAMPLE.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      const n = countLines(
        SAMPLE.slice(0, mid),
        presetOf(role),
        theme,
        w,
        weight ?? weightOf(role, theme),
        size,
      );
      if (n <= 1) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  });
}
export const TYPE = { scaleFor, LH };
