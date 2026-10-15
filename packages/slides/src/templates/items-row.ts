/**
 * Items row (TEACH-75 part u, layout pilot T2): 2-4 named items in a row on a connecting line,
 * each a medal (a library icon on a white face ringed in a category colour, or a number on the
 * accent's wash), a name and one short line, with an optional lead under the heading. Ported from
 * the pilot's `northstars/components/items-row.js` (gold 1, "Three parts work together"); the
 * pilot's px at 1440 are x 2/3 here.
 *
 * - 5-6 items wrap to two rows of three and are always `tight`: with icons the medal sits beside
 *   the text and there is no connector; numbered medals stay stacked on the curve.
 * - Icons are all or none: any label the matcher misses numbers every item, and the misses come
 *   back in `iconMisses`, never silently.
 * - Fit (ruling 215): medals give way to their comfort minimum, then type to the age's comfort
 *   sizes. Past that the slide is `tight`, and medals then type shrink only to the floors. Words
 *   are never cut; a field still over is named in `over`.
 * - The connector is a `path` per row (a soft band; with `motif: "vessel"` a dotted line on it) through the
 *   medal centres, so a re-layout moves it with the medals.
 */
import type { PathElement, ShapeElement, TextPreset } from "@tj/domain/documents";
import { uid } from "../factories";
import { pathSegments, samplePath } from "../path";
import { countLines } from "../text-measure";
import { resolveFontSize } from "../text-style";
import { keyStageOf, MIN_FONT_SIZE } from "../themes";
import { type Ctx, type FieldReport, G, kit, mix, type Stage, type TemplateInput } from "./index";
import CAPACITY from "./items-row-capacity.json" with { type: "json" };
import {
  type Age,
  ageProfileOf,
  iconImage,
  PLACEHOLDER_ICON,
  resolveIcons,
  type V2Colors,
  type V2Profile,
  v2Colors,
  v2Profile,
} from "./items-row-deps";

/** One item: a short name, one line and an optional icon label (matched to the library). */
export type RowItem = { name: string; text: string; icon?: string | null };
/**
 * The connecting line, each a stroke recipe on the same curve in the theme's colours (pilot
 * `drawConnector`). `plain` (the default): one soft band in the theme's tint. Only when the input
 * asks: `vessel` (blood, circulation: the band with a dotted line; `dots` is its older name),
 * `river` (water, journeys: a wide tint, a wash core and a dashed light line), `road` (routes,
 * history: a warm grey road with a dashed light centre line) and `stem` (growth: one green line
 * with a green leaf between neighbours and at each end; a plant is green, so the stem never takes
 * the theme's accent, the same rule as the icons' natural core colours). `none`: no line.
 * Anything else is plain.
 */
export type RowMotif = "plain" | "vessel" | "dots" | "river" | "road" | "stem" | "none";
export const ROW_MOTIFS: readonly RowMotif[] = [
  "plain",
  "vessel",
  "dots",
  "river",
  "road",
  "stem",
  "none",
];
/** The motif to draw: an unknown or missing one is plain. */
export const motifOf = (m: unknown): RowMotif =>
  ROW_MOTIFS.includes(m as RowMotif) ? (m as RowMotif) : "plain";

/** The stem motif's line and leaves in every theme (Greg's y/n, 13 Oct: "the line is always green"). */
export const STEM_GREEN = "#4E8A3C";

export const ROW_NAMES = {
  band: "Connecting line",
  core: "Connecting line core",
  leaf: "Leaf",
  dots: "Connecting dots",
  ring: "Circle edge",
  medal: "Circle",
  icon: "Picture",
  numeral: "Number",
  mark: "Mark",
  badgeRing: "Number edge",
  /** The number badge on an icon circle: `kit.disc`'s list marker. */
  badge: "Marker",
  name: "Item name",
  text: "Item line",
  lead: "Lead",
} as const;

export { PLACEHOLDER_ICON } from "./items-row-deps";
/**
 * A live draft's held icon (TEACH-75 part u, Greg 14 Oct: "without showing numbers if icons are
 * inbound"): while the writer is still writing a row that will have icons, an item whose icon has
 * not resolved yet carries this label. It counts as an icon for all or none and for the medal's
 * size and face, but nothing is drawn on the face: no number, no placeholder drawing. Never written
 * by the writer or the editor; a closed slide never carries it.
 */
export const PENDING_ICON = "(icon pending)";
/** The item the editor adds: blank words and the placeholder icon, so an icon row keeps its icons. */
export const blankRowItem = (): RowItem => ({
  name: "New item",
  text: "Add a sentence here.",
  icon: PLACEHOLDER_ICON,
});

export const ROW_MIN = 2;
/**
 * Most items an age takes: 4 everywhere, as the writer menu v4.4 says ("2 to 4 named parts; five or
 * more go to a labelled diagram, two slides or steps"). Five or six have no comfortable cap at any
 * age (chat-edit r03), so the editor's + and chat edit's add stop here.
 */
export const ROW_MAX: Record<Age, number> = { early: 4, primary: 4, secondary: 4 };
/**
 * The most a row still draws (two rows of three): an over-count row from before the max dropped
 * shows every item, flagged over, and its counters keep their measured caps.
 */
export const ROW_DRAW_MAX: Record<Age, number> = { early: 4, primary: 6, secondary: 6 };
/** The most items that can be comfortable (pilot `PARAMS.comfortMax`). */
export const ROW_COMFORT_MAX = 4;
/** Comfortable rows use at most this share of the stage (calibrated on gold 1). */
export const COMFORT_FILL = 0.92;

/* Geometry, pilot px x 2/3. */
const STAGE_X = 53;
const STAGE_W = 854;
const FOOT = 497;
const NAME_LH = 1.08;
/** The gold's dots: 2/22 at width 5, a gap of 4.4 stroke widths. */
const DOT_GAP = 4.4;
/** The ground-coloured ring round a medal that cuts the connector (14 px). */
const RING = 9.3;
/**
 * Names are set in the heading preset and lines in body, so the product's render floors bind
 * (26 and 20 pt): the pilot's x 2/3 floors (21.3 and 18.7) sit under them.
 */
const NAME_FLOOR = MIN_FONT_SIZE.heading;
const BODY_FLOOR = MIN_FONT_SIZE.body;
const LEAD_SCALE = 1.06;

/** Items per row: one row up to 4, two rows of three (the second may hold two) at 5-6. */
export function rowShape(n: number): number[] {
  if (n >= 5) return [3, n - 3];
  return [Math.max(0, n)];
}

/** The measured caps for a field (`items-row-capacity.json`). */
export type FieldCap = { cap: number; hardMax: number };
export type RowCaps = { name: FieldCap; text: FieldCap; lead: FieldCap; heading: FieldCap };
type CapCell = RowCaps & { items: number; icons: boolean; withLead: boolean };
let TABLE = CAPACITY as unknown as Record<string, CapCell[]>;
/** Lays out with no caps table, so the capacity script measures geometry alone. */
export function withoutCaps<T>(f: () => T): T {
  const kept = TABLE;
  TABLE = {};
  try {
    return f();
  } finally {
    TABLE = kept;
  }
}
export function capsOf(age: Age, n: number, o: { icons: boolean; lead: boolean }) {
  const cells = TABLE[age] ?? [];
  return cells.find((c) => c.items === n && c.icons === o.icons && c.withLead === o.lead);
}

/** A field's counter: master's FieldReport (`items[2].text`, path `items.2.text`). */
export type RowField = FieldReport;

/** Sizes and measures for one fit step. */
type Step = { ms: number; fk: number };

export function layoutItemsRow(c: Ctx, input: TemplateInput) {
  const stage: Stage = keyStageOf(c.t) ?? "ks2";
  const age = ageProfileOf(stage);
  const v2 = v2Profile(c.t);
  // Type starts at the stage's reading size (writer-real: the gold's sizes read small at KS2-3)
  // and gives way only after the medals have.
  const read = c.s.body;
  const prof = {
    ...v2,
    sizes: {
      ...v2.sizes,
      body: Math.max(v2.sizes.body, read),
      name: Math.max(v2.sizes.name, Math.round(read * 1.25)),
    },
    floors: {
      ...v2.floors,
      name: Math.max(NAME_FLOOR, v2.floors.name),
      body: Math.max(BODY_FLOOR, v2.floors.body),
    },
    comfort: {
      name: Math.max(NAME_FLOOR, v2.comfort.name),
      body: Math.max(BODY_FLOOR, v2.comfort.body),
    },
  };
  const col = v2Colors(c.t);
  const all = (input.items ?? []).filter(Boolean);
  const max = ROW_MAX[age];
  if (all.length < ROW_MIN || all.length > max) c.over.push("items");
  const items = all.slice(0, ROW_DRAW_MAX.primary);
  const n = items.length;

  // Heading: measured, the stage starts under it (ruling 198), the accent word coloured.
  let top = 40;
  let headLines = 0;
  const head = input.heading.trim();
  if (head) {
    const n0 = c.over.length;
    const el = kit.heading(c, head);
    c.over.length = n0;
    headLines = Math.round(el.h / ((el.style?.fontSize ?? c.s.heading) * kit.LH.heading));
    accent(el, head, input.accentWord, col.accent);
    top = el.y + el.h;
    c.bodyFromHeading = true;
  }
  const lead = input.lead?.trim();
  let leadLines = 0;
  if (lead) {
    const size = drawn(
      c,
      "body",
      round1(Math.max(prof.floors.body, v2.sizes.body * LEAD_SCALE, read)),
    );
    const y = top + 9;
    const el = textAt(c, lead, "body", size, c.t.weights.body, prof.lineHeights.body, {
      // The heading's left edge and width (writer-real: it sat 11 units left of the heading).
      x: G.margin,
      y,
      w: G.width,
      color: col.muted,
      name: ROW_NAMES.lead,
    });
    leadLines = Math.round(el.h / (size * prof.lineHeights.body));
    top = el.y + el.h;
  }

  // Icons all or none: every item names one and every name resolves, or the row is numbered.
  // A draft's held icon (PENDING_ICON) counts as one and is never matched.
  const labels = items.map((it) => it.icon?.trim() ?? "");
  const named = labels.filter((l) => l && l !== PENDING_ICON);
  const res = resolveIcons(named);
  if (res.misses.length) c.iconMisses = res.misses;
  const concepts = labels.map((l) =>
    l === PENDING_ICON ? PENDING_ICON : l ? (res.ids[named.indexOf(l)] ?? null) : null,
  );
  const icons = n > 0 && concepts.every(Boolean);
  const fields = report(age, input, items, icons);
  c.fields = fields;
  for (const f of fields) if (f.over && !c.over.includes(f.field)) c.over.push(f.field);
  if (!n) return;

  const two = n >= 5;
  const beside = two && icons;
  const shape = rowShape(n);
  const perRow = shape[0] ?? n;
  const M = prof.medal;
  const m = icons ? M * (two ? 0.66 : n === 4 ? 0.8 : 1) : M * (two ? 0.44 : n === 4 ? 0.62 : 0.72);
  const minMedal = icons ? prof.medalMin : M * 0.4;
  const gap = n <= 3 ? 37 : 29;
  const itemW = Math.floor(Math.min(n <= 2 ? 293 : 1e9, (STAGE_W - (perRow - 1) * gap) / perRow));
  const nf = beside ? 0.86 : two ? 0.8 : 1;
  const bf = two ? 0.9 : 1;
  const pad = prof.badge * 0.5;
  const stageTop = top + (two ? 27 : 37) - (lead ? 8 : 0);
  const avail = FOOT - stageTop - pad;

  const nameWeight = c.t.weights.heading;
  const bodyWeight = c.t.weights.body;
  /** Everything one fit step needs: sizes, each item's text heights, the rows' height. */
  const measureAt = ({ ms, fk }: Step) => {
    const mm = Math.round(m * ms);
    // Measured at the size the renderer draws: the key stage snaps a stored size to its scale
    // (up to the role's smallest step), so a size off the scale wrapped more in the browser than here.
    const nameSize = drawn(
      c,
      "heading",
      round1(Math.max(prof.floors.name, prof.sizes.name * fk * nf)),
    );
    const bodySize = drawn(
      c,
      "body",
      round1(Math.max(prof.floors.body, prof.sizes.body * fk * bf)),
    );
    const textW = beside ? itemW - mm - 17 : itemW;
    let wordsOk = true;
    const blocks = items.map((it) => {
      const nameH = lines(c, it.name, "heading", textW, nameWeight, nameSize) * nameSize * NAME_LH;
      const lineH =
        lines(c, it.text, "body", textW, bodyWeight, bodySize) * bodySize * prof.lineHeights.body;
      if (!wordsFit(c, it.name, "heading", textW, nameWeight, nameSize)) wordsOk = false;
      if (!wordsFit(c, it.text, "body", textW, bodyWeight, bodySize)) wordsOk = false;
      const gapN = beside ? 4 : 7;
      const textH = nameH + (lineH ? gapN + lineH : 0);
      const h = beside ? Math.max(mm, textH) : mm + mm * 0.14 + 3 + textH;
      return { nameH, lineH, textH, h, gapN };
    });
    // Stacked rows: the names in one row share the tallest name's height (each name top-aligned
    // in it), so every line under them starts level even when one name wraps to two lines.
    if (!beside) {
      let at = 0;
      for (const cnt of shape) {
        const row = blocks.slice(at, at + cnt);
        at += cnt;
        const nameH = Math.max(0, ...row.map((b) => b.nameH));
        for (const b of row) {
          b.nameH = nameH;
          b.textH = nameH + (b.lineH ? b.gapN + b.lineH : 0);
          b.h = mm + mm * 0.14 + 3 + b.textH;
        }
      }
    }
    const lh = bodySize * prof.lineHeights.body;
    const rowGap = two ? (beside ? Math.max(43, lh * 1.6) : Math.max(23, lh)) : 0;
    let k = 0;
    const rowHs = shape.map((cnt) => {
      const hs = blocks.slice(k, k + cnt).map((b) => b.h);
      k += cnt;
      return Math.max(0, ...hs);
    });
    const rowsH = rowHs.reduce((a, b) => a + b, 0) + rowGap;
    return {
      mm,
      nameSize,
      bodySize,
      textW,
      blocks,
      rowHs,
      rowGap,
      rowsH,
      fits: rowsH <= avail + 0.5 && wordsOk,
      comfy: rowsH <= COMFORT_FILL * avail && wordsOk,
      typeOk:
        nameSize >= drawn(c, "heading", prof.comfort.name) - 0.5 &&
        bodySize >= drawn(c, "body", prof.comfort.body) - 0.5,
    };
  };

  // The pilot's fit loop: medals to their comfort minimum, then type to the comfort sizes; past
  // that the slide is tight and medals (to 70%) then type (to the floors) shrink only to fit.
  const step: Step = { ms: 1, fk: 1 };
  let g = measureAt(step);
  // Medals give way first, all the way to their comfort minimum (numbers to 40% of the medal).
  const msComfort = Math.min(1, minMedal / m);
  while (!g.comfy && step.ms > msComfort + 1e-6) {
    step.ms = Math.max(msComfort, +(step.ms - 0.05).toFixed(2));
    g = measureAt(step);
  }
  while (!g.comfy && step.fk > 0.6) {
    const prev = step.fk;
    step.fk = +(step.fk - 0.025).toFixed(3);
    const next = measureAt(step);
    if (!next.typeOk) {
      step.fk = prev;
      break;
    }
    g = next;
  }
  g = measureAt(step);
  const medalOk = g.mm >= minMedal - 1;
  if (!(g.comfy && medalOk && g.typeOk)) {
    while (!g.fits && step.ms > 0.7) {
      step.ms = +(step.ms - 0.05).toFixed(2);
      g = measureAt(step);
    }
    while (!g.fits && step.fk > 0.6) {
      step.fk = +(step.fk - 0.025).toFixed(3);
      g = measureAt(step);
    }
  }
  const comfortable =
    g.comfy && g.mm >= minMedal - 1 && g.typeOk && n <= ROW_COMFORT_MAX && headLines <= 2;
  c.tight = !comfortable || leadLines > 1;
  if (leadLines > 2 && !c.over.includes("lead")) c.over.push("lead");
  if (!g.fits && !fields.some((f) => f.over)) {
    // Over from a combination: blame the field furthest past its comfortable cap.
    const worst = fields
      .filter((f) => f.field.startsWith("items["))
      .sort((a, b) => b.chars / (b.cap || 60) - a.chars / (a.cap || 60))[0];
    c.over.push(worst?.field ?? "items");
  }

  // Place: the rows centred in the stage, each row centred across it.
  const { mm, blocks } = g;
  let y = stageTop + pad + Math.max(0, (avail - g.rowsH) / 2);
  const rows: { cx: number; cy: number; k: number }[][] = [];
  let k = 0;
  shape.forEach((cnt, r) => {
    const rowW = cnt * itemW + (cnt - 1) * gap;
    const x0 = STAGE_X + (STAGE_W - rowW) / 2;
    const row: { cx: number; cy: number; k: number }[] = [];
    for (let i = 0; i < cnt; i++, k++) {
      const b = blocks[k];
      if (!b) continue;
      const x = x0 + i * (itemW + gap);
      // Beside: medal and name top-aligned on the row, so uneven items line up.
      row.push({ cx: beside ? x + mm / 2 : x + itemW / 2, cy: y + mm / 2, k });
    }
    rows.push(row);
    y += (g.rowHs[r] ?? 0) + g.rowGap;
  });

  const motif = motifOf(input.motif);
  if (motif !== "none" && !beside)
    for (const row of rows) connector(c, row, mm, icons, prof, col, motif);

  y = stageTop + pad + Math.max(0, (avail - g.rowsH) / 2);
  k = 0;
  shape.forEach((cnt, r) => {
    const rowH = g.rowHs[r] ?? 0;
    for (const p of rows[r] ?? []) {
      const it = items[p.k] as RowItem;
      const b = blocks[p.k];
      if (!b) continue;
      const mx = p.cx - mm / 2;
      const my = p.cy - mm / 2;
      medal(
        c,
        p.k,
        concepts[p.k] ?? null,
        it.name,
        icons,
        input.ordered !== false,
        mx,
        my,
        mm,
        prof,
        col,
      );
      const tx = beside ? mx + mm + 17 : p.cx - g.textW / 2;
      const ty = beside ? y : my + mm + mm * 0.14 + 3;
      const align = beside ? "left" : "center";
      textAt(c, it.name, "heading", g.nameSize, nameWeight, NAME_LH, {
        x: tx,
        y: ty,
        w: g.textW,
        color: col.heading,
        align,
        name: ROW_NAMES.name,
      });
      if (it.text.trim())
        textAt(c, it.text, "body", g.bodySize, bodyWeight, prof.lineHeights.body, {
          x: tx,
          y: ty + b.nameH + b.gapN,
          w: g.textW,
          color: col.muted,
          align,
          name: ROW_NAMES.text,
        });
    }
    y += rowH + g.rowGap;
    k += cnt;
  });
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/** The size the renderer draws a `preset` text stored at `size` (the key-stage scale's step). */
const drawn = (c: Ctx, preset: TextPreset, size: number) => resolveFontSize(c.t, preset, size);

const lines = (
  c: Ctx,
  value: string,
  preset: TextPreset,
  w: number,
  weight: number,
  size: number,
) => (value.trim() ? countLines(value, preset, c.t, w, weight, size) : 0);

const wordsFit = (
  c: Ctx,
  value: string,
  preset: TextPreset,
  w: number,
  weight: number,
  size: number,
) =>
  value
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => countLines(word, preset, c.t, w, weight, size) === 1);

/** A text box at its own size and line height (the row's sizes are not the template scale's). */
function textAt(
  c: Ctx,
  value: string,
  preset: TextPreset,
  size: number,
  weight: number,
  lh: number,
  o: { x: number; y: number; w: number; color: string; name: string; align?: "left" | "center" },
) {
  const h = Math.ceil(lines(c, value, preset, o.w, weight, size) * size * lh);
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
      lineHeight: lh,
      fontWeight: weight,
      padding: 0,
      color: o.color,
      ...(o.align ? { align: o.align } : {}),
    },
  };
  c.els.push(el);
  return el;
}

/** The accent word, when it is an exact substring of the heading, in the accent colour. */
function accent(
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

/**
 * One medal as in the gold: a soft halo in the theme's tint that cuts the connector, a white face,
 * its icon (with a small ink number badge top right when ordered) or its number. No per-item colour.
 */
/** A KS3 tile's corner radius, as a share of its side. */
const TILE_RADIUS = 0.2;

function medal(
  c: Ctx,
  k: number,
  concept: string | null,
  name: string,
  icons: boolean,
  ordered: boolean,
  x: number,
  y: number,
  d: number,
  prof: V2Profile,
  col: V2Colors,
) {
  const ring = RING;
  // From KS3 an icon sits on a quiet tile: no halo, a rounded-square face with a hairline edge, a
  // slightly smaller drawing and the badge tucked into the corner (Greg's icon option 2, 14 Oct).
  const tile = icons && !!concept && prof.medalShape === "tile";
  const shape = (extra: Partial<ShapeElement> & { x: number; y: number; w: number; h: number }) =>
    c.els.push({ id: uid(), type: "shape", shape: "ellipse", ...extra } as ShapeElement);
  shape({
    x: Math.round(x - ring),
    y: Math.round(y - ring),
    w: Math.round(d + 2 * ring),
    h: Math.round(d + 2 * ring),
    fill: tile ? col.background : mix(col.accent, col.background, 0.07),
    ...(tile ? { shape: "rounded", radius: Math.round(d * TILE_RADIUS + ring) } : {}),
    name: ROW_NAMES.ring,
  });
  if (icons && concept) {
    shape({
      x: Math.round(x),
      y: Math.round(y),
      w: d,
      h: d,
      fill: col.surface,
      ...(tile
        ? {
            shape: "rounded",
            radius: Math.round(d * TILE_RADIUS),
            stroke: mix(col.accent, col.background, 0.14),
            strokeWidth: 1.5,
          }
        : {}),
      name: ROW_NAMES.medal,
    });
    // A draft's held icon: the empty face only, no drawing and no number until it resolves.
    if (concept === PENDING_ICON) return;
    // The library's drawings fill 75% of a round face (pilot `.medal > svg`), 72% of a tile.
    const g = Math.round(d * (tile ? 0.72 : 0.75));
    const image = iconImage(
      concept,
      c.t,
      { x: Math.round(x + (d - g) / 2), y: Math.round(y + (d - g) / 2), w: g, h: g },
      col.accent,
      ROW_NAMES.icon,
      name,
    );
    // Before the icon library has loaded, the face alone (as a held icon); same box after.
    if (image.src) c.els.push(image);
    if (ordered) {
      const b = Math.round(prof.badge);
      const bx = Math.round(x + d * (tile ? 0.9 : 0.86) - b / 2);
      const by = Math.round(y + d * (tile ? 0.1 : 0.08) - b / 2);
      const br = Math.max(3, Math.round(RING * 0.45));
      shape({
        x: bx - br,
        y: by - br,
        w: b + 2 * br,
        h: b + 2 * br,
        fill: col.background,
        name: ROW_NAMES.badgeRing,
      });
      kit.disc(c, String(k + 1), bx, by, b, c.t.colors.ink);
    }
    return;
  }
  const size = Math.max(26, Math.round(d * 0.46));
  if (!ordered) {
    // Unordered and no icons: a neutral mark, never numbers that read as a sequence.
    shape({
      x: Math.round(x),
      y: Math.round(y),
      w: d,
      h: d,
      fill: col.surface,
      name: ROW_NAMES.medal,
    });
    const dot = Math.round(d * 0.24);
    shape({
      x: Math.round(x + (d - dot) / 2),
      y: Math.round(y + (d - dot) / 2),
      w: dot,
      h: dot,
      fill: col.connector.band,
      name: ROW_NAMES.mark,
    });
    return;
  }
  shape({
    x: Math.round(x),
    y: Math.round(y),
    w: d,
    h: d,
    fill: col.surface,
    name: ROW_NAMES.medal,
  });
  shape({
    x: Math.round(x),
    y: Math.round(y),
    w: d,
    h: d,
    name: ROW_NAMES.numeral,
    doc: kit.doc(String(k + 1)),
    textStyle: {
      preset: "heading",
      fontSize: size,
      fontWeight: c.t.weights.heading,
      color: col.accent,
      align: "center",
      valign: "middle",
      padding: 0,
    },
  });
}

/**
 * The connector for one row: a smooth curve entering at the left edge, through every medal
 * centre with a wave between neighbours, leaving at the right edge (gold 1's geometry). Two paths
 * on the same points: a pale band, then a dotted line on it.
 */
function connector(
  c: Ctx,
  row: { cx: number; cy: number }[],
  mm: number,
  icons: boolean,
  prof: V2Profile,
  col: V2Colors,
  motif: RowMotif,
) {
  const [first] = row;
  const last = row[row.length - 1];
  if (!first || !last) return;
  const y = first.cy;
  const band = Math.max(12, mm * prof.band * (icons ? 1 : 1.6));
  const a = Math.max(17, mm * prof.wave * (icons ? 1 : 1.5));
  const pts: { x: number; y: number }[] = [{ x: 0, y: y - a }];
  row.forEach((p, i) => {
    const prev = row[i - 1];
    if (prev) {
      const dir = i % 2 ? -1 : 1;
      pts.push({ x: prev.cx + (p.cx - prev.cx) * 0.55, y: y + dir * a * 0.44 });
    }
    pts.push({ x: p.cx, y });
  });
  pts.push({ x: 960, y: y + (row.length % 2 ? -1 : 1) * a * 0.57 });
  const top = Math.round(y - a - band * 1.3);
  const h = Math.round(2 * (a + band * 1.3));
  const base = {
    type: "path" as const,
    x: 0,
    y: top,
    w: 960,
    h,
    points: pts.map((p) => ({ x: +(p.x / 960).toFixed(4), y: +((p.y - top) / h).toFixed(4) })),
    smooth: true,
  };
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const stroke = (
    name: string,
    colour: string,
    width: number,
    extra: Partial<PathElement> = {},
  ): PathElement => ({
    id: uid(),
    ...base,
    stroke: colour,
    strokeWidth: r1(width),
    name,
    ...extra,
  });
  const dot = prof.strokes.dot;
  const light = col.surface;
  const out: PathElement[] = [];
  if (motif === "river") {
    out.push(stroke(ROW_NAMES.band, col.connector.band, band * 1.3));
    out.push(stroke(ROW_NAMES.core, col.wash, band * 0.55));
    // The pilot's 40/30 dash at about 3.5 px: dashes of 3 widths, gaps 2.2 (the closest stock dash).
    out.push(
      stroke(ROW_NAMES.dots, light, Math.max(2, dot * 0.7), { dash: "dashed", opacity: 0.95 }),
    );
  } else if (motif === "road") {
    out.push(stroke(ROW_NAMES.band, col.road, band * 1.1));
    // The pilot's 18/16 centre line: dashes of 3 widths, gaps 2.7.
    out.push(
      stroke(ROW_NAMES.dots, light, Math.max(2, dot * 0.8), { dash: "dashed", dashGap: 2.7 }),
    );
  } else if (motif === "stem") {
    out.push(stroke(ROW_NAMES.band, STEM_GREEN, prof.strokes.line));
  } else {
    out.push(stroke(ROW_NAMES.band, col.connector.band, band));
    if (motif === "vessel" || motif === "dots")
      out.push(
        stroke(ROW_NAMES.dots, col.connector.dot, dot, { dash: "dotted", dashGap: DOT_GAP }),
      );
  }
  c.els.push(...out);
  if (motif === "stem") leaves(c, out[0] as PathElement, row, mm, STEM_GREEN);
}

/**
 * The stem's leaves (pilot `leaves`): one between each pair of medals and one past each end, on
 * the curve's tangent, alternating sides, each a rotated ellipse in the stem's green.
 */
function leaves(
  c: Ctx,
  stem: PathElement,
  row: { cx: number; cy: number }[],
  mm: number,
  colour: string,
) {
  const curve = samplePath(pathSegments(stem, stem.w, stem.h), 24).map((p) => ({
    x: p.x + stem.x,
    y: p.y + stem.y,
  }));
  const at = (x: number) => {
    let k = 0;
    while (k < curve.length - 2 && (curve[k + 1]?.x ?? 0) < x) k++;
    return k;
  };
  // Each leaf stands whole in a gap: between two halos, or between an end halo and the slide edge,
  // with a margin to each halo, so no leaf touches or crosses a medal's ring (TEACH-75 part u).
  const r = mm / 2 + RING;
  const gap = 8;
  const cxs = row.map((m) => m.cx);
  const first = cxs[0] ?? 0;
  const last = cxs[cxs.length - 1] ?? 0;
  const gaps: [number, number][] = [[Math.max(8, first - r - 2 * gap - 60), first - r - gap]];
  for (let i = 1; i < cxs.length; i++)
    gaps.push([(cxs[i - 1] ?? 0) + r + gap, (cxs[i] ?? 0) - r - gap]);
  gaps.push([last + r + gap, Math.min(952, last + r + 2 * gap + 60)]);
  const full = Math.max(23, mm * 0.26);
  const tangent = (x: number) => {
    const k = at(x);
    const q = curve[k] ?? { x, y: 0 };
    const q2 = curve[k + 1] ?? q;
    return { q, t: Math.atan2(q2.y - q.y, q2.x - q.x) };
  };
  gaps.forEach(([lo, hi], j) => {
    if (hi - lo < 6) return;
    const tilt = ((j % 2 ? 40 : -40) * Math.PI) / 180;
    const mid = (lo + hi) / 2;
    const ang0 = tangent(mid).t + tilt;
    // Half the leaf's width on the page; shrink the leaf until it fits the gap.
    const half = (len: number) =>
      Math.hypot(len * 0.55 * Math.cos(ang0), len * 0.22 * Math.sin(ang0));
    const leaf = Math.min(full, ((hi - lo) / 2 / half(1)) * 0.98);
    const w = leaf * 0.22;
    // The base on the stem, so the leaf's middle lands on the gap's middle.
    const { q, t } = tangent(mid - Math.cos(ang0) * leaf * 0.55);
    const ang = t + tilt;
    // A rotated ellipse from the stem, leaning off it: native in every renderer and in PPTX.
    const lx = q.x + Math.cos(ang) * leaf * 0.55;
    const ly = q.y + Math.sin(ang) * leaf * 0.55;
    c.els.push({
      id: uid(),
      type: "shape",
      shape: "ellipse",
      x: Math.round(lx - leaf * 0.55),
      y: Math.round(ly - w),
      w: Math.round(leaf * 1.1),
      h: Math.round(2 * w),
      rotation: Math.round((ang * 180) / Math.PI),
      fill: colour,
      opacity: 0.85,
      name: ROW_NAMES.leaf,
    } as ShapeElement);
  });
}

/** Every field with its length and measured limits (the live "62/80" counters, ruling 215). */
function report(age: Age, input: TemplateInput, items: RowItem[], icons: boolean): RowField[] {
  const lead = !!input.lead?.trim();
  const caps = capsOf(age, Math.min(Math.max(items.length, ROW_MIN), ROW_DRAW_MAX[age]), {
    icons,
    lead,
  });
  const row = (field: string, value: string, measured?: FieldCap): RowField => {
    const chars = value.length;
    // A hard maximum of 0: nothing fitted with the table's default words, so no limit is known.
    const cap = measured?.hardMax ? measured : undefined;
    return {
      field,
      path: field.replace(/\[(\d+)\]/g, ".$1"),
      chars,
      cap: cap ? cap.cap : 0,
      hardMax: cap ? cap.hardMax : 0,
      tight: !!cap && chars > cap.cap,
      over: !!cap && chars > cap.hardMax,
    };
  };
  const out = [row("heading", input.heading.trim(), caps?.heading)];
  if (lead) out.push(row("lead", input.lead?.trim() ?? "", caps?.lead));
  items.forEach((it, i) => {
    out.push(row(`items[${i}].name`, it.name, caps?.name));
    out.push(row(`items[${i}].text`, it.text, caps?.text));
  });
  return out;
}
