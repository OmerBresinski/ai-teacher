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
/** Fetched faces by file URL; a failed fetch is remembered as `null` so it is not retried. */
let loaded = new Map<string, EmbeddedFace | null>();
let loading = new Map<string, Promise<void>>();
/** Fonted data URLs by source; bounded, oldest out first. */
let fonted = new Map<string, string>();
const FONTED_MAX = 200;

/** Tests swap in a fake source; `undefined` goes back to the page's stylesheets. Clears caches. */
export function setDiagramFontSource(next: FontSource | undefined): void {
  source = next ?? pageSource();
  loaded = new Map();
  loading = new Map();
  fonted = new Map();
}

const SVG_PREFIX = "data:image/svg+xml";

function needed(svg: string): FaceRule[] {
  try {
    return neededFaces(svg, source.rules());
  } catch {
    return [];
  }
}

function load(rule: FaceRule): Promise<void> {
  const known = loading.get(rule.url);
  if (known) return known;
  const { url, ...face } = rule;
  const p = source
    .fetchBase64(url)
    .then((woff2Base64) => {
      loaded.set(url, { ...face, woff2Base64 });
    })
    .catch(() => {
      loaded.set(url, null);
    });
  loading.set(url, p);
  return p;
}

/**
 * `src` with its fonts embedded, when every face it needs has been fetched; `src` itself when it is
 * not a drawn SVG or needs nothing; `undefined` while a face is still to fetch.
 */
export function diagramFontsNow(src: string): string | undefined {
  if (!src.startsWith(SVG_PREFIX)) return src;
  const hit = fonted.get(src);
  if (hit !== undefined) return hit;
  const svg = svgOfDataUrl(src);
  if (!svg) return src;
  const rules = needed(svg);
  if (rules.some((r) => !loaded.has(r.url))) return undefined;
  const faces = rules.flatMap((r) => {
    const f = loaded.get(r.url);
    return f ? [{ ...f, family: r.family }] : [];
  });
  const out = faces.length ? builtSvgDataUrl(svgWithFonts(svg, faces)) : src;
  if (fonted.size >= FONTED_MAX) fonted.delete(fonted.keys().next().value as string);
  fonted.set(src, out);
  return out;
}

/** `src` with its fonts embedded once they are fetched; never rejects, `src` on any failure. */
export async function withDiagramFonts(src: string): Promise<string> {
  try {
    const now = diagramFontsNow(src);
    if (now !== undefined) return now;
    const svg = svgOfDataUrl(src);
    if (!svg) return src;
    await Promise.all(needed(svg).map(load));
    return diagramFontsNow(src) ?? src;
  } catch {
    return src;
  }
}

/** Resolves once every face fetch started so far has finished (print and capture wait on it). */
export async function diagramFontsSettled(): Promise<void> {
  await Promise.all(loading.values());
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
