/**
 * A bar model's numbers as a fractions lesson writes them (BUILDER v5.3-gold B1/B3, CRITIQUE-2
 * fault 3): 10 split into 4 parts is "2 1/2" each, never "2.5". A whole part sits inline and the
 * fraction is drawn stacked (`bar-model.ts` `quantityText`), the way the slide's own text stacks
 * `10 1/2` (`../fractions.ts`). Money keeps its pence: £10 in 4 parts is £2.50.
 */

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : Math.abs(a));

/** The largest denominator a part is written over; past it the part keeps its decimal. */
export const PART_DENOMINATOR_MAX = 12;

/**
 * `p/q` (whole numbers, q ≥ 1) as a mixed number in lowest terms: "2 1/2", "1/3", "7".
 * Undefined when the lowest-terms denominator is over `PART_DENOMINATOR_MAX`.
 */
export function mixedText(p: number, q: number): string | undefined {
  if (!Number.isInteger(p) || !Number.isInteger(q) || q < 1 || p < 0) return undefined;
  const g = gcd(p, q) || 1;
  const num = p / g;
  const den = q / g;
  if (den === 1) return String(num);
  if (den > PART_DENOMINATOR_MAX) return undefined;
  const whole = Math.floor(num / den);
  const rest = num - whole * den;
  return whole ? `${whole} ${rest}/${den}` : `${rest}/${den}`;
}

const isMoney = (unit?: string | null) => !!unit && /^[£$€¥]$/.test(unit.trim());

/** A decimal to two places at most ("2.5"), or pence for money ("2.50"). */
export function decimalText(v: number, unit?: string | null): string {
  const r = Math.round(v * 100) / 100;
  if (Number.isInteger(r)) return String(r);
  return isMoney(unit) ? r.toFixed(2) : String(r);
}

/**
 * One of `parts` equal parts of `whole`, times `count` (1 for a part's label), as written on the
 * bar: a mixed number when whole and parts are whole numbers and the unit is not money, else a
 * decimal.
 */
export function partsText(whole: number, parts: number, count = 1, unit?: string | null): string {
  if (Number.isInteger(whole) && Number.isInteger(parts) && parts >= 1 && !isMoney(unit)) {
    const m = mixedText(whole * count, parts);
    if (m !== undefined) return m;
  }
  return decimalText((whole / parts) * count, unit);
}

/** A number with its unit placed: "£3", "2 1/2 m". */
export const withUnit = (v: string, unit?: string | null) =>
  !unit ? v : isMoney(unit) ? `${unit.trim()}${v}` : `${v} ${unit}`;

/** A label holding one fraction: currency and whole part, the fraction, a unit after it. */
export type FractionLabel = { pre: string; num: string; den: string; post: string };

const FRACTION_LABEL = /^([£$€¥]?)(?:(\d{1,4})\s)?(\d{1,3})\/(\d{1,3})(?:\s(\S.{0,11}))?$/;

/** "2 1/2", "1/3", "5 1/3 m", "£1 1/2" split for stacking; undefined for any other label. */
export function fractionLabel(label: string): FractionLabel | undefined {
  const m = FRACTION_LABEL.exec(label.trim());
  if (!m) return undefined;
  return { pre: `${m[1] ?? ""}${m[2] ?? ""}`, num: m[3] ?? "", den: m[4] ?? "", post: m[5] ?? "" };
}
