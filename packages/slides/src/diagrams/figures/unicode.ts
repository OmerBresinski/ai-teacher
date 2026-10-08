/**
 * Figure label text in Unicode (ADR 0034 decision 2, TEACH-98): `unicodeLabel` turns the ASCII
 * shorthands a model may still write into the characters a label draws. Re-exported from
 * `./labels`. It imports nothing, so `./measure`, whose `measureShape` a template reads at module
 * load, stays out of the layouts ↔ figures import cycle (see `./right-triangle`, TEACH-221).
 */
const SUPERSCRIPT: Record<string, string> = {
  "0": "⁰",
  "1": "¹",
  "2": "²",
  "3": "³",
  "4": "⁴",
  "5": "⁵",
  "6": "⁶",
  "7": "⁷",
  "8": "⁸",
  "9": "⁹",
  "-": "⁻",
};
const SUBSCRIPT: Record<string, string> = {
  "0": "₀",
  "1": "₁",
  "2": "₂",
  "3": "₃",
  "4": "₄",
  "5": "₅",
  "6": "₆",
  "7": "₇",
  "8": "₈",
  "9": "₉",
};
/** U+20D7 COMBINING RIGHT ARROW ABOVE: drawn over the letter before it. */
const VECTOR_ARROW = "\u20D7";

const mapped = (table: Record<string, string>) => (s: string) =>
  [...s].map((ch) => table[ch] ?? ch).join("");

/**
 * A label's text with the ASCII shorthands a model may write turned into the Unicode a label
 * draws: `x^2` and `10^-3` into superscripts (`x²`, `10⁻³`), `x_1` into a subscript (`x₁`),
 * `sqrt2`, `sqrt(3)` and `sqrt(x+1)` into `√2`, `√3` and `√(x+1)`, `pi` not touching a letter
 * into `π` (so "spin" and "pie" are left alone), `40deg` and `40 degrees` into `40°`, `A'` and
 * `B''` into primes (`A′`, `B″`), and `vec(AB)` into AB with U+20D7 over each letter. Anything
 * else passes through unchanged. Every template applies it before measuring and drawing a label.
 */
export function unicodeLabel(text: string): string {
  return text
    .replace(/vec\(([A-Za-z]+)\)/g, (_, letters: string) =>
      [...letters].map((ch) => `${ch}${VECTOR_ARROW}`).join(""),
    )
    .replace(/\^(-?\d+)/g, (_, digits: string) => mapped(SUPERSCRIPT)(digits))
    .replace(/_(\d+)/g, (_, digits: string) => mapped(SUBSCRIPT)(digits))
    .replace(/sqrt\((\d+)\)/g, "√$1")
    .replace(/sqrt(?=\d|\()/g, "√")
    .replace(/(?<![A-Za-z])pi(?![A-Za-z])/g, "π")
    .replace(/(\d)(?:deg|\s?degrees)(?![A-Za-z])/g, "$1°")
    .replace(/([A-Z])''/g, "$1″")
    .replace(/([A-Z])'/g, "$1′");
}
