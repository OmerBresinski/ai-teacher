/// <reference path="./assets.d.ts" />
/**
 * A library model drawn as a slide's diagram (TEACH-247 part h, ADR 0035): the kit's own engine
 * (`mountSlide`) runs on a happy-dom document, with text measured from the Lexend advance widths
 * production already measures with, and the result is serialised as one self-contained SVG. That
 * SVG goes in the slot the drawer's diagrams use (an image element, `name: "Diagram"`), so the
 * editor, Present (its `data-s` builds), PNG, PDF and PPTX show it with no new element type.
 *
 * Nothing here needs a browser: the worker draws it at generation time, and the stored SVG is
 * what every surface shows. The render is synchronous, and the two globals the kit reads at draw
 * time (`document`, `getComputedStyle`) are set only for its duration.
 */

import { REVEAL_HIDDEN } from "@tj/slides/diagram-builds";
import { textWidth } from "@tj/slides/diagrams";
import { FONT_STACKS } from "@tj/slides/fonts";
import { type Element, Window } from "happy-dom";
import { LEXEND_WOFF2_BASE64 } from "./lexend.gen";
import { MODEL_LOADERS } from "./models";
import { KIT_TOKENS as TOKENS } from "./tokens.gen";
import type { J, LibModel } from "./types";

/** Slide units of the kit (kit/svg.js, kit/layout.js). */
const W = 1280;
const STAGE_TOP = 112;
const FOOT = 660;
/** A drawing heavier than this is not stored on a slide (a map's coastline at full detail). */
export const MAX_SVG_BYTES = 400_000;

/** The kit reads two browser globals when it is imported; the stubs never fire (no animation loop). */
function shimImportGlobals() {
  const g = globalThis as Record<string, unknown>;
  g.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  g.requestAnimationFrame ??= () => 0;
}

let kitP: Promise<typeof import("./vendor/kit/index.js")> | undefined;
const models = new Map<string, Promise<LibModel>>();
/** The kit, imported once (after the import-time stubs). */
export function kit() {
  shimImportGlobals();
  kitP ??= import("./vendor/kit/index.js");
  return kitP;
}
/** One shipped model by id, or undefined for an id production does not ship. */
export async function loadModel(id: string): Promise<LibModel | undefined> {
  const load = MODEL_LOADERS[id];
  if (!load) return undefined;
  await kit();
  let p = models.get(id);
  if (!p) {
    p = load();
    models.set(id, p);
  }
  return p;
}

/** Only the primary theme's tokens travel with a drawing; fonts load nowhere inside an <img>. */
export const SVG_CSS = `@font-face{font-family:"Lexend";font-weight:100 900;src:url(data:font/woff2;base64,${LEXEND_WOFF2_BASE64}) format("woff2")}${(
  TOKENS as string
)
  .replace(/@import\s+url\([^)]*\)\s*;/g, "")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\.theme-(?!primary\b)[\w-]+[^{}]*\{[^{}]*\}/g, "")
  .replace(/\s+/g, " ")
  .trim()}`;

type Win = InstanceType<typeof Window>;
let env: { win: Win; host: Element } | undefined;

/** The primary theme's type tokens (`--fs-*`, `--w-*`) and each type class's size and weight. */
const VARS = new Map<string, string>();
const PLAIN_CSS = (TOKENS as string).replace(/\/\*[\s\S]*?\*\//g, "");
for (const block of PLAIN_CSS.matchAll(/(?<=^|\})\s*(:root|\.tk|\.theme-primary)\s*\{([^}]*)\}/g))
  for (const [, k, v] of (block[2] ?? "").matchAll(/(--(?:fs|w)-[\w-]+)\s*:\s*([^;]+);/g))
    VARS.set(k as string, (v as string).trim());
type ClassType = Map<string, { size?: string; weight?: string }>;
/** `.slide .cls { font-size; font-weight }` rules of a stylesheet, by class. */
function classTypes(css: string): ClassType {
  const map: ClassType = new Map();
  for (const [, cls, body] of css.matchAll(/(?:\.slide\s+)?\.([\w-]+)\s*\{([^}]*)\}/g)) {
    const size = /font-size:\s*([^;}]+)/.exec(body ?? "")?.[1]?.trim();
    const weight = /font-weight:\s*([^;}]+)/.exec(body ?? "")?.[1]?.trim();
    if (size || weight) map.set(cls as string, { size, weight });
  }
  return map;
}
const CLASS_TYPE = classTypes(PLAIN_CSS);
/** Rules a model adds in its own `<style>` while it draws (plant_growth's `.pg-job`); they win. */
const parsedStyles = new Map<string, ClassType>();
function modelClassTypes(el: Element): ClassType[] {
  const out: ClassType[] = [];
  for (const st of el.ownerDocument?.querySelectorAll("style") ?? []) {
    const css = st.textContent ?? "";
    if (!css || css.length > 50_000) continue;
    let m = parsedStyles.get(css);
    if (!m) {
      m = classTypes(css.replace(/\/\*[\s\S]*?\*\//g, ""));
      if (parsedStyles.size > 500) parsedStyles.clear();
      parsedStyles.set(css, m);
    }
    if (m.size) out.push(m);
  }
  return out.reverse();
}
const resolve = (v: string): number => {
  const m = /var\((--[\w-]+)\)/.exec(v);
  const base = Number.parseFloat(m ? (VARS.get(m[1] as string) ?? "") : v);
  // calc(var(--fs-label) * 1.2): the kit's only calc form for type.
  const k = /\*\s*([\d.]+)/.exec(v);
  return k ? base * Number(k[1]) : base;
};
/** An element's font size and weight as the kit's CSS sets them (inline style, attribute, class). */
export function typeOf(el: Element): { fs: number; weight: number } {
  let fs: number | undefined;
  let weight: number | undefined;
  const own = modelClassTypes(el);
  for (
    let e: Element | null = el;
    e && (fs === undefined || weight === undefined);
    e = e.parentElement
  ) {
    const style = e.getAttribute("style") ?? "";
    const s = /font-size:\s*([^;]+)/.exec(style)?.[1] ?? e.getAttribute("font-size") ?? undefined;
    const w =
      /font-weight:\s*([^;]+)/.exec(style)?.[1] ?? e.getAttribute("font-weight") ?? undefined;
    if (fs === undefined && s) fs = resolve(s) || undefined;
    if (weight === undefined && w) weight = resolve(w) || undefined;
    for (const c of e.classList) {
      const t = own.find((m) => m.has(c))?.get(c) ?? CLASS_TYPE.get(c);
      if (fs === undefined && t?.size) fs = resolve(t.size) || undefined;
      if (weight === undefined && t?.weight) weight = resolve(t.weight) || undefined;
    }
    if (e.tagName.toLowerCase() === "svg") break;
  }
  return { fs: fs ?? 16, weight: weight ?? (resolve("var(--w-body)") || 500) };
}

/** Width of a text element in slide units: Lexend advances (the primary theme's only family). */
export function textLength(el: Element): number {
  const { fs, weight } = typeOf(el);
  return lexendWidth(el.textContent ?? "", fs, weight);
}

/**
 * Lexend is one variable font: the advance tables hold 400, 600 and 700, and a weight between two
 * of them is set between their widths (500, the kit's body weight, is not 600's width).
 */
export function lexendWidth(s: string, fs: number, weight: number): number {
  const at = (w: number) => textWidth(s, { stack: FONT_STACKS.lexend } as never, fs, w);
  if (weight <= 400) return at(400);
  if (weight < 600) return at(400) + ((at(600) - at(400)) * (weight - 400)) / 200;
  if (weight < 700) return at(600) + ((at(700) - at(600)) * (weight - 600)) / 100;
  return at(700);
}

export function libraryDom() {
  if (env) return env;
  const win = new Window({ width: 1400, height: 900 });
  const doc = win.document;
  const style = doc.createElement("style");
  style.textContent = (TOKENS as string).replace(/@import\s+url\([^)]*\)\s*;/g, "");
  doc.head.appendChild(style);
  const host = doc.createElement("div");
  doc.body.appendChild(host);
  const w = win as unknown as Record<string, { prototype: Record<string, unknown> } | undefined>;
  for (const name of ["SVGElement", "SVGTextContentElement", "SVGTextElement", "SVGTSpanElement"]) {
    const C = w[name];
    if (C)
      C.prototype.getComputedTextLength = function (this: Element) {
        return textLength(this);
      };
  }
  const G = w.SVGGraphicsElement ?? w.SVGElement;
  if (G)
    G.prototype.getBBox = function (this: Element) {
      return bboxOf(this);
    };
  env = { win, host: host as unknown as Element };
  return env;
}

/** `f` with the kit's draw-time globals pointing at the happy-dom document; always restored. */
function withDom<T>(f: (e: { win: Win; host: Element }) => T): T {
  const e = libraryDom();
  const g = globalThis as Record<string, unknown>;
  const saved = {
    document: g.document,
    getComputedStyle: g.getComputedStyle,
    DOMMatrix: g.DOMMatrix,
  };
  g.document = e.win.document;
  g.getComputedStyle = (el: unknown) => e.win.getComputedStyle(el as never);
  // A few models place marks with DOMMatrix maths.
  g.DOMMatrix ??= (e.win as unknown as { DOMMatrix: unknown }).DOMMatrix;
  try {
    return f(e);
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete g[k];
      else g[k] = v;
    }
  }
}

/* ------------------------------------------------------------------ geometry for the crop */

type M = [number, number, number, number, number, number];
const ID: M = [1, 0, 0, 1, 0, 0];
const mul = (a: M, b: M): M => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
];
function parseTransform(t: string | null): M {
  let m = ID;
  if (!t) return m;
  for (const [, fn, args] of t.matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const n = (args ?? "")
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    const [a = 0, b, c, d, e, f] = n;
    let x: M = ID;
    if (fn === "translate") x = [1, 0, 0, 1, a, b ?? 0];
    else if (fn === "scale") x = [a, 0, 0, b ?? a, 0, 0];
    else if (fn === "matrix") x = [a, b ?? 0, c ?? 0, d ?? 1, e ?? 0, f ?? 0];
    else if (fn === "rotate") {
      const r = (a * Math.PI) / 180;
      const [cx, cy] = [b ?? 0, c ?? 0];
      x = mul(
        mul([1, 0, 0, 1, cx, cy], [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0]),
        [1, 0, 0, 1, -cx, -cy],
      );
    }
    m = mul(m, x);
  }
  return m;
}
const num = (el: Element, k: string) => Number.parseFloat(el.getAttribute(k) ?? "") || 0;

/** Points along a path's outline: curves and arcs sampled, so a box fits the drawn shape. */
function pathPoints(d: string): [number, number][] {
  const out: [number, number][] = [];
  const toks = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) ?? [];
  let cmd = "M";
  let [x, y, sx, sy] = [0, 0, 0, 0];
  let ctrl: [number, number] | undefined;
  let i = 0;
  const n = () => Number(toks[i++]);
  const N = 12;
  const cubic = (p1: number[], p2: number[], p3: number[]) => {
    for (let k = 1; k <= N; k++) {
      const t = k / N;
      const m = 1 - t;
      out.push([
        m * m * m * x +
          3 * m * m * t * (p1[0] as number) +
          3 * m * t * t * (p2[0] as number) +
          t * t * t * (p3[0] as number),
        m * m * m * y +
          3 * m * m * t * (p1[1] as number) +
          3 * m * t * t * (p2[1] as number) +
          t * t * t * (p3[1] as number),
      ]);
    }
  };
  const quad = (p1: number[], p2: number[]) => {
    for (let k = 1; k <= N; k++) {
      const t = k / N;
      const m = 1 - t;
      out.push([
        m * m * x + 2 * m * t * (p1[0] as number) + t * t * (p2[0] as number),
        m * m * y + 2 * m * t * (p1[1] as number) + t * t * (p2[1] as number),
      ]);
    }
  };
  const arc = (
    rx0: number,
    ry0: number,
    rot: number,
    large: number,
    sweep: number,
    x2: number,
    y2: number,
  ) => {
    let rx = Math.abs(rx0);
    let ry = Math.abs(ry0);
    if (!rx || !ry) return void out.push([x2, y2]);
    const phi = (rot * Math.PI) / 180;
    const [c, s0] = [Math.cos(phi), Math.sin(phi)];
    const dx = (x - x2) / 2;
    const dy = (y - y2) / 2;
    const x1p = c * dx + s0 * dy;
    const y1p = -s0 * dx + c * dy;
    const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
    if (lam > 1) [rx, ry] = [rx * Math.sqrt(lam), ry * Math.sqrt(lam)];
    const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
    const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
    const co = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
    const cxp = (co * rx * y1p) / ry;
    const cyp = (-co * ry * x1p) / rx;
    const cx = c * cxp - s0 * cyp + (x + x2) / 2;
    const cy = s0 * cxp + c * cyp + (y + y2) / 2;
    const ang = (ux: number, uy: number, vx: number, vy: number) =>
      Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
    let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
    if (!sweep && dt > 0) dt -= 2 * Math.PI;
    if (sweep && dt < 0) dt += 2 * Math.PI;
    for (let k = 1; k <= 2 * N; k++) {
      const t = t1 + (dt * k) / (2 * N);
      out.push([
        cx + rx * Math.cos(t) * c - ry * Math.sin(t) * s0,
        cy + rx * Math.cos(t) * s0 + ry * Math.sin(t) * c,
      ]);
    }
  };
  while (i < toks.length) {
    if (/[a-zA-Z]/.test(toks[i] ?? "")) cmd = toks[i++] as string;
    else if (!Number.isFinite(Number(toks[i]))) break;
    const rel = cmd !== cmd.toUpperCase();
    const C = cmd.toUpperCase();
    const pt = (): [number, number] => {
      const px = n() + (rel ? x : 0);
      const py = n() + (rel ? y : 0);
      return [px, py];
    };
    let nextCtrl: [number, number] | undefined;
    if (C === "Z") {
      [x, y] = [sx, sy];
      out.push([x, y]);
      if (i < toks.length && !/[a-zA-Z]/.test(toks[i] ?? "")) i++;
    } else if (C === "M") {
      [x, y] = pt();
      [sx, sy] = [x, y];
      out.push([x, y]);
      cmd = rel ? "l" : "L";
    } else if (C === "L" || C === "T") {
      const p = pt();
      if (C === "T") {
        const c1: [number, number] = ctrl ? [2 * x - ctrl[0], 2 * y - ctrl[1]] : [x, y];
        quad(c1, p);
        nextCtrl = c1;
      } else out.push(p);
      [x, y] = p;
    } else if (C === "H") {
      x = n() + (rel ? x : 0);
      out.push([x, y]);
    } else if (C === "V") {
      y = n() + (rel ? y : 0);
      out.push([x, y]);
    } else if (C === "C" || C === "S") {
      const c1: [number, number] =
        C === "C" ? pt() : ctrl ? [2 * x - ctrl[0], 2 * y - ctrl[1]] : [x, y];
      const c2 = pt();
      const p = pt();
      cubic(c1, c2, p);
      nextCtrl = c2;
      [x, y] = p;
    } else if (C === "Q") {
      const c1 = pt();
      const p = pt();
      quad(c1, p);
      nextCtrl = c1;
      [x, y] = p;
    } else if (C === "A") {
      const [rx, ry, rot, large, sweep] = [n(), n(), n(), n(), n()];
      const p = pt();
      arc(rx, ry, rot, large, sweep, p[0], p[1]);
      [x, y] = p;
    } else i++;
    ctrl = nextCtrl;
  }
  return out;
}

/** An element's own outline points, in its user space; undefined when it draws nothing countable. */
function ownPoints(el: Element): [number, number][] | undefined {
  const tag = el.tagName.toLowerCase();
  if (tag === "rect" || tag === "image" || tag === "use" || tag === "foreignobject") {
    const [x, y, w, h] = [num(el, "x"), num(el, "y"), num(el, "width"), num(el, "height")];
    if (!w && !h) return undefined;
    return [
      [x, y],
      [x + w, y + h],
    ];
  }
  if (tag === "circle" || tag === "ellipse") {
    const [cx, cy] = [num(el, "cx"), num(el, "cy")];
    const rx = tag === "circle" ? num(el, "r") : num(el, "rx");
    const ry = tag === "circle" ? num(el, "r") : num(el, "ry");
    return [
      [cx - rx, cy - ry],
      [cx + rx, cy + ry],
    ];
  }
  if (tag === "line")
    return [
      [num(el, "x1"), num(el, "y1")],
      [num(el, "x2"), num(el, "y2")],
    ];
  if (tag === "polyline" || tag === "polygon") {
    const v = (el.getAttribute("points") ?? "")
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    const out: [number, number][] = [];
    for (let i = 0; i + 1 < v.length; i += 2) out.push([v[i] as number, v[i + 1] as number]);
    return out;
  }
  if (tag === "path") return pathPoints(el.getAttribute("d") ?? "");
  if (tag === "text") {
    // Words on a curve sit on their path, which is drawn (or measured) as its own mark.
    if (el.querySelector("textPath, textpath")) return undefined;
    const { fs } = typeOf(el);
    // Tspans with their own x are lines; others are coloured runs of one line.
    const spans = [...el.querySelectorAll("tspan")].filter((t) => t.hasAttribute("x"));
    const lines = spans.length ? spans : [el];
    const w = 1.04 * Math.max(...lines.map((s) => textLength(s)));
    const anchor = el.getAttribute("text-anchor");
    const x = num(el, "x");
    const y = num(el, "y");
    const x0 = anchor === "middle" ? x - w / 2 : anchor === "end" ? x - w : x;
    const dys = spans.reduce((s, t) => s + num(t, "dy"), 0);
    return [
      [x0, y - fs * 0.85],
      [x0 + w, y + dys + fs * 0.3],
    ];
  }
  return undefined;
}

/** A subtree's box in its own user space (happy-dom has no layout): for models that centre on it. */
function bboxOf(el: Element): { x: number; y: number; width: number; height: number } {
  let [x0, y0, x1, y1] = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, -1e9, -1e9];
  const walk = (e: Element, m: M) => {
    if (SKIP_TAGS.includes(e.tagName.toLowerCase())) return;
    const pts = ownPoints(e);
    for (const [x, y] of pts ?? []) {
      const px = m[0] * x + m[2] * y + m[4];
      const py = m[1] * x + m[3] * y + m[5];
      if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
      [x0, y0, x1, y1] = [Math.min(x0, px), Math.min(y0, py), Math.max(x1, px), Math.max(y1, py)];
    }
    if (e.tagName.toLowerCase() !== "text")
      for (const c of e.children) walk(c, mul(m, parseTransform(c.getAttribute("transform"))));
  };
  walk(el, ID);
  return Number.isFinite(x0)
    ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
    : { x: 0, y: 0, width: 0, height: 0 };
}

const SKIP = "defs,clipPath,clippath,mask,marker,pattern,symbol,style,title,desc";
const SKIP_TAGS = SKIP.toLowerCase().split(",");
/** The drawn area: every visible mark's box, ignoring full-slide grounds and the foot. */
function drawnBox(svg: Element, foot: Element | null) {
  let [x0, y0, x1, y1] = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, -1e9, -1e9];
  const walk = (el: Element, m: M) => {
    const tag = el.tagName.toLowerCase();
    if (SKIP_TAGS.includes(tag)) return;
    if (el === foot || el.classList.contains("off") || el.classList.contains("grain")) return;
    if (el.classList.contains("live")) return;
    const mm = mul(m, parseTransform(el.getAttribute("transform")));
    const pts = ownPoints(el);
    if (pts?.length) {
      const t = pts.map(([x, y]) => [mm[0] * x + mm[2] * y + mm[4], mm[1] * x + mm[3] * y + mm[5]]);
      const xs = t.map((p) => p[0] as number);
      const ys = t.map((p) => p[1] as number);
      const bw = Math.max(...xs) - Math.min(...xs);
      // A ground that spans the slide is not the drawing's edge.
      if (bw < W - 1 && xs.every(Number.isFinite) && ys.every(Number.isFinite)) {
        x0 = Math.min(x0, ...xs);
        y0 = Math.min(y0, ...ys);
        x1 = Math.max(x1, ...xs);
        y1 = Math.max(y1, ...ys);
      }
    }
    if (tag !== "text") for (const c of el.children) walk(c, mm);
  };
  for (const c of svg.children) walk(c, ID);
  return Number.isFinite(x0) && x1 > x0 && y1 > y0 ? { x0, y0, x1, y1 } : undefined;
}

/* ------------------------------------------------------------------ the render */

export type LibraryDrawing = {
  /** The SVG as an image element's `src`: the drawer's data URL form, so builds are counted. */
  src: string;
  svg: string;
  aspect: number;
  /** Builds Present plays (`data-s` parts), 0 when the drawing is one frame. */
  builds: number;
  alt: string;
  warnings: string[];
  bytes: number;
  /** Words drawn off the slide or below its foot (the box from the Lexend advance tables). */
  offSlide: string[];
};

/** Bounds for a list or a number whose schema sets none: a drawing never gets more. */
export const DEFAULT_MAX_ITEMS = 60;
export const DEFAULT_NUMBER_BOUND = 1_000_000;
export const DEFAULT_MAX_LENGTH = 400;
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Params held to the schema's bounds before anything draws: every list cut to its maxItems (or
 * DEFAULT_MAX_ITEMS), every number into its minimum and maximum (or +-DEFAULT_NUMBER_BOUND), every
 * string to its maxLength (or DEFAULT_MAX_LENGTH), and no `__proto__`, `constructor` or
 * `prototype` key at any depth. A value inside its bounds is returned as it is.
 */
export function clampToSchema(schema: unknown, value: unknown): unknown {
  const s = (schema ?? {}) as J;
  if (Array.isArray(value)) {
    const max = typeof s.maxItems === "number" ? s.maxItems : DEFAULT_MAX_ITEMS;
    return value.slice(0, max).map((v) => clampToSchema(s.items, v));
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return typeof s.minimum === "number" ? s.minimum : 0;
    const lo = typeof s.minimum === "number" ? s.minimum : -DEFAULT_NUMBER_BOUND;
    const hi = typeof s.maximum === "number" ? s.maximum : DEFAULT_NUMBER_BOUND;
    return Math.min(hi, Math.max(lo, value));
  }
  if (typeof value === "string")
    return value.slice(0, typeof s.maxLength === "number" ? s.maxLength : DEFAULT_MAX_LENGTH);
  if (value && typeof value === "object") {
    const props = (s.properties ?? {}) as Record<string, unknown>;
    const out: J = {};
    for (const [k, v] of Object.entries(value as J)) {
      if (UNSAFE_KEYS.has(k)) continue;
      out[k] = clampToSchema(props[k] ?? s.additionalProperties, v);
    }
    return out;
  }
  return value;
}

/**
 * Where `value` falls outside the bounds `clampToSchema` holds a drawing to (TEACH-247 part i): each
 * path a clamp would change, as a refusal the fill's repair call can act on. Empty when the value
 * draws exactly as it was sent. A clamp is never applied silently: 16 cut to 12 is another number.
 */
export function boundsRefusals(
  schema: unknown,
  value: unknown,
  path = "",
): { path: string; reason: string }[] {
  const s = (schema ?? {}) as J;
  const at = path || "(all)";
  if (Array.isArray(value)) {
    const max = typeof s.maxItems === "number" ? s.maxItems : DEFAULT_MAX_ITEMS;
    const out =
      value.length > max ? [{ path: at, reason: `has ${value.length} items, at most ${max}` }] : [];
    return [
      ...out,
      ...value.flatMap((v, i) => boundsRefusals(s.items, v, path ? `${path}.${i}` : String(i))),
    ];
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return [{ path: at, reason: "is not a number" }];
    const c = clampToSchema(s, value);
    return c === value
      ? []
      : [{ path: at, reason: `${value} is out of range (it would draw ${c})` }];
  }
  if (typeof value === "string") {
    const max = typeof s.maxLength === "number" ? s.maxLength : DEFAULT_MAX_LENGTH;
    return value.length > max
      ? [{ path: at, reason: `is ${value.length} letters, at most ${max}` }]
      : [];
  }
  if (value && typeof value === "object") {
    const props = (s.properties ?? {}) as Record<string, unknown>;
    return Object.entries(value as J).flatMap(([k, v]) =>
      UNSAFE_KEYS.has(k)
        ? [{ path: path ? `${path}.${k}` : k, reason: "is not a parameter" }]
        : boundsRefusals(props[k] ?? s.additionalProperties, v, path ? `${path}.${k}` : k),
    );
  }
  return [];
}

/** Each visible text drawn off the slide or below the foot rule, as "words @x,y". */
function wordsOffSlide(svg: Element, foot: Element | null): string[] {
  const out: string[] = [];
  const walk = (el: Element, m: M) => {
    const tag = el.tagName.toLowerCase();
    if (SKIP_TAGS.includes(tag) || el === foot) return;
    if (el.classList.contains("off") || el.classList.contains("live")) return;
    const mm = mul(m, parseTransform(el.getAttribute("transform")));
    if (tag === "text") {
      const words = (el.textContent ?? "").trim();
      const pts = words ? ownPoints(el) : undefined;
      if (pts?.length) {
        const t = pts.map(([x, y]) => [
          mm[0] * x + mm[2] * y + mm[4],
          mm[1] * x + mm[3] * y + mm[5],
        ]);
        const xs = t.map((p) => p[0] as number);
        const ys = t.map((p) => p[1] as number);
        if (
          Math.min(...xs) < -2 ||
          Math.max(...xs) > W + 2 ||
          Math.min(...ys) < -2 ||
          Math.max(...ys) > FOOT + 4
        )
          out.push(
            `${words.slice(0, 40)} @${Math.round(Math.min(...xs))},${Math.round(Math.min(...ys))}`,
          );
      }
      return;
    }
    for (const c of el.children) walk(c, mm);
  };
  for (const c of svg.children) walk(c, ID);
  return out;
}

const SVG_URL = "data:image/svg+xml;charset=utf-8,";
const PAD = 18;

/**
 * Draws model `id` with checked params at its last build. With `step` (a question slide's last
 * build before the answer) the marks after it are the answer, hidden until the slide's reveal. Throws when the model is unknown, the kit throws, nothing is drawn or
 * the drawing is too heavy for a slide: the caller falls back to the drawer.
 */
export async function renderLibraryModel(
  id: string,
  params: J,
  opts: { step?: number } = {},
): Promise<LibraryDrawing> {
  const model = await loadModel(id);
  if (!model) throw new Error(`no library model ${id}`);
  const k = await kit();
  return withDom(({ host }) => {
    // The slide's heading is the title: the drawing carries none. Params out of bounds are refused
    // (the caller falls back to the drawer), never clamped into a different number.
    const bad = boundsRefusals(model.params, params);
    if (bad.length)
      throw new Error(
        `${id}: ${bad
          .map((r) => `${r.path} ${r.reason}`)
          .join("; ")
          .slice(0, 200)}`,
      );
    const P = { ...params, title: "" };
    const stage = k.mountSlide(host, model, P, { theme: "primary" });
    try {
      const svg = stage.svg;
      // A question slide (TEACH-247 part i): the drawing as it ends, with the answer held back
      // until the slide's answer is revealed. Marks the question shows and the answer replaces
      // (a pile before it is shared) are restored and leave on the reveal (`data-qn`).
      const q = opts.step;
      if (q !== undefined)
        for (const el of [...svg.querySelectorAll("[data-h]")]) {
          const hide = Number(el.getAttribute("data-h"));
          if (hide > q && !(Number(el.getAttribute("data-s") ?? 0) > q)) {
            el.classList.remove("off");
            el.setAttribute("data-qn", "1");
          }
        }
      const root = svg.firstElementChild;
      const foot = (root?.children[2] as Element | undefined) ?? null;
      const box = drawnBox(svg, foot);
      const offSlide = wordsOffSlide(svg, foot);
      const y0 = Math.max(0, Math.min(box ? box.y0 - PAD : STAGE_TOP, FOOT));
      const x0 = Math.max(0, box ? box.x0 - PAD : 0);
      const x1 = Math.min(W, box ? box.x1 + PAD : W);
      const y1 = Math.min(FOOT, box ? box.y1 + PAD : FOOT);
      const w = Math.round(x1 - x0);
      const h = Math.round(y1 - y0);
      if (w < 40 || h < 40) throw new Error(`${id} drew nothing to show`);
      const out = svg.cloneNode(true) as Element;
      const oroot = out.firstElementChild;
      oroot?.children[2]?.remove();
      for (const el of [...out.querySelectorAll(".off,.grain")]) el.remove();
      // The answer: every mark first shown after the question's build.
      if (q !== undefined)
        for (const el of [...out.querySelectorAll("[data-s]")])
          if (Number(el.getAttribute("data-s")) > q) el.setAttribute("data-reveal", "1");
      // A library model is a still (TEACH-247 part i): its builds start from an empty frame, so
      // Present would open on a blank box. Every surface shows the drawing as it ends (on a
      // question slide, without its answer until the reveal).
      for (const el of [...out.querySelectorAll("[data-s]")]) el.removeAttribute("data-s");
      for (const el of [...out.querySelectorAll("[data-h]")]) el.removeAttribute("data-h");
      // Builds left on hidden marks only make Present wait on nothing.
      out.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      out.setAttribute("class", "slide tk theme-primary");
      out.setAttribute("viewBox", `${Math.round(x0)} ${Math.round(y0)} ${w} ${h}`);
      out.setAttribute("width", String(w));
      out.setAttribute("height", String(h));
      out.removeAttribute("aria-label");
      // The answer is hidden unless a reveal says otherwise (`svgAtBuild` with `answer`), so the
      // editor, thumbnails and exports show the question, as the drawer's question slides do.
      const hold = q !== undefined ? `<style>${REVEAL_HIDDEN}</style>` : "";
      const style = `<style><![CDATA[${SVG_CSS}]]></style>${hold}`;
      const html = out.outerHTML.replace(/&nbsp;/g, "&#160;");
      const open = /<svg\b[^>]*>/.exec(html);
      if (!open) throw new Error(`${id} did not serialise`);
      const at = open.index + open[0].length;
      const text = html.slice(0, at) + style + html.slice(at);
      const bytes = Buffer.byteLength(text);
      if (bytes > MAX_SVG_BYTES)
        throw new Error(`${id} drew ${bytes} bytes, over the slide's limit`);
      let builds = 0;
      for (const m of text.matchAll(/ data-s="(\d+)"/g)) builds = Math.max(builds, Number(m[1]));
      return {
        src: `${SVG_URL}${encodeURIComponent(text)}`,
        svg: text,
        aspect: Math.round((w / h) * 1000) / 1000,
        builds,
        alt: stage.alt ?? model.meta.name,
        warnings: stage.warnings ?? [],
        bytes,
        offSlide,
      };
    } finally {
      stage.destroy();
    }
  });
}

/** One run of words in a drawn SVG: its type size and box in view-box units, after transforms. */
export type DrawnWords = {
  words: string;
  fs: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

/**
 * Reads a drawn library SVG back (the string a slide's image element carries): its view box and
 * every text's size and box, measured as the draw measured them. For checks on real slides.
 */
export function inspectDrawnSvg(svgText: string): {
  viewBox: [number, number, number, number];
  words: DrawnWords[];
} {
  return withDom(({ win, host }) => {
    // The first <style> is the embedded font and theme (CDATA, which happy-dom's parsers reject);
    // the kit's tokens are already in this document, and a model's own <style> is kept.
    // happy-dom's HTML parser loses the drawing after an inline <style>, so a model's own rules go
    // in the document's head while it is read, and every <style> leaves the markup.
    const own = [...svgText.matchAll(/<style>(?!\s*<!\[CDATA\[)([\s\S]*?)<\/style>/g)].map(
      (m) => m[1],
    );
    const sheet = win.document.createElement("style");
    sheet.textContent = own.join("\n");
    win.document.head.appendChild(sheet);
    host.innerHTML = svgText.replace(/<style>[\s\S]*?<\/style>/g, "");
    const svg = host.querySelector("svg");
    const vb = (svg?.getAttribute("viewBox") ?? "0 0 0 0").split(/[\s,]+/).map(Number);
    const words: DrawnWords[] = [];
    for (const el of svg ? [...svg.querySelectorAll("text")] : []) {
      let mm: M = ID;
      for (let e: Element | null = el as unknown as Element; e && e !== svg; e = e.parentElement)
        mm = mul(parseTransform(e.getAttribute("transform")), mm);
      const w = (el.textContent ?? "").trim();
      const pts = w ? ownPoints(el as unknown as Element) : undefined;
      if (!pts?.length) continue;
      const t = pts.map(([x, y]) => [mm[0] * x + mm[2] * y + mm[4], mm[1] * x + mm[3] * y + mm[5]]);
      const xs = t.map((p) => p[0] as number);
      const ys = t.map((p) => p[1] as number);
      const scale = Math.sqrt(Math.abs(mm[0] * mm[3] - mm[1] * mm[2])) || 1;
      words.push({
        words: w,
        fs: typeOf(el as unknown as Element).fs * scale,
        x0: Math.min(...xs),
        y0: Math.min(...ys),
        x1: Math.max(...xs),
        y1: Math.max(...ys),
      });
    }
    host.innerHTML = "";
    sheet.remove();
    return { viewBox: [vb[0] ?? 0, vb[1] ?? 0, vb[2] ?? 0, vb[3] ?? 0], words };
  });
}
