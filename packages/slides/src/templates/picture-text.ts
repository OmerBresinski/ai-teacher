/**
 * Picture and text (TEACH-75 part ae, layout pilot C6; rulings 208, 217, 228): one big idea beside
 * one picture. Ported from the pilot's `northstars-v13/picture-text` gold, winner B "tucked field".
 *
 * - **Title** across the top on the paper, as on every teaching slide. Its zone has a declared
 *   height (down to the field's top), so a banded theme's band runs down to meet the field with no
 *   strip of ground between them (THEME-FIT debt 3).
 * - **Field:** the picture bleeds off the right and bottom edges under the title, 427 / 387 / 333
 *   wide for a landscape / square / portrait picture (640 / 580 / 500 at 1440), 53 wider when the
 *   lead stands alone. A library model (aspect at most 1.45; a wider one belongs on the figure slide
 *   and is flagged) sits on the paper with no second frame and no bleed. A failed picture keeps the
 *   field in sand with the library icon in a medal; with no icon either, the field goes and the
 *   words take the width. Never a hole.
 * - **Plain look:** the lead in ink at weight 500, up to 3 points (2 at KS1) in muted with a small
 *   ink dot. The title's accent word is the slide's one red thing.
 * - **Key card look** (it replaces the callout): 1-2 sand cards, each a label, then a red term, a
 *   red number and its unit, or example pairs, then the meaning. No red in the title; the lead (if
 *   any) at body weight; never beside points; static (no build). With no picture the cards go side
 *   by side across the full width.
 *
 * **Fit:** spacing and type step down together, the points to the small step first and then the
 * lead, never under the small step (the reading floor). Past the last rung the slide is over:
 * named in `over`, never clipped or shrunk further. Content past the writer's caps (title, lead,
 * points, card fields) is named in `over` too.
 *
 * **Input:** a picture-text slide with `pictureText` (`{ icon?, cards? }`). A saved picture-text
 * slide without it lays out exactly as before.
 */
import type { ImageElement, RichDoc, ShapeElement, TextElement } from "@tj/domain/documents";
import { styledRun } from "@tj/domain/documents";
import { uid } from "../factories";
import { lineWidth } from "../text-measure";
import { typeScale } from "../themes";
import { paintSurface, surfacesOf } from "../themes/surfaces";
import { FIGURE_WIDE_ASPECT } from "./figure-rules";
import { type Ctx, type Figure, G, kit, type Role, type Stage, type TemplateInput } from "./index";
import { iconSrc, matchIcon } from "./panel-list-deps";
import CAPACITY from "./picture-text-capacity.json" with { type: "json" };
import { restyleModelSvg } from "./steps-model";

export type KeyCardKind = "word" | "rule" | "examples" | "fact";
export type KeyCard = {
  kind: KeyCardKind;
  /** At most 2 words, shown in small capitals. */
  label: string;
  /** Word or rule: the term, at most 3 words (or one long word). */
  term?: string;
  /** At most 16 words. */
  meaning?: string;
  /** Examples: at most 3 pairs, at most 2 words a side. */
  examples?: [string, string][];
  /** Fact: the number, at most 6 characters, and its unit (1 word). */
  num?: string;
  unit?: string;
};
export type PictureText = {
  /** The library icon shown in a medal when the picture fails (the writer always gives one at KS1). */
  icon?: string | null;
  /** The key card look: 1-2 cards. Absent: the plain look (lead and points). */
  cards?: KeyCard[];
};

export const PT_NAMES = {
  band: "Title band",
  title: "Heading",
  field: "Picture field",
  photo: "Photo",
  diagram: "Diagram",
  medal: "Picture medal",
  icon: "Picture icon",
  lead: "Lead",
  point: "Point",
  dot: "Point dot",
  card: "Key card",
  label: "Key label",
  term: "Key term",
  meaning: "Key meaning",
  example: "Key example",
  num: "Key number",
  unit: "Key unit",
} as const;

type Group = "KS1" | "KS2" | "KS3-5";
export const groupOf = (stage: Stage): Group =>
  stage === "ks1" ? "KS1" : stage === "ks2" ? "KS2" : "KS3-5";

/** The writer's caps (the gold's), in words; `words` is the measured hard cap for lead + points. */
export const PT_CAPS: Record<
  Group,
  { title: number; lead: number; points: number; words: number; comfortable: number }
> = {
  KS1: { title: 6, lead: 14, points: 2, ...(CAPACITY as Record<Group, CapRow>).KS1 },
  KS2: { title: 7, lead: 16, points: 3, ...(CAPACITY as Record<Group, CapRow>).KS2 },
  "KS3-5": { title: 7, lead: 16, points: 3, ...(CAPACITY as Record<Group, CapRow>)["KS3-5"] },
};
type CapRow = { words: number; comfortable: number };
/** Key card caps: label words, term words, meaning words, example pairs and words a side, number characters. */
export const KEY_CAPS = {
  cards: 2,
  label: 2,
  term: 3,
  meaning: 16,
  pairs: 3,
  side: 2,
  num: 6,
  unit: 1,
};

const words = (s: string | undefined | null) =>
  (s ?? "").trim().split(/\s+/).filter(Boolean).length;

/** Field width on the 960 grid by picture aspect (640 / 580 / 500 at 1440). */
export const fieldWidth = (aspect: number) => (aspect >= 1.2 ? 427 : aspect >= 0.9 ? 387 : 333);
/** Lead only: the picture takes 53 more (80 at 1440). */
const SOLO_EXTRA = 53;
/** The failed-picture field (560 at 1440). */
const ICON_FIELD = 373;
/** Title foot to field (48), column gap (72), foot margin (64), card pads (32, 40) at 1440. */
const FIELD_GAP = 32;
const COL_GAP = 48;
const FOOT = 540 - 43;
const isModel = (f: Figure | undefined): f is Extract<Figure, { drawn: unknown }> =>
  !!f && "drawn" in f;

/** The picture-and-text look this slide takes, or undefined for the saved layout. */
export function pictureTextOf(input: TemplateInput): PictureText | undefined {
  if (input.template !== "picture-text" || !input.pictureText) return undefined;
  return input.pictureText;
}

/** Whether a figure may sit in the side field (a library model only when near-square). */
export const fitsSideField = (f: Figure | undefined) =>
  !isModel(f) || (f.drawn.aspect || 1) <= FIGURE_WIDE_ASPECT;

/**
 * Content past the writer's caps, as `over` lines. A cap of 0 reports over, never "no cap"; the
 * content is drawn in full and flagged, never clipped.
 */
export function pictureTextCapsOver(input: TemplateInput, stage: Stage): string[] {
  const g = PT_CAPS[groupOf(stage)];
  const pt = input.pictureText ?? {};
  const out: string[] = [];
  const check = (what: string, n: number, cap: number) => {
    if (n > cap) out.push(`picture-text ${what} ${n}/${cap}`);
  };
  check("title words", words(input.heading), g.title);
  check("lead words", words(input.lead), g.lead);
  const cards = pt.cards ?? [];
  if (cards.length) {
    check("cards", cards.length, KEY_CAPS.cards);
    if (input.points?.length) out.push("picture-text key card beside points");
    for (const [i, k] of cards.entries()) {
      check(`card ${i + 1} label words`, words(k.label), KEY_CAPS.label);
      check(`card ${i + 1} term words`, words(k.term), KEY_CAPS.term);
      check(`card ${i + 1} meaning words`, words(k.meaning), KEY_CAPS.meaning);
      check(`card ${i + 1} example pairs`, k.examples?.length ?? 0, KEY_CAPS.pairs);
      for (const [a, b] of k.examples ?? [])
        check(`card ${i + 1} example words`, Math.max(words(a), words(b)), KEY_CAPS.side);
      check(`card ${i + 1} number characters`, (k.num ?? "").trim().length, KEY_CAPS.num);
      check(`card ${i + 1} unit words`, words(k.unit), KEY_CAPS.unit);
    }
  } else {
    const pts = (input.points ?? []).map((p) => (typeof p === "string" ? p : p.text));
    check("points", pts.length, g.points);
    check("words", words(input.lead) + pts.reduce((n, p) => n + words(p), 0), g.words);
  }
  if (!fitsSideField(input.figure)) out.push("picture-text model too wide: figure slide");
  return out;
}

/** `heading` with `word` (an exact substring) in the accent, through the shared run builder. */
function accentDoc(heading: string, word: string | null | undefined, accent: string): RichDoc {
  const w = word?.trim();
  const at = w ? heading.indexOf(w) : -1;
  const runs =
    !w || at < 0
      ? [styledRun(heading, {})]
      : [
          styledRun(heading.slice(0, at), {}),
          styledRun(w, { color: accent }),
          styledRun(heading.slice(at + w.length), {}),
        ].filter((r) => r.text);
  return { type: "doc", content: [{ type: "paragraph", content: runs }] } as RichDoc;
}

/** `role` text at a step's size (`at`: a scale role or points), measured and drawn at that size. */
const sizeOf = (c: Ctx, at: Role | number) => (typeof at === "number" ? at : c.s[at]);
function put(
  c: Ctx,
  value: string,
  role: Role,
  at: Role | number,
  rect: { x: number; y: number; w: number },
  extra: Parameters<typeof kit.text>[4],
): TextElement {
  const s = c.s;
  c.s = { ...s, [role]: sizeOf(c, at) };
  const el = kit.text(c, value, role, rect, extra);
  c.s = s;
  return el;
}
const hOf = (c: Ctx, value: string, role: Role, at: Role | number, w: number, weight?: number) =>
  kit.measure({ ...c, s: { ...c.s, [role]: sizeOf(c, at) } }, value, role, w, weight);
/** The scale's heading step (under the display heading): the card's term, unit and examples. */
const nameSize = (c: Ctx) => typeScale(c.t)?.heading ?? c.s.heading;

/** One rung of the fit ladder: the lead's and points' size steps and the spacing share. */
type Rung = { lead: Role; pts: Role; k: number };
/** The points always sit a step under the lead (the gold: lead 1.12x body at 500, points body). */
const RUNGS: Rung[] = [
  { lead: "body", pts: "small", k: 1 },
  { lead: "body", pts: "small", k: 0.85 },
  { lead: "body", pts: "small", k: 0.7 },
  { lead: "body", pts: "small", k: 0.55 },
];

/**
 * The model on its own sand panel with every part shown (the gold: the slide does not build, so a
 * part that a later build takes away, such as the open switch, stays drawn). One extra `<style>`
 * after the restyle's; the panel is the field-b role's fill.
 */
function onSandPanel(src: string, t: Ctx["t"]): string {
  const m = /^data:image\/svg\+xml;charset=utf-8,/.exec(src);
  if (!m) return src;
  const svg = decodeURIComponent(src.slice(m[0].length));
  const fill = surfacesOf(t).roles["field-b"].fill;
  const css = `svg.slide.tk[class][class]{--bg:${fill};--paper:${fill}}.slide [data-f][data-f][data-f]{opacity:1}`;
  const out = svg.replace(/<\/svg>\s*$/, `<style data-restyle="tj-panel">${css}</style></svg>`);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(out)}`;
}

export function layoutPictureText(c: Ctx, input: TemplateInput, pt: PictureText, stage: Stage) {
  c.bodyFromHeading = true;
  const key = !!pt.cards?.length;
  const fig = input.figure;
  const pts = key ? [] : (input.points ?? []).map((p) => (typeof p === "string" ? p : p.text));
  const solo = !key && pts.length === 0;
  const accent = c.t.colors.accent;
  c.over.push(...pictureTextCapsOver(input, stage));

  // Title: the key card look keeps its red for the term.
  const title = kit.heading(c, input.heading);
  title.doc = accentDoc(input.heading, key ? null : input.accentWord, accent);
  const titleFoot = title.y + title.h;
  const fieldTop = Math.round(titleFoot + FIELD_GAP);

  // The field: its width and kind.
  const icon = pt.icon ? matchIcon(pt.icon) : null;
  const model = isModel(fig) ? fig : undefined;
  const photo = fig && "photo" in fig ? fig : undefined;
  const other = fig && !model && !photo ? fig : undefined;
  let fw = 0;
  if (model) {
    const a = model.drawn.aspect || 1;
    fw = Math.round(Math.min(507, Math.max(373, 373 * a)));
  } else if (photo) fw = fieldWidth(photo.aspect ?? 1.5) + (solo ? SOLO_EXTRA : 0);
  else if (other) fw = fieldWidth(1.2);
  else if (icon) fw = ICON_FIELD;
  const wide = fw === 0;
  const colW = wide ? (key ? G.width : 667) : 960 - fw - COL_GAP - G.margin - (model ? COL_GAP : 0);
  const colTop = fieldTop + (wide ? 5 : 4);

  // Band: the title zone's declared height reaches the field, so a band joins it.
  const zoneH = wide ? Math.round(titleFoot + 16) : fieldTop;
  const band = paintSurface(
    { id: uid(), role: "title", zone: "top", box: { x: 0, y: 0, w: 960, h: zoneH } },
    c.t,
  );
  if (band) {
    c.els.unshift({ ...band, name: PT_NAMES.band } as ShapeElement);
    const onBand = surfacesOf(c.t).zones.top?.ink;
    if (onBand) title.style = { ...title.style, color: onBand };
  }

  // Field.
  if (!wide) {
    const r = Math.round(Math.min(24, c.t.radius * 1.4 || 16));
    const fieldBox = model
      ? { x: 960 - 48 - fw, y: fieldTop, w: fw, h: 540 - 35 - fieldTop }
      : { x: 960 - fw, y: fieldTop, w: fw, h: 540 - fieldTop };
    // A photo is the field itself (no ground or line under it); the sand field holds a fallback.
    if (!model && !photo) {
      const s = paintSurface({ id: uid(), role: "field-b", box: fieldBox, own: [r, 0, 0, 0] }, c.t);
      if (s) c.els.push({ ...s, name: PT_NAMES.field } as ShapeElement);
    }
    if (photo) {
      // One rounded corner (top-left): the picture runs r past the right and bottom edges, where the
      // slide's edge cuts its other three corners off, so it bleeds square there as in the gold.
      c.els.push({
        id: uid(),
        type: "image",
        name: PT_NAMES.photo,
        ...fieldBox,
        w: fieldBox.w + r,
        h: fieldBox.h + r,
        radius: r,
        src: photo.photo,
        alt: photo.alt ?? "",
        ...(photo.request ? { request: photo.request } : {}),
        fit: "cover",
      } as ImageElement);
    } else if (model) {
      const a = model.drawn.aspect || fieldBox.w / fieldBox.h;
      const w = Math.min(fieldBox.w, Math.round(fieldBox.h * a));
      const h = Math.min(fieldBox.h, Math.round(w / a));
      c.els.push({
        id: uid(),
        type: "image",
        name: PT_NAMES.diagram,
        x: Math.round(fieldBox.x + (fieldBox.w - w) / 2),
        y: fieldBox.y,
        w,
        h,
        src: onSandPanel(restyleModelSvg(model.drawn.src, c.t), c.t),
        alt: model.drawn.alt ?? "",
        fit: "contain",
        ...(model.drawn.source ? { diagram: model.drawn.source } : {}),
      } as ImageElement);
    } else if (other) {
      kit.figurePanel(c, other, { ...fieldBox, x: fieldBox.x + 16, w: fieldBox.w - 32 }, true);
    } else if (icon) {
      // The gold's medal: 288 / 268 / 240 at 1440 (early, primary, secondary).
      const d = Math.min(Math.round(fw * 0.8), stage === "ks1" ? 192 : stage === "ks2" ? 179 : 160);
      const mx = Math.round(fieldBox.x + (fw - d) / 2);
      const my = Math.round(fieldBox.y + (fieldBox.h - d) / 2);
      const m = paintSurface({ id: uid(), role: "medal", box: { x: mx, y: my, w: d, h: d } }, c.t);
      if (m) c.els.push({ ...m, name: PT_NAMES.medal } as ShapeElement);
      // The library drawing carries its own margin: drawn the medal's size it reads as the gold's 72%.
      const g = Math.round(d * 0.95);
      const src = iconSrc(icon, c.t, g);
      if (src)
        c.els.push({
          id: uid(),
          type: "image",
          name: PT_NAMES.icon,
          x: mx + Math.round((d - g) / 2),
          y: my + Math.round((d - g) / 2),
          w: g,
          h: g,
          src,
          alt: pt.icon ?? "",
          fit: "contain",
        } as ImageElement);
    }
  }

  if (key) keyCards(c, input, pt.cards ?? [], { x: G.margin, y: colTop, w: colW }, wide);
  else plainColumn(c, input.lead, pts, solo, { x: G.margin, y: colTop, w: colW }, stage);
}

/** The plain look's column: the first rung of the ladder whose words end above the foot. */
function plainColumn(
  c: Ctx,
  lead: string | undefined,
  pts: string[],
  solo: boolean,
  col: { x: number; y: number; w: number },
  stage: Stage,
) {
  const ink = c.t.colors.ink;
  const muted = c.t.colors.muted;
  const dot = stage === "ks1" ? 9 : 7;
  const leadText = lead?.trim() ?? "";
  const plan = (r: Rung) => {
    const ind = Math.round(c.s[r.pts] * 1.05);
    let h = 0;
    if (leadText)
      h += solo
        ? hOf(c, leadText, "heading", "heading", col.w, 400)
        : hOf(c, leadText, "lead", r.lead, col.w, 500);
    for (const [i, p] of pts.entries())
      h +=
        (i === 0 ? (leadText ? Math.round(21 * r.k) : 0) : Math.round(16 * r.k)) +
        hOf(c, p, "body", r.pts, col.w - ind);
    return h;
  };
  const rung = RUNGS.find((r) => col.y + plan(r) <= FOOT) ?? (RUNGS.at(-1) as Rung);
  if (col.y + plan(rung) > FOOT)
    c.over.push(`picture-text column ${Math.round(col.y + plan(rung))}/${FOOT}pt`);
  let y = col.y;
  if (leadText) {
    const el = solo
      ? put(
          c,
          leadText,
          "heading",
          "heading",
          { x: col.x, y, w: col.w },
          {
            color: ink,
            weight: 400,
            name: PT_NAMES.lead,
          },
        )
      : put(
          c,
          leadText,
          "lead",
          rung.lead,
          { x: col.x, y, w: col.w },
          {
            color: ink,
            weight: 500,
            name: PT_NAMES.lead,
          },
        );
    if (!solo) el.style = { ...el.style, preset: "body" };
    y = el.y + el.h;
  }
  const ind = Math.round(c.s[rung.pts] * 1.05);
  for (const [i, p] of pts.entries()) {
    y += i === 0 ? (leadText ? Math.round(21 * rung.k) : 0) : Math.round(16 * rung.k);
    const size = c.s[rung.pts];
    const line = size * kit.LH[rung.pts === "small" ? "small" : "body"];
    kit.box(
      c,
      { x: col.x + Math.round(size * 0.12), y: y + (line - dot) / 2, w: dot, h: dot },
      ink,
      { shape: "ellipse", name: PT_NAMES.dot, opacity: 0.55 },
    );
    const el = put(
      c,
      p,
      "body",
      rung.pts,
      { x: col.x + ind, y, w: col.w - ind },
      {
        color: muted,
        name: PT_NAMES.point,
      },
    );
    y = el.y + el.h;
  }
}

/** The key card look: the optional lead at body weight, then 1-2 sand cards. */
function keyCards(
  c: Ctx,
  input: TemplateInput,
  cards: KeyCard[],
  col: { x: number; y: number; w: number },
  wide: boolean,
) {
  const ink = surfacesOf(c.t).roles["field-b"].ink ?? c.t.colors.ink;
  const muted = c.t.colors.muted;
  const accent = c.t.colors.accent;
  const leadText = input.lead?.trim() ?? "";
  const n = cards.length;
  const side = wide && n > 1;
  const cw = side ? Math.floor((col.w - 16 * (n - 1)) / n) : col.w;
  const radius = Math.round(Math.min(16, c.t.radius || 16));

  type Part = { kind: "label" | "term" | "meaning" | "num" | "example"; h: number; gap: number };
  type CardRung = { term: number; mean: Role; k: number };
  const nm = nameSize(c);
  const RUNGS_K: CardRung[] = [
    { term: nm, mean: "body", k: 1 },
    { term: nm, mean: "body", k: 0.8 },
    { term: nm, mean: "small", k: 0.8 },
    { term: c.s.body, mean: "small", k: 0.7 },
  ];
  let cr = RUNGS_K[0] as CardRung;
  const partsOf = (k: KeyCard, kk: number, iw: number): Part[] => {
    const out: Part[] = [];
    if (k.label?.trim())
      out.push({
        kind: "label",
        h: hOf(c, k.label.toUpperCase(), "small", "small", iw, 700),
        gap: 0,
      });
    if (k.kind === "fact" && k.num?.trim())
      out.push({ kind: "num", h: Math.ceil(c.s.title * kit.LH.title), gap: Math.round(5 * kk) });
    else if (k.kind === "examples")
      for (const [i] of (k.examples ?? []).entries())
        out.push({
          kind: "example",
          h: Math.ceil(cr.term * kit.LH.heading),
          gap: Math.round((i === 0 ? 11 : 5) * kk),
        });
    else if (k.term?.trim())
      out.push({
        kind: "term",
        h: hOf(c, k.term, "heading", cr.term, iw),
        gap: Math.round(11 * kk),
      });
    if (k.kind !== "examples" && k.meaning?.trim())
      out.push({
        kind: "meaning",
        h: hOf(c, k.meaning, "body", cr.mean, iw),
        gap: Math.round(8 * kk),
      });
    return out;
  };
  const padY = (kk: number) => Math.round(21 * kk);
  const padX = (kk: number) => Math.round(27 * kk);
  const cardH = (k: KeyCard, kk: number) =>
    2 * padY(kk) + partsOf(k, kk, cw - 2 * padX(kk)).reduce((s, p) => s + p.gap + p.h, 0);
  const plan = (kk: number) => {
    const leadH = leadText ? hOf(c, leadText, "body", "body", col.w, 400) + Math.round(27 * kk) : 0;
    const hs = cards.map((k) => cardH(k, kk));
    const cardsH = side ? Math.max(...hs) : hs.reduce((s, h) => s + h, 0) + 13 * (n - 1);
    return { leadH, hs, total: leadH + cardsH };
  };
  cr =
    RUNGS_K.find((r) => {
      cr = r;
      return col.y + plan(r.k).total <= FOOT;
    }) ?? (RUNGS_K.at(-1) as CardRung);
  const kk = cr.k;
  const p = plan(kk);
  if (col.y + p.total > FOOT)
    c.over.push(`picture-text column ${Math.round(col.y + p.total)}/${FOOT}pt`);
  let y = col.y;
  if (leadText) {
    put(
      c,
      leadText,
      "body",
      "body",
      { x: col.x, y, w: col.w },
      {
        color: c.t.colors.ink,
        weight: 400,
        name: PT_NAMES.lead,
      },
    );
    y += p.leadH;
  }
  const hMax = Math.max(...p.hs);
  for (const [i, k] of cards.entries()) {
    const x = side ? col.x + i * (cw + 16) : col.x;
    const h = side ? hMax : (p.hs[i] ?? 0);
    const s = paintSurface(
      {
        id: uid(),
        role: "field-b",
        box: { x, y, w: cw, h },
        own: [radius, radius, radius, radius],
      },
      c.t,
    );
    if (s) c.els.push({ ...s, name: PT_NAMES.card } as ShapeElement);
    const iw = cw - 2 * padX(kk);
    const tx = x + padX(kk);
    let ty = y + padY(kk);
    let ex = 0;
    for (const part of partsOf(k, kk, iw)) {
      ty += part.gap;
      if (part.kind === "label")
        put(
          c,
          (k.label ?? "").toUpperCase(),
          "small",
          "small",
          { x: tx, y: ty, w: iw },
          {
            color: muted,
            weight: 700,
            name: PT_NAMES.label,
          },
        );
      else if (part.kind === "term")
        put(
          c,
          k.term ?? "",
          "heading",
          cr.term,
          { x: tx, y: ty, w: iw },
          {
            color: accent,
            name: PT_NAMES.term,
          },
        );
      else if (part.kind === "meaning")
        put(
          c,
          k.meaning ?? "",
          "body",
          cr.mean,
          { x: tx, y: ty, w: iw },
          {
            color: ink,
            name: PT_NAMES.meaning,
          },
        );
      else if (part.kind === "num") {
        const num = (k.num ?? "").trim();
        const nw = Math.ceil(lineWidth(num, "title", c.t, c.t.weights.heading)) + 2;
        put(
          c,
          num,
          "title",
          "title",
          { x: tx, y: ty, w: Math.min(iw, nw) },
          {
            color: accent,
            name: PT_NAMES.num,
          },
        );
        if (k.unit?.trim()) {
          const uh = Math.ceil(nm * kit.LH.heading);
          const ux = tx + Math.min(iw, nw) + 11;
          put(
            c,
            k.unit.trim(),
            "heading",
            nm,
            {
              x: ux,
              y: ty + part.h - uh,
              w: Math.max(40, tx + iw - ux),
            },
            { color: ink, name: PT_NAMES.unit },
          );
        }
      } else if (part.kind === "example") {
        const [a, b] = k.examples?.[ex++] ?? ["", ""];
        const el = put(
          c,
          `${a} → ${b}`,
          "heading",
          cr.term,
          { x: tx, y: ty, w: iw },
          {
            color: ink,
            name: PT_NAMES.example,
          },
        );
        el.doc = {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [styledRun(a, {}), styledRun(" → ", { color: muted }), styledRun(b, {})],
            },
          ],
        } as RichDoc;
      }
      ty += part.h;
    }
    if (!side) y += h + 13;
  }
}
