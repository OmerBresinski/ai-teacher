import {
  builtSvgDataUrl,
  type EmbeddedFace,
  neededFaces,
  svgOfDataUrl,
  svgWithFonts,
} from "@tj/slides/diagram-builds";
import { useEffect, useState } from "react";

/**
 * A drawn diagram's words in the face the drawer measured them in, on every surface. The stored
 * SVG names its theme family ("Nunito Variable"); an SVG shown through `<img>` or drawn to a canvas
 * cannot reach the page's web fonts, so it fell back to Verdana and its labels collided. Here the
 * page's own `@font-face` rules (`styles/fonts.css`, `fonts-playful.css`) are read, the woff2 files
 * the drawing needs are fetched once (the same files the page loads, usually from cache) and
 * embedded as base64 for display and export only. Nothing is added to a stored lesson and no font
 * data ships in the bundle. `ImageView` (editor, Present, thumbnails, print, PNG) and the PPTX
 * exporter go through this one module.
 */

/** One `@font-face` the page declares, its woff2 file not yet fetched. */
export type FaceRule = Omit<EmbeddedFace, "woff2Base64"> & { url: string };

/** Where the faces come from: the page's stylesheets in the app, a fake in tests. */
export type FontSource = {
  rules(): FaceRule[];
  fetchBase64(url: string): Promise<string>;
};

/* ------------------------------------------------------------------ */
/* The page's stylesheets                                              */
/* ------------------------------------------------------------------ */

const woff2Url = (src: string, base: string): string | undefined => {
  for (const m of src.matchAll(
    /url\(\s*(["']?)([^"')]+)\1\s*\)\s*(?:format\(\s*["']?([^"')]+))?/g,
  )) {
    const url = m[2] ?? "";
    if (
      /woff2/.test(m[3] ?? "") ||
      /\.woff2(?:[?#]|$)/.test(url) ||
      url.startsWith("data:font/woff2")
    )
      try {
        return new URL(url, base).href;
      } catch {
        return undefined;
      }
  }
  return undefined;
};

function collect(rules: CSSRuleList, base: string, out: FaceRule[]): void {
  for (const rule of Array.from(rules)) {
    if (rule.constructor.name === "CSSFontFaceRule" || rule.type === 5) {
      const style = (rule as CSSFontFaceRule).style;
      const family = style
        .getPropertyValue("font-family")
        .trim()
        .replace(/^['"]|['"]$/g, "");
      const url = woff2Url(style.getPropertyValue("src"), base);
      if (!family || !url) continue;
      const weight = style.getPropertyValue("font-weight").trim();
      const fontStyle = style.getPropertyValue("font-style").trim();
      const range = style.getPropertyValue("unicode-range").trim();
      out.push({
        family,
        url,
        ...(weight ? { weight } : {}),
        ...(fontStyle ? { style: fontStyle } : {}),
        ...(range ? { unicodeRange: range.replace(/\s+/g, "") } : {}),
      });
      continue;
    }
    const sheet = (rule as CSSImportRule).styleSheet;
    if (sheet) readSheet(sheet, out);
    const inner = (rule as CSSGroupingRule).cssRules;
    if (inner) collect(inner, base, out);
  }
}

function readSheet(sheet: CSSStyleSheet, out: FaceRule[]): void {
  try {
    collect(sheet.cssRules, sheet.href ?? document.baseURI, out);
  } catch {
    /* a cross-origin sheet cannot be read: it holds none of our faces */
  }
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** The page's own stylesheets; re-read whenever a sheet is added (the editor's CSS loads lazily). */
const pageSource = (): FontSource => {
  let seen = -1;
  let cached: FaceRule[] = [];
  return {
    rules() {
      if (typeof document === "undefined") return [];
      if (document.styleSheets.length !== seen) {
        seen = document.styleSheets.length;
        const out: FaceRule[] = [];
        for (const sheet of Array.from(document.styleSheets)) readSheet(sheet, out);
        cached = out;
      }
      return cached;
    },
    async fetchBase64(url) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`font ${res.status}`);
      return toBase64(await res.arrayBuffer());
    },
  };
};

/* ------------------------------------------------------------------ */
/* Caches                                                              */
/* ------------------------------------------------------------------ */

let source: FontSource = pageSource();
/**
 * Font data, once per woff2 file (keyed by its URL, which names the family, subset and weight
 * range). This is the only large cache: each face is held once, however many drawings use it.
 */
let loaded = new Map<string, EmbeddedFace>();
let loading = new Map<string, Promise<void>>();
/** Files whose last fetch failed, with when: retried on the next use after `RETRY_MS`. */
let failed = new Map<string, number>();
const RETRY_MS = 5_000;
/**
 * Fonted data URLs by source, a small LRU bounded by size (keys and values, in characters), so a
 * re-render or a Present build step does not rebuild the string. Evicted entries are rebuilt on
 * demand from `loaded` (about 0.2 ms).
 */
let fonted = new Map<string, string>();
let fontedSize = 0;
const FONTED_MAX_CHARS = 4_000_000;

/** Tests swap in a fake source; `undefined` goes back to the page's stylesheets. Clears caches. */
export function setDiagramFontSource(next: FontSource | undefined): void {
  source = next ?? pageSource();
  loaded = new Map();
  loading = new Map();
  failed = new Map();
  fonted = new Map();
  fontedSize = 0;
}

const SVG_PREFIX = "data:image/svg+xml";

function needed(svg: string): FaceRule[] {
  try {
    return neededFaces(svg, source.rules());
  } catch {
    return [];
  }
}

/** A failed file inside its back-off counts as settled (the drawing shows its fallback). */
const coolingDown = (url: string) => {
  const at = failed.get(url);
  return at !== undefined && Date.now() - at < RETRY_MS;
};

function load(rule: FaceRule): Promise<void> {
  const { url, ...face } = rule;
  if (loaded.has(url) || coolingDown(url)) return Promise.resolve();
  const known = loading.get(url);
  if (known) return known;
  const p = source
    .fetchBase64(url)
    .then((woff2Base64) => {
      loaded.set(url, { ...face, woff2Base64 });
      failed.delete(url);
    })
    .catch(() => {
      failed.set(url, Date.now());
    })
    .finally(() => {
      loading.delete(url);
    });
  loading.set(url, p);
  return p;
}

function remember(src: string, out: string): void {
  const size = src.length + out.length;
  if (size > FONTED_MAX_CHARS) return;
  while (fontedSize + size > FONTED_MAX_CHARS && fonted.size) {
    const [k, v] = fonted.entries().next().value as [string, string];
    fonted.delete(k);
    fontedSize -= k.length + v.length;
  }
  fonted.set(src, out);
  fontedSize += size;
}

/**
 * `src` with its fonts embedded, when every face it needs has been fetched (or has just failed and
 * is backing off); `src` itself when it is not a drawn SVG or needs nothing; `undefined` while a
 * face is still to fetch.
 */
export function diagramFontsNow(src: string): string | undefined {
  if (!src.startsWith(SVG_PREFIX)) return src;
  const hit = fonted.get(src);
  if (hit !== undefined) {
    // most recently used goes last
    fonted.delete(src);
    fonted.set(src, hit);
    return hit;
  }
  const svg = svgOfDataUrl(src);
  if (!svg) return src;
  const rules = needed(svg);
  if (rules.some((r) => !loaded.has(r.url) && !coolingDown(r.url))) return undefined;
  const faces = rules.flatMap((r) => {
    const f = loaded.get(r.url);
    return f ? [{ ...f, family: r.family }] : [];
  });
  // A drawing still waiting on a failed face is not cached, so it picks the face up on retry.
  const complete = faces.length === rules.length;
  const out = faces.length ? builtSvgDataUrl(svgWithFonts(svg, faces)) : src;
  if (complete) remember(src, out);
  return out;
}

/** `src` with its fonts embedded once they are fetched; never rejects, `src` on any failure. */
export async function withDiagramFonts(src: string): Promise<string> {
  try {
    if (!src.startsWith(SVG_PREFIX)) return src;
    const svg = svgOfDataUrl(src);
    if (!svg) return src;
    await Promise.all(needed(svg).map(load));
    return diagramFontsNow(src) ?? src;
  } catch {
    return src;
  }
}

/** Every drawn diagram's `src` in `elements`, group children included. */
function diagramSrcs(elements: readonly unknown[], out: string[]): string[] {
  for (const el of elements) {
    if (!el || typeof el !== "object") continue;
    const e = el as { type?: unknown; src?: unknown; children?: unknown };
    if (e.type === "image" && typeof e.src === "string" && e.src.startsWith(SVG_PREFIX))
      out.push(e.src);
    if (Array.isArray(e.children)) diagramSrcs(e.children, out);
  }
  return out;
}

/**
 * Starts and awaits the font fetches every drawn diagram on `slides` needs, before anything is
 * mounted: after it resolves, `ImageView` renders those diagrams fonted on its first render. Print,
 * PNG and PDF capture call it with the slides they are about to capture. Never rejects.
 */
export async function prepareDiagramFonts(
  slides: readonly { elements: readonly unknown[] }[],
): Promise<void> {
  const srcs = new Set(slides.flatMap((s) => diagramSrcs(s.elements, [])));
  await Promise.all(Array.from(srcs, withDiagramFonts));
}

const frame = () =>
  new Promise<void>((resolve) =>
    typeof requestAnimationFrame === "function"
      ? requestAnimationFrame(() => resolve())
      : setTimeout(resolve, 16),
  );

/**
 * Every drawn diagram `<img>` under `root` showing its fonted source. Starts the fetches itself
 * from the srcs in the DOM (so it does not depend on `ImageView`'s effect having run), then waits a
 * few frames for React to commit the fonted src. Never rejects; gives up after `maxFrames`.
 */
export async function diagramImagesReady(root: ParentNode, maxFrames = 30): Promise<void> {
  const imgs = () =>
    Array.from(root.querySelectorAll<HTMLImageElement>(`img[src^="${SVG_PREFIX}"]`));
  await Promise.all(imgs().map((img) => withDiagramFonts(img.getAttribute("src") ?? "")));
  for (let i = 0; i < maxFrames; i++) {
    const pending = imgs().some((img) => {
      const src = img.getAttribute("src") ?? "";
      return diagramFontsNow(src) !== src;
    });
    if (!pending) return;
    await frame();
  }
}

/**
 * `src` as an `<img>` should show it: the fonted drawing as soon as its faces are in (at once when
 * they already are, so a Present build step never flashes the fallback), `src` until then.
 */
export function useDiagramFonts(src: string): string {
  const now = diagramFontsNow(src);
  const [late, setLate] = useState<{ src: string; out: string } | null>(null);
  useEffect(() => {
    if (now !== undefined) return;
    let live = true;
    void withDiagramFonts(src).then((out) => {
      if (live) setLate({ src, out });
    });
    return () => {
      live = false;
    };
  }, [src, now]);
  return now ?? (late?.src === src ? late.out : src);
}
