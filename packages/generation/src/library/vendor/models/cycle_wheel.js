// Cycle wheel: a year of festivals and seasons, the school year, or any cycle.
// With true month spacing, each month's slice is sized by its days and every stage sits on its
// real date for the chosen year: fixed feasts by date, Easter-based feasts by the computus, and
// lunar festivals (Diwali, Eid, Hanukkah ...) from a dated table, marked "around" where the day
// depends on the moon or the place. Without dates, stages are spaced evenly with arrows round.
import {
  h, T, measure, clamp, eIO, GRID, textBlock, arrow, RM,
  editable, computed, txt, TEXT_PARAM_FOR, TITLE_PARAM, LABEL_PARAM, PHRASE_PARAM, schemaCheck, withDefaults, result,
} from '../kit/index.js';

export const meta = {
  id: 'cycle_wheel', name: 'Cycle wheel', kind: 'info', version: 1,
  subjects: ['RE', 'PSHE', 'Science', 'Geography', 'Design and technology', 'Art'],
  years: ['Reception', 'Y1', 'Y2', 'Y3', 'Y4', 'Y5', 'Y6'],
  teaches: 'How things come round again: festivals and seasons through the year on their real dates, the school year, or the stages of any cycle.',
};

/* ------------------------------------------------------------------ calendar facts */
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MON3 = MONTHS.map(m => m.slice(0, 3));
const leap = y => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const mdays = (y, m) => [31, leap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
const dayNum = (y, m, d) => Date.UTC(y, m - 1, d) / 864e5;
const fromNum = n => { const D = new Date(n * 864e5); return { y: D.getUTCFullYear(), m: D.getUTCMonth() + 1, d: D.getUTCDate() }; };
/** Easter Sunday (Western churches), anonymous Gregorian computus. */
function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const hh = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - hh - k) % 7, m = Math.floor((a + 11 * hh + 22 * l) / 451);
  const mo = Math.floor((hh + l - 7 * m + 114) / 31), da = ((hh + l - 7 * m + 114) % 31) + 1; return { y, m: mo, d: da };
}
const easterPlus = n => y => { const e = easter(y); return fromNum(dayNum(e.y, e.m, e.d) + n); };
/** Advent Sunday: the fourth Sunday before Christmas (27 November to 3 December). */
const advent = y => { const xmas = dayNum(y, 12, 25); const dow = new Date(xmas * 864e5).getUTCDay(); return fromNum(xmas - (dow === 0 ? 7 : dow) - 21); };
// lunar and lunisolar festivals, UK observance; [month, day] per year. Islamic dates depend on the
// moon being seen, so they are "around". Jewish festivals begin at sunset on the date given.
const TABLE = {
  diwali: { 2024: [11, 1], 2025: [10, 20], 2026: [11, 8], 2027: [10, 29], 2028: [10, 17], 2029: [11, 5], 2030: [10, 26] },
  holi: { 2024: [3, 25], 2025: [3, 14], 2026: [3, 4], 2027: [3, 22], 2028: [3, 11], 2029: [3, 1], 2030: [3, 20] },
  'chinese-new-year': { 2024: [2, 10], 2025: [1, 29], 2026: [2, 17], 2027: [2, 6], 2028: [1, 26], 2029: [2, 13], 2030: [2, 3] },
  hanukkah: { 2024: [12, 25], 2025: [12, 14], 2026: [12, 4], 2027: [12, 24], 2028: [12, 12], 2029: [12, 1], 2030: [12, 20] },
  passover: { 2024: [4, 22], 2025: [4, 12], 2026: [4, 1], 2027: [4, 21], 2028: [4, 10], 2029: [3, 30], 2030: [4, 17] },
  'rosh-hashanah': { 2024: [10, 2], 2025: [9, 22], 2026: [9, 11], 2027: [10, 1], 2028: [9, 20], 2029: [9, 9], 2030: [9, 27] },
  ramadan: { 2024: [3, 11], 2025: [3, 1], 2026: [2, 18], 2027: [2, 8], 2028: [1, 28], 2029: [1, 16], 2030: [1, 6] },
  'eid-al-fitr': { 2024: [4, 10], 2025: [3, 30], 2026: [3, 20], 2027: [3, 9], 2028: [2, 26], 2029: [2, 14], 2030: [2, 4] },
  'eid-al-adha': { 2024: [6, 16], 2025: [6, 6], 2026: [5, 27], 2027: [5, 16], 2028: [5, 5], 2029: [4, 24], 2030: [4, 13] },
};
const fromTable = key => y => { const r = TABLE[key][y]; return r ? { y, m: r[0], d: r[1] } : null; };
const fixed = (m, d) => y => ({ y, m, d });
// how: 'fixed' | 'easter' | 'lunar-hindu' | 'lunar-chinese' | 'jewish' | 'islamic' | 'solar'
const FEST = {
  'new-year': { name: 'New Year’s Day', who: 'people all over the world', how: 'fixed', at: fixed(1, 1), icon: 'firework' },
  epiphany: { name: 'Epiphany', who: 'Christians', how: 'fixed', at: fixed(1, 6), icon: 'star' },
  candlemas: { name: 'Candlemas', who: 'Christians', how: 'fixed', at: fixed(2, 2), icon: 'candle' },
  'ash-wednesday': { name: 'Ash Wednesday', alias: ['lent begins', 'start of lent'], who: 'Christians', how: 'easter', at: easterPlus(-46), icon: 'cross', verb: 'kept' },
  'palm-sunday': { name: 'Palm Sunday', who: 'Christians', how: 'easter', at: easterPlus(-7), icon: 'leaf', verb: 'kept' },
  'good-friday': { name: 'Good Friday', who: 'Christians', how: 'easter', at: easterPlus(-2), icon: 'cross', verb: 'kept' },
  easter: { name: 'Easter', alias: ['easter sunday', 'easter day'], who: 'Christians', how: 'easter', at: easterPlus(0), icon: 'egg' },
  pentecost: { name: 'Pentecost', alias: ['whitsun', 'whit sunday'], who: 'Christians', how: 'easter', at: easterPlus(49), icon: 'flame' },
  advent: { name: 'Advent Sunday', alias: ['advent', 'advent begins'], who: 'Christians', how: 'advent', at: advent, icon: 'candle', verb: 'kept' },
  'st-lucia': { name: 'St Lucia’s Day', alias: ['st lucia', 'santa lucia'], who: 'Christians, especially in Sweden', how: 'fixed', at: fixed(12, 13), icon: 'candle' },
  christmas: { name: 'Christmas', alias: ['christmas day'], who: 'Christians', how: 'fixed', at: fixed(12, 25), icon: 'star' },
  diwali: { name: 'Diwali', alias: ['deepavali', 'divali'], who: 'Hindus, Sikhs and Jains', how: 'lunar-hindu', at: fromTable('diwali'), approx: true, icon: 'diya' },
  holi: { name: 'Holi', who: 'Hindus', how: 'lunar-hindu', at: fromTable('holi'), approx: true, icon: 'splash' },
  vaisakhi: { name: 'Vaisakhi', alias: ['baisakhi'], who: 'Sikhs and Hindus', how: 'solar', at: fixed(4, 14), approx: true, icon: 'leaf' },
  'chinese-new-year': { name: 'Chinese New Year', alias: ['lunar new year', 'spring festival'], who: 'Chinese communities', how: 'lunar-chinese', at: fromTable('chinese-new-year'), icon: 'lantern' },
  hanukkah: { name: 'Hanukkah', alias: ['chanukah'], who: 'Jews', how: 'jewish', at: fromTable('hanukkah'), from: true, icon: 'menorah' },
  passover: { name: 'Passover', alias: ['pesach'], who: 'Jews', how: 'jewish', at: fromTable('passover'), from: true, icon: 'none' },
  'rosh-hashanah': { name: 'Rosh Hashanah', alias: ['jewish new year'], who: 'Jews', how: 'jewish', at: fromTable('rosh-hashanah'), from: true, icon: 'apple' },
  'yom-kippur': { name: 'Yom Kippur', who: 'Jews', how: 'jewish', at: y => { const r = fromTable('rosh-hashanah')(y); return r && fromNum(dayNum(r.y, r.m, r.d) + 9); }, from: true, icon: 'none', verb: 'kept' },
  ramadan: { name: 'Ramadan begins', alias: ['ramadan', 'start of ramadan'], who: 'Muslims', how: 'islamic', at: fromTable('ramadan'), approx: true, icon: 'crescent', lead: s => `Ramadan is a month of fasting kept by Muslims; it begins ${dateWords(s, true)}.` },
  'eid-al-fitr': { name: 'Eid al-Fitr', alias: ['eid ul-fitr', 'eid-ul-fitr'], who: 'Muslims', how: 'islamic', at: fromTable('eid-al-fitr'), approx: true, icon: 'crescent' },
  'eid-al-adha': { name: 'Eid al-Adha', alias: ['eid ul-adha', 'eid-ul-adha'], who: 'Muslims', how: 'islamic', at: fromTable('eid-al-adha'), approx: true, icon: 'crescent' },
  'bonfire-night': { name: 'Bonfire Night', alias: ['guy fawkes night', 'fireworks night'], who: 'people in the UK', how: 'fixed', at: fixed(11, 5), icon: 'firework' },
};
const FEST_KEYS = Object.keys(FEST);
const TABLE_YEARS = '2024 to 2030';
const ICONS = ['auto', 'none', 'diya', 'candle', 'menorah', 'star', 'lantern', 'egg', 'cross', 'crescent', 'flame', 'splash', 'apple', 'sun', 'leaf', 'flower', 'snowflake', 'firework', 'book', 'ball', 'pencil', 'hammer', 'magnifier', 'tick'];
const ICON_LABELS = ['Automatic', 'Plain dot', 'Diya lamp', 'Candle', 'Menorah', 'Star', 'Lantern', 'Egg', 'Cross', 'Crescent moon', 'Flame', 'Paint splash', 'Apple', 'Sun', 'Leaf', 'Flower', 'Snowflake', 'Firework', 'Book', 'Ball', 'Pencil', 'Hammer', 'Magnifying glass', 'Tick'];
const MONTH_ENUM = ['auto', ...MONTHS.map((_, i) => String(i + 1))];

export const params = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', title: 'Cycle wheel',
  properties: {
    title: TITLE_PARAM('Festivals through the year'),
    kind: { type: 'string', title: 'What the wheel shows', enum: ['festivals', 'school', 'cycle'], 'x-labels': ['Festivals across faiths', 'The school year', 'Any cycle (stages, no dates)'], default: 'festivals' },
    centre: LABEL_PARAM('Words in the middle', 'One year', { maxLength: 28 }), // libfix: the hub holds 28 letters at the most stages (tools/laneFit)
    months: { type: 'boolean', title: 'Space by real dates', description: 'Each month’s slice is sized by its days and every stage sits on its real date. Turn off to space stages evenly.', default: true },
    year: { type: 'integer', title: 'Year the dates are for', description: 'Moving festivals such as Easter and Diwali are worked out for this year. A wheel that starts after January runs on into the next year.', minimum: 1900, maximum: 2100, default: 2026 },
    startMonth: { type: 'string', title: 'Month at the top', description: 'The wheel starts here and runs clockwise. A school year starts in September.', enum: MONTH_ENUM.slice(1), 'x-labels': MONTHS, default: '1' },
    seasons: { type: 'string', title: 'Seasons ring', enum: ['none', 'north', 'south'], 'x-labels': ['No seasons', 'Seasons (UK and the northern half of the world)', 'Seasons (southern half of the world)'], default: 'north' },
    stages: {
      type: 'array', title: 'Stages', 'x-item': 'a stage', minItems: 2, maxItems: 8,
      default: [{ label: 'Chinese New Year', festival: 'chinese-new-year' }, { label: 'Easter', festival: 'easter' }, { label: 'Diwali', festival: 'diwali' }, { label: 'Christmas', festival: 'christmas' }],
      items: { type: 'object', required: ['label'], default: { label: 'New stage', festival: 'none', month: 'auto', day: 0, around: false, icon: 'auto' }, properties: {
        label: PHRASE_PARAM('Name', 'New stage', { minLength: 1 }),
        festival: { type: 'string', title: 'Festival', description: 'Choose a festival and its date is worked out for you.', enum: ['none', ...FEST_KEYS], 'x-labels': ['None (I will give the month)', ...FEST_KEYS.map(k => FEST[k].name)], default: 'none' },
        month: { type: 'string', title: 'Month', enum: MONTH_ENUM, 'x-labels': ['Work it out from the festival', ...MONTHS], default: 'auto' },
        day: { type: 'integer', title: 'Day of the month', description: '0 means no particular day.', minimum: 0, maximum: 31, default: 0 },
        around: { type: 'boolean', title: 'Date is approximate (“around”)', default: false, 'x-panel': 'advanced' },
        icon: { type: 'string', title: 'Picture', enum: ICONS, 'x-labels': ICON_LABELS, default: 'auto' },
      } },
    },
    today: { type: 'object', title: 'Today', default: { show: false, month: '10', day: 7 }, properties: {
      show: { type: 'boolean', title: 'Mark today on the wheel', default: false },
      month: { type: 'string', title: 'Month', enum: MONTH_ENUM.slice(1), 'x-labels': MONTHS, default: '10' },
      day: { type: 'integer', title: 'Day', minimum: 1, maximum: 31, default: 7 },
    } },
    text: TEXT_PARAM_FOR({ today: 'label', spacing: 'phrase', 'season:winter': 'label', 'season:spring': 'label', 'season:summer': 'label', 'season:autumn': 'label' }),
  },
};

export const presets = [
  { id: 'r-school-year', name: 'Reception: our school year', params: {
    title: 'Our school year', kind: 'school', centre: 'Our school year', year: 2026, startMonth: '9', seasons: 'north',
    stages: [{ label: 'Start school', month: '9', icon: 'book' }, { label: 'Harvest', month: '10', around: true, icon: 'leaf' },
      { label: 'Bonfire Night', festival: 'bonfire-night' }, { label: 'Christmas', festival: 'christmas' },
      { label: 'Easter', festival: 'easter' }, { label: 'Sports day', month: '6', icon: 'ball' }, { label: 'Summer holidays', month: '7', day: 22, icon: 'sun' }],
    today: { show: true, month: '10', day: 7 },
  } },
  { id: 'y2-festivals-of-light', name: 'Year 2: festivals of light', params: {
    title: 'Festivals of light', kind: 'festivals', centre: 'Festivals of light', year: 2026, startMonth: '1', seasons: 'north',
    stages: [{ label: 'Candlemas', festival: 'candlemas' }, { label: 'Diwali', festival: 'diwali' }, { label: 'Hanukkah', festival: 'hanukkah' }, { label: 'Christmas', festival: 'christmas' }],
    text: { 'caption:summary': 'All four fall between November and February, when the nights are longest.' },
  } },
  { id: 'y4-christian-year', name: 'Year 4: the Christian year', params: {
    title: 'The Christian year', kind: 'festivals', centre: 'The Christian year', year: 2026, startMonth: '11', seasons: 'none',
    stages: [{ label: 'Advent', festival: 'advent' }, { label: 'Christmas', festival: 'christmas' }, { label: 'Epiphany', festival: 'epiphany' },
      { label: 'Lent begins', festival: 'ash-wednesday' }, { label: 'Easter', festival: 'easter', icon: 'cross' }, { label: 'Pentecost', festival: 'pentecost' },
      { label: 'Harvest festival', month: '9', around: true, icon: 'leaf' }],
  } },
  { id: 'y6-design-cycle', name: 'Year 6: the design cycle', params: {
    title: 'The design cycle', kind: 'cycle', centre: 'Design and technology', months: false, seasons: 'none',
    stages: [{ label: 'Investigate what people need', icon: 'magnifier' }, { label: 'Design', icon: 'pencil' }, { label: 'Make', icon: 'hammer' }, { label: 'Evaluate and improve', icon: 'tick' }],
  } },
];

/* ------------------------------------------------------------------ model of the data */
const fmtDate = (r, f) => `${r.d ? `${r.d} ` : ''}${MONTHS[r.m - 1]}`;
function model(P) {
  const Y = P.year, sm = +P.startMonth || 1;
  const t0 = dayNum(Y, sm, 1), t1 = dayNum(sm === 1 ? Y + 1 : Y + 1, sm, 1), len = t1 - t0;
  const yearOf = m => (m >= sm ? Y : Y + 1);
  // a festival date inside the wheel's year: try both calendar years the wheel touches
  const festIn = f => { for (const y of sm === 1 ? [Y] : [Y, Y + 1]) { const r = f.at(y); if (!r) return { missing: y }; const n = dayNum(r.y, r.m, r.d); if (n >= t0 && n < t1) return r; } return null; };
  const stages = (P.stages || []).map((s, i) => {
    const f = s.festival && s.festival !== 'none' ? FEST[s.festival] : null;
    let date = null, approx = !!s.around, from = false, err = null;
    if (f) { const r = festIn(f); if (r && r.missing) err = { missing: r.missing }; else date = r; approx = approx || !!f.approx; from = !!f.from; }
    else if (s.month && s.month !== 'auto') { const m = +s.month, y = yearOf(m); date = { y, m, d: s.day || 0 }; }
    const icon = s.icon && s.icon !== 'auto' ? s.icon : f ? f.icon : 'none';
    let pos = null;
    if (date) { const md = mdays(date.y, date.m); pos = (dayNum(date.y, date.m, date.d ? Math.min(date.d, md) : 1) + (date.d ? 0.5 : md / 2) - t0) / len; }
    return { ...s, i, f, date, approx, from, err, icon, pos };
  });
  // real-date spacing needs every stage to have a date; until then the stages are spaced evenly
  const dated = !!P.months && stages.every(s => s.date || s.f);
  const order = dated ? [...stages].filter(s => s.pos != null).sort((a, b) => a.pos - b.pos || a.i - b.i) : stages;
  let today = null;
  if (P.today && P.today.show && dated) { const m = +P.today.month, y = yearOf(m), d = P.today.day; const md = mdays(y, m); today = { y, m, d, pos: (dayNum(y, m, Math.min(d, md)) + 0.5 - t0) / len }; }
  return { Y, sm, t0, t1, len, stages, order, today, dated, yearOf };
}
const dateWords = (s, withYear) => {
  if (!s.date) return '';
  const base = s.date.d ? `${s.date.d} ${MONTHS[s.date.m - 1]}` : MONTHS[s.date.m - 1];
  return `${s.approx && s.date.d ? 'around ' : s.from ? 'from ' : ''}${base}${withYear ? ` ${s.date.y}` : ''}`;
};
const ordinal = n => { const t = n % 100, u = n % 10; return `${n}${t >= 11 && t <= 13 ? 'th' : u === 1 ? 'st' : u === 2 ? 'nd' : u === 3 ? 'rd' : 'th'}`; };
const norm = s => String(s || '').toLowerCase().replace(/[’']/g, '').replace(/\s+/g, ' ').trim();

/* ------------------------------------------------------------------ validate */
export function validate(raw) {
  const P = withDefaults(params, raw);
  const R = schemaCheck(params, P); const W = [];
  if (R.length) return result(R);
  const M = model(P);
  for (const s of M.stages) {
    const p = `stages.${s.i}`;
    if (s.err) { R.push({ path: `${p}.festival`, reason: `I only have dates for ${s.f.name} from ${TABLE_YEARS}, because it follows the moon. Choose a year in that range.` }); continue; }
    if (s.f && !s.date) { R.push({ path: `${p}.festival`, reason: `${s.f.name} does not fall inside this wheel’s year. Check the year and the month at the top.` }); continue; }
    if (s.f && s.month !== 'auto' && +s.month !== s.date.m) W.push({ path: `${p}.month`, reason: `${s.f.name} is on ${fmtDate(s.date)} ${s.date.y}, so it goes there, not in ${MONTHS[+s.month - 1]}. Set the month to “Work it out from the festival” to tidy this up.` });
    if (s.f && s.day && s.day !== s.date.d) W.push({ path: `${p}.day`, reason: `${s.f.name} is on ${fmtDate(s.date)} ${s.date.y}, so it goes there, not on the ${ordinal(s.day)}. Set the day to 0 to tidy this up.` });
    if (!s.f && s.date && s.day && s.day > mdays(s.date.y, s.date.m)) R.push({ path: `${p}.day`, reason: `${MONTHS[s.date.m - 1]} ${s.date.y} has only ${mdays(s.date.y, s.date.m)} days.` });
    if (!s.f && s.day && (!s.month || s.month === 'auto')) R.push({ path: `${p}.month`, reason: `“${s.label}” has a day but no month. Choose the month too.` });
    // a stage named after a festival must sit on that festival's date
    if (!s.f && s.date) {
      const k = FEST_KEYS.find(key => [FEST[key].name, ...(FEST[key].alias || [])].some(n => norm(n) === norm(s.label)));
      if (k) { const r = (() => { for (const y of [s.date.y]) { const q = FEST[k].at(y); if (q) return q; } return null; })();
        if (r && (r.m !== s.date.m || (s.day && r.d !== s.day))) R.push({ path: r.m !== s.date.m ? `${p}.month` : `${p}.day`, reason: `${FEST[k].name} is on ${fmtDate(r)} in ${r.y}, not ${r.m !== s.date.m ? `in ${MONTHS[s.date.m - 1]}` : `on the ${ordinal(s.day)}`}. Choose “${FEST[k].name}” as the festival and the date is worked out.` }); }
    }
    if (P.months && !s.date && !s.f) W.push({ path: `${p}.month`, reason: `“${s.label}” has no month, so the stages are spaced evenly for now. Choose a month for every stage to space them by real dates.` });
  }
  if (P.today && P.today.show) {
    if (!M.dated) W.push({ path: 'today.show', reason: 'Today is only marked when the wheel is spaced by real dates, so it is not shown.' });
    else { const m = +P.today.month, y = M.yearOf(m); if (P.today.day > mdays(y, m)) R.push({ path: 'today.day', reason: `${MONTHS[m - 1]} ${y} has only ${mdays(y, m)} days.` }); }
  }
  if (R.length) return result(R, W);
  // honest spacing: three stages inside three weeks cannot be labelled clearly on a year wheel
  if (M.dated) {
    const o = M.order, n = o.length; const days = o.map(s => s.pos * M.len);
    if (n >= 3) for (let i = 0; i < n; i++) {
      const j = (i + 2) % n, d = days[j] + (i + 2 >= n ? M.len : 0) - days[i];
      if (d <= 21) { R.push({ path: `stages.${o[j].i}`, reason: `“${o[i].label}”, “${o[(i + 1) % n].label}” and “${o[j].label}” all fall within three weeks, too close to label clearly. Take one out, or turn off “Space by real dates”.` }); break; }
    }
  }
  return result(R, W);
}

/* ------------------------------------------------------------------ builds */
function plan(P) {
  const M = model(P); const items = []; const cyc = P.kind === 'cycle';
  const startW = MONTHS[M.sm - 1];
  items.push({ key: 'wheel', caption: M.dated
    ? `One trip round the wheel is one year, starting in ${startW}. Each slice is one month.`
    : (cyc ? 'A cycle is a set of stages that come round again in the same order.' : 'The stages go round the wheel in order, spaced evenly.') });
  if (M.dated && P.seasons !== 'none') items.push({ key: 'seasons', caption: P.seasons === 'north' ? 'The four seasons. In the UK, winter is December to February.' : 'The four seasons. South of the equator, December to February is summer.' });
  M.order.forEach((s, j) => items.push({ key: `st:${s.i}`, s, caption: cyc && !M.dated ? (j === 0 ? `It starts with: ${s.label}.` : `Next: ${s.label}.`) : (s.date ? `${s.label}: ${dateWords(s, true)}.` : `${s.label}.`) }));
  if (M.today) {
    const next = M.order.find(s => s.pos >= M.today.pos) || M.order[0];
    items.push({ key: 'today', caption: `Today is ${M.today.d} ${MONTHS[M.today.m - 1]}.${next ? ` Next on the wheel: ${next.label}.` : ''}` });
  }
  const n = M.order.length; const first = M.order[0], last = M.order[n - 1];
  const summary = cyc ? `After ${last.label}, the cycle starts again.`
    : P.kind === 'school' ? `One school year, from ${startW} round to ${startW} again.`
    : `${n} festivals in one year, in the order they come.`;
  return { M, items, summary };
}
export function builds(P) { const { items, summary } = plan(P); return { steps: items.map(({ key, caption }) => ({ key, caption })), summary: { caption: summary } }; }

const HOW = {
  fixed: () => 'It is on the same date every year.',
  easter: (s, M) => { const e = easter(s.date.y); return `Its date moves with Easter, which follows the first full moon of spring: in ${e.y} Easter Sunday is ${e.d} ${MONTHS[e.m - 1]}.`; },
  advent: () => 'It is the fourth Sunday before Christmas, so it falls between 27 November and 3 December.',
  'lunar-hindu': () => 'Its date follows the Hindu calendar, which is set by the moon, so it moves each year and can differ by a day between places.',
  'lunar-chinese': () => 'It falls on the new moon between 21 January and 20 February, so it moves each year.',
  jewish: s => `The Jewish calendar follows the moon and the sun, and Jewish days begin at sunset, so it starts on the evening of ${fmtDate(s.date)}.`,
  islamic: () => 'The Islamic calendar follows the moon and is about 11 days shorter than our year, so it comes round earlier each year. The exact day depends on the new moon being seen.',
  solar: () => 'It is on 13 or 14 April, depending on the year.',
};
export function notes(P) {
  const { M, items } = plan(P); const cyc = P.kind === 'cycle';
  const steps = items.map(it => {
    if (it.key === 'wheel') return M.dated ? `Each month’s slice is sized by its number of days, so February is the thinnest.${M.sm !== 1 ? ` The wheel starts in ${MONTHS[M.sm - 1]} ${M.Y} and runs into ${M.Y + 1}.` : ''}`
      : `The stages are spaced evenly: the gaps do not show how long each stage takes. Ask: what has to happen before the first stage can start again?`;
    if (it.key === 'seasons') return P.seasons === 'north' ? 'These are the weather seasons used by the Met Office. Ask: which season has the shortest days?' : 'South of the equator the seasons are the other way round: Christmas comes in summer.';
    if (it.key === 'today') return 'Find today on the wheel. Ask: which comes next? How many months until then?';
    const s = it.s;
    if (s.f) return `${s.f.lead ? s.f.lead(s) : `${s.f.name} is ${s.f.verb || 'celebrated'} by ${s.f.who}.`} ${(HOW[s.f.how] || HOW.fixed)(s, M)}`;
    if (cyc && !M.dated) return 'Ask: what happens in this stage? What has to be finished before the next one?';
    return s.approx ? `The date is approximate: it changes from year to year.` : 'Ask: what happens at this time of year?';
  });
  return { steps, summary: cyc ? 'Ask: could the cycle start at a different stage? What would happen if one stage were missed?' : 'Ask: which ones are close together? Which season has the most?' };
}

/* ------------------------------------------------------------------ icons (flat, tokens only) */
function icon(p, kind, x, y) {
  const g = h('g', { transform: `translate(${x} ${y})` }, p);
  const F = (tag, a) => h(tag, a, g);
  switch (kind) {
    case 'diya': F('path', { d: 'M-16 2 Q0 20 16 2 Z', fill: 'var(--counter)' }); F('path', { d: 'M0 -17 Q8 -7 0 -1 Q-8 -7 0 -17 Z', fill: 'var(--energy)' }); break;
    case 'candle': F('rect', { x: -5, y: -5, width: 10, height: 21, rx: 2, fill: 'var(--cloud)', stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-hair)' }); F('path', { d: 'M0 -19 Q6 -12 0 -8 Q-6 -12 0 -19 Z', fill: 'var(--energy)' }); break;
    case 'menorah': F('rect', { x: -15, y: 3, width: 30, height: 3, rx: 1.5, fill: 'var(--energy)' }); F('rect', { x: -1.5, y: 3, width: 3, height: 12, fill: 'var(--energy)' }); F('rect', { x: -8, y: 14, width: 16, height: 3, rx: 1.5, fill: 'var(--energy)' });
      for (let i = -4; i <= 4; i++) { const x = i * 3.6, top = i === 0 ? -12 : -7; F('rect', { x: x - 1.1, y: top, width: 2.2, height: 3 - top, fill: 'var(--water)' }); F('path', { d: `M${x} ${top - 7} Q${x + 2.6} ${top - 3} ${x} ${top - 1} Q${x - 2.6} ${top - 3} ${x} ${top - 7} Z`, fill: 'var(--heat)' }); } break;
    case 'star': { const pts = []; for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 7 : 17; pts.push(`${(r * Math.cos(a)).toFixed(1)},${(r * Math.sin(a) + 1).toFixed(1)}`); } F('polygon', { points: pts.join(' '), fill: 'var(--energy)' }); break; }
    case 'lantern': F('rect', { x: -12, y: -12, width: 24, height: 24, rx: 9, fill: 'var(--heat)' }); F('rect', { x: -7, y: -16, width: 14, height: 5, fill: 'var(--energy)' }); F('rect', { x: -7, y: 11, width: 14, height: 5, fill: 'var(--energy)' }); break;
    case 'egg': F('ellipse', { cx: 0, cy: 1, rx: 12, ry: 16, fill: 'var(--era-5)' }); F('path', { d: 'M-12 2 L-6 -3 L0 2 L6 -3 L12 2', fill: 'none', stroke: 'var(--heat)', 'stroke-width': 'var(--sw-struct)', 'stroke-linejoin': 'round' }); break;
    case 'cross': F('rect', { x: -3, y: -17, width: 6, height: 34, fill: 'var(--ink-2)' }); F('rect', { x: -12, y: -9, width: 24, height: 6, fill: 'var(--ink-2)' }); break;
    case 'crescent': F('circle', { cx: 0, cy: 0, r: 15, fill: 'var(--energy)' }); F('circle', { cx: 7, cy: -4, r: 13, fill: 'var(--paper)' }); break;
    case 'flame': F('path', { d: 'M0 -18 C10 -6 13 5 0 16 C-13 5 -10 -6 0 -18 Z', fill: 'var(--heat)' }); F('path', { d: 'M0 -2 C5 3 6 8 0 13 C-6 8 -5 3 0 -2 Z', fill: 'var(--energy)' }); break;
    case 'splash': [[-7, -6, 8, 'var(--heat)'], [8, -7, 7, 'var(--water)'], [7, 8, 8, 'var(--life)'], [-8, 9, 6, 'var(--energy)']].forEach(([cx, cy, r, fill]) => F('circle', { cx, cy, r, fill })); break;
    case 'apple': F('circle', { cx: 0, cy: 3, r: 13, fill: 'var(--heat)' }); F('line', { x1: 0, y1: -9, x2: 1, y2: -16, stroke: 'var(--trunk)', 'stroke-width': 'var(--sw-struct)', 'stroke-linecap': 'round' }); F('ellipse', { cx: 7, cy: -13, rx: 6, ry: 3, fill: 'var(--life)' }); break;
    case 'sun': F('circle', { cx: 0, cy: 0, r: 8, fill: 'var(--sun)' }); for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; F('line', { x1: 12 * Math.cos(a), y1: 12 * Math.sin(a), x2: 17 * Math.cos(a), y2: 17 * Math.sin(a), stroke: 'var(--sun)', 'stroke-width': 'var(--sw-struct)', 'stroke-linecap': 'round' }); } break;
    case 'leaf': F('path', { d: 'M-13 13 Q-13 -13 13 -13 Q13 13 -13 13 Z', fill: 'var(--life)' }); F('line', { x1: -13, y1: 13, x2: 6, y2: -6, stroke: 'var(--life-shade)', 'stroke-width': 'var(--sw-rule)' }); break;
    case 'flower': for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + i * 2 * Math.PI / 5; F('circle', { cx: 9 * Math.cos(a), cy: 9 * Math.sin(a), r: 7, fill: 'var(--heat)' }); } F('circle', { cx: 0, cy: 0, r: 5, fill: 'var(--energy)' }); break;
    case 'snowflake': for (let i = 0; i < 3; i++) { const a = i * Math.PI / 3; F('line', { x1: -16 * Math.cos(a), y1: -16 * Math.sin(a), x2: 16 * Math.cos(a), y2: 16 * Math.sin(a), stroke: 'var(--water)', 'stroke-width': 'var(--sw-struct)', 'stroke-linecap': 'round' }); } break;
    case 'firework': for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; F('line', { x1: 5 * Math.cos(a), y1: 5 * Math.sin(a), x2: 16 * Math.cos(a), y2: 16 * Math.sin(a), stroke: i % 2 ? 'var(--energy)' : 'var(--heat)', 'stroke-width': 'var(--sw-struct)', 'stroke-linecap': 'round' }); } break;
    case 'book': F('path', { d: 'M0 -9 L-16 -13 L-16 10 L0 14 Z', fill: 'var(--water)' }); F('path', { d: 'M0 -9 L16 -13 L16 10 L0 14 Z', fill: 'var(--era-4)' }); break;
    case 'ball': F('circle', { cx: 0, cy: 0, r: 14, fill: 'var(--cloud)', stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-rule)' }); F('path', { d: 'M-14 0 Q0 -8 14 0 M-6 -13 Q-1 0 -6 13', fill: 'none', stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-rule)' }); break;
    case 'pencil': { const q = h('g', { transform: 'rotate(45)' }, g); h('rect', { x: -5, y: -17, width: 10, height: 23, fill: 'var(--energy)' }, q); h('polygon', { points: '-5,6 5,6 0,17', fill: 'var(--daub)' }, q); h('polygon', { points: '-1.8,13 1.8,13 0,17', fill: 'var(--ink)' }, q); break; }
    case 'hammer': { const q = h('g', { transform: 'rotate(-40)' }, g); h('rect', { x: -2.5, y: -6, width: 5, height: 23, rx: 2, fill: 'var(--trunk)' }, q); h('rect', { x: -12, y: -15, width: 24, height: 10, rx: 2, fill: 'var(--metal)' }, q); break; }
    case 'magnifier': F('circle', { cx: -4, cy: -4, r: 9, fill: 'none', stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-arrow)' }); F('line', { x1: 3, y1: 3, x2: 13, y2: 13, stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-arrow)', 'stroke-linecap': 'round' }); break;
    case 'tick': F('path', { d: 'M-12 1 L-4 9 L12 -9', fill: 'none', stroke: 'var(--life)', 'stroke-width': 'var(--sw-arrow)', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }); break;
    default: F('circle', { cx: 0, cy: 0, r: 8, fill: 'var(--event)' });
  }
  return g;
}

/* ------------------------------------------------------------------ render */
const sector = (cx, cy, r1, r2, a0, a1) => {
  const P = (r, a) => `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`; const L = a1 - a0 > Math.PI ? 1 : 0;
  return `M${P(r2, a0)} A${r2} ${r2} 0 ${L} 1 ${P(r2, a1)} L${P(r1, a1)} A${r1} ${r1} 0 ${L} 0 ${P(r1, a0)} Z`;
};
/** distance from point (px, py) to segment a-b */
const segD = (px, py, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy; const t = L2 ? clamp(((px - a[0]) * dx + (py - a[1]) * dy) / L2) : 0; return Math.hypot(px - a[0] - t * dx, py - a[1] - t * dy); };
const SEASONS = [['winter', 'Winter', 12, 4], ['spring', 'Spring', 3, 3], ['summer', 'Summer', 6, 5], ['autumn', 'Autumn', 9, 2]];

export function render(root, P, ctx) {
  const { M, items } = plan(P); const b = ctx.b, N = ctx.N; const bi = k => b[k] ?? 0;
  const cyc = P.kind === 'cycle';
  const cx = 640, cy = 380;
  const ang = pos => -Math.PI / 2 + pos * 2 * Math.PI;
  const at = (r, a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const kW = bi('wheel');
  const R2 = 212, R1 = 160, S2 = 154, S1 = 114;   // month band and season band
  const seasonsOn = M.dated && P.seasons !== 'none';
  const posOf = (y, m, d) => (dayNum(y, m, d) - M.t0) / M.len;

  /* the wheel */
  const wheel = h('g', {}, root);
  // kit sizes: the smallest text and its line, read from the tokens rather than pinned here
  const tokv = (n, d) => parseFloat(getComputedStyle(root).getPropertyValue(n)) || d;
  const FS = { 'ts-tiny': tokv('--fs-min', 24), 'ts-label': tokv('--fs-label', 30), 'ts-h3': tokv('--fs-h3', 32) };
  const base0 = (cls, lh) => Math.round((lh - FS[cls]) / 2 + FS[cls] * 0.8);   // first baseline below a block's top
  const measureLH = (cls, lh) => { const g = h('g', {}, root); const v = textBlock(g, 0, 0, 'x', { cls, lh }).lh; g.remove(); return v; };
  const dateGap = FS['ts-tiny'] + 8;                                            // baseline to baseline, name to date
  let Ricon, Rtrack, rIcon = 26, centreR;
  if (M.dated) {
    Ricon = R2 + rIcon + 8; centreR = seasonsOn ? S1 - 6 : R1 - 10;
    for (let j = 0; j < 12; j++) {
      const m = ((M.sm - 1 + j) % 12) + 1, y = M.yearOf(m);
      const a0 = ang(posOf(y, m, 1)), a1 = ang(posOf(y, m, 1) + mdays(y, m) / M.len);
      h('path', { d: sector(cx, cy, R1, R2, a0, a1), fill: 'var(--panel)', stroke: 'var(--rule)', 'stroke-width': 'var(--sw-rule)', s: kW, cls: 'rise', delay: j * 50 }, wheel);
      const [tx, ty] = at((R1 + R2) / 2, (a0 + a1) / 2);
      computed(T(wheel, tx, ty + 8, MON3[m - 1], 'ts-small', { 'text-anchor': 'middle', fill: 'var(--ink)', s: kW, cls: 'rise', delay: j * 50 }), 'startMonth');
    }
    // the start of the year (or of the wheel) is a firmer line at the top
    h('line', { x1: cx, x2: cx, y1: cy - R1, y2: cy - R2 - 6, stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-struct)', s: kW }, wheel);
  } else {
    Rtrack = 200; Ricon = Rtrack; rIcon = 32; centreR = Rtrack - rIcon - 14;
    h('circle', { cx, cy, r: Rtrack, fill: 'none', stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-arrow)', s: kW, cls: 'rise' }, wheel);
  }

  /* seasons ring */
  const seasonBoxes = [];
  if (seasonsOn) {
    const kS = bi('seasons'); const sg = h('g', { c: ctx.rc('seasons', null, 'soft') }, root);
    for (const [id, name, m0, col] of SEASONS) {
      const mm = P.seasons === 'south' ? ((m0 + 5) % 12) + 1 : m0;
      // a season is three months from mm; place it inside the wheel's year, wrapping across the top
      let y = M.yearOf(mm); let p0 = posOf(y, mm, 1); const mEnd = ((mm + 2) % 12) + 1; let yE = mEnd < mm ? y + 1 : y; let p1 = posOf(yE, mEnd, 1);
      const arcs = p1 <= 1 ? [[p0, p1]] : [[p0, 1], [0, p1 - 1]];
      if (p0 < 0) { arcs.length = 0; arcs.push([p0 + 1, 1], [0, p1]); }
      arcs.forEach(([u0, u1]) => { if (u1 - u0 > 1e-4) h('path', { d: sector(cx, cy, S1, S2, ang(u0), ang(u1)), fill: `var(--era-${col})`, s: kS, cls: 'rise' }, sg); });
      const big = arcs.reduce((a, q) => (q[1] - q[0] > a[1] - a[0] ? q : a));
      const nm = txt(P, `label:season:${id}`, name);
      const b0 = ang(big[0]), b1 = ang(big[1]);
      const tw = measure(root, nm, 'ts-small', { cls: 'strong' });
      const span = (tw / 2 + 6) / ((S1 + S2) / 2), lo = b0 + span + 0.05, hi = b1 - span - 0.05;
      if (lo > hi) continue;   // the name does not fit its arc: the colour and the key words still carry it
      // the curved name's box (glyphs stand outward from the baseline, or inward on the lower half
      // where the path runs back); it sits where that box leaves the centre most room
      const boxAt = am => {
        const low = Math.sin(am) > 0.2, rr = (S1 + S2) / 2 + (low ? 8 : -8), a0 = am - span, a1 = am + span;
        const ri = low ? rr - 20 : rr - 8, ro = low ? rr + 8 : rr + 20; const B = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, low, rr, a0, a1 };
        for (let q = 0; q <= 16; q++) { const a = a0 - 0.04 + (a1 - a0 + 0.08) * q / 16; for (const r of [ri, ro]) { const [x, y] = at(r, a); B.x0 = Math.min(B.x0, x); B.x1 = Math.max(B.x1, x); B.y0 = Math.min(B.y0, y); B.y1 = Math.max(B.y1, y); } }
        const hc = B.x0 > cx ? B.x0 - cx : B.x1 < cx ? cx - B.x1 : 0, vc = B.y0 > cy ? B.y0 - cy : B.y1 < cy ? cy - B.y1 : 0;
        B.room = Math.max(hc, vc * 1.6); return B;
      };
      let B = null; for (let q = 0; q <= 24; q++) { const c = boxAt(lo + (hi - lo) * q / 24); if (!B || c.room > B.room + 1e-6) B = c; }
      const { low, rr, a0, a1 } = B;
      const pa = (r, a) => `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
      const pid = `${ctx.uid}-season-${id}`;
      h('path', { id: pid, d: low ? `M${pa(rr, a1)} A${rr} ${rr} 0 0 0 ${pa(rr, a0)}` : `M${pa(rr, a0)} A${rr} ${rr} 0 0 1 ${pa(rr, a1)}`, fill: 'none' }, h('defs', {}, sg));
      const t = h('text', { cls: 'ts-small strong', fill: 'var(--ink)', s: kS }, sg);
      h('textPath', { href: `#${pid}`, startOffset: '50%', 'text-anchor': 'middle', text: nm }, t);
      editable(t, `text.label:season:${id}`);
      seasonBoxes.push(B);
    }
  }

  /* centre words */
  {
    const cg = h('g', { s: kW, cls: 'rise' }, root);
    const yrs = M.dated && !cyc ? (M.sm === 1 ? String(M.Y) : `${M.Y} to ${M.Y + 1}`) : null;
    const ccls = M.dated ? 'ts-label' : 'ts-h3', clh = M.dated ? 32 : 40;
    const note = !M.dated && M.stages.some(s => s.date) ? txt(P, 'label:spacing', 'Spaced evenly, not by date') : null;
    const extra = yrs ? 30 : 0, rD = centreR;
    // widest line a block from yT to yB may use: inside the disc, and beside (never across) a season name
    const fitW = (yT, yB) => {
      const d = Math.max(Math.abs(yT - cy), Math.abs(yB - cy)); if (d >= rD) return 0;
      let w = 2 * Math.sqrt(rD * rD - d * d) - 8;
      for (const B of seasonBoxes) if (B.y0 < yB + 4 && B.y1 > yT - 4) { if (B.x0 >= cx) w = Math.min(w, 2 * (B.x0 - cx - 8)); else if (B.x1 <= cx) w = Math.min(w, 2 * (cx - B.x1 - 8)); else return 0; }
      return w;
    };
    const tmp = h('g', {}, root); let fit = null, last = null;
    for (const c of [ccls, 'ts-tiny']) {
      const lh0 = c === 'ts-tiny' ? measureLH('ts-tiny', clh) : clh;
      for (let nl = 1; nl <= 5 && !fit; nl++) {
        const H = nl * lh0 + extra, w = fitW(cy - H / 2, cy + H / 2);
        if (w < 60 || (yrs && measure(root, yrs, 'ts-tiny') > w)) break;
        last = { c, nl, w };
        const tb = textBlock(tmp, 0, 0, P.centre, { cls: c, maxW: w, maxLines: nl, lh: clh, a: { cls: 'strong' } });
        if (tb.cls === c && !tb.lines.some(l => l.endsWith('…')) && tb.h + extra <= H + 0.5) fit = { c, nl, w, tb };
      }
      if (fit) break;
    }
    if (!fit) { const L0 = last || { c: 'ts-tiny', nl: 1, w: 120 }; fit = { ...L0, tb: textBlock(tmp, 0, 0, P.centre, { cls: L0.c, maxW: L0.w, maxLines: L0.nl, lh: clh, a: { cls: 'strong' } }) }; }
    tmp.remove();
    const tot = fit.tb.h + extra, yTop = cy - tot / 2, fs = FS[fit.tb.cls] || FS['ts-label'];
    const y0 = yTop + (fit.tb.lh - fs) / 2 + fs * 0.8;
    textBlock(cg, cx, y0, P.centre, { cls: fit.c, maxW: fit.w, maxLines: fit.nl, lh: clh, anchor: 'middle', a: { cls: 'strong', fill: 'var(--ink)' }, edit: 'centre' });
    if (yrs) computed(T(cg, cx, yTop + fit.tb.h + base0('ts-tiny', extra), yrs, 'ts-tiny', { 'text-anchor': 'middle' }), 'year');
    if (note) editable(T(cg, cx, cy + R2 + 70, note, 'ts-tiny', { 'text-anchor': 'middle', cls: 'muted' }), 'text.label:spacing');
  }

  /* stage positions: true angle on the ring; icons pushed apart along the arc only if they would touch */
  const order = M.order; const n = order.length;
  order.forEach((s, j) => { s.a = M.dated ? ang(s.pos) : ang(j / n); s.ia = s.a; });
  if (M.dated && n > 1) {
    // today's pointer is a fixed point the icons keep clear of
    const ring = [...order]; if (M.today) { const ta = ang(M.today.pos); ring.push({ fixed: true, a: ta, ia: ta }); ring.sort((x, y) => x.a - y.a); }
    const m = ring.length, minA = (2 * rIcon + 12) / Ricon;
    for (let it = 0; it < 80; it++) {
      let moved = false;
      for (let j = 0; j < m; j++) {
        const A = ring[j], B = ring[(j + 1) % m]; let d = B.ia - A.ia; if (j === m - 1) d += 2 * Math.PI;
        const need = A.fixed || B.fixed ? (rIcon + 30) / Ricon : minA;
        if (d < need) { const push = need - d + 1e-4; if (A.fixed) B.ia += push; else if (B.fixed) A.ia -= push; else { A.ia -= push / 2; B.ia += push / 2; } moved = true; }
      }
      if (!moved) break;
    }
    for (const s of order) if (Math.abs(s.ia - s.a) > 0.5) ctx.warn(`“${s.label}” had to move far from its date to fit.`);
  }

  /* labels in two columns, beside the wheel */
  const colR = M.dated ? Ricon + rIcon + 26 : Rtrack + rIcon + 46;
  const LW = Math.min(280, cx - colR - GRID.left);
  const today = M.today;
  const labs = order.map(s => ({ s, key: `st:${s.i}`, name: s.label, date: M.dated && s.date ? dateWords(s, false) : null, edit: `stages.${s.i}.label`, cpath: s.f ? `stages.${s.i}.festival` : `stages.${s.i}.month`, a: s.ia, ink: 'var(--ink)', r: rIcon, rA: Ricon }));
  // today's words are a label of their own beside the wheel, joined to the pointer's tip
  if (today) labs.push({ today: true, key: 'today', name: txt(P, 'label:today', 'Today'), date: `${today.d} ${MONTHS[today.m - 1]}`, edit: 'text.label:today', cpath: 'today.month', a: ang(today.pos), ink: 'var(--focus-text)', r: 12, rA: R2 + 13 });
  const sizeL = (L, small) => {
    L.cls = small ? 'ts-tiny' : 'ts-label'; L.ml = small ? 4 : 3;
    const tmp = h('g', {}, root); const tb = textBlock(tmp, 0, 0, L.name, { cls: L.cls, maxW: LW, maxLines: L.ml, lh: 32, a: L.today ? { cls: 'strong' } : {} }); tmp.remove();   // measured as drawn: today's words are bold
    // the kit may set a long name one step smaller; space by what it actually used
    L.cls = tb.cls; L.lh = tb.lh; L.b0 = base0(tb.cls, tb.lh);
    L.nh = tb.h; L.dateY = L.b0 + tb.h - tb.lh + dateGap;
    L.h = L.date ? L.dateY + Math.ceil(FS['ts-tiny'] * 0.3) : tb.h;
  };
  for (const L of labs) {
    const [ix, iy] = at(L.rA, L.a);
    L.ix = ix; L.iy = iy; L.right = Math.cos(L.a) > 1e-6 || (Math.abs(Math.cos(L.a)) <= 1e-6 && Math.sin(L.a) < 0);
    sizeL(L, false); L.want = iy - 12;
  }
  const top = 128, bottom = GRID.bottom, gap = 14;
  const stack = final => { for (const side of [true, false]) {
    const col = labs.filter(L => L.right === side).sort((a, b) => a.want - b.want);
    // a column that cannot hold its labels at full size sets them one step smaller, wrapping to more lines
    const need = cl => cl.reduce((t, L) => t + L.h, 0) + gap * (cl.length - 1);
    if (final && need(col) > bottom - top) col.forEach(L => sizeL(L, true));
    let y = top; for (const L of col) { L.y = Math.max(L.want - L.h / 2 + 12, y); y = L.y + L.h + gap; }
    let lim = bottom; for (let j = col.length - 1; j >= 0; j--) { col[j].y = Math.min(col[j].y, lim - col[j].h); lim = col[j].y - gap; }
    if (final && col.length && col[0].y < top - 1) ctx.warn(`Too many labels on the ${side ? 'right' : 'left'} of the wheel to fit.`);
  } };
  // leaders: a straight line from the icon's edge to the label's edge, unless it would pass another icon
  const hits = (L, pts) => labs.some(o => o !== L && pts.slice(1).some((q, j) => segD(o.ix, o.iy, pts[j], q) < o.r + 6));
  const straight = L => { const ex = L.right ? cx + colR - 10 : cx - colR + 10, ly = L.y + 16, da = Math.atan2(ly - L.iy, ex - L.ix); return [[L.ix + (L.r + 2) * Math.cos(da), L.iy + (L.r + 2) * Math.sin(da)], [ex, ly]]; };
  stack(false);
  // a stage near the top or bottom of the wheel may take the other column when that gives it a clear line
  for (const L of labs) if (Math.abs(Math.cos(L.a)) < 0.4 && hits(L, straight(L))) { L.right = !L.right; stack(false); if (hits(L, straight(L))) { L.right = !L.right; stack(false); } }
  // libfix: a column too full for its labels hands its top- or bottom-most stage to the other column,
  // then the gaps close up, so every name stays on the slide whole (it used to run off the top)
  { const H = (cl, g0) => cl.reduce((t, L) => t + L.h, 0) + g0 * Math.max(0, cl.length - 1);
    labs.forEach(L => sizeL(L, true));
    for (let guard = 0; guard < labs.length; guard++) {
      const R = labs.filter(L => L.right), Lf = labs.filter(L => !L.right);
      const [full, other] = H(R, gap) > H(Lf, gap) ? [R, Lf] : [Lf, R];
      if (H(full, gap) <= bottom - top) break;
      const mv = full.slice().sort((p, q) => Math.abs(Math.cos(p.a)) - Math.abs(Math.cos(q.a)))[0];
      if (!mv || H(other, gap) + mv.h + gap > bottom - top) break;
      mv.right = !mv.right;
    }
    labs.forEach(L => sizeL(L, false)); }
  stack(true);
  { const over = side => { const cl = labs.filter(L => L.right === side); return cl.length && cl[0] && Math.min(...cl.map(L => L.y)) < top - 1; };
    if (over(true) || over(false)) { const g0 = gap; for (const side of [true, false]) { const col = labs.filter(L => L.right === side).sort((p, q) => p.y - q.y);
      let y = top; for (const L of col) { L.y = Math.max(L.y, y); y = L.y + L.h + Math.min(g0, 6); }
      let lim = bottom; for (let j = col.length - 1; j >= 0; j--) { col[j].y = Math.min(col[j].y, lim - col[j].h); lim = col[j].y - Math.min(g0, 6); } } } }

  /* draw the stages */
  const hand = { g: null, a: 0, from: ang(0) };
  for (const L of labs) {
    const k = bi(L.key);
    const g = h('g', { c: ctx.rc(L.key) }, root);
    const dl = L.today ? 1200 : 0;
    const lx = L.right ? cx + colR : cx - colR, anchor = L.right ? 'start' : 'end';
    const ly = L.y + 16;   // middle of the first line
    {
      const s = L.s;
      if (M.dated && !L.today) {
        const [dx, dy] = at(R2, s.a), [ex2, ey2] = at(Ricon - rIcon, s.ia);
        h('line', { x1: dx, y1: dy, x2: ex2, y2: ey2, stroke: 'var(--event)', 'stroke-width': 'var(--sw-rule)', s: k }, g);
        h('circle', { cx: dx, cy: dy, r: 6, fill: 'var(--event)', stroke: 'var(--bg)', 'stroke-width': 2, s: k, cls: 'pop' }, g);
      }
      // leader from the icon's edge to the label's edge; if a straight line would pass another icon,
      // step radially out past the ring of icons first, then across to the label
      const ex = L.right ? lx - 10 : lx + 10;
      let pts = straight(L);
      if (hits(L, pts)) { const ra = Math.atan2(L.iy - cy, L.ix - cx); const out = L.today ? Ricon + rIcon + 8 - L.rA : L.r + 16;   // today's line clears the ring of pictures first
        pts = [[L.ix + (L.r + 2) * Math.cos(ra), L.iy + (L.r + 2) * Math.sin(ra)], [L.ix + out * Math.cos(ra), L.iy + out * Math.sin(ra)], [ex, ly]]; if (hits(L, pts)) {
          // last resort: round the outside of the ring of pictures, then straight out to the label
          const Ro = Ricon + rIcon + 10, ta = Math.atan2(ly - cy, ex - cx); let da = ta - ra; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
          const nS = Math.max(2, Math.ceil(Math.abs(da) / 0.08)); pts = [pts[0], at(Ro, ra)]; for (let q = 1; q <= nS; q++) pts.push(at(Ro, ra + da * q / nS)); pts.push([ex, ly]);
          if (hits(L, pts)) ctx.warn(`The line to “${L.name}” passes another picture.`);
        } }
      if (Math.hypot(ex - pts[0][0], ly - pts[0][1]) > 12) h('polyline', { points: pts.map(q => q.map(v => v.toFixed(1)).join(',')).join(' '), fill: 'none', stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-hair)', 'stroke-linejoin': 'round', s: k, cls: 'rise', delay: 300 + dl }, g);
      if (!L.today) {
        const ig = h('g', { s: k, cls: 'pop', delay: 150 }, g);
        h('circle', { cx: L.ix, cy: L.iy, r: rIcon, fill: 'var(--paper)', stroke: 'var(--event)', 'stroke-width': 'var(--sw-struct)' }, ig);
        icon(ig, s.icon, L.ix, L.iy);
      }
    }
    const lg = h('g', { s: k, cls: 'rise', delay: 300 + dl }, g);
    textBlock(lg, lx, L.y + L.b0, L.name, { cls: L.cls, maxW: LW, maxLines: L.ml, lh: L.lh, anchor, a: L.today ? { cls: 'strong', fill: L.ink } : { fill: L.ink }, edit: L.edit });
    if (L.date) computed(T(lg, lx, L.y + L.dateY, L.date, 'ts-tiny', { 'text-anchor': anchor }), L.cpath);
  }

  // today: a pointer that travels round the outside of the year to today's date; its words sit in the centre
  if (today) {
    const inner = h('g', {}, h('g', { s: bi('today') }, root));
    h('path', { d: `M${R2 + 3} 0 L${R2 + 23} -12 L${R2 + 23} 12 Z`, fill: 'var(--focus)' }, inner);
    hand.g = inner; hand.a = ang(today.pos); inner.setAttribute('transform', `translate(${cx} ${cy}) rotate(${hand.a * 180 / Math.PI})`);
  }

  /* any cycle: arrows round the ring, each drawn as its stage arrives; the last closes the loop in the summary */
  if (!M.dated && n > 1) {
    const dA = (rIcon + 10) / Rtrack;
    for (let j = 0; j < n; j++) {
      const A = order[j], B = order[(j + 1) % n]; const a0 = A.a + dA; let a1 = B.a - dA; if (a1 <= a0) a1 += 2 * Math.PI;
      const [x0, y0] = at(Rtrack, a0), [x1, y1] = at(Rtrack, a1);
      const hd = ctx.tk.head * .72; const a1b = a1 - hd / Rtrack; const [x1b, y1b] = at(Rtrack, a1b);
      const d = `M${x0.toFixed(1)} ${y0.toFixed(1)} A${Rtrack} ${Rtrack} 0 ${a1b - a0 > Math.PI ? 1 : 0} 1 ${x1b.toFixed(1)} ${y1b.toFixed(1)}`;
      const kk = j === n - 1 ? N : bi(`st:${B.i}`);
      arrow(ctx, root, d, x1b, y1b, a1b + Math.PI / 2, 'var(--ink-2)', 'var(--sw-arrow)', { draw: kk, g: {} });
      void x1; void y1;
    }
  }

  const setHand = a => { if (hand.g) hand.g.setAttribute('transform', `translate(${cx} ${cy}) rotate(${a * 180 / Math.PI})`); };
  return {
    dur: { today: 1500 },
    still() { setHand(hand.a); },
    reset() { setHand(hand.a); },
    tick(k, u) { if (!hand.g) return; if (k === bi('today') && !RM.matches) setHand(hand.from + (hand.a - hand.from) * eIO(clamp(u))); else if (k >= bi('today')) setHand(hand.a); },
  };
}
