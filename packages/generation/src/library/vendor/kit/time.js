// Dates and honest time scales. Shared by timeline, historical maps, life-span and any
// model that places things in time. Years are held as astronomical years internally:
// 1 BC = 0, 2 BC = -1, AD 1 = 1. There is no year 0 in BC/AD counting, so 55 BC to AD 43
// is 43 - (-54) = 97 years.
import { fmtInt } from './svg.js';

/** Parse a teacher-written date: "55 BC", "AD 43", "43 CE", "c. 2560 BC", "about 10,000 BC", "2019".
 *  Returns {astro, approx, era, n} or {error} with a reason in teacher words. */
export function parseDate(raw) {
  if (typeof raw === 'number') raw = String(raw);
  if (typeof raw !== 'string' || !raw.trim()) return { error: 'A date is missing.' };
  let s = raw.trim();
  let approx = false;
  const ap = s.match(/^(c\.?|ca\.?|circa|about|around)\s*/i);
  if (ap) { approx = true; s = s.slice(ap[0].length); }
  const m = s.match(/^(AD|CE)?\s*([0-9][0-9,]*)\s*(BC|BCE|AD|CE)?$/i);
  if (!m) return { error: `I can't read “${raw}” as a year. Write it like “55 BC”, “AD 43”, “c. 2560 BC” or “2019”.` };
  const pre = (m[1] || '').toUpperCase(), post = (m[3] || '').toUpperCase();
  if (pre && post) return { error: `“${raw}” has two era words. Write “AD 43” or “55 BC”.` };
  const n = parseInt(m[2].replace(/,/g, ''), 10);
  const bc = post === 'BC' || post === 'BCE';
  if (n === 0) return { error: `There is no year 0: the year before AD 1 is 1 BC. Change “${raw}”.` };
  const era = bc ? 'BC' : (pre || post) ? 'AD' : null;
  return { astro: bc ? 1 - n : n, approx, era, n, raw };
}

/** Label for an astronomical year in a style: 'bc-ad', 'bce-ce' or 'plain'. */
export function formatYear(astro, style = 'bc-ad', approx = false) {
  const c = approx ? 'c. ' : '';
  if (style === 'plain') return c + fmtInt(astro, true);
  const bc = astro <= 0, n = bc ? 1 - astro : astro;
  if (style === 'bce-ce') return c + `${fmtInt(n, true)} ${bc ? 'BCE' : 'CE'}`;
  return c + (bc ? `${fmtInt(n, true)} BC` : `AD ${fmtInt(n, true)}`);
}

/** Whole years from a to b (astronomical years), already free of the year-0 trap. */
export const yearsBetween = (a, b) => b - a;

/** "97 years", "1 year", or "about 2,500 years" when either end is approximate. */
export function durationLabel(n, approx) {
  n = Math.abs(n);
  if (!approx) return `${fmtInt(n)} ${n === 1 ? 'year' : 'years'}`;
  let r = n;
  if (n >= 20) { const mag = Math.pow(10, Math.floor(Math.log10(n)) - 1); r = Math.round(n / mag) * mag; }
  return `about ${fmtInt(r)} ${r === 1 ? 'year' : 'years'}`;
}

const STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 25000, 50000, 100000, 200000, 250000, 500000, 1000000];
/** Labelled ticks for a time axis. Labels sit on round numbers in each era, so on a BC/AD
 *  axis the ticks either side of the BC/AD line are one year closer than the rest. That is
 *  honest: positions are true years, labels are round. Returns {step, major:[{astro,label}], minor:[astro], divider}. */
export function timeTicks(from, to, style, pxPerYear, labelPx) {
  const span = to - from;
  let step = STEPS.find(st => st * pxPerYear >= labelPx) || STEPS[STEPS.length - 1];
  while (span / step > 14) step = STEPS[STEPS.indexOf(step) + 1] || step * 2;
  const minorCands = [step / 10, step / 5, step / 4, step / 2].filter(m => Number.isInteger(m) && m >= 1 && m * pxPerYear >= 6);
  const minorStep = minorCands[0] || 0;
  const major = [], minor = [];
  const usesEra = style !== 'plain';
  const push = (arr, astro, label) => { if (astro >= from && astro <= to) arr.push(label === undefined ? astro : { astro, label }); };
  if (usesEra && from <= 0) {
    for (let n = Math.ceil(Math.max(1, 1 - to) / step) * step; n <= 1 - from; n += step) push(major, 1 - n, formatYear(1 - n, style));
    if (minorStep) for (let n = Math.ceil(Math.max(1, 1 - to) / minorStep) * minorStep; n <= 1 - from; n += minorStep) if (n % step) push(minor, 1 - n);
  }
  const a0 = Math.max(usesEra ? 1 : from, from);
  for (let n = Math.ceil(a0 / step) * step; n <= to; n += step) { if (usesEra && n === 0) continue; push(major, n, formatYear(n, style)); }
  if (minorStep) for (let n = Math.ceil(a0 / minorStep) * minorStep; n <= to; n += minorStep) if (n % step && !(usesEra && n === 0)) push(minor, n);
  major.sort((a, b) => a.astro - b.astro);
  const divider = usesEra && from <= 0 && to >= 1 ? 0.5 : null;
  return { step, minorStep, major, minor, divider };
}
