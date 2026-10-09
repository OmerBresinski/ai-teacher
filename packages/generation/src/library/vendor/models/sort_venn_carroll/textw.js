// Width of a wording in slide units without a DOM, so validate() can run the same layout as
// render(). Glyph advances in em, the widest of the five themes' label fonts at every weight the
// sort cards use (measured in Chromium, Oct 2026), so the estimate is never narrower than the slide.
const ASCII = [0.33, 0.34, 0.56, 0.74, 0.66, 1.02, 0.82, 0.34, 0.4, 0.4, 0.56, 0.68, 0.34, 0.47, 0.34, 0.52, 0.68, 0.63, 0.64, 0.65, 0.68, 0.63, 0.66, 0.62, 0.66, 0.66, 0.34, 0.35, 0.68, 0.68, 0.68, 0.62, 1.02, 0.77, 0.75, 0.76, 0.78, 0.7, 0.65, 0.82, 0.79, 0.56, 0.64, 0.78, 0.63, 0.94, 0.81, 0.82, 0.7, 0.82, 0.76, 0.7, 0.69, 0.79, 0.77, 1.06, 0.74, 0.74, 0.69, 0.42, 0.51, 0.42, 0.65, 0.69, 0.51, 0.66, 0.66, 0.62, 0.66, 0.62, 0.4, 0.67, 0.64, 0.32, 0.33, 0.63, 0.31, 0.97, 0.64, 0.65, 0.66, 0.66, 0.46, 0.58, 0.4, 0.65, 0.66, 0.86, 0.62, 0.62, 0.58, 0.47, 0.38, 0.47, 0.68];
const EXTRA = {"“": 0.55, "”": 0.54, "’": 0.32, "–": 0.6, "—": 1.0, "é": 0.62, "×": 0.68, "−": 0.68};
export const FS = { 'ts-num': 40, 'ts-label': 30, 'ts-small': 24, 'ts-tiny': 22 };
export function estW(s, cls) {
  let em = 0;
  for (const ch of String(s)) { const c = ch.codePointAt(0); em += c >= 32 && c < 127 ? ASCII[c - 32] : (EXTRA[ch] || 1); }
  return em * FS[cls];
}
