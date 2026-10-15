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
  // a natural near-black for eyes, noses and dark matter (copper oxide): never the theme ink, which
  // is light on a dark theme (TEACH-310 part c)
  eye: "#2A2230",
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

type Filter = readonly ["saturate" | "brightness" | "sepia" | "chroma", number][];
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
  /** the outline's stroke-opacity (the soft style's faint early-years line) */
  outlineOpacity?: number;
  /** soft style: the gradient's spread (1 = the full soft gradient, 0 = flat fills) */
  gradient?: number;
  /** drop `dt` detail at size m too (the small drawing's level of detail on the full drawing) */
  calm?: boolean;
}

/**
 * The icon style (TEACH-310 part b, Greg's review of 12 Oct 2026 against the gold heart slide):
 * - "soft" (the default): no dark outline, soft radial gradients and a highlight on the full
 *   palette, a faint thin outline for early years only;
 * - "pilot": the pilot's cartoon look, a thick dark outline at early and primary, flat fills.
 */
export type IconStyle = "soft" | "pilot";
export const ICON_STYLES: readonly IconStyle[] = ["soft", "pilot"];

/**
 * The soft style's age tokens (Greg, 13 Oct: "ks1-3 are soo similar ... adult it up a bit for the
 * latter"). Same drawings, ruled by age:
 * - early (EYFS-KS1): the full soft gradient and gloss, a faint thin outline, round corners;
 * - primary (KS2): a gentler gradient (55%), less gloss, colours 10% calmer (OKLab chroma);
 * - secondary (KS3 on): flat fills with one flat shade, no gloss, no `dt` detail at size m, colours
 *   28% calmer, square-ish corners. Still no outline (Greg's 12 Oct ruling).
 */
export const SOFT_AGE_TOKENS: Readonly<Record<IconAge, AgeTokens>> = {
  early: {
    sw: 1.6,
    gloss: 0.75,
    glossK: 1.2,
    shade: 0.3,
    r: 26,
    spark: 0,
    filter: [],
    outlineOpacity: 0.45,
  },
  primary: {
    sw: 0,
    gloss: 0.45,
    glossK: 1,
    shade: 0.32,
    r: 10,
    spark: 0,
    filter: [["chroma", 0.9]],
    gradient: 0.55,
  },
  secondary: {
    sw: 0,
    gloss: 0,
    glossK: 1,
    shade: 0.22,
    r: 4,
    spark: 0,
    filter: [["chroma", 0.72]],
    gradient: 0,
    calm: true,
  },
};

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
  if (!/^(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(h)) {
    throw new Error(`icon colour must be #rgb or #rrggbb: ${hex}`);
  }
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
  for (const [fn, v] of filter) {
    if (fn === "chroma") {
      const [L, a, b] = toOklab(c);
      c = fromOklab([L, a * v, b * v]);
    } else c = mul(FILTER_MATRIX[fn](v), c);
  }
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
/** OKLCH (lightness 0-1, chroma, hue in degrees) of an #rrggbb colour. */
export function toOklch(hex: string): [number, number, number] {
  const [L, a, b] = toOklab(parseHex(hex));
  return [L, Math.hypot(a, b), ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360];
}
/** An OKLCH colour as #rrggbb, chroma reduced until it fits sRGB (the theming slots' `ok`). */
export function fromOklch(L: number, C: number, H: number): string {
  const rad = (H * Math.PI) / 180;
  const raw = (c: number) => {
    const a = c * Math.cos(rad);
    const b = c * Math.sin(rad);
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    return [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ];
  };
  let c = Math.max(0, C);
  while (c > 0 && !raw(c).every((v) => v >= -0.0005 && v <= 1.0005)) c -= 0.002;
  return toHex(raw(Math.max(0, c)).map((v) => fromLinear(clamp01(v))) as Rgb);
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
  /** "soft" (default) or "pilot" */
  style?: IconStyle;
}

const styleOf = (s: unknown): IconStyle => (s === "pilot" ? "pilot" : "soft");

/** Every slot name a drawing may use, resolved to a literal colour before the age filter. */
/** `value` as #rrggbb when it is a hex colour, else `fallback`: a slot never carries markup. */
export function safeHex(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  try {
    return toHex(parseHex(value));
  } catch {
    return fallback;
  }
}

/** The age's tokens; an unknown age reads as primary. */
export const ageTokens = (age: unknown, style: IconStyle = "pilot"): AgeTokens => {
  const table = style === "soft" ? SOFT_AGE_TOKENS : AGE_TOKENS;
  return Object.hasOwn(table, String(age)) ? table[age as IconAge] : table.primary;
};

export function resolveSlots(opts: TreatmentOptions = {}): Record<string, string> {
  const given: Partial<IconColours> = opts.colours ?? {};
  const c = Object.fromEntries(
    (Object.keys(DEFAULT_ICON_COLOURS) as (keyof IconColours)[]).map((k) => [
      k,
      safeHex(given[k] ?? DEFAULT_ICON_COLOURS[k], DEFAULT_ICON_COLOURS[k]),
    ]),
  ) as unknown as IconColours;
  const age = ageTokens(opts.age, styleOf(opts.style));
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

/** The colours an icon may contain for these options: each slot and #fff, after the age filter,
 * then (soft style) each colour's gradient stops. */
export function iconColourSet(opts: TreatmentOptions = {}): Set<string> {
  const style = styleOf(opts.style);
  const filter = ageTokens(opts.age, style).filter;
  const base = [...Object.values(resolveSlots(opts)), "#ffffff"].map((h) => applyFilter(h, filter));
  const spread = ageTokens(opts.age, style).gradient ?? 1;
  if (style === "pilot" || spread === 0) return new Set(base);
  return new Set(base.flatMap((c) => [c, ...gradientStops(c, spread)]));
}

// ---------- soft style ----------

const WHITE = "#ffffff";
/** The light and dark ends of a fill's soft radial gradient (the middle is the fill itself). */
export const gradientStops = (c: string, spread = 1): [string, string] => [
  mixOklab(c, WHITE, 1 - 0.28 * spread),
  mixOklab(c, "#000000", 1 - 0.22 * spread),
];

/** Soft style: each solid fill (white aside) becomes a radial gradient, highlight top left. */
function soften(svg: string, idPrefix: string, spread = 1): string {
  const defs = new Map<string, string>();
  const body = svg.replace(/fill:(#[0-9a-f]{6})/g, (whole, c: string) => {
    if (c === WHITE) return whole;
    const id = `${idPrefix}-g${c.slice(1)}`;
    if (!defs.has(id)) {
      const [light, dark] = gradientStops(c, spread);
      defs.set(
        id,
        `<radialGradient id="${id}" cx="35%" cy="30%" r="80%"><stop offset="0" stop-color="${light}"/><stop offset=".55" stop-color="${c}"/><stop offset="1" stop-color="${dark}"/></radialGradient>`,
      );
    }
    return `fill:url(#${id})`;
  });
  return defs.size ? `<defs>${[...defs.values()].join("")}</defs>${body}` : body;
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
  const style = styleOf(opts.style);
  const age = ageTokens(opts.age, style);
  const size: IconSize = opts.size === "s" || opts.size === "l" ? opts.size : "m";
  // size s drops the outline at every age (tokens.css `.size-s{--icon-sw:0px}`)
  const sw = size === "s" ? 0 : age.sw;
  const slots = resolveSlots(opts);
  const outline = slots["icon-outline"] as string;
  const hidden = age.calm && size === "m" ? new Set(["dt", "dl"]) : HIDDEN_AT[size];
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
    if (classes.includes("hl") && age.gloss === 0) return "";
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
        if (age.outlineOpacity !== undefined) {
          fromClass.set("stroke-opacity", num(age.outlineOpacity));
        }
      } else if (c === "lu") {
        fromClass.set("fill", "none");
        fromClass.set("stroke", outline);
        fromClass.set("stroke-width", num(px(custom.get("--w"), 0) + (sw * 2) / k));
        fromClass.set("stroke-linejoin", "round");
        if (age.outlineOpacity !== undefined) {
          fromClass.set("stroke-opacity", num(age.outlineOpacity));
        }
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
  let out = parseMarkup(markup).map(visit).join("");
  const spread = age.gradient ?? 1;
  if (style === "soft" && spread > 0) {
    out = soften(out, opts.idPrefix, spread);
  }
  // a clip path or marker whose user was dropped at this size goes too
  return out.replace(
    /<(clipPath|marker) id="([^"]+)"[^>]*>.*?<\/\1>/g,
    (whole, _tag: string, i: string) => (out.includes(`url(#${i})`) ? whole : ""),
  );
}
