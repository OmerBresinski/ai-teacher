/**
 * Panel list (TEACH-75 part v, layout pilot T3; rulings 211, 212, 215, 217): a deep title panel
 * down the left (the heading, and a photo, a pie chart or nothing under it) beside a calm list of
 * 2-6 rows, each an icon or number disc, a name and one line, with hairline dividers. Ported from
 * the pilot's `northstars/components/panel-list.js` (Greg's gold 2, "The five food groups"); the
 * pilot draws at 1440 x 810 px, so every pilot length here is x 2/3 (slide points).
 *
 * - Comfortable up to the measured `PANEL_COMFORT` rows, at the sizes the renderer draws. 2-line
 *   rows at 4+ are `tight`.
 * - Fit order: discs give way (to 75%) while the rows overflow, then type down to the comfort
 *   sizes; past that the slide is `tight` and type goes on to the floors only until it fits.
 *   Words are never cut: a field past its measured hard maximum is named in `over`.
 * - Row pictures (Greg's D1 pick, 14 Oct): a row may lead with a small rounded photo tile in
 *   place of its disc. All rows or none; a row whose picture is still being made shows the empty
 *   slot (`PLACEHOLDER_IMAGE`), so nothing vanishes. With row pictures the panel takes no picture,
 *   pie or icon of its own (it narrows), and row icons are not drawn: pictures win over icons.
 * - Icons are all or none (matched through the icon library); any miss draws numbers and is
 *   reported in `iconMisses`. With icons or a pie the discs take the category colours, so each
 *   row's disc is the swatch of its wedge.
 * - The photo zone takes the tallest safe standard shape at the panel's width that fits under the
 *   title (which may shrink to 80% for it); none safe: the photo's own shape, full bleed if it
 *   fits, else inset with the picture radius. Never a mat or a blur (ruling 217).
 */
import type {
  IconElement,
  PathElement,
  ShapeElement,
  SlideElement,
  TextElement,
  Theme,
} from "@tj/domain/documents";
import { uid } from "../factories";
import { PLACEHOLDER_IMAGE } from "../layouts";
import { countLines } from "../text-measure";
import { resolveTextStyle } from "../text-style";
import {
  type Ctx,
  type FieldReport,
  type Figure,
  kit,
  layoutTemplate,
  type Stage,
  type TemplateInput,
} from "./index";
import CAPACITY from "./panel-list-capacity.json";
import {
  type AgeKey,
  cropFor,
  factsOf,
  matchIcon,
  type PanelLook,
  panelLook,
  SHAPES,
  shapeMode,
} from "./panel-list-deps";

/**
 * One row: a short name, one line, an optional icon label (a library concept) and an optional
 * picture (a photo, or the empty slot while it is made). Pictures are all or none across rows.
 */
export type PanelRow = {
  name: string;
  text: string;
  icon?: string | null;
  picture?: Figure | null;
};
type Photo = Extract<Figure, { photo: string }>;
/** A row's picture when it is one a tile can show: a photo, or the empty slot (any `photo` string). */
const rowPhoto = (r: { picture?: Figure | null } | null | undefined): Photo | null =>
  r?.picture &&
  typeof r.picture === "object" &&
  "photo" in r.picture &&
  typeof r.picture.photo === "string"
    ? r.picture
    : null;
/**
 * Draft mode (streaming, DRAFT-MODE.md): the writer streams each row's picture after its words, so
 * a list laid as it stands would drop every tile while a later row's picture is still arriving and
 * bring them back when it lands. Once any row has a picture, a row whose picture is not there yet
 * (`undefined`, or not yet a photo) holds the empty slot. An explicit `null` is the writer's "no
 * picture" and is left alone, so the closed slide still follows all or none. For the draft path
 * only (TEACH-110 s calls it before laying a draft); the closed slide never holds.
 */
export function holdRowPictures<R extends { picture?: Figure | null }>(rows: readonly R[]): R[] {
  const donor = rows.map(rowPhoto).find(Boolean);
  if (!donor) return [...rows];
  return rows.map((r) =>
    r.picture === null || rowPhoto(r)
      ? r
      : { ...r, picture: { photo: PLACEHOLDER_IMAGE, aspect: ROW_PIC_ASPECT, alt: "" } },
  );
}
/**
 * A row picture's tile height by row count (slide points), before the column's room caps it. The
 * tile is 4:3 landscape; it gives way with the discs (to 75%) before type does. Measured on the D1
 * renders (13 Oct): a 2-row tile at 176 still leaves the line beside it its full measure.
 */
export const ROW_PIC_H: Readonly<Record<number, number>> = {
  1: 176,
  2: 176,
  3: 116,
  4: 92,
  5: 76,
  6: 64,
};
export const ROW_PIC_ASPECT = 4 / 3;
/**
 * The title panel's picture frame is the layout's, not the photo's (Greg 15 Oct: nothing reshapes
 * when a photo lands): the zone is chosen for a 3:2 picture, the shape most stock and generated
 * photos come in, so a pending slot already has its final shape and the landed photo is
 * cover-cropped into it (`cropFor`, subjects kept in view where they fit).
 */
export const PANEL_PIC_ASPECT = 3 / 2;
/** A row tile's corner radius at most, as a share of its height. */
const ROW_PIC_RADIUS = 0.14;
/** The panel's visual: a picture (photo or diagram), or a pie of one share per row. */
export type PanelVisual = { picture: Figure } | { shares: number[] };

export const PANEL_MAX = 6;
export const PANEL_MIN = 2;
/** The most rows that can be comfortable at each age. */
/**
 * The most rows that are comfortable at each age: the largest count whose measured name and text
 * caps are above 0 in `panel-list-capacity.json` (filled below, once the table is read).
 */
export const PANEL_COMFORT = {} as Record<AgeKey, number>;
/** Element names, as a teacher sees them in the editor's selection and layers. */
export const PANEL_NAMES = {
  panel: "Title panel",
  title: "Heading",
  lead: "Lead",
  disc: "Row circle",
  icon: "Row icon",
  name: "Row name",
  line: "Row line",
  rule: "Divider",
  photo: "Panel picture",
  figure: "Panel diagram",
  halo: "Pie chart back",
  wedge: "Pie slice",
  groupIcon: "Panel icon",
  rowPicture: "Row picture",
} as const;

/**
 * The writer's menu line for panel-list per key-stage group, copied verbatim from the pilot's
 * `writer/MENU-v3.md` (section A) for TEACH-110 part s to wire; its numbers come from the pilot's
 * caps and are re-derived from `panel-list-capacity.json` there.
 */
// writer-prompt: owned by TEACH-110 s
export const PANEL_LIST_WRITER_MENU = {
  // writer-prompt: owned by TEACH-110 s
  KS1: "- panel-list: 3 to 4 members of one group, such as kinds, groups or rules, as a calm list beside a title panel, each a name and one line, when order does not matter (2 to 4 parts or stages go to items-row). The panel holds a photo of the whole group, a pie of the items' shares of one known whole, or nothing. Fits: 3 items each 8; 4 each 5; with a lead of up to 5 words: 3 items each 5.",
  // writer-prompt: owned by TEACH-110 s
  KS2: "- panel-list: 3 to 5 members of one group, such as kinds, groups or rules, or five named parts, too many for items-row, as a calm list beside a title panel, each a name and one line, when order does not matter (2 to 4 parts or stages go to items-row). The panel holds a photo of the whole group, a pie of the items' shares of one known whole, or nothing. Fits: heading up to 5 words; 3 items each 12; 4 to 5 each 5; with a lead of up to 6 words: 3 items each 11; 4 each 5.",
  // writer-prompt: owned by TEACH-110 s
  "KS3-5":
    "- panel-list: 3 to 5 members of one group, such as kinds, groups or rules, or five named parts, too many for items-row, as a calm list beside a title panel, each a name and one line, when order does not matter (2 to 4 parts or stages go to items-row). The panel holds a photo of the whole group, a pie of the items' shares of one known whole, or nothing. Fits: heading up to 6 words; 3 items each 12; 4 to 5 each 6; with a lead of up to 6 words: 3 items each 11; 4 each 6.",
} as const;

/* Geometry (960 x 540; the pilot's 1440 px x 2/3). */
const SLIDE_H = 540;
export const PANEL_W = 313;
/** The panel with no visual (option A, the default): about 28% of the slide, the title at its top. */
export const PANEL_W_NARROW = 269;
const TITLE_X = 40;
/**
 * The title's right margin inside the panel: the same as its left (Greg's y/n, 13 Oct: the pilot's
 * 21 put "Volcano hazards" against the narrow panel's edge).
 */
const TITLE_RIGHT = TITLE_X;
const TITLE_TOP = 64;
/** The gap between the panel and the rows column (pilot 70 px). */
const ROWS_GAP = 47;
const ROWS_RIGHT = 960 - 64;
/**
 * Display text (titles, row names) is measured 6% narrower than its box, the repo's measured
 * cushion for a browser break the ruler missed (`FIT_CUSHION`, text-measure.ts); at 800 it is also
 * heavier than the ruler's 700 metrics. y3 s3's heading ran off the slide by one line without it.
 */
export const DISPLAY_CUSHION = 0.94;
/** Option B: the group's icon under the title, at most this big. */
const GROUP_ICON = 150;
const ROWS_TOP = 43;
const ROWS_FOOT = 43;
const COL_GAP = 23;
const NAME_GAP = 3;
const LEAD_GAP = 24;
const COMFORT_FILL = 0.85;
/** The pilot's half-pixel tolerance on the comfort sizes, in points. */
const TOL = 0.34;
/** The photo zone's reserved height and the gap above it (pilot 300 / 48 px). */
const PHOTO_ROOM = 200;
const PHOTO_GAP = 32;
/** The pie's square and its offsets from the panel's left and foot (pilot 300 / 80 / 70 px). */
const PIE = 200;
const PIE_X = 53;
const PIE_FOOT = 47;
const CHART_ROOM = 247;
const CHART_GAP = 27;
const INSET = 48;

/* Caps (the measured table, `panel-list-capacity.json`). */
/** A field's limits in characters, and `words`: the cap's measured text in words (mean-length words). */
export type Cap = { cap: number; hardMax: number; words?: number };
export type PanelCaps = {
  heading: Cap;
  lead: Cap;
  name: Cap;
  text: Cap;
  withLead: { name: Cap; text: Cap };
  /** The same fields when every row carries a picture (the narrow panel, a tile per row). */
  pictures?: Omit<PanelCaps, "pictures">;
};
const TABLE = CAPACITY as unknown as Partial<Record<AgeKey, Record<string, PanelCaps>>>;
for (const age of ["early", "primary", "secondary"] as const)
  PANEL_COMFORT[age] = Math.max(
    PANEL_MIN,
    ...Object.entries(TABLE[age] ?? {})
      .filter(([, c]) => c.text.cap > 0 && c.name.cap > 0)
      .map(([n]) => Number(n)),
  );
/** The caps for `count` rows at `age` (the nearest measured count at or over it). */
export function panelCapsFor(age: AgeKey, count: number): PanelCaps | undefined {
  const byCount = TABLE[age];
  if (!byCount) return undefined;
  const counts = Object.keys(byCount)
    .map(Number)
    .sort((a, b) => a - b);
  const n = counts.find((x) => x >= count) ?? counts[counts.length - 1];
  return n === undefined ? undefined : byCount[String(n)];
}

/** What the layout measured, kept for the capacity probe (geometry only, no caps). */
type Geometry = { fits: boolean; comfortable: boolean };
const GEOMETRY = new WeakMap<object, Geometry>();

const clean = (s: string | null | undefined) => (s ?? "").trim();

/**
 * A live draft's held icon (TEACH-75 part v, Greg 14 Oct: "without showing numbers if icons are
 * inbound"): while the writer is still writing a list that will have icons, a row whose icon has
 * not resolved yet carries this label. It counts as an icon for all or none and for the disc's
 * look, but nothing is drawn on it: no number, no drawing. The same string as items-row's
 * `PENDING_ICON`; never written by the writer or the editor, and a closed slide never carries it.
 */
export const PENDING_ICON = "(icon pending)";

/**
 * What sits behind a row's icon (`LayoutOptions.panelIconBack`; unset `soft`,
 * Greg's y/n 14 Oct: a pale disc at KS1 and KS2, a pale tile from KS3 as icon option 2 shipped): `ring` a category-coloured disc round the drawing; `none` the drawing alone at the disc's
 * size; `soft` a pale disc of the category colour, no ring, the drawing a little smaller in it.
 */
export type PanelIconBack = "ring" | "none" | "soft";
/** The soft disc: the category colour this much over the slide's background. */
const SOFT_TINT = 0.16;
/** The drawing's share of a soft disc. */
const SOFT_ICON = 0.78;
const hexMix = (a: string, b: string, k: number) => {
  const p = (h: string) => [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return `#${x
    .map((v, i) =>
      Math.round(v * k + (y[i] as number) * (1 - k))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`.toUpperCase();
};

/** A KS3 icon tile's corner radius, as a share of its side. */
const TILE_RADIUS = 0.22;

export function layoutPanelList(c: Ctx, input: TemplateInput) {
  c.bodyFromHeading = true;
  const L = panelLook(c.t);
  const all = (input.rows ?? []).filter((r) => r && typeof r === "object");
  if (all.length > PANEL_MAX) c.over.push(`rows ${all.length}/${PANEL_MAX}`);
  const rows = all.slice(0, PANEL_MAX).map((r) => ({
    name: clean(r.name),
    text: clean(r.text),
    icon: clean(r.icon),
    picture: rowPhoto(r),
  }));
  const n = rows.length;
  const geomOver: string[] = [];

  // Row pictures: all or none (a slot still being made counts). They win over icons, and the
  // panel then holds no visual of its own (one set of pictures per slide, never both).
  const rowPics = n > 0 && rows.every((r) => !!r.picture);

  // Icons: all or none, never drawn live. A miss is reported, and the rows take numbers.
  const matched = rows.map((r) =>
    r.icon && !rowPics ? (r.icon === PENDING_ICON ? PENDING_ICON : matchIcon(r.icon)) : null,
  );
  const misses = rowPics ? [] : rows.filter((r, i) => r.icon && !matched[i]).map((r) => r.icon);
  if (misses.length) c.iconMisses = misses;
  const icons = !rowPics && n > 0 && matched.every(Boolean);

  // The panel's visual (none beside row pictures).
  const panel = rowPics ? null : (input.panel ?? null);
  let shares: number[] | null = null;
  let figure: Figure | null = null;
  if (panel && "shares" in panel) {
    const s = Array.isArray(panel.shares) ? panel.shares : [];
    const valid = s.every((v) => Number.isFinite(v) && v >= 0) && s.reduce((a, b) => a + b, 0) > 0;
    if (n && s.length === n && valid) shares = s;
    else c.over.push("panel.shares");
  } else if (panel && "picture" in panel && panel.picture) figure = panel.picture;
  const photo = figure && "photo" in figure ? figure : null;
  const cat = icons || !!shares;

  // Panel and title. With no visual the panel narrows (A, the default), or keeps its width and
  // shows the group's icon large (B, `panelNoVisual: "icon"`, when the first row's icon resolves).
  const head = clean(input.heading);
  const visual = !!(shares || figure);
  const groupIcon = !visual && c.panelNoVisual === "icon" && icons ? (matched[0] ?? null) : null;
  const panelW = visual || groupIcon ? PANEL_W : PANEL_W_NARROW;
  const TITLE_W = panelW - TITLE_X - TITLE_RIGHT;
  const ROWS_X = panelW + ROWS_GAP;
  const ROWS_W = ROWS_RIGHT - ROWS_X;
  kit.box(c, { x: 0, y: 0, w: panelW, h: SLIDE_H }, L.deep, {
    shape: "rect",
    radius: 0,
    name: PANEL_NAMES.panel,
  });
  const titleRoom = photo
    ? SLIDE_H - TITLE_TOP - PHOTO_ROOM - PHOTO_GAP
    : visual
      ? SLIDE_H - TITLE_TOP - CHART_ROOM - CHART_GAP
      : groupIcon
        ? SLIDE_H - TITLE_TOP - GROUP_ICON - 2 * PHOTO_GAP
        : SLIDE_H - 2 * TITLE_TOP;
  // The title takes the deck's type-scale step the renderer draws for the wanted size: a title
  // step while one sits at or under it, else a heading step (the title role stops at subtitle).
  const titleAt = (tk: number) => {
    const want = L.sizes.titlePanel * tk;
    const asTitle = drawn(c.t, "title", want);
    const preset: "title" | "heading" = asTitle <= want + 0.5 ? "title" : "heading";
    const size = preset === "title" ? asTitle : drawn(c.t, "heading", want);
    const lines = head ? lines_(c.t, head, preset, L.displayWeight, size, TITLE_W) : 0;
    const h = Math.ceil(lines * size * L.lineHeights.title);
    const whole = !head || kit.wordsFit(c, head, preset, cushioned(TITLE_W), size, L.displayWeight);
    return { size, preset, h, lines, ok: lines <= 4 && h <= titleRoom && whole };
  };
  let tk = 1;
  let title = titleAt(tk);
  while (!title.ok && tk > 0.62) {
    tk = Math.round((tk - 0.02) * 100) / 100;
    title = titleAt(tk);
  }
  const titleFits = title.ok;

  // The photo zone: the tallest safe standard shape that fits under the title.
  let picBox: { x: number; y: number; w: number; h: number; inset: boolean } | null = null;
  if (photo) {
    // The frame never depends on the photo, so pending and landed draw the same box.
    const aspect = PANEL_PIC_ASPECT;
    const facts = factsOf(aspect);
    const avail = () => SLIDE_H - (TITLE_TOP + title.h + PHOTO_GAP);
    const tk0 = tk;
    const shapes = [...SHAPES].filter(([, r]) => shapeMode(facts, r)).sort((a, b) => a[1] - b[1]);
    for (const [, r] of shapes) {
      const h = Math.round(PANEL_W / r);
      tk = tk0;
      title = titleAt(tk);
      while (h > avail() && tk > 0.8) {
        tk = Math.round((tk - 0.02) * 100) / 100;
        title = titleAt(tk);
      }
      if (h <= avail()) {
        picBox = { x: 0, y: SLIDE_H - h, w: PANEL_W, h, inset: false };
        break;
      }
    }
    if (!picBox) {
      tk = tk0;
      title = titleAt(tk);
      const h = Math.round(PANEL_W / aspect);
      if (h <= avail()) picBox = { x: 0, y: SLIDE_H - h, w: PANEL_W, h, inset: false };
      else {
        const ih = Math.max(40, Math.min(avail() - INSET, TITLE_W / aspect));
        const iw = Math.round(ih * aspect);
        picBox = {
          x: TITLE_X,
          y: Math.round(SLIDE_H - INSET - ih),
          w: iw,
          h: Math.round(ih),
          inset: true,
        };
      }
    }
  }

  // Title: under the panel's top with a visual, at its foot without one.
  if (head) {
    const y = TITLE_TOP;
    put(c, head, title.preset, { x: TITLE_X, y, w: TITLE_W }, title.size, {
      weight: L.displayWeight,
      lh: L.lineHeights.title,
      color: L.onDeep,
      name: PANEL_NAMES.title,
    });
  }

  // A held first icon keeps the panel's room for it; the drawing lands when it resolves.
  if (groupIcon && groupIcon !== PENDING_ICON) {
    const top = TITLE_TOP + title.h + PHOTO_GAP;
    const g = Math.max(0, Math.min(GROUP_ICON, panelW - 2 * TITLE_X, SLIDE_H - PHOTO_GAP - top));
    c.els.push({
      id: uid(),
      type: "icon",
      x: Math.round((panelW - g) / 2),
      y: Math.round(top + (SLIDE_H - PHOTO_GAP - top - g) / 2),
      w: Math.round(g),
      h: Math.round(g),
      icon: groupIcon,
      color: L.onDeep,
      strokeWidth: 1.5,
      name: PANEL_NAMES.groupIcon,
    } as IconElement);
  }
  if (photo && picBox) {
    const crop =
      photo.photo && photo.aspect
        ? cropFor(factsOf(photo.aspect, photo.subjects), picBox)
        : undefined;
    c.els.push({
      id: uid(),
      type: "image",
      name: PANEL_NAMES.photo,
      x: picBox.x,
      y: picBox.y,
      w: picBox.w,
      h: picBox.h,
      src: photo.photo,
      alt: photo.alt ?? "",
      ...(photo.request ? { request: photo.request } : {}),
      ...(photo.subjects ? { subjects: photo.subjects } : {}),
      ...(photo.source ? { source: photo.source } : {}),
      ...(crop ? { crop } : {}),
      fit: "cover",
      ...(picBox.inset ? { radius: L.radiusPicture } : {}),
    } as SlideElement);
  } else if (figure && !photo) {
    // A diagram contains inside the zone, on the panel, any shape.
    const y = TITLE_TOP + title.h + CHART_GAP;
    const rect = { x: TITLE_X, y, w: PANEL_W - 2 * TITLE_X, h: SLIDE_H - INSET - y };
    if (!(rect.h > 40 && kit.figurePanel(c, figure, rect, true))) figure = null;
  }
  const fills = rows.map((_, i) => (cat ? (L.category[i % L.category.length] as string) : L.wash));
  if (shares) pie(c, L, shares, fills);

  // Lead: one line at the head of the rows column.
  const lead = clean(input.lead);
  let top = ROWS_TOP;
  let leadLines = 0;
  if (lead) {
    const size = drawn(c.t, "body", Math.max(L.floors.body, L.sizes.body * 1.06));
    leadLines = lines_(c.t, lead, "body", L.bodyWeight, size, ROWS_W);
    const el = put(c, lead, "body", { x: ROWS_X, y: ROWS_TOP, w: ROWS_W }, size, {
      weight: L.bodyWeight,
      lh: L.lineHeights.body,
      color: L.muted,
      name: PANEL_NAMES.lead,
    });
    top = el.y + el.h + LEAD_GAP;
    if (leadLines > 2) geomOver.push("lead");
  }

  // Rows: discs give way first, then type, until the column is comfortable.
  const H = SLIDE_H - ROWS_FOOT - top;
  const d0 = L.disc * (n >= 6 ? 0.86 : n <= 3 ? 1.2 : 1);
  const f = n >= 6 ? 0.92 : n <= 3 ? 1.12 : 1;
  const gapMin = n <= 3 ? 37 : 12;
  // Every size is the step the renderer draws (the deck's one key-stage scale snaps any stored
  // size to a step of its role), so what is measured here is what the browser lays out.
  const sizesAt = (k: number) => ({
    name: drawn(c.t, "heading", Math.max(L.floors.name, L.sizes.name * 0.87 * k * f)),
    body: drawn(c.t, "body", Math.max(L.floors.body, L.sizes.body * 0.94 * k * f)),
  });
  const comfortName = drawn(c.t, "heading", L.comfort.name);
  const comfortBody = drawn(c.t, "body", L.comfort.body);
  // A row picture's tile: the count's height, capped so n tiles and the least gaps fit the column.
  const picH0 = Math.min(ROW_PIC_H[n] ?? 64, (H - (n - 1) * gapMin) / Math.max(1, n));
  const measureAt = (k: number, df: number) => {
    const s = sizesAt(k);
    const ph = rowPics ? Math.round(picH0 * df) : 0;
    const d = rowPics ? Math.round(ph * ROW_PIC_ASPECT) : Math.round(d0 * df);
    const tw = ROWS_W - d - COL_GAP;
    const blocks = rows.map((r) => {
      const nh = r.name
        ? lines_(c.t, r.name, "heading", L.displayWeight, s.name, tw) * s.name * L.lineHeights.name
        : 0;
      const lh = r.text
        ? lines_(c.t, r.text, "body", L.bodyWeight, s.body, tw) * s.body * L.lineHeights.body
        : 0;
      const th = nh + (nh && lh ? NAME_GAP : 0) + lh;
      const whole =
        (!r.name || kit.wordsFit(c, r.name, "heading", cushioned(tw), s.name, L.displayWeight)) &&
        (!r.text || kit.wordsFit(c, r.text, "body", tw, s.body, L.bodyWeight));
      return { nh, lh, th, rh: Math.max(rowPics ? ph : d + 4, th), whole };
    });
    const sum = blocks.reduce((a, b) => a + b.rh, 0);
    const fits = n === 0 || (sum + (n - 1) * gapMin <= H + 0.5 && blocks.every((b) => b.whole));
    // Row tops: three or fewer centred with a fixed gap, more spread to fill the column.
    const gap = n <= 3 ? gapMin : n > 1 ? Math.max(gapMin, (H - sum) / (n - 1)) : 0;
    const total = sum + (n - 1) * gap;
    let y = top + (n <= 3 ? Math.max(0, (H - total) / 2) : 0);
    const ys = blocks.map((b) => {
      const at = y;
      y += b.rh + gap;
      return at;
    });
    const bodyLH = s.body * L.lineHeights.body;
    let minGap = Number.POSITIVE_INFINITY;
    for (let i = 1; i < n; i++) {
      const a = blocks[i - 1];
      const b = blocks[i];
      if (!a || !b) continue;
      const aTop = (ys[i - 1] ?? 0) + (a.rh - a.th) / 2;
      const bTop = (ys[i] ?? 0) + (b.rh - b.th) / 2;
      minGap = Math.min(minGap, bTop - (aTop + a.th));
    }
    // 85% of the column for the text alone; the gaps are judged by minGap (CAPS-AUDIT: one margin).
    const fill = blocks.reduce((a, b) => a + b.th, 0) / Math.max(1, H);
    const comfy = fits && fill <= COMFORT_FILL + 0.005 && (n < 2 || minGap >= bodyLH - 1);
    const typeOk = s.name >= comfortName - TOL && s.body >= comfortBody - TOL;
    return { s, d, ph, tw, blocks, ys, gap, fits, comfy, typeOk };
  };
  let df = 1;
  let m = measureAt(1, df);
  while (!m.fits && df > 0.75) {
    df = Math.round((df - 0.05) * 100) / 100;
    m = measureAt(1, df);
  }
  let k = 1;
  while (!m.comfy && k > 0.6) {
    const next = measureAt(Math.round((k - 0.025) * 1000) / 1000, df);
    if (!next.typeOk) break;
    k = Math.round((k - 0.025) * 1000) / 1000;
    m = next;
  }
  if (!m.comfy || !m.typeOk)
    while (!m.fits && k > 0.6) {
      k = Math.round((k - 0.025) * 1000) / 1000;
      m = measureAt(k, df);
    }

  const tight = n < PANEL_MIN || !m.comfy || !m.typeOk || tk < 0.8 || !titleFits || leadLines > 1;
  if (!titleFits) geomOver.push("heading");

  // Draw the rows.
  const tx = ROWS_X + m.d + COL_GAP;
  rows.forEach((r, i) => {
    const b = m.blocks[i];
    const y = m.ys[i];
    if (!b || y === undefined) return;
    const fill = fills[i] as string;
    const pic = rowPics ? r.picture : null;
    if (pic) {
      // The tile, centred on the row's text block; cover-cropped by the picture fit (TEACH-25 b).
      const box = { x: ROWS_X, y: Math.round(y + (b.rh - m.ph) / 2), w: m.d, h: m.ph };
      const real = !!pic.photo && pic.photo !== PLACEHOLDER_IMAGE;
      const crop = real && pic.aspect ? cropFor(factsOf(pic.aspect, pic.subjects), box) : undefined;
      c.els.push({
        id: uid(),
        type: "image",
        name: PANEL_NAMES.rowPicture,
        ...box,
        src: pic.photo || PLACEHOLDER_IMAGE,
        alt: pic.alt ?? r.name,
        ...(pic.request ? { request: pic.request } : {}),
        ...(pic.subjects ? { subjects: pic.subjects } : {}),
        ...(pic.source ? { source: pic.source } : {}),
        ...(crop ? { crop } : {}),
        fit: "cover",
        // The age's picture radius, but never past 14% of a small tile (a KS1 radius on a 76 pt
        // tile read as a pill).
        radius: Math.min(L.radiusPicture, Math.round(m.ph * ROW_PIC_RADIUS)),
      } as SlideElement);
    }
    const dy = y + (b.rh - m.d) / 2;
    const numeral = drawn(c.t, "heading", Math.max(20, m.d * 0.48));
    // Beside a pie the disc is its wedge's swatch, so it keeps the full colour unless asked.
    const back: PanelIconBack = icons ? (c.panelIconBack ?? (shares ? "ring" : "soft")) : "ring";
    // From KS3 an icon's back is a rounded square (icon option 2); numbers stay on a disc.
    const tile = icons && L.medalShape === "tile";
    if (back !== "none" && !pic)
      c.els.push({
        id: uid(),
        type: "shape",
        shape: tile ? "rounded" : "ellipse",
        ...(tile ? { radius: Math.round(m.d * TILE_RADIUS) } : {}),
        x: ROWS_X,
        y: Math.round(dy),
        w: m.d,
        h: m.d,
        fill: back === "soft" ? hexMix(fill, c.t.colors.background, SOFT_TINT) : fill,
        name: PANEL_NAMES.disc,
        ...(icons
          ? {}
          : {
              doc: kit.doc(String(i + 1)),
              textStyle: {
                preset: "heading",
                fontSize: numeral,
                fontWeight: L.displayWeight,
                color: cat ? L.onCategory(fill) : L.onWash,
                align: "center",
                valign: "middle",
                padding: 0,
              },
            }),
      } as ShapeElement);
    // A draft's held icon: the empty disc or tile only, until it resolves.
    if (icons && matched[i] !== PENDING_ICON) {
      const g = Math.round(m.d * (back === "none" ? 1 : back === "soft" ? SOFT_ICON : L.discIcon));
      c.els.push({
        id: uid(),
        type: "icon",
        x: ROWS_X + Math.round((m.d - g) / 2),
        y: Math.round(dy + (m.d - g) / 2),
        w: g,
        h: g,
        icon: matched[i] as string,
        color: L.onCategory(fill),
        strokeWidth: 2,
        name: PANEL_NAMES.icon,
      } as IconElement);
    }
    let ty = y + (b.rh - b.th) / 2;
    if (r.name) {
      put(c, r.name, "heading", { x: tx, y: ty, w: m.tw }, m.s.name, {
        weight: L.displayWeight,
        lh: L.lineHeights.name,
        color: L.ink,
        name: PANEL_NAMES.name,
      });
      ty += b.nh + NAME_GAP;
    }
    if (r.text)
      put(c, r.text, "body", { x: tx, y: ty, w: m.tw }, m.s.body, {
        weight: L.bodyWeight,
        lh: L.lineHeights.body,
        color: L.muted,
        name: PANEL_NAMES.line,
      });
    // A hairline midway in the gap above the row; none when tight (a rule pressed on text reads packed).
    const prev = m.blocks[i - 1];
    const py = m.ys[i - 1];
    if (i > 0 && !tight && prev && py !== undefined) {
      const mid = (py + prev.rh + y) / 2;
      c.els.push({
        id: uid(),
        type: "shape",
        shape: "rect",
        x: tx,
        y: Math.round(mid),
        w: ROWS_X + ROWS_W - tx,
        h: 1.5,
        fill: L.rule,
        name: PANEL_NAMES.rule,
      } as ShapeElement);
    }
  });

  // Fields, the live counters, against the measured caps (ruling 215).
  const caps = panelCapsFor(L.age, Math.max(PANEL_MIN, n));
  // Beside row pictures the rows are narrower and the panel narrow: their own measured caps.
  const table = rowPics ? (caps?.pictures ?? caps) : caps;
  const capOf = (key: "heading" | "lead" | "name" | "text") =>
    table
      ? lead && (key === "name" || key === "text")
        ? table.withLead[key]
        : table[key]
      : undefined;
  const fields: FieldReport[] = [];
  const add = (field: string, key: "heading" | "lead" | "name" | "text", s: string) => {
    const cp = capOf(key);
    const chars = s.length;
    const cap = cp?.cap ?? 0;
    const hardMax = cp?.hardMax ?? 0;
    fields.push({
      field,
      path: field.replace(/\[(\d+)\]/g, ".$1"),
      chars,
      cap,
      hardMax,
      tight: !!cp && chars > cap,
      over: !!cp && chars > hardMax,
    });
  };
  add("heading", "heading", head);
  if (lead) add("lead", "lead", lead);
  rows.forEach((r, i) => {
    add(`rows[${i}].name`, "name", r.name);
    add(`rows[${i}].text`, "text", r.text);
  });
  c.fields = fields;
  // Over: geometry that did not fit (blame the field furthest past its cap), and any field past its hard maximum.
  const past = fields.filter((x) => x.over).map((x) => x.field);
  if (!m.fits && !past.length) {
    const worst = fields
      .filter((x) => x.field.startsWith("rows["))
      .sort((a, b) => b.chars / (b.cap || 60) - a.chars / (a.cap || 60))[0];
    if (worst) past.push(worst.field);
  }
  for (const o of [...geomOver, ...past]) if (!c.over.includes(o)) c.over.push(o);
  c.tight = tight || fields.some((x) => x.tight) || c.over.length > 0;
  GEOMETRY.set(c.els, {
    fits: m.fits && titleFits && leadLines <= 2,
    comfortable: m.fits && !tight,
  });
}

/** Lines of `text` in a `preset` box `w` wide at `size` and `weight`. */
/** The size the renderer draws a `preset` text stored at `size` (the key-stage scale's step). */
const drawn = (t: Theme, preset: "title" | "heading" | "body", size: number) =>
  resolveTextStyle({ preset, fontSize: size }, t, preset).fontSize;

function lines_(
  t: Theme,
  text: string,
  preset: "title" | "heading" | "body",
  weight: number,
  size: number,
  w: number,
) {
  // Display text (title and heading presets) is measured narrower (DISPLAY_CUSHION).
  return countLines(text, preset, t, preset === "body" ? w : w * DISPLAY_CUSHION, weight, size);
}
const cushioned = (w: number) => w * DISPLAY_CUSHION;

/** A text box at an explicit size, weight and line height (the profile's, not the template scale's). */
function put(
  c: Ctx,
  value: string,
  preset: "title" | "heading" | "body",
  rect: { x: number; y: number; w: number },
  size: number,
  o: { weight: number; lh: number; color: string; name: string },
): TextElement {
  const lines = lines_(c.t, value, preset, o.weight, size, rect.w);
  const el: TextElement = {
    id: uid(),
    type: "text",
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    w: Math.round(rect.w),
    h: Math.ceil(lines * size * o.lh),
    doc: kit.doc(value),
    name: o.name,
    style: {
      preset,
      autoHeight: true,
      fontSize: size,
      lineHeight: o.lh,
      fontWeight: o.weight,
      padding: 0,
      color: o.color,
    },
  };
  c.els.push(el);
  return el;
}

/**
 * The pie: a pale ground ring, a disc in the panel's light ink, and one closed wedge per share in
 * the rows' category colours, starting at the foot and running clockwise (the pilot's `pie`).
 */
function pie(c: Ctx, L: PanelLook, shares: number[], fills: string[]) {
  const cx = PIE_X + PIE / 2;
  const cy = SLIDE_H - PIE_FOOT - PIE / 2;
  const k = PIE / 320;
  const ring = (r: number, fill: string, name: string, opacity?: number) =>
    c.els.push({
      id: uid(),
      type: "shape",
      shape: "ellipse",
      x: Math.round(cx - r * k),
      y: Math.round(cy - r * k),
      w: Math.round(2 * r * k),
      h: Math.round(2 * r * k),
      fill,
      name,
      ...(opacity === undefined ? {} : { opacity }),
    } as ShapeElement);
  ring(152, L.onDeep, PANEL_NAMES.halo, 0.12);
  ring(140, L.onDeep, PANEL_NAMES.halo);
  const R = 118 * k;
  const total = shares.reduce((a, b) => a + b, 0);
  let a = Math.PI / 2 + 0.003;
  shares.forEach((s, i) => {
    const span = (s / total) * 2 * Math.PI;
    if (span <= 0) return;
    const b = a + span;
    const steps = Math.max(2, Math.ceil(span / (Math.PI / 60)));
    const pts = [{ x: 0.5, y: 0.5 }];
    for (let j = 0; j <= steps; j++) {
      const t = a + (span * j) / steps;
      pts.push({
        x: Math.round((0.5 + 0.5 * Math.cos(t)) * 10000) / 10000,
        y: Math.round((0.5 + 0.5 * Math.sin(t)) * 10000) / 10000,
      });
    }
    c.els.push({
      id: uid(),
      type: "path",
      x: Math.round((cx - R) * 100) / 100,
      y: Math.round((cy - R) * 100) / 100,
      w: Math.round(2 * R * 100) / 100,
      h: Math.round(2 * R * 100) / 100,
      points: pts,
      closed: true,
      fill: fills[i],
      stroke: L.onDeep,
      strokeWidth: Math.round(5 * k * 10) / 10,
      name: PANEL_NAMES.wedge,
    } as PathElement);
    a = b;
  });
}

/**
 * The capacity probe: whether `input` fits (geometry, at the floors) and is comfortable on every
 * theme in `themes` at `stage`, judged on the layout alone (never on the caps it measures).
 */
export function panelListFits(
  input: TemplateInput,
  themes: readonly Theme[],
  stage: Stage,
): Geometry {
  let fits = true;
  let comfortable = true;
  for (const theme of themes) {
    const r = layoutTemplate(input, theme, stage);
    const g = GEOMETRY.get(r.slide.elements) ?? { fits: false, comfortable: false };
    const shares = r.over.includes("panel.shares") || r.over.some((o) => /^rows \d+\/\d+$/.test(o));
    fits &&= g.fits && !shares;
    comfortable &&= g.comfortable && !shares;
    if (!fits) return { fits, comfortable: false };
  }
  return { fits, comfortable };
}

/**
 * Which input path each laid element shows, in draw order (the editor's `AdaptiveSpec.paths`,
 * TEACH-205 part b): the heading, the lead, and each row's name and line; the rest are not text
 * the teacher edits through the layout.
 */
export function panelListPaths(els: readonly { name?: string }[]): (string | undefined)[] {
  let row = -1;
  return els.map((el) => {
    if (el.name === PANEL_NAMES.title) return "heading";
    if (el.name === PANEL_NAMES.lead) return "lead";
    if (el.name === PANEL_NAMES.disc || el.name === PANEL_NAMES.rowPicture) row++;
    if (el.name === PANEL_NAMES.name) return `rows.${row}.name`;
    if (el.name === PANEL_NAMES.line) return `rows.${row}.text`;
    return undefined;
  });
}
