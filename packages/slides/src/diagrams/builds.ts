/**
 * Diagram builds (TEACH-247 part b, ruling 180): a drawing's parts are shown one per Next in Present.
 *
 * While `withBuilds` runs, a renderer wraps each part in `<g data-s="k">` (shown from build k; build 0
 * is the drawing as the slide opens) and an answer part in `<g data-ans="1">` (shown only once the
 * slide's answer is revealed). A `<g>` with only data attributes carries no paint, so the tagged SVG
 * draws exactly like the untagged one everywhere else (editor, thumbnails, PDF, PPTX): they show
 * the last build. Outside `withBuilds` the tags are not written at all, so every other render is
 * byte for byte what it was.
 */
let on = false;

/** Whether renderers are writing build tags now. */
export const buildsOn = (): boolean => on;

/** `f` with build tags written. Never leaves tagging on, even when `f` throws. */
export function withBuilds<T>(f: () => T): T {
  const was = on;
  on = true;
  try {
    return f();
  } finally {
    on = was;
  }
}

/** `svg` as the part shown from build `k` (k <= 0 is shown from the start: no tag). */
export function part(k: number, svg: string): string {
  if (!on || !svg || !(k > 0)) return svg;
  return `<g data-s="${Math.round(k)}">${svg}</g>`;
}

/** `svg` as an answer part: hidden on a question slide until the answer is revealed. */
export function answerPart(svg: string): string {
  if (!on || !svg) return svg;
  return `<g data-ans="1">${svg}</g>`;
}

/** How many builds a tagged SVG has after its opening frame (0 when it has none). */
export function buildCount(svg: string): number {
  let max = 0;
  for (const m of svg.matchAll(/ data-s="(\d+)"/g)) max = Math.max(max, Number(m[1]));
  return max;
}

/** Whether a tagged SVG has an answer part. */
export const hasAnswerPart = (svg: string): boolean => / data-ans="1"/.test(svg);

/** The untagged SVG back: every build wrapper removed, byte for byte the plain render. */
export function stripBuilds(svg: string): string {
  // Wrappers never nest a different wrapper's close inside their own, so removing each opening
  // tag and one `</g>` per opening (innermost first) restores the plain markup.
  let out = svg;
  for (;;) {
    const m = /<g data-(?:s="\d+"|ans="1")>/.exec(out);
    if (!m) return out;
    // The wrapper's matching close: walk nested <g> elements from the opening.
    let depth = 0;
    let i = m.index;
    const re = /<g\b[^>]*>|<\/g>/g;
    re.lastIndex = i;
    let close = -1;
    for (let t = re.exec(out); t; t = re.exec(out)) {
      if (t[0] === "</g>") depth -= 1;
      else if (!t[0].endsWith("/>")) depth += 1;
      if (depth === 0) {
        close = t.index;
        break;
      }
    }
    if (close < 0) return out;
    i = m.index;
    out = out.slice(0, i) + out.slice(i + m[0].length, close) + out.slice(close + 4);
  }
}

/**
 * The drawing as Present shows it at build `k` (TEACH-247 part b): a `<style>` inside the SVG hides
 * parts from later builds, and answer parts until `answer`. With `motion` the parts of build `k`
 * itself rise and fade in over 0.9 s (motion tokens, ruling 179); without it (reduced motion, or
 * stepping back) every frame is static. The SVG still goes to an `<img>`, so a stored lesson's
 * markup is never inlined into the page and nothing in it can run.
 */
export function svgAtBuild(
  svg: string,
  k: number,
  opts: { answer: boolean; motion: boolean },
): string {
  const total = buildCount(svg);
  const answers = hasAnswerPart(svg);
  if (!total && !answers) return svg;
  const at = Math.max(0, Math.min(total, Math.floor(k)));
  const rules: string[] = [];
  const later = [];
  for (let s = at + 1; s <= total; s++) later.push(`[data-s="${s}"]`);
  if (later.length) rules.push(`${later.join(",")}{opacity:0}`);
  if (answers && !opts.answer) rules.push(`[data-ans="1"]{opacity:0}`);
  if (opts.motion && at > 0)
    rules.push(
      `@keyframes tj-build{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}`,
      `[data-s="${at}"]{animation:tj-build 900ms cubic-bezier(.2,.7,.2,1) both}`,
    );
  if (!rules.length) return svg;
  const open = /<svg\b[^>]*>/.exec(svg);
  if (!open) return svg;
  const end = open.index + open[0].length;
  return `${svg.slice(0, end)}<style>${rules.join("")}</style>${svg.slice(end)}`;
}

const SVG_URL = "data:image/svg+xml;charset=utf-8,";

/** The SVG inside a drawn diagram's data URL, or undefined for any other source. */
export function svgOfDataUrl(src: string): string | undefined {
  if (!src.startsWith(SVG_URL)) return undefined;
  try {
    return decodeURIComponent(src.slice(SVG_URL.length));
  } catch {
    return undefined;
  }
}

/** `svg` as the data URL an image element shows. */
export const builtSvgDataUrl = (svg: string) => `${SVG_URL}${encodeURIComponent(svg)}`;
