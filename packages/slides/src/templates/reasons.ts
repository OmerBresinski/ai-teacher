/**
 * Reasons (TEACH-75 part ad, batch C5; ruling 225): one "why?" or "how?" question answered by 2-4
 * reasons, one per click. Ported from the v13 gold (`northstars-v13/reasons`, the fidelity pass's
 * bare look); the gold draws at 1440 x 810 px, so every gold length here is x 2/3 (slide points).
 *
 * - The question sits in a sand panel down the left at title size (stepping down to 80% so it
 *   never runs past 4 lines), with an optional lead line under it.
 * - **Reasons:** each reason sits bare on the paper on the right (no card): an optional icon, a
 *   bold head and one line. Each hangs off the question by its own thin accent curve (the fan),
 *   all starting at one point on the panel edge level with the question, and ending in a dot.
 * - **Chain** (`chain: true`, cause and consequence): the links step down and to the right, joined
 *   by solid accent block arrows pointing down. There is no fan: the whole chain answers it.
 * - **Reveal:** before the first click the question shows with a quiet grey line and dot per reason
 *   (a chain: a grey arrow per join), so the class sees how many are coming. Each click reveals one
 *   reason, and its line, dot or arrow in the accent drawn over the grey one (the domain can only
 *   make an element appear), so nothing moves.
 * - Icons are all or none (matched through the icon library): one miss drops every icon and the
 *   reasons close up to text (a designed state, reported in `iconMisses`).
 * - Fit: type steps down from the age sizes to the floors until the column holds; never shrunk
 *   past the floors, never truncated. A count past the age's maximum, a field past its measured
 *   hard maximum, or a count whose cap is 0 (four reasons at KS1, a four-link chain with long
 *   lines) is named in `over`; the slide is never cut.
 */
import type { ImageElement, PathElement, TextElement, Theme } from "@tj/domain/documents";
import { uid } from "../factories";
import { countLines } from "../text-measure";
import { resolveTextStyle } from "../text-style";
import { v2Colors, v2Profile } from "../theme-v2";
import {
  type Ctx,
  type FieldReport,
  kit,
  layoutTemplate,
  type Stage,
  type TemplateInput,
} from "./index";
import { type AgeKey, iconSrc, matchIcon, panelLook } from "./panel-list-deps";
import CAPACITY from "./reasons-capacity.json";

/** One reason (or chain link): a short head, one line, an optional icon label. */
export type ReasonItem = { head: string; line: string; icon?: string | null };

export const REASONS_MIN = 2;
/** The most reasons at each age (gold: KS1 lines get too short at four). */
export const REASONS_MAX: Readonly<Record<AgeKey, number>> = { early: 3, primary: 4, secondary: 4 };
/** A chain has 3 links; 4 only when every line is this short or shorter (gold NOTES). */
export const CHAIN_LINKS = 3;
export const CHAIN_MAX = 4;
export const CHAIN_SHORT_LINE = 35;

/** Element names, as a teacher sees them in the editor's selection and layers. */
export const REASON_NAMES = {
  panel: "Question panel",
  question: "Question",
  lead: "Lead",
  wireOff: "Reason line (to come)",
  dotOff: "Reason dot (to come)",
  arrowOff: "Chain arrow (to come)",
  wire: "Reason line",
  dot: "Reason dot",
  arrow: "Chain arrow",
  icon: "Reason icon",
  head: "Reason head",
  text: "Reason text",
} as const;

/**
 * A live draft's held icon: while the writer is still writing a slide whose reasons have icons, a
 * reason whose icon has not arrived carries this label. It counts as an icon for all or none, but
 * nothing is drawn for it. The same string as items-row's and panel-list's.
 */
export const REASON_PENDING_ICON = "(icon pending)";

/* Geometry (960 x 540; the gold's 1440 px x 2/3). */
const SLIDE_W = 960;
const SLIDE_H = 540;
const PANEL_W: Readonly<Record<AgeKey, number>> = { early: 387, primary: 360, secondary: 360 };
const PAD_X = 64;
const PANEL_RIGHT = 32;
/** The fan's run from the panel edge to the reasons column. */
const FAN_W = 64;
const COL_TOP = 29;
const COL_FOOT = 29;
/** The reason's indent from where its line lands (the gold's bare-card left padding). */
const PAD_L = 24;
const ICON_GAP = 16;
const HEAD_GAP = 5;
const LEAD_GAP = 19;
/** The fan line's width (gold 4 / 5 / 3.5 px); a line still to come is 70% of it. */
const WIRE: Readonly<Record<AgeKey, number>> = { early: 3.33, primary: 2.67, secondary: 2.33 };
const DOT_K = 1.9;
/** Display text is measured 6% narrower than its box (panel-list's `DISPLAY_CUSHION`). */
const CUSHION = 0.94;
/**
 * Lines are counted at the box's full width: the ruler already counts display text wider than the
 * browser draws it ("Wind spreads the flames" two lines in a box the browser fits it in one), and
 * a further cushion left a gap under heads and called a 4-line question 5. Whole words still use
 * `CUSHION`, and a head sits on the foot of its measured box (valign bottom), so an over-count
 * opens room above the head, never between it and its line.
 */
const LINE_CUSHION = 1;
const NAME_LH = 1.08;
/** The least join between chain links (room for a readable block arrow). */
const CHAIN_GAP_MIN = 27;
const QUESTION_LH = 1.04;

/* Caps (the measured table, `reasons-capacity.json`). */
/** A field's limits in characters: `cap` the writer's (the gold's, never past what the renderer holds), `hardMax` the longest that still fits. */
export type Cap = { cap: number; hardMax: number };
export type ReasonsCaps = { question: Cap; lead: Cap; head: Cap; line: Cap };
type Table = Record<AgeKey, Record<string, ReasonsCaps>>;
const TABLE = CAPACITY as unknown as Table;
/** The table's key for a count and look: "reasons-3", "chain-4". */
export const capsKey = (chain: boolean, n: number) => `${chain ? "chain" : "reasons"}-${n}`;
export function reasonsCapsFor(age: AgeKey, chain: boolean, n: number): ReasonsCaps | undefined {
  return TABLE[age]?.[capsKey(chain, Math.max(chain ? CHAIN_LINKS : REASONS_MIN, n))];
}

type Geometry = { fits: boolean; comfortable: boolean };
const GEOMETRY = new WeakMap<object, Geometry>();
/** Trimmed; a number keeps its unit on its line ("37 °C", "50 %"), a no-break space between them. */
const clean = (s: string | null | undefined) =>
  typeof s === "string" ? s.trim().replace(/(\d) (°|%)/g, "$1\u00A0$2") : "";
const drawn = (t: Theme, preset: "title" | "heading" | "body", size: number) =>
  resolveTextStyle({ preset, fontSize: size }, t, preset).fontSize;
const linesOf = (
  t: Theme,
  text: string,
  preset: "title" | "heading" | "body",
  weight: number,
  size: number,
  w: number,
) => countLines(text, preset, t, preset === "body" ? w : w * LINE_CUSHION, weight, size);

/** A point on the cubic from p0 to p1 through c1, c2 at t. */
const cubic = (
  p0: [number, number],
  c1: [number, number],
  c2: [number, number],
  p1: [number, number],
  t: number,
): [number, number] => {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return [
    a * p0[0] + b * c1[0] + c * c2[0] + d * p1[0],
    a * p0[1] + b * c1[1] + c * c2[1] + d * p1[1],
  ];
};

/** An open or closed path element from absolute points (stored relative to its own box). */
function pathOf(
  pts: [number, number][],
  o: {
    stroke?: string;
    strokeWidth?: number;
    fill?: string;
    closed?: boolean;
    name: string;
    step: number;
  },
): PathElement {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const w = Math.max(0.01, Math.max(...xs) - x);
  const h = Math.max(0.01, Math.max(...ys) - y);
  const r4 = (v: number) => Math.round(v * 10000) / 10000;
  return {
    id: uid(),
    type: "path",
    x: Math.round(x * 100) / 100,
    y: Math.round(y * 100) / 100,
    w: Math.round(w * 100) / 100,
    h: Math.round(h * 100) / 100,
    points: pts.map(([px, py]) => ({ x: r4((px - x) / w), y: r4((py - y) / h) })),
    ...(o.closed ? { closed: true } : {}),
    ...(o.fill ? { fill: o.fill } : {}),
    ...(o.stroke ? { stroke: o.stroke, strokeWidth: o.strokeWidth } : {}),
    name: o.name,
    ...(o.step ? { revealStep: o.step } : {}),
  } as PathElement;
}

/**
 * The chain's block arrow pointing down from y0 to y1, centred on x: the gold's stages-family
 * arrow (shaft 32% of its height, head 78% wide and 50% long), one closed path.
 */
export function blockArrowDown(x: number, y0: number, y1: number): [number, number][] {
  const h = y1 - y0;
  const sw = h * 0.32;
  const hw = h * 0.78;
  const hl = h * 0.5;
  return [
    [x - sw / 2, y0],
    [x + sw / 2, y0],
    [x + sw / 2, y1 - hl],
    [x + hw / 2, y1 - hl],
    [x, y1],
    [x - hw / 2, y1 - hl],
    [x - sw / 2, y1 - hl],
  ];
}

export function layoutReasons(c: Ctx, input: TemplateInput) {
  c.bodyFromHeading = true;
  const L = panelLook(c.t);
  const P = v2Profile(c.t);
  const col = v2Colors(c.t);
  const age = L.age;
  const chain = input.chain === true;
  const items = (input.reasons ?? [])
    .filter((r) => r && typeof r === "object")
    .map((r) => ({ head: clean(r.head), line: clean(r.line), icon: clean(r.icon) }));
  const n = items.length;
  const over: string[] = [];

  // Counts: never cut, flagged. A chain's fourth link only with short lines.
  const maxN = chain
    ? age === "early"
      ? CHAIN_LINKS
      : items.every((r) => r.line.length <= CHAIN_SHORT_LINE)
        ? CHAIN_MAX
        : CHAIN_LINKS
    : REASONS_MAX[age];
  const minN = chain ? CHAIN_LINKS : REASONS_MIN;
  if (n > maxN || n < minN) over.push(`reasons ${n}/${n > maxN ? maxN : minN}`);

  // Icons: all or none, never drawn live.
  const matched = items.map((r) =>
    r.icon ? (r.icon === REASON_PENDING_ICON ? REASON_PENDING_ICON : matchIcon(r.icon)) : null,
  );
  const misses = items.filter((r, i) => r.icon && !matched[i]).map((r) => r.icon);
  if (misses.length) c.iconMisses = misses;
  const icons = n > 0 && matched.every(Boolean);

  // Colours: theme roles only. The question panel is the sand; red (the accent) means only the
  // lines, dots and arrows; a reason still to come is a grey of the sand and the ink.
  const ink = L.ink;
  const muted = L.muted;
  const accent = col.accent;
  const off = mixHex(col.ink, col.sand, 0.1);

  // The panel and the question.
  const panelW = PANEL_W[age];
  kit.box(c, { x: 0, y: 0, w: panelW, h: SLIDE_H }, col.sand, {
    shape: "rect",
    radius: 0,
    name: REASON_NAMES.panel,
  });
  const qW = panelW - PAD_X - PANEL_RIGHT;
  const question = clean(input.heading);
  const lead = clean(input.lead);
  const leadSize = drawn(c.t, "body", Math.max(L.floors.body, L.sizes.body * 0.92));
  const leadLines = lead ? linesOf(c.t, lead, "body", L.bodyWeight, leadSize, qW) : 0;
  const leadH = lead ? Math.ceil(leadLines * leadSize * L.lineHeights.body) : 0;
  const qAt = (size: number) => {
    const lines = question ? linesOf(c.t, question, "title", L.displayWeight, size, qW) : 0;
    const h = Math.ceil(lines * size * QUESTION_LH);
    const whole =
      !question || kit.wordsFit(c, question, "title", qW * CUSHION, size, L.displayWeight);
    const room = h + (lead ? LEAD_GAP + leadH : 0) <= SLIDE_H - 2 * COL_TOP;
    return { size, lines, h, ok: lines <= 4 && whole && room };
  };
  const qTop = drawn(c.t, "title", P.sizes.title);
  let q = qAt(qTop);
  for (let k = 0.98; !q.ok && k >= 0.8 - 1e-9; k -= 0.02)
    q = qAt(drawn(c.t, "title", P.sizes.title * k));
  const qFits = q.ok;
  if (!qFits) over.push("question");
  const block = q.h + (lead ? LEAD_GAP + leadH : 0);
  const qY = Math.round((SLIDE_H - block) / 2);
  if (question)
    put(
      c,
      question,
      "title",
      { x: PAD_X, y: qY, w: qW },
      q.size,
      L.displayWeight,
      QUESTION_LH,
      ink,
      REASON_NAMES.question,
    );
  if (lead)
    put(
      c,
      lead,
      "body",
      { x: PAD_X, y: qY + q.h + LEAD_GAP, w: qW },
      leadSize,
      L.bodyWeight,
      L.lineHeights.body,
      muted,
      REASON_NAMES.lead,
    );

  // The reasons column: type steps from the age sizes to the floors until it holds.
  const colX = panelW + FAN_W;
  const colH = SLIDE_H - COL_TOP - COL_FOOT;
  // A chain's joins hold its block arrows: the gold's 43 pt, closing to 27 pt before type steps down.
  const gapFor = (sum: number) =>
    chain
      ? Math.max(CHAIN_GAP_MIN, Math.min(43, (colH - sum) / Math.max(1, n - 1)))
      : n <= 2
        ? 27
        : n === 3
          ? 19
          : 11;
  const step = n >= 4 ? 27 : 32;
  const bodyMax = age === "early" ? 2 : age === "secondary" || chain ? 3 : 2;
  const comfortName = drawn(c.t, "heading", L.comfort.name);
  const comfortBody = drawn(c.t, "body", L.comfort.body);
  const measureAt = (k: number) => {
    const ns = drawn(c.t, "heading", Math.max(L.floors.name, P.sizes.name * k));
    const bs = drawn(c.t, "body", Math.max(L.floors.body, P.sizes.body * k));
    const padY = n >= 4 ? (k < 0.9 ? 11 : 13) : 16;
    const d = icons ? Math.round(L.disc * (n >= 4 ? 0.8 : 0.9) * Math.max(k, 0.85)) : 0;
    const blocks = items.map((r, i) => {
      const x = colX + (chain ? i * step : 0);
      const tx = x + PAD_L + (icons ? d + ICON_GAP : 0);
      const tw = SLIDE_W - PAD_X - tx;
      const hl = r.head ? linesOf(c.t, r.head, "heading", L.displayWeight, ns, tw) : 0;
      const bl = r.line ? linesOf(c.t, r.line, "body", L.bodyWeight, bs, tw) : 0;
      const hh = hl * ns * NAME_LH;
      const bh = bl * bs * L.lineHeights.body;
      const th = hh + (hh && bh ? HEAD_GAP : 0) + bh;
      const whole =
        (!r.head || kit.wordsFit(c, r.head, "heading", tw * CUSHION, ns, L.displayWeight)) &&
        (!r.line || kit.wordsFit(c, r.line, "body", tw, bs, L.bodyWeight));
      return {
        x,
        tx,
        tw,
        hh,
        th,
        h: Math.max(d, th) + 2 * padY,
        ok: whole && hl <= 2 && bl <= bodyMax,
      };
    });
    const sum = blocks.reduce((a, b) => a + b.h, 0);
    const gap = gapFor(sum);
    const used = sum + gap * Math.max(0, n - 1);
    const fits = used <= colH + 0.5 && blocks.every((b) => b.ok);
    return {
      k,
      ns,
      bs,
      padY,
      d,
      blocks,
      gap,
      used,
      fits,
      typeOk: ns >= comfortName - 0.34 && bs >= comfortBody - 0.34,
    };
  };
  let m = measureAt(1);
  for (let k = 0.98; !m.fits && k >= 0.6 - 1e-9; k -= 0.02)
    m = measureAt(Math.round(k * 100) / 100);
  const fits = m.fits;
  const comfortable = fits && m.typeOk && qFits && leadLines <= 3;

  // Draw. Every reason's words and icon appear on its click; its line or arrow too, in the accent,
  // over the grey placeholder that shows from the start.
  const ww = WIRE[age];
  const ox = panelW;
  const oy = qY + Math.min(q.h, q.size * QUESTION_LH * q.lines) / 2;
  let y = COL_TOP + Math.max(0, (colH - m.used) / 2);
  const tops: number[] = [];
  items.forEach((r, i) => {
    const b = m.blocks[i];
    if (!b) return;
    tops.push(y);
    const stepNo = i + 1;
    const mid = y + b.h / 2;
    const textTop = mid - b.th / 2;
    // Fan: the line lands on the reason's middle beside an icon, else on its head's first line.
    if (!chain) {
      const ty = icons ? mid : textTop + (m.ns * NAME_LH) / 2;
      const tx = b.x;
      const mx = (ox + tx) / 2;
      const pts: [number, number][] = [];
      for (let s = 0; s <= 24; s++) pts.push(cubic([ox, oy], [mx, oy], [mx, ty], [tx, ty], s / 24));
      const dot = (fill: string, name: string, at: number, r0: number) =>
        c.els.push({
          id: uid(),
          type: "shape",
          shape: "ellipse",
          x: Math.round((tx - r0) * 100) / 100,
          y: Math.round((ty - r0) * 100) / 100,
          w: Math.round(2 * r0 * 100) / 100,
          h: Math.round(2 * r0 * 100) / 100,
          fill,
          name,
          ...(at ? { revealStep: at } : {}),
        } as never);
      c.els.push(
        pathOf(pts, {
          stroke: off,
          strokeWidth: Math.round(ww * 0.7 * 100) / 100,
          name: REASON_NAMES.wireOff,
          step: 0,
        }),
      );
      dot(off, REASON_NAMES.dotOff, 0, ww * DOT_K);
      c.els.push(
        pathOf(pts, { stroke: accent, strokeWidth: ww, name: REASON_NAMES.wire, step: stepNo }),
      );
      dot(accent, REASON_NAMES.dot, stepNo, ww * DOT_K);
    }
    if (icons) {
      const g = m.d;
      const src = matched[i] !== REASON_PENDING_ICON ? iconSrc(matched[i] as string, c.t, g) : "";
      if (src)
        c.els.push({
          id: uid(),
          type: "image",
          x: Math.round(b.x + PAD_L),
          y: Math.round(mid - g / 2),
          w: g,
          h: g,
          src,
          alt: r.icon,
          fit: "contain",
          name: REASON_NAMES.icon,
          revealStep: stepNo,
        } as ImageElement);
    }
    let ty = textTop;
    if (r.head) {
      const el = put(
        c,
        r.head,
        "heading",
        { x: b.tx, y: ty, w: b.tw },
        m.ns,
        L.displayWeight,
        NAME_LH,
        ink,
        REASON_NAMES.head,
      );
      el.revealStep = stepNo;
      el.style = { ...el.style, autoHeight: false, valign: "bottom" };
      ty += b.hh + HEAD_GAP;
    }
    if (r.line) {
      const el = put(
        c,
        r.line,
        "body",
        { x: b.tx, y: ty, w: b.tw },
        m.bs,
        L.bodyWeight,
        L.lineHeights.body,
        muted,
        REASON_NAMES.text,
      );
      el.revealStep = stepNo;
    }
    y += b.h + m.gap;
  });
  // Chain: a block arrow into each link after the first, under the next link's icon column.
  if (chain)
    for (let i = 1; i < n; i++) {
      const a = m.blocks[i - 1];
      const b = m.blocks[i];
      const at = tops[i - 1];
      const bt = tops[i];
      if (!a || !b || at === undefined || bt === undefined) continue;
      const x = b.x + PAD_L + (icons ? m.d : L.disc * 0.9) / 2;
      const y0 = at + a.h + 5;
      const y1 = bt - 5;
      if (y1 - y0 < 8) continue;
      const pts = blockArrowDown(x, y0, y1);
      c.els.push(
        pathOf(pts, {
          fill: off,
          stroke: off,
          strokeWidth: 0.5,
          closed: true,
          name: REASON_NAMES.arrowOff,
          step: 0,
        }),
      );
      c.els.push(
        pathOf(pts, {
          fill: accent,
          stroke: accent,
          strokeWidth: 0.5,
          closed: true,
          name: REASON_NAMES.arrow,
          step: i + 1,
        }),
      );
    }

  // Fields, the live counters, against the measured caps (ruling 215). A cap of 0 is a count the
  // layout never takes: every field there is over, never "no cap".
  const caps = reasonsCapsFor(age, chain, n);
  const fields: FieldReport[] = [];
  const add = (field: string, key: keyof ReasonsCaps, s: string) => {
    const cp = caps?.[key];
    const chars = s.length;
    const banned = !cp || cp.hardMax <= 0;
    const cap = banned ? 0 : comfortable ? Math.max(cp.cap, chars) : cp.cap;
    const hardMax = banned ? 0 : fits && qFits ? Math.max(cp.hardMax, chars) : cp.hardMax;
    fields.push({
      field,
      path: field.replace(/\[(\d+)\]/g, ".$1"),
      chars,
      cap,
      hardMax,
      tight: chars > cap,
      over: chars > hardMax || (banned && chars > 0),
    });
  };
  add("heading", "question", question);
  if (lead) add("lead", "lead", lead);
  items.forEach((r, i) => {
    add(`reasons[${i}].head`, "head", r.head);
    add(`reasons[${i}].line`, "line", r.line);
  });
  c.fields = fields;
  const past = fields.filter((x) => x.over).map((x) => x.field);
  if (!fits && !past.length) {
    const worst = fields
      .filter((x) => x.field.startsWith("reasons["))
      .sort((a, b) => b.chars / (b.cap || 60) - a.chars / (a.cap || 60))[0];
    if (worst) past.push(worst.field);
  }
  if (leadLines > 3) past.push("lead");
  for (const o of [...over, ...past]) if (!c.over.includes(o)) c.over.push(o);
  c.tight = !comfortable || fields.some((x) => x.tight) || c.over.length > 0;
  GEOMETRY.set(c.els, {
    fits: fits && qFits && leadLines <= 3 && !over.length,
    comfortable: comfortable && !over.length,
  });
}

/** `a` over `b` at `k`, as hex (theme roles mixed, never a literal colour). */
function mixHex(a: string, b: string, k: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return `#${x
    .map((v, i) =>
      Math.round(v * k + (y[i] as number) * (1 - k))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`.toUpperCase();
}

function put(
  c: Ctx,
  value: string,
  preset: "title" | "heading" | "body",
  rect: { x: number; y: number; w: number },
  size: number,
  weight: number,
  lh: number,
  color: string,
  name: string,
): TextElement {
  const lines = linesOf(c.t, value, preset, weight, size, rect.w);
  const el: TextElement = {
    id: uid(),
    type: "text",
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    w: Math.round(rect.w),
    h: Math.ceil(lines * size * lh),
    doc: kit.doc(value),
    name,
    style: {
      preset,
      autoHeight: true,
      fontSize: size,
      lineHeight: lh,
      fontWeight: weight,
      padding: 0,
      color,
    },
  };
  c.els.push(el);
  return el;
}

/** The capacity probe: whether `input` fits and is comfortable on every theme at `stage`. */
export function reasonsFits(
  input: TemplateInput,
  themes: readonly Theme[],
  stage: Stage,
): Geometry {
  let comfortable = true;
  for (const theme of themes) {
    const r = layoutTemplate(input, theme, stage);
    const g = GEOMETRY.get(r.slide.elements) ?? { fits: false, comfortable: false };
    if (!g.fits) return { fits: false, comfortable: false };
    comfortable &&= g.comfortable;
  }
  return { fits: true, comfortable };
}

/** Which input path each laid element shows, in draw order (the editor's `AdaptiveSpec.paths`). */
export function reasonsPaths(els: readonly { name?: string }[]): (string | undefined)[] {
  let i = -1;
  return els.map((el) => {
    if (el.name === REASON_NAMES.question) return "heading";
    if (el.name === REASON_NAMES.lead) return "lead";
    if (el.name === REASON_NAMES.head) return `reasons.${++i}.head`;
    if (el.name === REASON_NAMES.text) return i < 0 ? undefined : `reasons.${i}.line`;
    return undefined;
  });
}
