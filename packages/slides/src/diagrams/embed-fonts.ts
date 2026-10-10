/**
 * A drawn diagram's own fonts, embedded at display time. A diagram is an SVG shown through `<img>`
 * (and drawn to a canvas for PPTX), and an SVG image cannot reach the page's web fonts: its words
 * fell back to Verdana or Trebuchet MS, wider than the theme face the drawer measured them in
 * (`svg.ts` `textWidth`), so labels that fit on paper collided on screen ("Marching" on Splash).
 *
 * The stored SVG keeps naming its family and nothing else (a lesson stays small); each surface
 * passes it through `svgWithFonts` with the faces the page already loads, and only the faces the
 * drawing names and the unicode-range subsets its words use go in. Pure string work: never throws.
 */

/** One `@font-face` the page loads, its file as base64 woff2. */
export type EmbeddedFace = {
  family: string;
  /** CSS `font-weight`, e.g. "200 1000" for a variable face. */
  weight?: string;
  style?: string;
  /** CSS `unicode-range`; unset: every character. */
  unicodeRange?: string;
  woff2Base64: string;
};

const unquote = (s: string) =>
  s
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .trim();

/** Every family a drawing names in a `font-family` attribute or declaration, in order, once each. */
export function svgFontFamilies(svg: string): string[] {
  const out: string[] = [];
  try {
    const stacks = [
      ...Array.from(svg.matchAll(/font-family="([^"]*)"/g), (m) => m[1] ?? ""),
      ...Array.from(svg.matchAll(/font-family='([^']*)'/g), (m) => m[1] ?? ""),
      ...Array.from(svg.matchAll(/font-family\s*:\s*([^;}<]*)/g), (m) => m[1] ?? ""),
    ];
    for (const stack of stacks)
      for (const part of stack.split(",")) {
        const name = unquote(part.replace(/&quot;|&#39;|&apos;/g, "'"));
        if (name && !out.includes(name)) out.push(name);
      }
  } catch {
    /* a malformed drawing names nothing */
  }
  return out;
}

const ENTITY: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/** The characters a drawing's text nodes set (entities decoded). */
function textChars(svg: string): Set<number> {
  const chars = new Set<number>();
  for (const m of svg.matchAll(/>([^<]+)</g)) {
    const text = (m[1] ?? "").replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (all, e: string) => {
      if (e[0] !== "#") return ENTITY[e.toLowerCase()] ?? all;
      const code =
        e[1] === "x" || e[1] === "X" ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1));
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : "";
    });
    for (const ch of text) chars.add(ch.codePointAt(0) ?? 0);
  }
  return chars;
}

/** Whether a CSS `unicode-range` covers any of `chars`; an unreadable range counts as covering. */
function rangeCovers(range: string | undefined, chars: Set<number>): boolean {
  if (!range) return true;
  const spans: [number, number][] = [];
  for (const raw of range.split(",")) {
    const m = /^\s*U\+([0-9a-f?]+)(?:-([0-9a-f]+))?\s*$/i.exec(raw);
    if (!m?.[1]) return true;
    const lo = Number.parseInt(m[1].replace(/\?/g, "0"), 16);
    const hi = Number.parseInt(m[2] ?? m[1].replace(/\?/g, "f"), 16);
    spans.push([lo, hi]);
  }
  for (const c of chars) if (spans.some(([lo, hi]) => c >= lo && c <= hi)) return true;
  return false;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whether the drawing already carries an `@font-face` for `family` (a library model's Lexend). */
const embeds = (svg: string, family: string) =>
  new RegExp(
    `@font-face\\s*\\{[^}]*font-family\\s*:\\s*["']?${escapeRe(family)}["']?\\s*[;}]`,
  ).test(svg);

/**
 * Of `faces`, the ones `svg` needs: its family is named and not embedded already, and its
 * unicode-range covers a character the drawing sets. A page's loader fetches only these.
 */
export function neededFaces<T extends { family: string; unicodeRange?: string }>(
  svg: string,
  faces: readonly T[],
): T[] {
  try {
    const named = new Set(svgFontFamilies(svg).filter((f) => !embeds(svg, f)));
    if (!named.size) return [];
    const chars = textChars(svg);
    return faces.filter((f) => named.has(f.family) && rangeCovers(f.unicodeRange, chars));
  } catch {
    return [];
  }
}

const faceCss = (f: EmbeddedFace) =>
  `@font-face{font-family:"${f.family.replace(/"/g, "")}";font-style:${f.style ?? "normal"};` +
  `${f.weight ? `font-weight:${f.weight};` : ""}` +
  `src:url(data:font/woff2;base64,${f.woff2Base64}) format("woff2")` +
  `${f.unicodeRange ? `;unicode-range:${f.unicodeRange}` : ""}}`;

/**
 * `svg` with an `@font-face` for each of `faces` whose family it names (and has not embedded
 * already) and whose unicode-range one of its characters needs, in a `<style>` right after the
 * opening tag. Unchanged when nothing applies.
 */
export function svgWithFonts(svg: string, faces: readonly EmbeddedFace[]): string {
  try {
    if (!faces.length) return svg;
    const open = /<svg\b[^>]*>/.exec(svg);
    if (!open) return svg;
    const css = neededFaces(svg, faces).map(faceCss);
    if (!css.length) return svg;
    const end = open.index + open[0].length;
    return `${svg.slice(0, end)}<style>${css.join("")}</style>${svg.slice(end)}`;
  } catch {
    return svg;
  }
}
