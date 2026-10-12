/**
 * Split compare (TEACH-75 part w, layout pilot T4; rulings 211, 212, 215, 216): 2 or 3 things set
 * against each other in edge-to-edge colour fields, each a title and a sentence or two, with a seam
 * marker ("vs") on each seam. Ported from the pilot's `northstars/components/split-compare.js`.
 *
 * - **Fields.** Flat full-bleed rects from under the heading to the slide's foot: the accent's
 *   tint, then two neutrals (never a second hue). A ground in the theme's paper covers the whole
 *   slide first, so the theme's art never draws under them (every art layer meets an element and
 *   is left out, `background.ts`; a single `backgroundImage` is covered), as the hook's full photo
 *   does.
 * - **Zones are all or none:** a matched picture pair if every side has a picture, else a quote
 *   each if every side has one, else words only. Pictures share one standard shape and one crop
 *   scale (ruling 216), at 52% of the field; when the words need room the pair takes a wider shared
 *   shape, then shrinks to 40% of the field's width, then type shrinks. A quote is a speech bubble
 *   in a lighter tone of its field, its tail up toward the speaker, the words in the quote voice.
 * - **Reveal** (the first template that writes `revealStep` itself): a side marked `reveal` shows a
 *   "?" medal centred in the box its content will fill. On step 1 an opaque cover in the field's
 *   colour appears over the medal with the content above it: the domain can only make an element
 *   appear, so the cover is what hides the "?" in the editor, in Present and on PPTX build slides.
 * - **Fit (ruling 215).** Words are never changed or cut. Pictures give way first, then type to the
 *   age's comfort sizes; past that the slide is `tight` and type goes on to the floors. A field past
 *   its measured hard maximum (`split-compare-capacity.json`), or the field furthest past its cap
 *   when the slide still overflows, is named in `over`.
 */
import type {
  ImageElement,
  PathElement,
  RichDoc,
  ShapeElement,
  SlideElement,
  TextElement,
} from "@tj/domain/documents";
import { uid } from "../factories";
import { SAFE, SPACE } from "../grid";
import { MIN_FONT_SIZE, typeScale } from "../themes";
import {
  type Ctx,
  type FieldCount,
  type Figure,
  kit,
  mix,
  type Stage,
  type TemplateInput,
} from "./index";
import CAPACITY from "./split-compare-capacity.json" with { type: "json" };
import {
  extOf,
  type FitPicture,
  type PictureFacts,
  pairCrops,
  quoteVoice,
  SHAPES,
  type SplitSizes,
  shapeSafe,
  splitSizes,
  splitTones,
  subjectArea,
} from "./split-compare-deps";

/** One side: a title, a sentence or two, and an optional quote, picture and reveal. */
export type SplitSide = {
  title: string;
  text: string;
  quote?: string | null;
  /** With T5's placement facts (`backdrop`, `kind`) when the picture director wrote them. */
  picture?: (Figure & PictureFacts) | null;
  /** Hidden behind a "?" until the presenter's first click. */
  reveal?: boolean;
};
export type SplitZone = "picture" | "quote" | "text";

/** Element names: what the layers list shows a teacher, and what the tests find. */
export const SPLIT_NAMES = {
  ground: "Background",
  field: "Side field",
  title: "Side title",
  text: "Side words",
  picture: "Side picture",
  bubble: "Quote bubble",
  tail: "Quote bubble tail",
  quote: "Quote",
  marker: "Seam marker",
  markerRing: "Seam marker ring",
  medal: "Hidden until click",
  medalRing: "Hidden until click ring",
  cover: "Revealed on click",
  zoneOf: { picture: "Side picture", quote: "Quote bubble", text: "Side words" },
} as const;

export const SPLIT_MIN = 2;
export const SPLIT_MAX = 3;

/* Geometry, in slide points (the pilot's 1440 px x 2/3). */
const W = 960;
const H = 540;
const SEAM = 5;
/** Clear space under the heading band, before the fields (grid `SPACE`, Greg 12 Oct: more air). */
const UNDER_HEADING = SPACE[5];
const STAGE_TOP = 40;
/**
 * Words only, or pictures that take the spare height: the content starts nearer the field's top (a
 * bubble's tail keeps the pilot's room).
 */
const TEXT_TOP = 24;
const STAGE_FOOT = 43;
/** Clear space under a side's title, before its picture or words (`SPACE`). */
const TITLE_GAP = SPACE[4];
/** Clear space under a side's title before a bubble's tail, which reaches up toward it. */
const TAIL_GAP = SPACE[2];
/** Between a picture or bubble and the words under it (`SPACE`). */
const BODY_GAP = SPACE[3];
/** Room above a bubble for its tail. */
const TAIL_ROOM = 27;
const BUBBLE = { x: 21, top: 16, bottom: 17 } as const;
const MARKER = 56;
/** Content may use this share of the stage (beside a picture: of what the picture leaves). */
const COMFORT_FILL = 0.85;
/**
 * Words only (ruling 218, split-compare replaces compare): with no picture or bubble the words take
 * the zone's height too, so they may fill 90% of the stage; the field's own margins are the room.
 */
const TEXT_FILL = 0.9;
const PIC_SHARE = 0.52;
/** Short words leave spare height: the pictures take it, up to this share of the field. */
const PIC_GROW = 0.62;
const PIC_LOW = 0.25;
const PIC_MIN_W = 0.4;

const stageOf = (c: Ctx): Stage => (c.t as { keyStage?: Stage }).keyStage ?? "ks2";
/** A field's inner padding (the pilot's 56 / 80 px); the slide's outer edges keep the safe margin. */
const sidePad = (n: number) => (n === 3 ? 37 : 53);
const EDGE = SAFE.x;
const medalSize = (n: number) => (n === 3 ? 100 : 120);
const fieldW = (n: number) => (W - (n - 1) * SEAM) / n;

/** The key-stage group a stage's caps are measured for (the pilot's early, primary, secondary). */
export type SplitGroup = "KS1" | "KS2" | "KS3-5";
export const splitGroupOf = (s: Stage): SplitGroup =>
  s === "ks1" ? "KS1" : s === "ks2" ? "KS2" : "KS3-5";

export type SplitLimit = { cap: number; hardMax: number };
export type SplitCell = { title: SplitLimit; text: SplitLimit; quote?: SplitLimit };
/** The measured limits for a group, side count and zone (`split-compare-capacity.json`). */
export function splitTable(group: SplitGroup, n: 2 | 3, zone: SplitZone): SplitCell {
  const t = CAPACITY as unknown as Record<string, Record<string, Record<string, SplitCell>>>;
  return t[group]?.[n]?.[zone] ?? { title: { cap: 0, hardMax: 0 }, text: { cap: 0, hardMax: 0 } };
}

type Pic = FitPicture & { figure: Figure };
/** A side's picture as the fit sees it, or null when it has none it can show. */
function pictureOf(s: SplitSide): Pic | null {
  const f = s.picture;
  if (!f) return null;
  if ("photo" in f) {
    const aspect = f.aspect && f.aspect > 0 ? f.aspect : 4 / 3;
    const ext = f.photo ? extOf(f) : undefined;
    return {
      aspect,
      ...(f.photo && f.subjects ? { subjects: f.subjects } : {}),
      ...(ext ? { ext } : {}),
      figure: f,
    };
  }
  if ("drawn" in f && f.drawn?.src)
    return { aspect: f.drawn.aspect || 4 / 3, diagram: true, figure: f };
  return null;
}

export function zoneOf(sides: SplitSide[]): SplitZone {
  if (sides.length && sides.every((s) => pictureOf(s))) return "picture";
  if (sides.length && sides.every((s) => s.quote?.trim())) return "quote";
  return "text";
}

/** Geometry-only fit of a split, for the capacity table: fits at the floors, and comfortable. */
export type SplitFit = { fits: boolean; comfy: boolean };

export function layoutSplitCompare(c: Ctx, input: TemplateInput) {
  run(c, input, true);
}

/** The fit alone, without the published table (the capacity script measures that table). */
export function splitFit(c: Ctx, input: TemplateInput): SplitFit {
  return run(c, input, false);
}

function run(c: Ctx, input: TemplateInput, useTable: boolean): SplitFit {
  const all = input.sides ?? [];
  if (all.length < SPLIT_MIN) c.over.push(`sides ${all.length}/${SPLIT_MIN}`);
  if (all.length > SPLIT_MAX) c.over.push(`sides ${all.length}/${SPLIT_MAX}`);
  const sides = all.slice(0, SPLIT_MAX);
  const n = Math.max(SPLIT_MIN, sides.length);
  const tones = splitTones(c.t);
  const stage = stageOf(c);
  const voice = quoteVoice(c.t, stage);
  const full = c.s;

  kit.box(c, { x: 0, y: 0, w: W, h: H }, tones.paper, {
    shape: "rect",
    radius: 0,
    name: SPLIT_NAMES.ground,
  });
  let top = 46;
  const head = input.heading.trim();
  if (head) {
    // The fields start under the measured heading (ruling 198), so a two-line heading is not over.
    const n0 = c.over.length;
    const el = kit.heading(c, head);
    c.over.length = n0;
    accent(c, el, input.accentWord);
    top = el.y + el.h;
  }
  c.bodyFromHeading = true;
  // Words only and pictures: the fields start a little nearer the heading, for the height it gives.
  const ft = Math.round(top + UNDER_HEADING);
  const fh = H - ft;
  const fw = fieldW(n);
  const pad = sidePad(n);
  const cellW = Math.floor(fw - pad - Math.max(pad, EDGE));
  const zone = zoneOf(sides);
  const stageTop = zone === "quote" ? STAGE_TOP : TEXT_TOP;
  const stageH = fh - stageTop - STAGE_FOOT;
  const pics = zone === "picture" ? sides.map((s) => pictureOf(s) as Pic) : [];

  // Sizes on the stage's scale, scaled by k; never under the floors.
  const base = splitSizes(full.body, MIN_FONT_SIZE.body, typeScale(c.t)?.heading);
  const at = (k: number): SplitSizes => ({
    ...base,
    name: Math.max(base.floor.name, Math.round(base.name * k)),
    body: Math.max(base.floor.body, Math.round(base.body * k)),
    quote: Math.max(base.floor.body, Math.round(base.quote * k)),
  });
  const kMin = Math.max(base.floor.name / base.name, base.floor.body / base.body);
  const typeComfy = (z: SplitSizes) => z.name >= base.comfort.name && z.body >= base.comfort.body;

  const quoteCtx: Ctx = { ...c, t: { ...c.t, fonts: { ...c.t.fonts, body: voice.family } } };
  const nameH = (s: SplitSide, z: SplitSizes) =>
    s.title.trim() ? measureAt(c, s.title, "heading", cellW, z.name) : 0;
  const textH = (s: SplitSide, z: SplitSizes) =>
    s.text.trim() ? measureAt(c, s.text, "body", cellW, z.body) : 0;
  const quoteH = (s: SplitSide, z: SplitSizes) =>
    measureAt(quoteCtx, s.quote ?? "", "body", cellW - 2 * BUBBLE.x, z.quote, 500) +
    BUBBLE.top +
    BUBBLE.bottom;
  const wordsOk = (z: SplitSizes) =>
    sides.every(
      (s) =>
        kit.wordsFit(c, s.title, "heading", cellW, z.name) &&
        kit.wordsFit(c, s.text, "body", cellW, z.body) &&
        (zone !== "quote" ||
          kit.wordsFit(quoteCtx, s.quote ?? "", "body", cellW - 2 * BUBBLE.x, z.quote, 500)),
    );

  // The picture's steps, largest first: the shared shape that shows the subjects largest, from the
  // spare height down to 52% of the field ("short text, bigger pictures"); then wider shared shapes;
  // then that shape shrinking to 40% of the field's width. A shape counts as shared when every
  // picture can crop to it or extend its plain backdrop to it. No standard shape: the shape of a
  // picture that cannot extend, if the others can reach it; else each its own shape at one height.
  type Step = { ratios: number[]; h: number };
  const steps: Step[] = [];
  const wFloor = PIC_MIN_W * fw;
  if (zone === "picture") {
    const hMax = Math.round(PIC_SHARE * fh);
    const hGrow = Math.round(PIC_GROW * fh);
    const hLow = Math.round(PIC_LOW * fh);
    const boxOf = (r: number, h: number) => ({
      w: Math.round(Math.min(cellW, h * r)),
      h: Math.round(Math.min(h, cellW / r)),
    });
    const fixed = pics.filter((p) => !p.ext && !p.diagram).map((p) => p.aspect);
    const candidates: number[] = SHAPES.map(([, r]) => r).filter((r) =>
      pics.every((p) => shapeSafe(p, r)),
    );
    if (!candidates.length)
      for (const r of fixed) if (pics.every((p) => shapeSafe(p, r))) candidates.push(r);
    if (candidates.length) {
      const area = (r: number) => {
        const b = boxOf(r, hMax);
        return pics.reduce((t, p) => t + subjectArea(p, b.w, b.h), 0) + b.w * b.h * 1e-3;
      };
      const start = [...candidates].sort((a, b) => area(b) - area(a))[0] as number;
      const hStart = boxOf(start, hMax).h;
      for (let h = boxOf(start, hGrow).h; h > hStart; h -= 6)
        steps.push({ ratios: pics.map(() => start), h });
      const wider = candidates
        .filter((r) => r !== start && boxOf(r, hMax).h < hStart)
        .sort((a, b) => boxOf(b, hMax).h - boxOf(a, hMax).h);
      for (const r of [start, ...wider])
        steps.push({ ratios: pics.map(() => r), h: boxOf(r, hMax).h });
      const last = steps[steps.length - 1] as Step;
      const r = last.ratios[0] as number;
      // An upright shape is narrower than the width floor from the start: it gives way to 60% of
      // its own width instead.
      const wMin = Math.min(wFloor, boxOf(r, last.h).w * 0.6);
      for (let h = last.h - 6; boxOf(r, h).w >= wMin && h >= hLow; h -= 6)
        steps.push({ ratios: last.ratios, h });
    } else {
      // No shape suits every picture: each takes its own shape at one shared height.
      const rs = pics.map((p) => p.aspect);
      const widest = (h: number) => Math.max(...rs.map((r) => boxOf(r, h).w));
      for (let h = hGrow; h >= hLow && (h >= hMax || widest(h) >= wFloor); h -= 6)
        steps.push({ ratios: rs, h });
    }
    for (const st of steps) Object.assign(st, { boxes: st.ratios.map((r) => boxOf(r, st.h)) });
  }
  const boxesOf = (st: Step) => (st as Step & { boxes: { w: number; h: number }[] }).boxes;

  type Plan = { name: number; zone: number; picH: number; body: number; total: number };
  const plan = (z: SplitSizes, si: number): Plan => {
    const name = Math.max(0, ...sides.map((s) => nameH(s, z)));
    let zoneH = 0;
    let picH = 0;
    if (zone === "picture") {
      picH = Math.max(...boxesOf(steps[si] as Step).map((b) => b.h));
      zoneH = picH + (name ? TITLE_GAP : 0);
    } else if (zone === "quote")
      zoneH = (name ? TAIL_GAP : 0) + TAIL_ROOM + Math.max(...sides.map((s) => quoteH(s, z)));
    const words = Math.max(0, ...sides.map((s) => textH(s, z)));
    const gap = zoneH ? BODY_GAP : name ? TITLE_GAP : 0;
    const body = words ? words + gap : 0;
    return { name, zone: zoneH, picH, body, total: name + zoneH + body };
  };
  const judge = (p: Plan, z: SplitSizes) => {
    const fits = p.total <= stageH && wordsOk(z);
    const fill =
      (p.total - (zone === "picture" ? p.zone : 0)) / (stageH - (zone === "picture" ? p.zone : 0));
    // Beside pictures the words may fill what the picture leaves: the picture gives way first.
    const room = zone === "text" ? TEXT_FILL : zone === "picture" ? 1 : COMFORT_FILL;
    return { fits, comfy: fits && fill <= room };
  };

  let k = 1;
  let si = 0;
  let z = at(k);
  let p = plan(z, si);
  let j = judge(p, z);
  while (zone === "picture" && !j.comfy && si < steps.length - 1) {
    si++;
    p = plan(z, si);
    j = judge(p, z);
  }
  // Type down to the comfort sizes while it is not comfortable...
  while (!j.comfy && k > kMin) {
    const next = Math.round((k - 0.025) * 1000) / 1000;
    if (!typeComfy(at(next))) break;
    k = next;
    z = at(k);
    p = plan(z, si);
    j = judge(p, z);
  }
  // ...then, tight, on to the floors until it fits.
  while (!j.fits && k > kMin) {
    k = Math.max(kMin, Math.round((k - 0.025) * 1000) / 1000);
    z = at(k);
    p = plan(z, si);
    j = judge(p, z);
  }
  // A picture narrower than 40% of its field (or than a 3:4 box of its height, for an upright pair)
  // is a sliver: the slide does not suit these pictures, so it is reported and the writer moves it.
  const narrow =
    zone === "picture"
      ? boxesOf(steps[si] as Step).flatMap((b, i) =>
          b.w < Math.min(wFloor, 0.75 * b.h) - 1 ? [i] : [],
        )
      : [];
  const comfy = j.comfy && typeComfy(z) && !narrow.length;

  // Fields, then the content centred in each field's stage.
  for (let i = 0; i < n; i++)
    kit.box(
      c,
      {
        x: Math.round(i * (fw + SEAM)),
        y: ft,
        w: Math.round((i + 1) * (fw + SEAM) - SEAM) - Math.round(i * (fw + SEAM)),
        h: fh,
      },
      tones.fields[i] as string,
      { shape: "rect", radius: 0, name: SPLIT_NAMES.field },
    );
  if (sides.length)
    drawSides(c, sides, {
      zone,
      z,
      p,
      ft,
      fw,
      pad,
      cellW,
      y0: ft + stageTop + Math.max(0, Math.round((stageH - p.total) / 2)),
      tones,
      voice,
      quoteCtx,
      pics,
      step: steps[si],
      boxes: zone === "picture" ? boxesOf(steps[si] as Step) : [],
      n,
      quoteH,
      textH,
    });
  // A marker on each seam, level with the fields' middle.
  const label = input.marker ?? "vs";
  for (let i = 1; i < n; i++) {
    const cx = (i * (W + SEAM)) / n - SEAM / 2;
    const cy = ft + fh / 2;
    disc(c, cx, cy, MARKER + 2 * SEAM, tones.paper, SPLIT_NAMES.markerRing);
    const m = disc(c, cx, cy, MARKER, tones.deep, SPLIT_NAMES.marker);
    if (label.trim()) {
      m.doc = kit.doc(label.trim());
      m.textStyle = {
        preset: "heading",
        fontSize: MIN_FONT_SIZE.body,
        fontWeight: 700,
        color: tones.onDeep,
        align: "center",
        valign: "middle",
        padding: 0,
      };
    }
  }

  const fit = { fits: j.fits && !narrow.length, comfy };
  if (!useTable) return fit;
  report(c, sides, n, zone, { ...fit, fits: j.fits });
  for (const i of narrow) c.over.push(`sides[${i}].picture`);
  if (narrow.length) c.tight = true;
  return fit;
}

/** The fields report, `over` past a hard maximum (or the worst field when it overflows), `tight`. */
function report(c: Ctx, sides: SplitSide[], n: number, zone: SplitZone, fit: SplitFit) {
  const stage = stageOf(c);
  const cell = splitTable(splitGroupOf(stage), (n === 3 ? 3 : 2) as 2 | 3, zone);
  const fields: FieldCount[] = [];
  sides.forEach((s, i) => {
    const row = (key: "title" | "quote" | "text", v: string) => {
      const lim = cell[key] ?? cell.text;
      const chars = v.length;
      fields.push({
        field: `sides[${i}].${key}`,
        path: `sides.${i}.${key}`,
        chars,
        cap: lim.cap,
        hardMax: lim.hardMax,
        tight: chars > lim.cap,
        over: chars > lim.hardMax,
      });
    };
    row("title", s.title);
    if (zone === "quote") row("quote", s.quote ?? "");
    row("text", s.text);
  });
  let over = fields.filter((f) => f.over);
  if (!fit.fits && !over.length) {
    // Overflow from a combination: blame the field furthest past its cap.
    const worst = [...fields].sort((a, b) => b.chars / (b.cap || 60) - a.chars / (a.cap || 60))[0];
    if (worst) {
      worst.over = true;
      over = [worst];
    }
  }
  for (const f of over) c.over.push(f.field);
  c.fields = fields;
  c.tight = !fit.comfy || fields.some((f) => f.tight);
}

type Draw = {
  zone: SplitZone;
  z: SplitSizes;
  p: { name: number; zone: number; picH: number; body: number };
  ft: number;
  fw: number;
  pad: number;
  cellW: number;
  y0: number;
  tones: ReturnType<typeof splitTones>;
  voice: { family: string; italic: boolean };
  quoteCtx: Ctx;
  pics: Pic[];
  step?: { ratios: number[]; h: number };
  boxes: { w: number; h: number }[];
  n: number;
  quoteH: (s: SplitSide, z: SplitSizes) => number;
  textH: (s: SplitSide, z: SplitSizes) => number;
};

function drawSides(c: Ctx, sides: SplitSide[], d: Draw) {
  const ink = c.t.colors.heading ?? c.t.colors.ink;
  const crops = d.zone === "picture" && d.step ? pairCrops(d.pics, d.step.ratios[0] as number) : [];
  const ownCrops = d.zone === "picture" && d.step && new Set(d.step.ratios).size > 1;
  const radius = Math.min(c.t.radius, 14);
  sides.forEach((s, i) => {
    // Outer fields keep the safe margin on the slide's edge; a middle field centres its column.
    const left =
      i === 0
        ? Math.max(d.pad, EDGE)
        : i === d.n - 1
          ? d.fw - d.cellW - Math.max(d.pad, EDGE)
          : (d.fw - d.cellW) / 2;
    const x = Math.round(i * (d.fw + SEAM) + left);
    const field = d.tones.fields[i] as string;
    const hide = s.reveal === true;
    const later: (() => void)[] = [];
    const now = (f: () => void) => (hide ? later.push(f) : f());
    let y = d.y0;
    if (s.title.trim())
      sized(
        c,
        s.title,
        "heading",
        d.z.name,
        { x, y, w: d.cellW },
        { color: ink, name: SPLIT_NAMES.title },
      );
    y += d.p.name;
    let box: { x: number; y: number; w: number; h: number } | null = null;
    if (d.zone === "picture") {
      const b = d.boxes[i] as { w: number; h: number };
      const r = { x, y: y + (d.p.name ? TITLE_GAP : 0), w: b.w, h: b.h };
      box = r;
      const pic = d.pics[i] as Pic;
      now(() => picture(c, pic, r, ownCrops ? pairCrops([pic], b.w / b.h)[0] : crops[i], radius));
    } else if (d.zone === "quote") {
      const bh = d.quoteH(s, d.z);
      const r = { x, y: y + (d.p.name ? TAIL_GAP : 0) + TAIL_ROOM, w: d.cellW, h: bh };
      box = r;
      now(() => bubble(c, s.quote ?? "", r, mix(field, c.t.colors.surface, 0.58), d, radius));
    }
    y += d.p.zone;
    const th = d.textH(s, d.z);
    const gap = d.p.zone ? BODY_GAP : d.p.name ? TITLE_GAP : 0;
    const textRect = { x, y: y + gap, w: d.cellW, h: th };
    if (s.text.trim())
      now(() =>
        sized(c, s.text, "body", d.z.body, textRect, {
          color: c.t.colors.ink,
          name: SPLIT_NAMES.text,
        }),
      );
    if (!hide) return;
    // The "?" medal centred in the box the content fills; then, on step 1, the cover and content.
    const target = box ?? textRect;
    const q = d.zone === "picture" ? Math.min(147, Math.round(d.p.picH * 0.62)) : medalSize(d.n);
    const dm = Math.round(Math.min(q, d.cellW, Math.max(target.h, q * 0.6)));
    const cx = target.x + target.w / 2;
    const cy = target.y + target.h / 2;
    const ring = Math.max(4, Math.round(dm * 0.08));
    disc(c, cx, cy, dm + 2 * ring, d.tones.paper, SPLIT_NAMES.medalRing);
    const m = disc(c, cx, cy, dm, d.tones.face, SPLIT_NAMES.medal);
    m.doc = kit.doc("?");
    m.textStyle = {
      preset: "heading",
      fontSize: Math.max(MIN_FONT_SIZE.body, Math.round(dm * 0.5)),
      fontWeight: c.t.weights.heading,
      color: c.t.colors.accent,
      align: "center",
      valign: "middle",
      padding: 0,
    };
    const rx0 = Math.min(target.x, cx - dm / 2 - ring);
    const ry0 = Math.min(target.y, cy - dm / 2 - ring);
    const rx1 = Math.max(target.x + target.w, cx + dm / 2 + ring);
    const ry1 = Math.max(target.y + target.h, cy + dm / 2 + ring);
    const from = c.els.length;
    kit.box(
      c,
      {
        x: Math.floor(rx0),
        y: Math.floor(ry0),
        w: Math.ceil(rx1 - Math.floor(rx0)),
        h: Math.ceil(ry1 - Math.floor(ry0)),
      },
      field,
      {
        shape: "rect",
        radius: 0,
        name: SPLIT_NAMES.cover,
      },
    );
    for (const f of later) f();
    for (const e of c.els.slice(from)) e.revealStep = 1;
  });
}

/** A photo filling its box at the pair's crop, or a drawn diagram contained in it. */
function picture(
  c: Ctx,
  p: Pic,
  r: { x: number; y: number; w: number; h: number },
  crop: { x: number; y: number; w: number; h: number } | null | undefined,
  radius: number,
) {
  const f = p.figure;
  if ("drawn" in f) {
    c.els.push({
      id: uid(),
      type: "image",
      name: SPLIT_NAMES.picture,
      ...r,
      src: f.drawn.src,
      alt: f.drawn.alt ?? "",
      fit: "contain",
    } as ImageElement);
    return;
  }
  if (!("photo" in f)) return;
  const known = !!f.photo && !!f.aspect;
  c.els.push({
    id: uid(),
    type: "image",
    name: SPLIT_NAMES.picture,
    ...r,
    src: f.photo,
    alt: f.alt ?? "",
    ...(f.request ? { request: f.request } : {}),
    ...(f.subjects ? { subjects: f.subjects } : {}),
    ...(f.source ? { source: f.source } : {}),
    ...(known && crop ? { crop } : {}),
    fit: "cover",
    radius,
  } as ImageElement);
}

/** A speech bubble: a rounded body and a pointed tail up toward the speaker's name, the quote on it. */
function bubble(
  c: Ctx,
  quote: string,
  r: { x: number; y: number; w: number; h: number },
  fill: string,
  d: Draw,
  radius: number,
) {
  // The tail: the pilot's polygon (4% 0, 100% 100%, 30% 100%) on a 41 x 31 box, 20 in from the left.
  const tail: PathElement = {
    id: uid(),
    type: "path",
    name: SPLIT_NAMES.tail,
    x: r.x + 20,
    y: r.y - TAIL_ROOM + 1,
    w: 41,
    h: TAIL_ROOM + 2,
    points: [
      { x: 0.04, y: 0 },
      { x: 1, y: 1 },
      { x: 0.3, y: 1 },
    ],
    closed: true,
    fill,
    // The path view strokes in ink by default: the tail is one piece with its bubble.
    stroke: fill,
    strokeWidth: 1,
  };
  c.els.push(tail);
  kit.box(c, r, fill, { shape: "rounded", radius: Math.max(radius, 8), name: SPLIT_NAMES.bubble });
  const el = sized(
    d.quoteCtx,
    quote,
    "body",
    d.z.quote,
    { x: r.x + BUBBLE.x, y: r.y + BUBBLE.top, w: r.w - 2 * BUBBLE.x },
    { color: c.t.colors.ink, name: SPLIT_NAMES.quote, weight: 500 },
  );
  el.style = { ...el.style, fontFamily: d.voice.family };
  if (d.voice.italic) el.doc = italic(el.doc);
}

const italic = (doc: RichDoc): RichDoc =>
  JSON.parse(
    JSON.stringify(doc).replace(/"type":"text",/g, '"type":"text","marks":[{"type":"italic"}],'),
  ) as RichDoc;

/** Text at an explicit size in a role's face and line height. */
function sized(
  c: Ctx,
  value: string,
  role: "heading" | "body",
  size: number,
  rect: { x: number; y: number; w: number },
  extra: { color?: string; name?: string; weight?: number },
): TextElement {
  const s = c.s;
  c.s = { ...s, [role]: size };
  const el = kit.text(c, value, role, rect, extra);
  c.s = s;
  return el;
}

function measureAt(
  c: Ctx,
  value: string,
  role: "heading" | "body",
  w: number,
  size: number,
  weight?: number,
) {
  return kit.measure({ ...c, s: { ...c.s, [role]: size } }, value, role, w, weight);
}

/**
 * Which input path each element shows, in draw order (the editor's layout ref binding, TEACH-205
 * part b): a side's title, quote and words by their name and the field they sit in.
 */
export function splitPaths(els: SlideElement[]): (string | undefined)[] {
  const fields = els.filter((e) => e.name === SPLIT_NAMES.field);
  const key: Record<string, string> = {
    [SPLIT_NAMES.title]: "title",
    [SPLIT_NAMES.quote]: "quote",
    [SPLIT_NAMES.text]: "text",
  };
  return els.map((e) => {
    const k = e.name ? key[e.name] : undefined;
    if (!k) return undefined;
    const i = fields.findIndex((f) => e.x >= f.x && e.x < f.x + f.w);
    return i < 0 ? undefined : `sides.${i}.${k}`;
  });
}

/** A disc of diameter `d` centred on (cx, cy). */
function disc(c: Ctx, cx: number, cy: number, d: number, fill: string, name: string): ShapeElement {
  const el: ShapeElement = {
    id: uid(),
    type: "shape",
    shape: "ellipse",
    x: Math.round(cx - d / 2),
    y: Math.round(cy - d / 2),
    w: Math.round(d),
    h: Math.round(d),
    fill,
    name,
  };
  c.els.push(el);
  return el;
}

/** `accentWord`, when it is an exact substring of the heading, in the accent. */
function accent(c: Ctx, el: TextElement, word: string | null | undefined) {
  const w = word?.trim();
  if (!w) return;
  const text = el.doc.content?.[0]?.content?.map((r) => ("text" in r ? r.text : "")).join("") ?? "";
  const at = text.indexOf(w);
  if (at < 0) return;
  const parts = [text.slice(0, at), w, text.slice(at + w.length)];
  el.doc = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: parts
          .map((t, i) =>
            i === 1
              ? {
                  type: "text",
                  text: t,
                  marks: [{ type: "textStyle", attrs: { color: c.t.colors.accent } }],
                }
              : { type: "text", text: t },
          )
          .filter((r) => r.text),
      },
    ],
  } as RichDoc;
}
