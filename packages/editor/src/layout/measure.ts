import type { RichDoc, TextPreset, TextStyle, Theme } from "@tj/domain/documents";
import type { CSSProperties } from "react";
import { resolveTextStyle, type TextRole, textTypeCss, withAlpha } from "../slide/elements/kit";
import { renderDocHTML } from "../text/static";
import type { MeasureInput, Measurer } from "./reflow";

/**
 * Text fitting engine — the ruler (TeachDeck `lib/layout/measure.ts`).
 *
 * Measures a rich doc the only way that can be trusted: by laying it out in the browser, in a
 * hidden node that carries the *renderer's own* markup, classes and inline type styles.
 * `renderDocHTML` produces the same HTML `RichText` renders, the node carries the same `td-rt`
 * class and `data-slide-root` context (so `slide.css` applies — `editor.css` must be loaded, as
 * every document page does), and the type comes from the same `resolveTextStyle` / `textTypeCss`
 * pair `StaticText` uses — so a measurement and a render cannot disagree.
 *
 * Cheap enough for every tidy and lint: one reflow per batch (`measureMany`), a `WeakMap` cache
 * keyed by doc identity + width + font signature, and a font signature so results taken before
 * `document.fonts.ready` are thrown away the moment the real faces land.
 */

export type { MeasureInput, Measurer };

/* ---- font gate ---- */

let fontsReady = false;
let fontEpoch = 0;

/** Cache key component: results taken with fallback faces must not outlive them. */
const fontSignature = () => (fontsReady ? `f${fontEpoch}` : "loading");

/**
 * Resolves once the theme faces are usable. Callers that can afford to wait should await this
 * before measuring; those that cannot get a `loading` result re-measured for free afterwards.
 */
export async function whenFontsReady(): Promise<void> {
  if (fontsReady) return;
  try {
    if (typeof document !== "undefined" && document.fonts) await document.fonts.ready;
  } catch {
    /* No font loading API: the fallback stack is what we get, and it is stable. */
  }
  fontsReady = true;
  fontEpoch += 1;
  cache = new WeakMap();
}

/* ---- cache ---- */

type Entry = { height: number };
let cache = new WeakMap<RichDoc, Map<string, Entry>>();

function cacheKey(
  input: MeasureInput,
  size: number,
  lineHeight: number,
  family: string,
  weight: number,
): string {
  return [
    fontSignature(),
    Math.round(input.width * 100) / 100,
    Math.round(input.inset * 100) / 100,
    Math.round(input.chrome * 100) / 100,
    size,
    lineHeight,
    weight,
    input.preset,
    input.role ?? "",
    input.style?.align ?? "",
    family,
  ].join("|");
}

export function clearMeasureCache(): void {
  cache = new WeakMap();
}

/* ---- host ---- */

let host: HTMLDivElement | null = null;

/**
 * One hidden 1:1 host for the whole app. `visibility: hidden` rather than `display: none` — a
 * display:none subtree has no layout — and parked off-screen so it can never paint or take a hit.
 */
function getHost(): HTMLDivElement {
  if (host?.isConnected) return host;
  const node = document.createElement("div");
  node.setAttribute("data-slide-root", "");
  node.setAttribute("data-tj-measure", "");
  node.setAttribute("aria-hidden", "true");
  node.style.cssText =
    "position:fixed;left:-10000px;top:0;width:0;height:0;visibility:hidden;pointer-events:none;z-index:-1;contain:layout style;";
  document.body.appendChild(node);
  host = node;
  return node;
}

/** The theme tokens `slide.css` reads (the same set `SlideView` sets on its root). */
function applyTheme(node: HTMLElement, theme: Theme): void {
  node.style.setProperty("--td-ink", theme.colors.ink);
  node.style.setProperty("--td-muted", theme.colors.muted);
  node.style.setProperty("--td-accent", theme.colors.accent);
  node.style.setProperty("--td-accent2", theme.colors.accent2);
  node.style.setProperty("--td-accent-soft", withAlpha(theme.colors.accent, 0.18));
  node.style.setProperty("--td-line", theme.colors.line);
  node.style.setProperty("--td-surface", theme.colors.surface);
}

const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** `textTypeCss` output onto a real node. Only `fontSize` carries a unit. */
function applyType(node: HTMLElement, css: CSSProperties): void {
  for (const [key, value] of Object.entries(css)) {
    if (value == null) continue;
    if (key.startsWith("--")) node.style.setProperty(key, String(value));
    else if (key === "fontSize") node.style.fontSize = `${value}px`;
    else node.style.setProperty(kebab(key), String(value));
  }
}

/**
 * One measuring cell: the wrapper `StaticText` puts the ref on, holding the same `td-rt` body
 * `RichText` renders. Reading `scrollHeight` off the wrapper is exactly what `use-auto-height`
 * does at render time.
 */
function buildCell(input: MeasureInput, theme: Theme): HTMLDivElement {
  const r = resolveTextStyle(input.style, theme, input.preset, input.role);
  const size = input.fontSize ?? r.fontSize;
  const cell = document.createElement("div");
  cell.style.cssText = `width:${Math.max(1, input.width - input.inset)}px;flex:0 0 auto;`;
  const body = document.createElement("div");
  body.className = "td-rt";
  applyType(body, textTypeCss(r));
  body.style.fontSize = `${size}px`;
  body.innerHTML = renderDocHTML(input.doc);
  cell.appendChild(body);
  return cell;
}

/* ---- measuring ---- */

const canMeasure = () => typeof document !== "undefined" && !!document.body;

/**
 * Deterministic fallback for SSR, tests and the split second before `document.body` exists.
 * ~0.5em average advance is the estimate research/04 §4 uses for the same job.
 */
function estimate(input: MeasureInput, size: number, lineHeight: number): number {
  const width = Math.max(1, input.width - input.inset);
  const perLine = Math.max(1, Math.floor(width / (size * 0.5)));
  const text = plain(input.doc);
  const lines = text
    .split("\n")
    .reduce((n, para) => n + Math.max(1, Math.ceil(para.length / perLine)), 0);
  return Math.ceil(lines * size * lineHeight + input.chrome);
}

type Walkable = { type?: string; text?: string; content?: Walkable[] };

function plain(doc: RichDoc): string {
  const out: string[] = [];
  const walk = (n: Walkable) => {
    if (n.text) out.push(n.text);
    n.content?.forEach(walk);
    if (n.type === "paragraph" || n.type === "listItem") out.push("\n");
  };
  walk(doc as Walkable);
  return out.join("");
}

/**
 * Measure a batch in one reflow: every cell is written, layout is forced once, then every height
 * is read. Cache hits never touch the DOM.
 */
export function measureMany(inputs: MeasureInput[], theme: Theme): number[] {
  const results = new Array<number>(inputs.length);
  const pending: { i: number; cell: HTMLDivElement; key: string; doc: RichDoc; chrome: number }[] =
    [];

  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i];
    if (!input) continue;
    const r = resolveTextStyle(input.style, theme, input.preset, input.role);
    const size = input.fontSize ?? r.fontSize;
    const key = cacheKey(input, size, r.lineHeight, r.fontFamily, r.fontWeight);
    const hit = cache.get(input.doc)?.get(key);
    if (hit) {
      results[i] = hit.height;
      continue;
    }
    if (!canMeasure()) {
      results[i] = estimate(input, size, r.lineHeight);
      continue;
    }
    pending.push({ i, cell: buildCell(input, theme), key, doc: input.doc, chrome: input.chrome });
  }

  if (pending.length === 0) return results;

  const node = getHost();
  applyTheme(node, theme);
  for (const p of pending) node.appendChild(p.cell);
  // One synchronous layout for the whole batch.
  void node.offsetHeight;
  for (const p of pending) {
    // `Math.round`, matching `use-auto-height` exactly: the two must agree to the point, or the
    // renderer will rewrite every height the engine just stored.
    const height = Math.round(p.cell.scrollHeight + p.chrome);
    results[p.i] = height;
    let bucket = cache.get(p.doc);
    if (!bucket) {
      bucket = new Map();
      cache.set(p.doc, bucket);
    }
    bucket.set(p.key, { height });
  }
  for (const p of pending) p.cell.remove();

  return results;
}

/** Height in slide points a doc needs at a given width. */
export function measureDocHeight(
  doc: RichDoc,
  opts: {
    width: number;
    theme: Theme;
    preset?: TextPreset;
    role?: TextRole;
    style?: Partial<TextStyle> | TextStyle;
    fontSize?: number;
    inset?: number;
    chrome?: number;
  },
): number {
  return (
    measureMany(
      [
        {
          doc,
          width: opts.width,
          style: opts.style,
          preset: opts.preset ?? opts.style?.preset ?? "body",
          role: opts.role,
          fontSize: opts.fontSize,
          inset: opts.inset ?? 0,
          chrome: opts.chrome ?? 0,
        },
      ],
      opts.theme,
    )[0] ?? 0
  );
}

/**
 * Number of rendered line boxes, counted from the client rects of a range over the laid-out text
 * rather than divided out of the height.
 */
export function measureLines(
  doc: RichDoc,
  opts: {
    width: number;
    theme: Theme;
    preset?: TextPreset;
    role?: TextRole;
    style?: Partial<TextStyle> | TextStyle;
    fontSize?: number;
    inset?: number;
  },
): number {
  const input: MeasureInput = {
    doc,
    width: opts.width,
    style: opts.style,
    preset: opts.preset ?? opts.style?.preset ?? "body",
    role: opts.role,
    fontSize: opts.fontSize,
    inset: opts.inset ?? 0,
    chrome: 0,
  };
  const r = resolveTextStyle(input.style, opts.theme, input.preset, input.role);
  const size = input.fontSize ?? r.fontSize;
  if (!canMeasure()) {
    return Math.max(1, Math.round(estimate(input, size, r.lineHeight) / (size * r.lineHeight)));
  }

  const node = getHost();
  applyTheme(node, opts.theme);
  const cell = buildCell(input, opts.theme);
  node.appendChild(cell);
  let lines = 0;
  try {
    const range = document.createRange();
    range.selectNodeContents(cell);
    const tops = new Set<number>();
    for (const box of Array.from(range.getClientRects())) {
      if (box.height < 1) continue;
      tops.add(Math.round(box.top * 2) / 2);
    }
    lines = tops.size;
  } finally {
    cell.remove();
  }
  return Math.max(1, lines);
}

/** A `Measurer` bound to a theme — the shape `reflowSlide` and `lint.ts` consume. */
export function createMeasurer(theme: Theme): Measurer {
  return (input) => measureMany([input], theme)[0] ?? 0;
}

/** Batched measurer: pre-warms the cache for a whole slide in one reflow. */
export function warmMeasurer(inputs: MeasureInput[], theme: Theme): void {
  if (inputs.length) measureMany(inputs, theme);
}
