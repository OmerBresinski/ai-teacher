/**
 * FIDELITY VT-1, BV-1 and BV-3 (Greg, 12 Oct: "full screen should be full screen. adding extra cards
 * is bad unless for contrast reasons"). A drawn figure beside the words or across the slide stands
 * on the slide itself: a drawer's SVG is trimmed to its ink so `contain` fills the room with the
 * drawing, not its margins, and a library model's own canvas takes the slide's ground (or the
 * theme's wash when the model's ink would not read on it). No card goes behind either, except on a
 * dark slide, where the drawing's dark ink needs the wash panel to read.
 */
import type { Theme } from "@tj/domain/documents";
import { contrastRatio, darkGround } from "../look";

export { darkGround };

type Box = { x: number; y: number; w: number; h: number };

export function svgText(src: string): string | undefined {
  const comma = src.indexOf(",");
  if (!src.startsWith("data:image/svg") || comma < 0) return undefined;
  const body = src.slice(comma + 1);
  try {
    return /;base64,/.test(src.slice(0, comma + 1)) ? atob(body) : decodeURIComponent(body);
  } catch {
    return undefined;
  }
}

function svgSrc(src: string, svg: string): string {
  const comma = src.indexOf(",");
  const head = src.slice(0, comma + 1);
  if (/;base64,/.test(head)) return head + btoa(unescape(encodeURIComponent(svg)));
  return head + encodeURIComponent(svg);
}

/** A length attribute in user units; an `em` length is taken at `fs`. */
const num = (attrs: string, name: string, fs = 16): number | undefined => {
  const m = attrs.match(new RegExp(`(?:^|\\s)${name}="\\s*(-?[\\d.]+)(em)?`));
  return m ? Number(m[1]) * (m[2] ? fs : 1) : undefined;
};

/**
 * The box a drawer SVG draws its ink in, in its own user units: shapes from their geometry, text
 * from its anchor and a generous width per character. Undefined when the drawing uses anything
 * this cannot measure (a rotate or scale, relative path commands, an embedded image): no trim then.
 */
export function svgInkBox(svg: string): Box | undefined {
  if (/<(image|foreignObject|use)\b/.test(svg)) return undefined;
  const sizes = [...svg.matchAll(/font-size(?:="|:\s*)([\d.]+)/g)].map((m) => Number(m[1]));
  const fsMax = sizes.length ? Math.max(...sizes) : 16;
  const strokes = [...svg.matchAll(/stroke-width(?:="|:\s*)([\d.]+)/g)].map((m) => Number(m[1]));
  const sw = (strokes.length ? Math.max(...strokes) : 1) / 2;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const add = (ax: number, ay: number, bx: number, by: number) => {
    x0 = Math.min(x0, ax, bx);
    y0 = Math.min(y0, ay, by);
    x1 = Math.max(x1, ax, bx);
    y1 = Math.max(y1, ay, by);
  };
  const stack: { tag: string; dx: number; dy: number }[] = [];
  let skip = 0;
  let text: { x: number; y: number; fs: number; anchor: string } | undefined;
  const re = /<(\/?)([a-zA-Z]+)([^>]*?)(\/?)>|([^<]+)/g;
  for (const m of svg.matchAll(re)) {
    const [, close, tag0, attrs = "", self, chars] = m;
    const top = stack[stack.length - 1] ?? { dx: 0, dy: 0 };
    if (chars !== undefined) {
      const t = chars.replace(/&[a-z#0-9]+;/g, "x").trim();
      if (!t || !text || skip) continue;
      const w = 0.62 * text.fs * t.length;
      const left =
        text.anchor === "middle" ? text.x - w / 2 : text.anchor === "end" ? text.x - w : text.x;
      add(left, text.y - 0.9 * text.fs, left + w, text.y + 0.3 * text.fs);
      continue;
    }
    const tag = (tag0 ?? "").toLowerCase();
    if (close) {
      // Pop to the matching open tag.
      while (stack.length) {
        const s = stack.pop();
        if (s?.tag === tag) break;
      }
      if (/^(defs|marker|clippath|pattern|mask|symbol|title|style|desc)$/.test(tag)) skip--;
      if (tag === "text") text = undefined;
      continue;
    }
    const tr = attrs.match(/transform="([^"]*)"/)?.[1];
    let dx = top.dx;
    let dy = top.dy;
    if (tr) {
      const t = tr.match(/^\s*translate\(\s*(-?[\d.]+)[\s,]*(-?[\d.]+)?\s*\)\s*$/);
      if (!t) return undefined;
      dx += Number(t[1]);
      dy += Number(t[2] ?? 0);
    }
    const opensSkip = /^(defs|marker|clippath|pattern|mask|symbol|title|style|desc)$/.test(tag);
    if (!self) {
      stack.push({ tag, dx, dy });
      if (opensSkip) skip++;
    }
    if (skip || opensSkip || tag === "svg" || tag === "g") continue;
    const n = (k: string) => num(attrs, k) ?? 0;
    if (tag === "rect")
      add(dx + n("x"), dy + n("y"), dx + n("x") + n("width"), dy + n("y") + n("height"));
    else if (tag === "circle") {
      const r = n("r");
      add(dx + n("cx") - r, dy + n("cy") - r, dx + n("cx") + r, dy + n("cy") + r);
    } else if (tag === "ellipse")
      add(
        dx + n("cx") - n("rx"),
        dy + n("cy") - n("ry"),
        dx + n("cx") + n("rx"),
        dy + n("cy") + n("ry"),
      );
    else if (tag === "line") add(dx + n("x1"), dy + n("y1"), dx + n("x2"), dy + n("y2"));
    else if (tag === "polyline" || tag === "polygon" || tag === "path") {
      const data = attrs.match(tag === "path" ? / d="([^"]*)"/ : / points="([^"]*)"/)?.[1] ?? "";
      if (tag === "path" && /[a-yA-Y]/.test(data.replace(/[MLCQZz]/g, ""))) return undefined;
      const v = (data.match(/-?[\d.]+(?:e-?\d+)?/g) ?? []).map(Number);
      for (let k = 0; k + 1 < v.length; k += 2)
        add(dx + (v[k] ?? 0), dy + (v[k + 1] ?? 0), dx + (v[k] ?? 0), dy + (v[k + 1] ?? 0));
    } else if (tag === "text" || tag === "tspan") {
      const fs = num(attrs, "font-size") ?? attrs.match(/font-size:\s*([\d.]+)/)?.[1];
      const size = Number(fs ?? text?.fs ?? fsMax);
      const anchor = attrs.match(/text-anchor="(\w+)"/)?.[1] ?? text?.anchor ?? "start";
      const px = num(attrs, "x");
      const py = num(attrs, "y");
      const ddy = num(attrs, "dy", size) ?? 0;
      text = {
        x: px !== undefined ? dx + px : (text?.x ?? dx),
        y: (py !== undefined ? dy + py : (text?.y ?? dy)) + ddy,
        fs: size,
        anchor,
      };
    }
  }
  if (!Number.isFinite(x0) || x1 <= x0 || y1 <= y0) return undefined;
  return { x: x0 - sw, y: y0 - sw, w: x1 - x0 + 2 * sw, h: y1 - y0 + 2 * sw };
}

/**
 * The drawing with its viewBox cropped to its ink plus a 4 % margin, never past its own canvas.
 * Unchanged when the ink already fills the canvas or cannot be measured.
 */
export function trimToInk<D extends { src: string; aspect: number }>(drawn: D): D {
  const svg = svgText(drawn.src);
  const vb = svg
    ?.match(/<svg[^>]*\sviewBox="([^"]+)"/)?.[1]
    ?.split(/[\s,]+/)
    .map(Number);
  if (!svg || !vb || vb.length !== 4 || vb.some((v) => !Number.isFinite(v))) return drawn;
  const [vx = 0, vy = 0, vw = 0, vh = 0] = vb;
  const ink = svgInkBox(svg);
  if (!ink || vw <= 0 || vh <= 0) return drawn;
  const m = 0.04 * Math.max(ink.w, ink.h);
  const x = Math.max(vx, ink.x - m);
  const y = Math.max(vy, ink.y - m);
  const w = Math.min(vx + vw, ink.x + ink.w + m) - x;
  const h = Math.min(vy + vh, ink.y + ink.h + m) - y;
  if (w <= 0 || h <= 0 || w * h > 0.97 * vw * vh) return drawn;
  const r = (v: number) => Math.round(v * 100) / 100;
  const root = svg.match(/<svg[^>]*>/)?.[0] ?? "";
  const next = root
    .replace(/\sviewBox="[^"]*"/, ` viewBox="${r(x)} ${r(y)} ${r(w)} ${r(h)}"`)
    .replace(/\swidth="[\d.]+"/, ` width="${r(w)}"`)
    .replace(/\sheight="[\d.]+"/, ` height="${r(h)}"`);
  return { ...drawn, src: svgSrc(drawn.src, svg.replace(root, next)), aspect: w / h };
}

/**
 * A library model's canvas (`--bg`, cream) set to the slide's own ground when the model's ink
 * reads on it, so no framed print sits on the slide; otherwise to the theme's `wash`.
 */
export function themedCanvas(src: string, t: Theme, wash: string): string {
  const svg = svgText(src);
  if (!svg || !/var\(--bg\)/.test(svg)) return src;
  const ink = svg.match(/--ink:\s*(#[0-9a-fA-F]{6})/)?.[1] ?? "#2a2019";
  const bg = t.colors.background;
  const ground = !darkGround(t) && contrastRatio(ink, bg) >= 4.5 ? bg : wash;
  const root = svg.match(/<svg[^>]*>/)?.[0];
  if (!root) return src;
  return svgSrc(src, svg.replace(root, `${root}<style>svg,.tk{--bg:${ground} !important}</style>`));
}
