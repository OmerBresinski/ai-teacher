/**
 * Stages (TEACH-75 part ac, layout batch C4; rulings 220, 221, 243): 3-6 named frames of one
 * strictly linear process in one strip, joined by block arrows, a tint that deepens from 30% to
 * 80% left to right, and each frame's name and line under it. No numbers. Ported from the pilot's
 * `northstars-v12/stages-arrows/slide.html` (`?arrow=block`, Greg 15 Oct); the pilot's px at 1440
 * are x 2/3 here.
 *
 * - Visuals are all or none: every stage has a picture or a library icon, or the slide is laid by
 *   items-row's ordered look (part u: medals on the theme's line, numbered, the writer's motif).
 *   There is no slim band and no separate no-icon look (ruling 243, N7). A held draft icon
 *   (`PENDING_ICON`) counts as an icon and draws an empty frame.
 * - With pictures every stage is its own rounded tile and the arrow sits on the paper in a gutter
 *   wide enough to clear both tiles; with icons the frames join in one strip and the arrow sits on
 *   each seam with a paper halo. A failed picture's frame shows its icon.
 * - Fit: type steps down from the age's sizes to the floors; past the comfort sizes the slide is
 *   tight, and when it still does not fit the furthest field is named in `over`. Words are never
 *   cut; a name never breaks inside a word, and every name in the row takes the tallest one's height.
 * - Max 6 stages (5 at early); a 7th is over and the editor offers Split (two slides, title repeated).
 */
import type { PathElement, ShapeElement, TextPreset } from "@tj/domain/documents";
import { uid } from "../factories";
import { blockArrow } from "../paths/arrow";
import { countLines } from "../text-measure";
import { resolveFontSize } from "../text-style";
import { keyStageOf, MIN_FONT_SIZE } from "../themes";
import { type Connector, connectorShape } from "../themes/marks";
import { surfacesOf } from "../themes/surfaces";
import { type Ctx, type FieldReport, type Figure, kit, mix, type TemplateInput } from "./index";
import { layoutItemsRow, PENDING_ICON, ROW_NAMES } from "./items-row";
import {
  type Age,
  ageProfileOf,
  iconImage,
  PLACEHOLDER_ICON,
  resolveIcons,
  v2Colors,
  v2Profile,
} from "./items-row-deps";
import CAPACITY from "./stages-capacity.json" with { type: "json" };

/** One stage: a name (1-2 words), one line, a library icon label and an optional AI picture. */
export type StageItem = {
  name: string;
  line: string;
  icon?: string | null;
  /** The stage's picture; `photo: ""` is an open slot (still being found). */
  picture?: Figure | null;
};

export const STAGES_MIN = 3;
/** Most stages an age takes (gold caps: six at early leaves a 23-character line, too thin). */
export const STAGES_MAX: Record<Age, number> = { early: 5, primary: 6, secondary: 6 };

export const STAGES_NAMES = {
  frame: "Stage frame",
  picture: "Stage picture",
  icon: "Stage icon",
  halo: "Stage arrow halo",
  arrow: "Stage arrow",
  name: "Stage name",
  line: "Stage line",
} as const;

/** The stage the editor adds: blank words and the placeholder icon, so an icon strip keeps its icons. */
export const blankStage = (): StageItem => ({
  name: "New stage",
  line: "Add a sentence here.",
  icon: PLACEHOLDER_ICON,
});

/* Geometry, pilot px x 2/3. Per count: outer gutter, frame height, arrow base size (the old disc). */
const K = 2 / 3;
const GEO: Record<number, [number, number, number]> = {
  3: [96, 300, 80],
  4: [96, 290, 76],
  5: [64, 262, 62],
  6: [56, 212, 54],
};
const SLIDE_W = 960;
const FOOT = 497;
const SEAM = 8 * K;
const CLEAR = 14 * K;
const CAP_GAP = 30 * K;
const LINE_GAP = 12 * K;
const NAME_LH = 1.08;
const ROW_TOP = 196 * K;
const UNDER_TITLE = 52 * K;
/** The arrow's paper halo (pilot stroke 7px, painted under the fill). */
const HALO = 7 * K;

/* ------------------------------------------------------------------ */
/* Caps (stages-capacity.json, measured by stages-capacity.ts)         */
/* ------------------------------------------------------------------ */

export type StageVis = "icons" | "pictures";
export type StageCap = { cap: number; hardMax: number };
export type StageCell = { n: number; vis: StageVis; name: StageCap; line: StageCap };
let TABLE = CAPACITY as unknown as Record<string, StageCell[]>;
/** Lays out with no caps table, so the capacity script measures geometry alone. */
export function withoutStageCaps<T>(f: () => T): T {
  const kept = TABLE;
  TABLE = {};
  const wasMeasuring = MEASURING;
  MEASURING = true;
  try {
    return f();
  } finally {
    TABLE = kept;
    MEASURING = wasMeasuring;
  }
}
/** True while the capacity script measures: no field is checked against a table it is writing. */
let MEASURING = false;
export const stageCapsOf = (age: Age, n: number, vis: StageVis) =>
  (TABLE[age] ?? []).find((c) => c.n === n && c.vis === vis);

/**
 * Cells the writer is never offered, whatever they measure (TEACH-215 part m): six pictured stages
 * at KS2 and KS3 hold a 6-character name and a 24-character line, which reads cramped. A saved
 * slide still lays out from its measured cell; a stages menu line must skip these.
 */
export const STAGES_NOT_OFFERED: Partial<Record<Age, readonly `${number}${"i" | "p"}`[]>> = {
  primary: ["6p"],
  secondary: ["6p"],
};
export const stageOffered = (age: Age, n: number, vis: StageVis) =>
  !STAGES_NOT_OFFERED[age]?.includes(`${n}${vis === "pictures" ? "p" : "i"}`);

/* ------------------------------------------------------------------ */
/* Layout                                                              */
/* ------------------------------------------------------------------ */

const round1 = (v: number) => Math.round(v * 10) / 10;
/**
 * A stages size as drawn. KS1 and KS2 draw the gold's sizes as given (`fixedSize`); from KS3 a size
 * snaps to the stage's type scale, as on master.
 */
const goldStage = (c: Ctx) => {
  const ks = keyStageOf(c.t);
  return ks === "ks1" || ks === "ks2";
};
const drawn = (c: Ctx, preset: TextPreset, size: number) =>
  goldStage(c) ? round1(size) : resolveFontSize(c.t, preset, size);
/**
 * Half a point kept clear at the column's edge where the stage is drawn at a fixed size (KS1 and
 * KS2, `fixedSize`), which the editor's fitting engine never re-fits (TEACH-215 part m). The
 * advances are rounded to a thousandth of an em and kerning can widen a pair, so a name or line
 * the tables put within half a point of the edge (187.85 of 188, 146.95 of 147) drew one line
 * longer than counted and printed over the text under it. KS3 snaps to the type scale and is
 * re-fitted in the editor, so it measures to the edge as before.
 */
const FIXED_EDGE = 0.5;
const room = (c: Ctx, w: number) => (goldStage(c) ? w - FIXED_EDGE : w);
const lines = (c: Ctx, v: string, p: TextPreset, w: number, wt: number, size: number) =>
  v.trim() ? countLines(v, p, c.t, room(c, w), wt, size) : 0;
const wordsFit = (c: Ctx, v: string, p: TextPreset, w: number, wt: number, size: number) =>
  v
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => countLines(word, p, c.t, room(c, w), wt, size) === 1);

/** Whether a stage's picture is there (an open slot counts: it is coming). */
type Photo = Extract<Figure, { photo: string }>;
const hasPicture = (p: Figure | null | undefined): p is Photo =>
  !!p && typeof p === "object" && "photo" in p && typeof p.photo === "string";

export function layoutStages(c: Ctx, input: TemplateInput) {
  const stage = keyStageOf(c.t) ?? "ks2";
  const age = ageProfileOf(stage);
  const all = (input.stages ?? []).filter(Boolean);
  const items = all.slice(0, 6);
  const n = items.length;
  const countOver = all.length < STAGES_MIN || all.length > STAGES_MAX[age];

  // Icons: every label must resolve (a held draft icon counts), else the ordered item row.
  const labels = items.map((it) => it.icon?.trim() ?? "");
  const named = labels.filter((l) => l && l !== PENDING_ICON);
  const res = resolveIcons(named);
  const concepts = labels.map((l) =>
    l === PENDING_ICON ? PENDING_ICON : l ? (res.ids[named.indexOf(l)] ?? null) : null,
  );
  const vis = items.map((it, i) => (hasPicture(it.picture) ? "pic" : concepts[i] ? "icon" : null));
  if (!n || !vis.every(Boolean)) return orderedRow(c, input, items, all.length, age, res.misses);
  if (countOver) c.over.push("stages");

  const v2 = v2Profile(c.t);
  const col = v2Colors(c.t);
  // The gold's own sizes at KS1 and KS2 (C10, THEME-AUDIT 18 Oct: `--t-name` / `--t-body`, KS2 46 /
  // 33 px, KS1 54 / 38 px), drawn as given (`fixedSize`) as the starting size; ruling 162 amended by
  // Greg 18 Oct (stages) lets the line take the gold's size under the stage's reading floor. The
  // floors and comfort sizes are master's. From KS3 the profile is master's exactly.
  const gold = goldStage(c);
  const prof = {
    name: gold ? v2.sizes.name : Math.max(v2.sizes.name, Math.round(c.s.body * 1.25)),
    body: gold ? v2.sizes.body : Math.max(v2.sizes.body, c.s.body),
    floorName: Math.max(MIN_FONT_SIZE.heading, v2.floors.name),
    floorBody: Math.max(MIN_FONT_SIZE.body, v2.floors.body),
    comfortName: Math.max(MIN_FONT_SIZE.heading, v2.comfort.name),
    comfortBody: Math.max(MIN_FONT_SIZE.body, v2.comfort.body),
    lh: v2.lineHeights.body,
  };

  // Heading, the accent word coloured.
  let top = 40;
  const head = input.heading.trim();
  if (head) {
    const n0 = c.over.length;
    const el = kit.heading(c, head);
    c.over.length = n0;
    accentWord(el, head, input.accentWord, col.accent);
    top = el.y + el.h;
    c.bodyFromHeading = true;
  }

  const geo = GEO[Math.min(Math.max(n, 3), 6)] as [number, number, number];
  const pad = geo[0] * K;
  const picH0 = geo[1] * K;
  const mk = geo[2] * K;
  const tiles = vis.includes("pic");
  const gap = tiles ? Math.round(mk * 1.25) + 28 * K : SEAM;
  const colW = (SLIDE_W - 2 * pad - (n - 1) * gap) / n;
  const gutter = (n >= 5 ? 20 : 24) * K;
  // Tiles stand apart already (the arrow gutter): only a joined strip keeps a gutter in each frame.
  // Measured at the width it is drawn at: `textBox` draws the box on whole points, and at 5 frames
  // a name measured on one line in 157.3 wrapped in the 157 it was drawn in (TEACH-215 part m).
  const textW = Math.round(tiles ? colW : colW - gutter);
  const nameWt = c.t.weights.heading;
  const bodyWt = c.t.weights.body;
  const rowTop = Math.max(ROW_TOP, top + UNDER_TITLE);

  const measureAt = (k: number, fs = 1) => {
    const picH = picH0 * fs;
    const sn = drawn(c, "heading", round1(Math.max(prof.floorName, prof.name * k)));
    const sb = drawn(c, "body", round1(Math.max(prof.floorBody, prof.body * k)));
    let wordsOk = true;
    let nameH = 0;
    let lineH = 0;
    for (const it of items) {
      if (!wordsFit(c, it.name, "heading", textW, nameWt, sn)) wordsOk = false;
      if (!wordsFit(c, it.line, "body", textW, bodyWt, sb)) wordsOk = false;
      nameH = Math.max(nameH, lines(c, it.name, "heading", textW, nameWt, sn) * sn * NAME_LH);
      lineH = Math.max(lineH, lines(c, it.line, "body", textW, bodyWt, sb) * sb * prof.lh);
    }
    const h = picH + CAP_GAP + nameH + (lineH ? LINE_GAP + lineH : 0);
    const floored =
      sn <= drawn(c, "heading", prof.floorName) && sb <= drawn(c, "body", prof.floorBody);
    return { sn, sb, nameH, h, picH, fits: wordsOk && rowTop + h <= FOOT + 0.5, floored };
  };
  let g = measureAt(1);
  // Type steps down to the floors; still over, the frames give way to 80% and type steps again.
  for (const fs of [1, 0.9, 0.8]) {
    g = measureAt(1, fs);
    for (let k = 0.98; !g.fits && !g.floored && k >= 0.5; k -= 0.02)
      g = measureAt(+k.toFixed(2), fs);
    if (g.fits) break;
  }
  const picH = g.picH;

  const fields = report(age, input, items, tiles ? "pictures" : "icons");
  c.fields = fields;
  for (const f of fields) if (f.over && !c.over.includes(f.field)) c.over.push(f.field);
  if (!g.fits && !fields.some((f) => f.over)) {
    const worst = fields
      .filter((f) => f.field.startsWith("stages["))
      .sort((a, b) => b.chars / (b.cap || 60) - a.chars / (a.cap || 60))[0];
    c.over.push(worst?.field ?? "stages");
  }
  const comfy =
    g.fits &&
    g.sn >= drawn(c, "heading", prof.comfortName) - 0.5 &&
    g.sb >= drawn(c, "body", prof.comfortBody) - 0.5 &&
    // KS1 and KS2: a name that fell to the heading minimum is tight (TEACH-215 part j review).
    !(gold && g.sn <= MIN_FONT_SIZE.heading + 0.05);
  c.tight = !comfy || countOver || fields.some((f) => f.tight);

  // The block sits centred in the room under the title (biased up), never above the row top.
  const y0 = Math.round(rowTop + Math.max(0, (FOOT - rowTop - g.h) * 0.5));
  const cx = (i: number) => pad + i * (colW + gap);
  const tint = (i: number) =>
    mix(col.soft, col.surface, n > 1 ? (30 + (50 * i) / (n - 1)) / 100 : 0.3);
  const radius = Math.round(v2.radius.picture);

  // Frames: one strip with its own outer corners, or one rounded tile each when there are pictures.
  items.forEach((it, i) => {
    const x = cx(i);
    const box = { x, y: y0, w: colW, h: picH };
    const fill = tint(i);
    const pic = vis[i] === "pic" ? (it.picture as Photo) : null;
    if (pic) {
      // Cover the tile whatever the picture's shape (the gold's object-fit: cover).
      kit.photoBox(
        c,
        {
          photo: pic.photo,
          alt: pic.alt ?? it.name,
          ...(pic.request ? { request: pic.request } : {}),
        },
        box,
      );
      const img = c.els.at(-1) as { name?: string; radius?: number } | undefined;
      if (img) Object.assign(img, { name: STAGES_NAMES.picture, radius });
      return;
    }
    if (tiles) frameShape(c, box, fill, radius, "both");
    else
      frameShape(
        c,
        box,
        fill,
        radius,
        n === 1 ? "both" : i === 0 ? "left" : i === n - 1 ? "right" : "none",
      );
    const concept = concepts[i];
    if (!concept || concept === PENDING_ICON) return;
    const room = tiles ? colW - 2 * CLEAR : colW - 1.25 * mk - 2 * CLEAR;
    const side = Math.max(0, Math.round(Math.min(0.68 * picH, room)));
    const image = iconImage(
      concept,
      c.t,
      {
        x: Math.round(x + (colW - side) / 2),
        y: Math.round(y0 + (picH - side) / 2),
        w: side,
        h: side,
      },
      col.accent,
      STAGES_NAMES.icon,
      it.name,
      // As the myth's proof medals: a theme whose gold outlines its icons in ink (every round 5
      // gold draws the pilot library) draws the outlined style (THEME-AUDIT-r2 #1).
      surfacesOf(c.t).marks.iconOutline ? "pilot" : undefined,
    );
    if (image.src) c.els.push({ ...image, radius: 0 });
  });

  // Arrows on the seams (or in the paper gutter between tiles): a halo under a closed block arrow.
  for (let i = 0; i < n - 1; i++) {
    const sx = cx(i) + colW + gap / 2;
    const sy = y0 + picH / 2;
    const k = Math.min(1, (picH * 0.55) / (mk * 0.92));
    const w = mk * 1.25 * k;
    const h = mk * 0.92 * k;
    // The gold's block arrow (pilot `markers`, arrow=block) from the arrow primitive: the shaft
    // 40% of the box's height, the head its full 92% and 44% of its width long.
    const pts = blockArrow([sx - w / 2 + 0.04 * w, sy], [sx - w / 2 + 0.96 * w, sy], {
      shaft: 0.4 * h,
      head: 0.92 * h,
      headLen: 0.44 * w,
    }).map(([x, y]) => ({ x: round1(x), y: round1(y) }));
    const kind = surfacesOf(c.t).marks.connector;
    if (kind === "block") {
      arrowPath(c, pts, col.background, STAGES_NAMES.halo, HALO);
      arrowPath(c, pts, col.accent, STAGES_NAMES.arrow);
    } else familyArrow(c, kind, { x: sx - w / 2, y: sy - h / 2, w, h }, col.background, col.accent);
  }

  // Names (sharing the tallest name's height) and lines.
  const nameY = y0 + picH + CAP_GAP;
  const lineY = nameY + g.nameH + LINE_GAP;
  items.forEach((it, i) => {
    const x = cx(i);
    const name = textBox(c, it.name, "heading", g.sn, nameWt, NAME_LH, {
      x,
      y: nameY,
      w: textW,
      color: col.heading,
      name: STAGES_NAMES.name,
    });
    name.h = Math.max(name.h, Math.ceil(g.nameH));
    if (it.line.trim())
      textBox(c, it.line, "body", g.sb, bodyWt, prof.lh, {
        x,
        y: lineY,
        w: textW,
        color: col.muted,
        name: STAGES_NAMES.line,
      });
  });
}

/**
 * Not every stage has a picture or an icon: the content goes through items-row's ordered look
 * (part u; ruling 243): numbered medals on the theme's line, the writer's motif. Its fields and
 * overs are renamed to the stages' paths; five or six stages are in the stages' range, so the
 * row's own count limit is not an over here.
 */
function orderedRow(
  c: Ctx,
  input: TemplateInput,
  items: StageItem[],
  count: number,
  age: Age,
  misses: string[],
) {
  layoutItemsRow(c, {
    template: "items-row",
    heading: input.heading,
    ...(input.accentWord ? { accentWord: input.accentWord } : {}),
    ordered: true,
    ...(input.motif ? { motif: input.motif } : {}),
    items: items.map((it) => ({ name: it.name, text: it.line, icon: null })),
  });
  // Stages draws on the deck's ground in both looks: drop items-row's own ground (TEACH-75 part
  // ap), or a draft in this look would show an element the closed icons look never has.
  const ground = c.els.findIndex((el) => el.name === ROW_NAMES.ground);
  if (ground >= 0) c.els.splice(ground, 1);
  if (misses.length) c.iconMisses = misses;
  const rename = (f: string) =>
    f.replace(/^items\[(\d+)\]\.text$/, "stages[$1].line").replace(/^items\[/, "stages[");
  const over = c.over.filter((o) => o !== "items").map(rename);
  if (count < STAGES_MIN || count > STAGES_MAX[age]) over.push("stages");
  c.over.length = 0;
  c.over.push(...new Set(over));
  c.fields = (c.fields ?? []).map((f) => {
    const field = rename(f.field);
    return { ...f, field, path: field.replace(/\[(\d+)\]/g, ".$1") };
  });
}

/** Which input path each laid element shows (both looks), for the editor's LayoutRef binding. */
export function stagesPaths(els: readonly { name?: string }[]): (string | undefined)[] {
  let name = -1;
  return els.map((el) => {
    if (el.name === "Heading") return "heading";
    if (el.name === STAGES_NAMES.name || el.name === ROW_NAMES.name) return `stages.${++name}.name`;
    if (el.name === STAGES_NAMES.line || el.name === ROW_NAMES.text)
      return name < 0 ? undefined : `stages.${name}.line`;
    return undefined;
  });
}

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

/** Sampled quarter-circle corner from `a` (deg) round centre (x, y). */
const corner = (x: number, y: number, r: number, a: number) =>
  Array.from({ length: 5 }, (_, k) => {
    const t = ((a + (90 * k) / 4) * Math.PI) / 180;
    return { x: round1(x + r * Math.cos(t)), y: round1(y + r * Math.sin(t)) };
  });

/**
 * A frame: a plain rect in the strip's middle, a closed path with its own two outer corners at
 * the strip's ends (custGeom in PowerPoint), a rounded rect when it stands alone.
 */
function frameShape(
  c: Ctx,
  b: { x: number; y: number; w: number; h: number },
  fill: string,
  r: number,
  round: "left" | "right" | "both" | "none",
) {
  const box = { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) };
  if (round === "none" || round === "both") {
    const el: ShapeElement = {
      id: uid(),
      type: "shape",
      shape: round === "both" ? "rounded" : "rect",
      ...box,
      fill,
      ...(round === "both" ? { radius: r } : {}),
      name: STAGES_NAMES.frame,
    };
    c.els.push(el);
    return;
  }
  const { x, y, w, h } = box;
  const pts =
    round === "left"
      ? [
          ...corner(x + r, y + h - r, r, 90),
          ...corner(x + r, y + r, r, 180),
          { x: x + w, y },
          { x: x + w, y: y + h },
        ]
      : [
          { x, y },
          ...corner(x + w - r, y + r, r, 270),
          ...corner(x + w - r, y + h - r, r, 0),
          { x, y: y + h },
        ];
  const el: PathElement = {
    id: uid(),
    type: "path",
    ...box,
    points: pts.map((p) => ({ x: +((p.x - x) / w).toFixed(4), y: +((p.y - y) / h).toFixed(4) })),
    closed: true,
    fill,
    stroke: fill,
    strokeWidth: 0,
    name: STAGES_NAMES.frame,
  };
  c.els.push(el);
}

/** A closed block arrow (or its halo: the same outline stroked in paper under it). */
/**
 * A seam connector in the theme's family (round 2 roles-map2.js `arrowSvg`, round 5's sketch):
 * Poster's block over an ink offset, Scrapbook's hand-drawn line with an open chevron, Storytime's
 * round-cornered block. Drawn in the box the block arrow takes, a ground halo under it.
 */
function familyArrow(
  c: Ctx,
  kind: Connector,
  box: { x: number; y: number; w: number; h: number },
  ground: string,
  ink: string,
) {
  const shape = connectorShape(kind, box.w, box.h);
  const shadow = surfacesOf(c.t).marks.offset?.color ?? c.t.colors.ink;
  const push = (
    pts: { x: number; y: number }[],
    closed: boolean,
    paint: { fill?: string; stroke: string; width: number },
    name: string,
    dx = 0,
  ) =>
    c.els.push({
      id: uid(),
      type: "path",
      x: round1(box.x + dx),
      y: round1(box.y + dx),
      w: round1(box.w),
      h: round1(box.h),
      points: pts.map((p) => ({ x: +(p.x / box.w).toFixed(4), y: +(p.y / box.h).toFixed(4) })),
      closed,
      ...(paint.fill ? { fill: paint.fill } : {}),
      stroke: paint.stroke,
      strokeWidth: round1(paint.width),
      name,
    } as PathElement);
  for (const f of shape.fills)
    push(f.pts, true, { fill: ground, stroke: ground, width: shape.halo }, STAGES_NAMES.halo);
  for (const st of shape.strokes)
    push(st, false, { stroke: ground, width: shape.halo }, STAGES_NAMES.halo);
  for (const f of shape.fills) {
    if (f.offset)
      push(f.pts, true, { fill: shadow, stroke: shadow, width: 0 }, STAGES_NAMES.arrow, f.offset);
    const edge = f.offset ? shadow : ink;
    push(
      f.pts,
      true,
      { fill: ink, stroke: edge, width: f.round ?? shape.width },
      STAGES_NAMES.arrow,
    );
  }
  for (const st of shape.strokes)
    push(st, false, { stroke: ink, width: shape.width }, STAGES_NAMES.arrow);
}

function arrowPath(
  c: Ctx,
  pts: { x: number; y: number }[],
  colour: string,
  name: string,
  halo?: number,
) {
  const x0 = Math.min(...pts.map((p) => p.x));
  const y0 = Math.min(...pts.map((p) => p.y));
  const x1 = Math.max(...pts.map((p) => p.x));
  const y1 = Math.max(...pts.map((p) => p.y));
  const el: PathElement = {
    id: uid(),
    type: "path",
    x: x0,
    y: y0,
    w: round1(x1 - x0),
    h: round1(y1 - y0),
    points: pts.map((p) => ({
      x: +((p.x - x0) / (x1 - x0)).toFixed(4),
      y: +((p.y - y0) / (y1 - y0)).toFixed(4),
    })),
    closed: true,
    fill: colour,
    stroke: colour,
    strokeWidth: halo ? round1(halo) : 0,
    name,
  };
  c.els.push(el);
}

function textBox(
  c: Ctx,
  value: string,
  preset: TextPreset,
  size: number,
  weight: number,
  lh: number,
  o: { x: number; y: number; w: number; color: string; name: string },
) {
  const h = Math.ceil(lines(c, value, preset, o.w, weight, size) * size * lh);
  const fixed = goldStage(c);
  const el = {
    id: uid(),
    type: "text" as const,
    x: Math.round(o.x),
    y: Math.round(o.y),
    w: Math.round(o.w),
    h,
    doc: kit.doc(value),
    name: o.name,
    style: {
      preset,
      autoHeight: true,
      fontSize: size,
      ...(fixed ? { fixedSize: true } : {}),
      lineHeight: lh,
      fontWeight: weight,
      padding: 0,
      color: o.color,
    },
  };
  c.els.push(el);
  return el;
}

function accentWord(
  el: { doc: unknown },
  head: string,
  word: string | null | undefined,
  colour: string,
) {
  const w = word?.trim();
  const at = w ? head.indexOf(w) : -1;
  if (!w || at < 0) return;
  const parts = [
    { type: "text", text: head.slice(0, at) },
    { type: "text", text: w, marks: [{ type: "textStyle", attrs: { color: colour } }] },
    { type: "text", text: head.slice(at + w.length) },
  ].filter((p) => p.text);
  el.doc = { type: "doc", content: [{ type: "paragraph", content: parts }] };
}

function report(age: Age, input: TemplateInput, items: StageItem[], vis: StageVis): FieldReport[] {
  const caps = stageCapsOf(age, Math.min(Math.max(items.length, STAGES_MIN), 6), vis);
  // A name's measure is its longest word (each word is nowrap; a second word takes a second line).
  // `measured` false: a field the table does not measure (the heading). A measured field with no
  // cell, or a hard maximum of 0 (6-up primary with pictures), holds nothing: any content is over,
  // never "no limit" (TEACH-68 part b), so the layout is never chosen silently.
  const row = (
    field: string,
    value: string,
    m?: StageCap,
    word = false,
    measured = true,
  ): FieldReport => {
    const chars = word ? Math.max(0, ...value.split(/\s+/).map((w) => w.length)) : value.length;
    const cap = m?.hardMax ? m : undefined;
    const none = measured && !MEASURING && !cap && chars > 0;
    return {
      field,
      path: field.replace(/\[(\d+)\]/g, ".$1"),
      chars,
      cap: cap ? cap.cap : 0,
      hardMax: cap ? cap.hardMax : 0,
      tight: none || (!!cap && chars > cap.cap),
      over: none || (!!cap && chars > cap.hardMax),
    };
  };
  const out: FieldReport[] = [row("heading", input.heading.trim(), undefined, false, false)];
  items.forEach((it, i) => {
    out.push(row(`stages[${i}].name`, it.name, caps?.name, true));
    out.push(row(`stages[${i}].line`, it.line, caps?.line));
  });
  return out;
}
