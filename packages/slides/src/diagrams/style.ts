/**
 * The diagrams' shared look: one type floor, one weight ladder, one
 * stroke ladder, one wash, one arrowhead. Every kind and figure reads these, so a change here lifts
 * every drawing at once and no kind keeps a private constant.
 */
import type { Theme } from "@tj/domain/documents";

/** The smallest text a diagram draws, in slide points: readable from the back of a classroom. */
export const TYPE_FLOOR = 18;

/** A secondary size (ticks, arrow words, a timeline's body) `k` of `fs`, never under the floor. */
export const sub = (fs: number, k = 0.85): number => Math.max(TYPE_FLOOR, Math.round(fs * k));

/**
 * DIAGRAM-MODERN: the look presets. `current` is the shipped look (heavy outlines, tints, bold
 * names). `flat` drops outlines from filled shapes, keeps thin round-capped lines, rounds corners
 * and reads at medium weight with only values bold. `line` is a line illustration: one 2 pt
 * stroke, open shapes, the focal element the only fill. Every renderer reads the same tokens, so a
 * preset is a switch, not a second renderer. The default is `flat`.
 */
export type DiagramPreset = "current" | "flat" | "line";
export const DIAGRAM_PRESETS: readonly DiagramPreset[] = ["current", "flat", "line"];
/** The shipped look: flat (Greg picked A, 5 Oct 2026). `current` and `line` stay behind the switch. */
export const DEFAULT_DIAGRAM_PRESET: DiagramPreset = "flat";

/**
 * Weights: labels read calmly, values and key terms stand out, a title leads. `name` is a box's,
 * set's or axis's name: as heavy as a value in the current look, a step lighter in the modern ones.
 */
export const WEIGHT: { label: number; value: number; title: number; name: number } = {
  label: 500,
  value: 600,
  title: 700,
  name: 600,
};

/** Three stroke widths: hairlines (grids, leaders, rules), structure (outlines, axes, arrows), data. */
export const STROKE: { hair: number; line: number; data: number } = {
  hair: 1.75,
  line: 2.5,
  data: 4,
};

/** What a preset changes beyond the ladders: the shape treatment the renderers branch on. */
export type Look = {
  preset: DiagramPreset;
  /** Filled shapes carry an outline (the current look). */
  outlines: boolean;
  /** Shapes are open (line art): no fill except the focal element. */
  open: boolean;
  /** Scene textures (bricks, ladder rails and rungs, hatching). */
  textures: boolean;
  /** A box's corner radius as a share of the label size. */
  radius: number;
  /** The gap between touching parts (bar-model cells), as a share of the label size. */
  gap: number;
  /** A frame around a whole drawing (the Venn universe box). */
  frame: boolean;
  /** Light horizontal gridlines on a chart. */
  grid: boolean;
};

const PRESETS: Record<
  DiagramPreset,
  { weight: typeof WEIGHT; stroke: typeof STROKE; look: Omit<Look, "preset"> }
> = {
  current: {
    weight: { label: 500, value: 600, title: 700, name: 600 },
    stroke: { hair: 1.75, line: 2.5, data: 4 },
    look: {
      outlines: true,
      open: false,
      textures: true,
      radius: 0.5,
      gap: 0,
      frame: true,
      grid: true,
    },
  },
  flat: {
    weight: { label: 400, value: 600, title: 600, name: 500 },
    stroke: { hair: 1.5, line: 2, data: 3.5 },
    look: {
      outlines: false,
      open: false,
      textures: false,
      radius: 0.45,
      gap: 0.22,
      frame: false,
      grid: true,
    },
  },
  line: {
    weight: { label: 400, value: 600, title: 600, name: 500 },
    stroke: { hair: 1.5, line: 2, data: 2.5 },
    look: {
      outlines: true,
      open: true,
      textures: false,
      radius: 0.45,
      gap: 0.22,
      frame: false,
      grid: false,
    },
  },
};

let preset: DiagramPreset = "current";
let LOOK: Look = { preset, ...PRESETS.current.look };
setDiagramPreset(DEFAULT_DIAGRAM_PRESET);

/** Switch every diagram and figure to `p` (process-wide; the default is `current`). */
export function setDiagramPreset(p: DiagramPreset): void {
  preset = PRESETS[p] ? p : "current";
  Object.assign(WEIGHT, PRESETS[preset].weight);
  Object.assign(STROKE, PRESETS[preset].stroke);
  LOOK = { preset, ...PRESETS[preset].look };
}

/** The live preset's shape treatment. */
export const look = (): Look => LOOK;

/** Run `f` under preset `p`, then restore the one before (synchronous). */
export function withDiagramPreset<T>(p: DiagramPreset, f: () => T): T {
  const was = preset;
  setDiagramPreset(p);
  try {
    return f();
  } finally {
    setDiagramPreset(was);
  }
}

const envPreset = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
  ?.env?.DIAGRAM_PRESET as DiagramPreset | undefined;
if (envPreset && PRESETS[envPreset]) setDiagramPreset(envPreset);

/** Any width snapped to the ladder (a highlight band of 6 or more is kept as drawn). */
export function onLadder(w: number): number {
  if (!(w > 0) || w >= 6) return w;
  if (w < 2.2) return STROKE.hair;
  if (w <= 3.25) return STROKE.line;
  return STROKE.data;
}

/**
 * Every `stroke-width` in an SVG fragment snapped to the ladder, outside text (a text halo keeps
 * its own width): the last word on stroke weight for every kind, whatever a renderer wrote.
 */
export function laddered(svg: string): string {
  return svg.replace(/<(?!text\b)([a-z]+)\b[^>]*>/g, (tag) =>
    tag.replace(
      /stroke-width="([\d.]+)"/,
      (_, v: string) => `stroke-width="${onLadder(Number(v))}"`,
    ),
  );
}

/**
 * the figure look (after the homepage examples and Chalkie's worksheet): a
 * pastel tint inside a heavy ink outline, the right angle a filled accent square, side labels bold
 * and the unknown italic in the accent. Neutral tint on dark themes.
 */
export function figureLook(t: Theme, mix: (a: string, b: string, s: number) => string) {
  const surface = t.colors.panel ?? t.colors.surface;
  const L = look();
  const tint = t.dark ? mix(t.colors.ink, surface, 0.12) : mix(t.colors.accent, surface, 0.16);
  return {
    /** The shape's fill: none in line art. */
    fill: L.open ? "none" : tint,
    /** The shape's outline width: 0 (no outline) in the flat look. */
    outline: L.outlines ? (L.open ? STROKE.line : STROKE.data) : 0,
    /** The outline colour: the accent in line art (the shape is the focal element). */
    stroke: L.open ? t.colors.accent : t.colors.ink,
    /** The right-angle square's fill: open in line art. */
    mark: L.open ? undefined : t.colors.accent,
    /** The right-angle square's outline colour. */
    markLine: L.outlines ? t.colors.ink : t.colors.accent,
    unknown: t.colors.accent,
  };
}

/** An arrowhead's length for a line of width `stroke`: one head shape, sized from its line. */
export const headFor = (stroke: number): number => 4.2 * onLadder(stroke);

/**
 * The one wash a drawing fills with. Light themes: the accent washed into the panel. Dark themes:
 * a neutral lifted panel (the accent stays in the outline), never an olive or brown mud.
 */
export function washes(
  t: Theme,
  surface: string,
  mix: (a: string, b: string, s: number) => string,
) {
  if (t.dark) {
    const tint = mix(t.colors.ink, surface, 0.1);
    return { tint, tint2: mix(t.colors.ink, surface, 0.18) };
  }
  return {
    tint: mix(t.colors.accent, surface, 0.14),
    tint2: mix(t.colors.accent2, surface, 0.28),
  };
}

/** The colours `finished` reads (a `Palette` subset; style.ts sits below svg.ts). */
type FinishColours = { bg: string; surface: string; ink: string; accent: string };

const same = (a: string | undefined, b: string) => !!a && a.toLowerCase() === b.toLowerCase();

/**
 * DIAGRAM-MODERN: the preset's last word on a drawn SVG fragment, after `laddered`. `current`
 * returns it untouched. `flat`: no outline on a filled shape (a blank box becomes a soft neutral
 * block instead), rounded rectangles, round caps and joins, no 700 weight. `line`: open shapes
 * (a filled shape keeps only its outline, a flat-filled area is drawn as its outline), the accent
 * fill kept as the focal element without its outline, round caps and joins.
 */
export function finished(
  svg: string,
  c: FinishColours,
  mix: (a: string, b: string, s: number) => string,
  dark = false,
): string {
  const L = look();
  if (L.preset === "current") return svg;
  const soft = mix(c.ink, c.surface, dark ? 0.1 : 0.06);
  const shapes = svg.replace(
    /<(rect|circle|ellipse|polygon|path|line|polyline)\b([^>]*?)(\/?)>/g,
    (_tag, el: string, a0: string, close: string) => {
      let a = a0;
      const get = (k: string) => new RegExp(`\\s${k}="([^"]*)"`).exec(a)?.[1];
      const set = (k: string, v: string) => {
        a =
          get(k) !== undefined
            ? a.replace(new RegExp(`\\s${k}="[^"]*"`), ` ${k}="${v}"`)
            : `${a} ${k}="${v}"`;
      };
      const fill = get("fill");
      const stroke = get("stroke");
      const filled = !!fill && fill !== "none" && fill !== "transparent" && el !== "line";
      const stroked = !!stroke && stroke !== "none" && Number(get("stroke-width") ?? 1) > 0;
      const blank = same(fill, c.bg) || same(fill, c.surface);
      if (L.preset === "flat") {
        if (filled && stroked) {
          if (blank) set("fill", soft);
          set("stroke", "none");
        }
      } else if (filled) {
        // A wash (a see-through fill) is never the focal element.
        const focal = same(fill, c.accent) && Number(get("fill-opacity") ?? 1) >= 1;
        const pts = (get("points") ?? "").split(/[\s,]+/).map(Number);
        const xs = pts.filter((_, i) => i % 2 === 0);
        const ys = pts.filter((_, i) => i % 2 === 1);
        const small =
          el === "polygon" &&
          Math.max(...xs) - Math.min(...xs) < 30 &&
          Math.max(...ys) - Math.min(...ys) < 30;
        if (focal) {
          if (stroked) set("stroke", "none");
        } else if (stroked) set("fill", "none");
        else if (!small && !blank) {
          // A flat-filled area (land, water, a band) becomes its outline.
          set("fill", "none");
          set("fill-opacity", "1");
          set("stroke", c.ink);
          set("stroke-width", String(STROKE.line));
        }
      }
      if (el === "rect" && filled && get("rx") === undefined) {
        const w = Number(get("width") ?? 0);
        const h = Number(get("height") ?? 0);
        const r = Math.min(6, w / 4, h / 4);
        if (r >= 1) set("rx", String(Math.round(r * 10) / 10));
      }
      if (get("stroke") && get("stroke") !== "none") {
        if (get("stroke-linecap") === undefined) set("stroke-linecap", "round");
        if (get("stroke-linejoin") === undefined) set("stroke-linejoin", "round");
      }
      return `<${el}${a}${close}>`;
    },
  );
  return shapes.replace(/font-weight="700"/g, `font-weight="${WEIGHT.title}"`);
}
