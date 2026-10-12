/*
 * Turns a drawing's pilot markup into a self-contained SVG for one age, size and theme (TEACH-310
 * part b, rulings 211-213). The pilot did this with CSS (tokens.css): colour slots as custom
 * properties, age and size as classes, a CSS `filter` for warmth. PPTX, thumbnails and export need
 * literal colours, so `flatten` resolves every one of those here:
 * - `var(--slot)` -> the theme's colour (or the fixed drawing palette);
 * - the classes `o lu hl sp sh rr rr2` -> inline stroke, opacity and `rx` from the age;
 * - `dt` (detail, hidden at s) and `dl` (fine detail, shown only at l) -> kept or dropped;
 * - the age filter (saturate, brightness, sepia) -> applied to each literal colour;
 * - ids -> renamed under a per-SVG prefix so two icons on one page never share a clip path.
 * The result has no `class`, no custom property, no `var(` and no CSS function.
 */
import type { IconAge, IconColours, IconSize } from "./types";

/** The fixed drawing palette (pilot tokens.css `:root`), shared by every theme. */
export const ICON_PALETTE: Readonly<Record<string, string>> = {
  flesh: "#E0343F",
  "flesh-d": "#A81D2C",
  "flesh-l": "#FF6B6B",
  "flesh-tint": "#FCE3E0",
  pink: "#F49AA8",
  "pink-d": "#D2647A",
  leaf: "#4CAF50",
  "leaf-d": "#2E7D32",
  "leaf-l": "#B5E07A",
  earth: "#A86F45",
  "earth-d": "#74492A",
  sand: "#E9C27C",
  "sand-l": "#F4DDAE",
  clay: "#D9824B",
  "clay-d": "#A95A2C",
  "clay-l": "#E99A64",
  stone: "#8D8079",
  fire: "#F26B1D",
  "fire-l": "#FFB13B",
  smoke: "#BDB6AE",
  sun: "#FFC53D",
  "sun-d": "#F29F05",
  water: "#3D8BD9",
  "water-d": "#2A66A8",
  metal: "#C9CFD8",
  "metal-d": "#8D96A3",
  enamel: "#FBF6EC",
  "enamel-d": "#D9CBB0",
  gold: "#E8B33A",
  "gold-d": "#B8851B",
  roman: "#B3262E",
  "roman-d": "#7E1820",
  mito: "#F29E4C",
  "mito-l": "#FFD28F",
  "mito-d": "#C46A1C",
  glass: "#E6F3FA",
  chem: "#2F86D6",
  "chem-l": "#6FB2EE",
  alabaster: "#EEDFC4",
  "alabaster-d": "#C9B48E",
  wire: "#4A4A55",
  vein: "#5B5FC7",
  "vein-d": "#3E3F96",
  o2: "#E84B5A",
  co2: "#8A8FA0",
  "co2-d": "#5F6475",
  liver: "#8E3B2E",
  "liver-d": "#5E2219",
  gut: "#E9A38F",
  "gut-d": "#C47460",
  stomach: "#E58C8A",
  "stomach-d": "#B85B5B",
  linen: "#F3EAD6",
  "linen-d": "#CDBE9C",
  natron: "#F7F4EC",
  "natron-d": "#CFC6B0",
  lapis: "#2456A6",
  "lapis-d": "#173B78",
  wood: "#B97A3F",
  "wood-d": "#83521F",
  sky: "#9FD3F2",
  magma: "#E8501E",
  "magma-d": "#B02F10",
  mantle: "#E58A3A",
  "mantle-d": "#B45F1F",
  ocean: "#2F7DC2",
  "ocean-d": "#1F5C94",
  rock: "#6E6A6F",
  "rock-d": "#4A464C",
  grass: "#7CC35A",
  glow: "#FFE7A3",
};

/** The pilot's warm theme slots (tokens.css `.theme-warm`): the default when a theme has none. */
export const DEFAULT_ICON_COLOURS: Readonly<IconColours> = {
  primary: "#D7263D",
  primaryDark: "#A81D2C",
  secondary: "#2F7FD1",
  secondaryDark: "#1F5C9E",
  tint: "#FCE3E0",
  ink: "#22152B",
  stroke: "#22152B",
};
/** The pilot's cool theme slots (tokens.css `.theme-cool`). */
export const COOL_ICON_COLOURS: Readonly<IconColours> = {
  primary: "#1F7A5C",
  primaryDark: "#145440",
  secondary: "#E8A33A",
  secondaryDark: "#B87A1E",
  tint: "#DDF1E8",
  ink: "#14262E",
  stroke: "#14262E",
};

type Filter = readonly ["saturate" | "brightness" | "sepia", number][];
interface AgeTokens {
  /** outline width (px); the drawn outline is twice this, over the per-element scale `--k` */
  sw: number;
  gloss: number;
  glossK: number;
  shade: number;
  /** corner radius of `rr` (and half of it for `rr2`) */
  r: number;
  spark: number;
  filter: Filter;
  /** early mixes the outline toward a warm brown (oklab, this share of the stroke slot) */
  outlineMix?: { with: string; share: number };
}

/** Age tokens from the pilot's tokens.css v2 (12 Oct 2026). */
export const AGE_TOKENS: Readonly<Record<IconAge, AgeTokens>> = {
  early: {
    sw: 8,
    gloss: 0.95,
    glossK: 1.55,
    shade: 0.26,
    r: 30,
    spark: 0.95,
    filter: [
      ["saturate", 1.28],
      ["brightness", 1.04],
      ["sepia", 0.06],
    ],
    outlineMix: { with: "#9A4A1C", share: 0.62 },
  },
  primary: { sw: 3.5, gloss: 0.6, glossK: 1, shade: 0.5, r: 14, spark: 0, filter: [] },
  secondary: {
    sw: 0,
    gloss: 0.18,
    glossK: 0.8,
    shade: 0.3,
    r: 4,
    spark: 0,
    filter: [["saturate", 0.9]],
  },
};

// ---------- colour ----------

type Rgb = [number, number, number];
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function parseHex(hex: string): Rgb {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3 || h.length === 4) h = [...h.slice(0, 3)].map((c) => c + c).join("");
  if (!/^[0-9a-fA-F]{6}/.test(h)) throw new Error(`icon colour must be #rgb or #rrggbb: ${hex}`);
  return [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16) / 255) as Rgb;
}
const toHex = (c: Rgb) =>
  `#${c
    .map((v) =>
      Math.round(clamp01(v) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;

const mul = (m: readonly number[], c: Rgb): Rgb => [
  clamp01((m[0] as number) * c[0] + (m[1] as number) * c[1] + (m[2] as number) * c[2]),
  clamp01((m[3] as number) * c[0] + (m[4] as number) * c[1] + (m[5] as number) * c[2]),
  clamp01((m[6] as number) * c[0] + (m[7] as number) * c[1] + (m[8] as number) * c[2]),
];
// Filter Effects 1 §13 matrices for the CSS shorthand functions, applied in order, each clamped.
const FILTER_MATRIX = {
  saturate: (s: number) => [
    0.213 + 0.787 * s,
    0.715 - 0.715 * s,
    0.072 - 0.072 * s,
    0.213 - 0.213 * s,
    0.715 + 0.285 * s,
    0.072 - 0.072 * s,
    0.213 - 0.213 * s,
    0.715 - 0.715 * s,
    0.072 + 0.928 * s,
  ],
  brightness: (b: number) => [b, 0, 0, 0, b, 0, 0, 0, b],
  sepia: (a: number) => {
    const s = 1 - a;
    return [
      0.393 + 0.607 * s,
      0.769 - 0.769 * s,
      0.189 - 0.189 * s,
      0.349 - 0.349 * s,
      0.686 + 0.314 * s,
      0.168 - 0.168 * s,
      0.272 - 0.272 * s,
      0.534 - 0.534 * s,
      0.131 + 0.869 * s,
    ];
  },
} as const;

function applyFilter(hex: string, filter: Filter): string {
  let c = parseHex(hex);
  for (const [fn, v] of filter) c = mul(FILTER_MATRIX[fn](v), c);
  return toHex(c);
}

// CSS color-mix(in oklab, a share, b): Björn Ottosson's OKLab.
const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const fromLinear = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
function toOklab(c: Rgb): Rgb {
  const [r, g, b] = c.map(toLinear) as Rgb;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
function fromOklab([L, a, b]: Rgb): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((v) => fromLinear(clamp01(v))) as Rgb;
}
export function mixOklab(a: string, b: string, share: number): string {
  const x = toOklab(parseHex(a));
  const y = toOklab(parseHex(b));
  return toHex(
    fromOklab(
      [0, 1, 2].map((i) => (x[i] as number) * share + (y[i] as number) * (1 - share)) as Rgb,
    ),
  );
}

export interface TreatmentOptions {
  colours?: Partial<IconColours>;
  age?: IconAge;
}

/** Every slot name a drawing may use, resolved to a literal colour before the age filter. */
export function resolveSlots(opts: TreatmentOptions = {}): Record<string, string> {
  const c = { ...DEFAULT_ICON_COLOURS, ...opts.colours };
  const age = AGE_TOKENS[opts.age ?? "primary"];
  return {
    ...ICON_PALETTE,
    "icon-primary": c.primary,
    "icon-primary-dark": c.primaryDark,
    "icon-secondary": c.secondary,
    "icon-secondary-dark": c.secondaryDark,
    "icon-tint": c.tint,
    "icon-ink": c.ink,
    "icon-stroke": c.stroke,
    "icon-outline": age.outlineMix
      ? mixOklab(c.stroke, age.outlineMix.with, age.outlineMix.share)
      : c.stroke,
  };
}

/** The colours an icon may contain for these options: each slot and #fff, after the age filter. */
export function iconColourSet(opts: TreatmentOptions = {}): Set<string> {
  const filter = AGE_TOKENS[opts.age ?? "primary"].filter;
  return new Set(
    [...Object.values(resolveSlots(opts)), "#ffffff"].map((h) => applyFilter(h, filter)),
  );
}

// ---------- markup ----------

interface El {
  tag: string;
  attrs: [string, string][];
  children: Node[];
}
type Node = El | string;

const TOKEN =
  /<\/([A-Za-z][\w:-]*)\s*>|<([A-Za-z][\w:-]*)((?:\s+[^\s=/>]+\s*=\s*"[^"]*")*)\s*(\/?)>|[^<]+/g;
const ATTR = /([^\s=/>]+)\s*=\s*"([^"]*)"/g;

/** Parses the library's own markup (well-formed, double-quoted attributes, no comments). */
export function parseMarkup(markup: string): Node[] {
  const root: El = { tag: "#root", attrs: [], children: [] };
  const stack: El[] = [root];
  let consumed = 0;
  for (const m of markup.matchAll(TOKEN)) {
    if (m.index !== consumed) throw new Error(`icon markup: unparsable at ${consumed}`);
    consumed += m[0].length;
    const top = stack[stack.length - 1] as El;
    if (m[1]) {
      if (top.tag !== m[1]) throw new Error(`icon markup: </${m[1]}> closes <${top.tag}>`);
      stack.pop();
    } else if (m[2]) {
      const el: El = {
        tag: m[2],
        attrs: [...(m[3] ?? "").matchAll(ATTR)].map((a) => [a[1] as string, a[2] as string]),
        children: [],
      };
      top.children.push(el);
      if (!m[4]) stack.push(el);
    } else if (m[0].trim()) {
      top.children.push(m[0]);
    }
  }
  if (consumed !== markup.length || stack.length !== 1) throw new Error("icon markup: unbalanced");
  return root.children;
}

const num = (v: number) => String(Math.round(v * 1000) / 1000);
const px = (v: string | undefined, fallback: number) =>
  v === undefined ? fallback : Number.parseFloat(v);
const HIDDEN_AT: Record<IconSize, ReadonlySet<string>> = {
  s: new Set(["hl", "sp", "sh", "dt", "dl"]),
  m: new Set(["dl"]),
  l: new Set(),
};

export interface FlattenOptions extends TreatmentOptions {
  size?: IconSize;
  idPrefix: string;
}

/** The pilot markup of one drawing -> literal SVG children for one age, size and theme. */
export function flatten(markup: string, opts: FlattenOptions): string {
  const age = AGE_TOKENS[opts.age ?? "primary"];
  const size = opts.size ?? "m";
  // size s drops the outline at every age (tokens.css `.size-s{--icon-sw:0px}`)
  const sw = size === "s" ? 0 : age.sw;
  const slots = resolveSlots(opts);
  const outline = slots["icon-outline"] as string;
  const hidden = HIDDEN_AT[size];
  const ids = new Map<string, string>();
  const colourCache = new Map<string, string>();
  const colour = (hex: string) => {
    let c = colourCache.get(hex);
    if (!c) {
      c = applyFilter(hex, age.filter);
      colourCache.set(hex, c);
    }
    return c;
  };
  const resolveValue = (v: string) =>
    v
      .replace(/var\(--([\w-]+)\)/g, (_, name: string) => {
        const c = slots[name];
        if (!c) throw new Error(`icon drawing uses an unknown colour slot --${name}`);
        return c;
      })
      .replace(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g, colour)
      .replace(/url\(#([\w-]+)\)/g, (_, i: string) => `url(#${ids.get(i) ?? i})`);

  const visit = (node: Node): string => {
    if (typeof node === "string") return node;
    const attrs = new Map(node.attrs);
    const classes = (attrs.get("class") ?? "").split(/\s+/).filter(Boolean);
    attrs.delete("class");
    if (classes.some((c) => hidden.has(c))) return "";
    if (classes.includes("sp") && age.spark === 0) return "";
    if (classes.includes("lu") && sw === 0) return "";

    const inline = new Map<string, string>();
    const custom = new Map<string, string>();
    for (const decl of (attrs.get("style") ?? "").split(";")) {
      const i = decl.indexOf(":");
      if (i < 0) continue;
      const k = decl.slice(0, i).trim();
      const v = decl.slice(i + 1).trim();
      (k.startsWith("--") ? custom : inline).set(k, v);
    }
    attrs.delete("style");
    const k = px(custom.get("--k"), 1);
    const fromClass = new Map<string, string>();
    for (const c of classes) {
      if (c === "o" && sw > 0) {
        fromClass.set("stroke", outline);
        fromClass.set("stroke-width", num((sw * 2) / k));
        fromClass.set("stroke-linejoin", "round");
        fromClass.set("paint-order", "stroke");
      } else if (c === "lu") {
        fromClass.set("fill", "none");
        fromClass.set("stroke", outline);
        fromClass.set("stroke-width", num(px(custom.get("--w"), 0) + (sw * 2) / k));
        fromClass.set("stroke-linejoin", "round");
      } else if (c === "hl") {
        fromClass.set("fill", "none");
        fromClass.set("stroke", "#fff");
        fromClass.set("stroke-linecap", "round");
        fromClass.set("opacity", num(age.gloss));
        fromClass.set("stroke-width", num(px(custom.get("--gw"), 8) * age.glossK));
      } else if (c === "sp") {
        fromClass.set("fill", "#fff");
        fromClass.set("opacity", num(age.spark));
      } else if (c === "sh") {
        fromClass.set("opacity", num(age.shade));
      } else if (c === "rr" || c === "rr2") {
        attrs.set("rx", num(c === "rr" ? age.r : age.r / 2));
      }
    }
    // an inline declaration beats a class rule, as it did in the pilot's CSS
    const style = new Map([...fromClass, ...inline]);
    const id = attrs.get("id");
    if (id !== undefined) {
      const renamed = `${opts.idPrefix}-${ids.size + 1}`;
      ids.set(id, renamed);
      attrs.set("id", renamed);
    }
    const out = [...attrs].map(([n, v]) => ` ${n}="${resolveValue(v)}"`);
    if (style.size) {
      out.push(` style="${[...style].map(([n, v]) => `${n}:${resolveValue(v)}`).join(";")}"`);
    }
    const inner = node.children.map(visit).join("");
    return node.children.length
      ? `<${node.tag}${out.join("")}>${inner}</${node.tag}>`
      : `<${node.tag}${out.join("")}/>`;
  };
  const out = parseMarkup(markup).map(visit).join("");
  // a clip path or marker whose user was dropped at this size goes too
  return out.replace(
    /<(clipPath|marker) id="([^"]+)"[^>]*>.*?<\/\1>/g,
    (whole, _tag: string, i: string) => (out.includes(`url(#${i})`) ? whole : ""),
  );
}
