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
const CLASS_TYPE = new Map<string, { size?: string; weight?: string }>();
for (const [, cls, body] of PLAIN_CSS.matchAll(/\.slide \.([\w-]+)\s*\{([^}]*)\}/g)) {
  const size = /font-size:\s*([^;]+);/.exec(body ?? "")?.[1]?.trim();
  const weight = /font-weight:\s*([^;]+);/.exec(body ?? "")?.[1]?.trim();
  if (size || weight) CLASS_TYPE.set(cls as string, { size, weight });
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
      const t = CLASS_TYPE.get(c);
      if (fs === undefined && t?.size) fs = resolve(t.size) || undefined;
      if (weight === undefined && t?.weight) weight = resolve(t.weight) || undefined;
    }
    if (e.tagName.toLowerCase() === "svg") break;
  }
  return { fs: fs ?? 16, weight: weight ?? (resolve("var(--w-body)") || 500) };
}

/** Width of a text element in slide units: Lexend advances (the primary theme's only family). */
function textLength(el: Element): number {
  const { fs, weight } = typeOf(el);
  return textWidth(el.textContent ?? "", { stack: FONT_STACKS.lexend } as never, fs, weight);
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

/** The points of a path's outline (control points included: a box that errs wide). */
function pathPoints(d: string): [number, number][] {
  const out: [number, number][] = [];
  const toks = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) ?? [];
  let cmd = "M";
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  let i = 0;
  const n = () => Number(toks[i++]);
  while (i < toks.length) {
    if (/[a-zA-Z]/.test(toks[i] ?? "")) cmd = toks[i++] as string;
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    if (C === "Z") {
      x = sx;
      y = sy;
      if (i < toks.length && !/[a-zA-Z]/.test(toks[i] ?? "")) i++;
      continue;
    }
    const pairs = { M: 1, L: 1, T: 1, C: 3, S: 2, Q: 2 }[C as "M"];
    if (pairs) {
      for (let p = 0; p < pairs; p++) {
        const px = n() + (rel ? x : 0);
        const py = n() + (rel ? y : 0);
        out.push([px, py]);
        if (p === pairs - 1) {
          x = px;
          y = py;
        }
      }
      if (C === "M") {
        sx = x;
        sy = y;
        cmd = rel ? "l" : "L";
      }
    } else if (C === "H") {
      x = n() + (rel ? x : 0);
      out.push([x, y]);
    } else if (C === "V") {
      y = n() + (rel ? y : 0);
      out.push([x, y]);
    } else if (C === "A") {
      const rx = Math.abs(n());
      const ry = Math.abs(n());
      i += 3;
      const px = n() + (rel ? x : 0);
      const py = n() + (rel ? y : 0);
      out.push([x - rx, y - ry], [px + rx, py + ry], [px - rx, py - ry], [x + rx, y + ry]);
      x = px;
      y = py;
    } else i++;
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
};

const SVG_URL = "data:image/svg+xml;charset=utf-8,";
const PAD = 18;

/**
 * Draws model `id` with checked params at its last build (or at `step`, a question slide's last
 * build before the answer). Throws when the model is unknown, the kit throws, nothing is drawn or
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
    // The slide's heading is the title: the drawing carries none.
    const P = { ...params, title: "" };
    const stage = k.mountSlide(host, model, P, { theme: "primary" });
    try {
      if (opts.step !== undefined) stage.show(opts.step, true);
      const svg = stage.svg;
      const root = svg.firstElementChild;
      const foot = (root?.children[2] as Element | undefined) ?? null;
      const box = drawnBox(svg, foot);
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
      // Builds left on hidden marks only make Present wait on nothing.
      out.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      out.setAttribute("class", "slide tk theme-primary");
      out.setAttribute("viewBox", `${Math.round(x0)} ${Math.round(y0)} ${w} ${h}`);
      out.setAttribute("width", String(w));
      out.setAttribute("height", String(h));
      out.removeAttribute("aria-label");
      const style = `<style><![CDATA[${SVG_CSS}]]></style>`;
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
      };
    } finally {
      stage.destroy();
    }
  });
}
