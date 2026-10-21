/*
 * Colour slots (TEACH-215 part c; ruling 248): one recipe makes every theme's four categorical
 * fill and ink pairs, in a fixed hue order (rose, blue, amber, teal), plus a `dim` text tone. A
 * port of the pilot's `theming/slots.mjs` (spec `theming/COLOUR-SLOTS.md`, round 5 soft fills):
 * a theme states `{mode, ground, surface, ink, muted, accent, chroma, hueShift}` and gets four
 * checked pairs. `tokens.json` holds the generated values; `scripts/theme-slots.ts` regenerates
 * and compares them.
 */

type Hex = string;
type Rgb = [number, number, number];

const hex2rgb = (h: Hex): Rgb =>
  [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16) / 255) as Rgb;
const rgb2hex = (c: readonly number[]): Hex =>
  `#${c
    .map((v) =>
      Math.round(Math.min(1, Math.max(0, v)) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")
    .toUpperCase()}`;
const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const gam = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
const lum = (h: Hex) => {
  const [r, g, b] = hex2rgb(h).map(lin) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** WCAG 2 contrast ratio. */
export const contrast = (a: Hex, b: Hex): number => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
};
function oklch2rgb(L: number, C: number, H: number): Rgb {
  const a = C * Math.cos((H * Math.PI) / 180);
  const b = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map(gam) as Rgb;
}
const inGamut = (c: Rgb) => c.every((v) => v >= -0.0005 && v <= 1.0005);
/** OKLCH to hex, chroma reduced until it is in sRGB. */
export function ok(L: number, C: number, H: number): Hex {
  let c = C;
  while (c > 0 && !inGamut(oklch2rgb(L, c, H))) c -= 0.002;
  return rgb2hex(oklch2rgb(L, Math.max(0, c), H));
}
function rgb2oklch(h: Hex): Rgb {
  const [r, g, b] = hex2rgb(h).map(lin) as Rgb;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360];
}
const toLab = (h: Hex): Rgb => {
  const [L, C, H] = rgb2oklch(h);
  return [L, C * Math.cos((H * Math.PI) / 180), C * Math.sin((H * Math.PI) / 180)];
};
/** `f` of the way from `h1` to `h2`, in OKLab. */
export function mixOk(h1: Hex, h2: Hex, f: number): Hex {
  const a = toLab(h1);
  const b = toLab(h2);
  const m = a.map((v, k) => v + ((b[k] as number) - v) * f) as Rgb;
  return ok(m[0], Math.hypot(m[1], m[2]), ((Math.atan2(m[2], m[1]) * 180) / Math.PI + 360) % 360);
}

/** Rose, blue, amber, teal: slot 2 means the same in every deck. */
const HUES = [12, 252, 82, 192] as const;
/** Fill lightness zig-zags so neighbours differ in lightness and on the blue-yellow axis. */
const LADDER = { light: [0.865, 0.765, 0.905, 0.795], dark: [0.45, 0.365, 0.5, 0.4] } as const;
/** Inks are searched against round 4's full fills, so they stay as approved. */
const LADDER_R4 = { light: [0.86, 0.775, 0.895, 0.8], dark: [0.43, 0.38, 0.49, 0.405] } as const;
const FILL_C = { light: [0.068, 0.055, 0.095, 0.06], dark: [0.075, 0.08, 0.07, 0.06] } as const;
const INK_C = [0.15, 0.12, 0.12, 0.09] as const;
/** AA 4.5 plus a margin, so rounding and PPTX colour shifts cannot drop a pair below AA. */
export const SLOT_NEED = 4.7;
/** Round 5 softening toward the ground (rose and amber move furthest). */
const SOFTEN = [0.4, 0.32, 0.42, 0.32] as const;

export type SlotInput = {
  mode: "light" | "dark";
  ground: Hex;
  surface: Hex;
  ink: Hex;
  muted: Hex;
  accent: Hex;
  chroma: number;
  hueShift: readonly [number, number, number, number];
};
export type Slot = { full: Hex; fill: Hex; ink: Hex; wash: Hex };

/** The most colourful lightness of the hue that reads at `SLOT_NEED` on ground, surface and `fill`. */
function slotInk(t: SlotInput, H: number, C: number, fill: Hex): Hex {
  const reads = (h: Hex) => [t.ground, t.surface, fill].every((g) => contrast(h, g) >= SLOT_NEED);
  if (t.mode === "light") {
    for (let L = 0.7; L > 0.2; L -= 0.005) {
      const h = ok(L, C, H);
      if (reads(h)) return h;
    }
  } else {
    for (let L = 0.7; L < 0.99; L += 0.005) {
      const h = ok(L, C * 0.8, H);
      if (reads(h)) return h;
    }
  }
  throw new Error(`no slot ink for hue ${H}`);
}

/** Muted's hue moved toward the ground: the faintest text still at `SLOT_NEED` on ground and surface. */
function dimInk(t: SlotInput): Hex {
  const [L0, C0, H0] = rgb2oklch(t.muted);
  let best = t.muted;
  for (let k = 0; k <= 1; k += 0.005) {
    const L = t.mode === "light" ? L0 + k * (1 - L0) : L0 - k * L0;
    const h = ok(L, C0, H0);
    if ([t.ground, t.surface].every((g) => contrast(h, g) >= SLOT_NEED)) best = h;
    else break;
  }
  return best;
}

/** A theme's four slots and its dim tone. */
export function buildSlots(t: SlotInput): { slots: Slot[]; dim: Hex } {
  const slots = HUES.map((H0, i) => {
    const H = H0 + (t.hueShift[i] as number);
    const L0 = LADDER[t.mode][i] as number;
    const fc = (FILL_C[t.mode][i] as number) * t.chroma;
    const full = ok(L0, fc, H);
    const Lg = rgb2oklch(t.ground)[0];
    const f = SOFTEN[i] as number;
    const kL = t.mode === "light" ? 0.5 : 0.4;
    const fill = ok(L0 + (Lg - L0) * f * kL, fc * (1 - f), H);
    const C = (INK_C[i] as number) * Math.min(t.chroma, 1.2);
    let ink = slotInk(t, H, C, ok(LADDER_R4[t.mode][i] as number, fc, H));
    if (contrast(ink, fill) < SLOT_NEED) ink = slotInk(t, H, C, fill);
    return { full, fill, ink, wash: mixOk(fill, t.ground, 0.35) };
  });
  return { slots, dim: dimInk(t) };
}

/** The closest tone to `from` (moving from `to`) that still reads `need` on `on`. */
function ease(from: Hex, to: Hex, on: Hex, need: number): Hex {
  let best = to;
  for (let f = 0; f <= 1.0001; f += 0.02) {
    const h = mixOk(to, from, f);
    if (contrast(h, on) >= need) best = h;
    else break;
  }
  return best;
}

/**
 * Calm's 7:1 rule on the slots (the pilot's `final/build-tokens.mjs`): each slot ink deepens, same
 * hue, until it reads `need` on the ground, the surface and its own fill; the fill eases toward the
 * ground only if the ink runs out of depth. Dim becomes the faintest muted tone at `need`.
 */
export function slotsAt(
  built: { slots: Slot[]; dim: Hex },
  t: SlotInput,
  need: number,
): { slots: Slot[]; dim: Hex } {
  const slots = built.slots.map((s) => {
    const [L0, C0, H0] = rgb2oklch(s.ink);
    let L = L0;
    let ink = s.ink;
    let fill = s.fill;
    while ([t.ground, t.surface, fill].some((g) => contrast(ink, g) < need) && L > 0.15) {
      L -= 0.005;
      ink = ok(L, C0, H0);
    }
    for (let f = 0; contrast(ink, fill) < need && f <= 1; f += 0.02)
      fill = mixOk(s.fill, t.ground, f);
    return { ...s, ink, fill };
  });
  const dim = [t.ground, t.surface].reduce(
    (d, g) => (contrast(d, g) >= need ? d : ease(g, t.ink, g, need)),
    ease(t.ground, t.muted, t.ground, need),
  );
  return { slots, dim };
}
