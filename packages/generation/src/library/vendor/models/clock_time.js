// Clocks and time: one time on an analogue face, a digital readout (12- or 24-hour) or both,
// read hand by hand, then in words; optionally a number of minutes passes and the minute hand
// sweeps through them (the hour hand creeps with it) to an end time worked out in code.
// Built on the kit and the batch B clock parts.
import {
  h, T, measure, clamp, eIO, GRID,
  textBlock, editable, computed, txt, TEXT_PARAM, TITLE_PARAM, schemaCheck, withDefaults, result,
} from '../kit/index.js';
import { clockFace, digitalTime, timeWords } from '../kit/batch-B.js';

export const meta = {
  id: 'clock_time', name: 'Clocks and time', kind: 'info', version: 1,
  subjects: ['Maths'],
  years: ['Y1', 'Y2', 'Y3', 'Y4'],
  teaches: 'How to read the time on analogue and digital clocks, say it in words, convert to the 24-hour clock and work out how long passes.',
};

const CLOCKS = ['analogue', 'digital12', 'digital24', 'both12', 'both24'];
export const params = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', title: 'Clocks and time',
  required: ['time'],
  properties: {
    title: TITLE_PARAM('What time is it?'),
    time: { type: 'string', title: 'Time', description: 'Like 3:45, 14:45 or 2:45 pm. Hours and minutes, with a colon.', minLength: 1, maxLength: 12, default: '3:45' },
    clock: { type: 'string', title: 'Clock', enum: CLOCKS, 'x-labels': ['Analogue clock', 'Digital, 12-hour (am and pm)', 'Digital, 24-hour', 'Analogue and 12-hour digital', 'Analogue and 24-hour digital'], default: 'analogue' },
    words: { type: 'string', title: 'Say it in words', enum: ['past-to', 'past-to-day', 'none'], 'x-labels': ['Yes (quarter to 4)', 'Yes, with the time of day (3:45 pm is quarter to 4 in the afternoon)', 'No words'], default: 'past-to' },
    duration: { type: 'integer', title: 'Minutes that pass', description: '0 for none. The minute hand sweeps through them and the end time is worked out for you.', minimum: 0, maximum: 720, default: 0 },
    showFiveMinuteRing: { type: 'boolean', title: 'Show minutes in fives round the outside', default: false },
    shade: { type: 'boolean', title: 'Shade the minutes past or to the hour', description: 'Its own step: shades from 12 to the minute hand (past) or from the minute hand to 12 (to).', default: false },
    nameHands: { type: 'boolean', title: 'Name the hands', description: 'Say which hand is the hour hand and which is the minute hand, in their steps.', default: true, 'x-panel': 'advanced' },
    text: TEXT_PARAM,
  },
};

export const presets = [
  { id: 'y1-oclock-half-past', name: 'Year 1: o’clock and half past', params: {
    title: 'O’clock and half past', time: '3:00', clock: 'analogue', words: 'past-to', duration: 30 } },
  { id: 'y2-quarter-to', name: 'Year 2: quarter to 4', params: {
    title: 'Quarter to', time: '3:45', clock: 'analogue', words: 'past-to', showFiveMinuteRing: true, shade: true } },
  { id: 'y3-how-long', name: 'Year 3: how long is the film?', params: {
    title: 'How long is the film?', time: '10:40 am', clock: 'both12', words: 'past-to', duration: 35, showFiveMinuteRing: true,
    text: { 'label:start': 'The film starts', 'label:end': 'The film ends' } } },
  { id: 'y4-24-hour', name: 'Year 4: 14:45 on the 24-hour clock', params: {
    title: 'The 24-hour clock', time: '14:45', clock: 'both24', words: 'past-to-day', nameHands: false } },
];

/* ------------------------------------------------------------------ time maths */
const pad = n => String(n).padStart(2, '0');
/** Parse "3:45", "03.45", "14:45", "2:45 pm", "12:00am". Returns {h 0–23, m} or {error}. */
export function parseTime(s) {
  const raw = String(s == null ? '' : s).trim();
  const mt = raw.match(/^(\d{1,2})\s*[:.]\s*(\d{1,2})\s*(am|pm|a\.m\.|p\.m\.)?$/i);
  if (!mt) return { error: `“${raw}” is not a time we can read. Write hours and minutes with a colon, like 3:45, 14:45 or 2:45 pm.` };
  let hh = +mt[1]; const mm = +mt[2]; const ap = mt[3] ? mt[3][0].toLowerCase() : null;
  if (mt[2].length !== 2) return { error: `Minutes are written with two digits: ${hh}:${pad(mm)}, not ${raw}.` };
  if (mm > 59) { const t = hh * 60 + mm; return { error: `There are 60 minutes in an hour, so the minutes only go up to 59. ${raw} is really ${ap ? `${((Math.floor(t / 60) % 12) || 12)}:${pad(t % 60)}` : `${pad(Math.floor(t / 60) % 24)}:${pad(t % 60)}`}.` }; }
  if (ap) {
    if (hh < 1 || hh > 12) return { error: hh > 12 ? `${raw} mixes the two clocks: with am or pm the hours go from 1 to 12. Write ${pad(hh)}:${pad(mm)} or ${hh - 12}:${pad(mm)} pm.` : `With am or pm the hours go from 1 to 12. Midnight is 12:00 am.` };
    hh = (hh % 12) + (ap === 'p' ? 12 : 0);
  } else if (hh > 23) return { error: `The 24-hour clock goes from 00:00 to 23:59, so there is no ${raw}. Midnight is 00:00.` };
  return { h: hh, m: mm, ap: !!ap };
}
const fmt12 = (hh, mm) => `${((hh + 11) % 12) + 1}:${pad(mm)} ${hh % 24 < 12 ? 'am' : 'pm'}`;
const fmt24 = (hh, mm) => `${pad(hh % 24)}:${pad(mm)}`;
const fmtFace = (hh, mm) => `${((hh + 11) % 12) + 1}:${pad(mm)}`;
const hour12 = hh => ((hh + 11) % 12) + 1;
const durText = n => { const hh = Math.floor(n / 60), mm = n % 60; const H = hh ? `${hh} hour${hh === 1 ? '' : 's'}` : ''; const M = mm || !hh ? `${mm} minute${mm === 1 ? '' : 's'}` : ''; return [H, M].filter(Boolean).join(' '); };
function sayTime(hh, mm, day) {
  if (day && mm === 0 && hh % 24 === 0) return '12 o’clock midnight';
  if (day && mm === 0 && hh % 24 === 12) return '12 o’clock midday';
  const w = timeWords(hh % 24, mm).replace("o'clock", 'o’clock');
  if (!day) return w;
  // the time of day belongs to the hour the words name ("quarter to 12" at 23:45 is still the evening)
  const H = hh % 24; return `${w} ${H < 12 ? 'in the morning' : H < 18 ? 'in the afternoon' : 'in the evening'}`;
}

function model(P) {
  const t = parseTime(P.time); const c = P.clock || 'analogue';
  const face = c === 'analogue' || c.startsWith('both'), digital = c !== 'analogue', h24 = c.endsWith('24');
  const words = P.words !== 'none', day = P.words === 'past-to-day';
  const d = P.duration || 0; const endAbs = t.h * 60 + t.m + d;
  const end = { h: Math.floor(endAbs / 60) % 24, m: endAbs % 60, days: Math.floor(endAbs / 1440) };
  const show = (hh, mm) => digital ? (h24 ? fmt24(hh, mm) : fmt12(hh, mm)) : fmtFace(hh, mm);
  return { t, face, digital, h24, words, day, d, end, show, shade: face && !!P.shade && t.m !== 0, ring: face && !!P.showFiveMinuteRing, hands: face && P.nameHands !== false };
}

/* ------------------------------------------------------------------ validate */
export function validate(raw) {
  const P = withDefaults(params, raw);
  const R = schemaCheck(params, P); const W = [];
  if (R.length) return result(R);
  const t = parseTime(P.time);
  if (t.error) R.push({ path: 'time', reason: t.error });
  if (R.length) return result(R);
  const face = P.clock === 'analogue' || P.clock.startsWith('both');
  if (P.shade && !face) W.push({ path: 'shade', reason: 'Shading needs an analogue clock, so it is left out.' });
  if (P.shade && face && t.m === 0) W.push({ path: 'shade', reason: `At ${t.h % 12 || 12} o’clock there are no minutes past or to the hour to shade, so that step is left out.` });
  if (P.showFiveMinuteRing && !face) W.push({ path: 'showFiveMinuteRing', reason: 'The minutes in fives go round an analogue clock, so they are left out.' });
  // a bare 1–12 hour (no leading zero, no am or pm) could be morning or afternoon: refuse it where the time of day shows
  const hs = String(P.time).trim().match(/^\d+/)[0];
  const showsDay = P.clock === 'digital12' || P.clock === 'both12' || P.words === 'past-to-day';
  const read24 = P.clock.endsWith('24') && hs.length === 2; // 10:00 to 12:59 on a 24-hour clock are already clear
  if (!t.ap && t.h >= 1 && t.h <= 12 && hs[0] !== '0' && showsDay && !read24) return result([{ path: 'time', reason: `Add am or pm: is it ${t.h}:${pad(t.m)} am or ${t.h}:${pad(t.m)} pm?` }]);
  if (P.clock === 'analogue' && t.ap &&P.words !== 'past-to-day') W.push({ path: 'time', reason: 'An analogue clock looks the same in the morning and the afternoon. Choose words with the time of day to show am or pm.' });
  return result(R, W);
}

/* ------------------------------------------------------------------ builds */
function handCaption(M) {
  const { h: hh, m: mm } = M.t; const H = hour12(hh), N = hour12(hh + 1);
  if (mm === 0) return `The short hand is the hour hand. It points straight at ${H}.`;
  const where = mm === 30 ? `halfway to ${N}` : mm === 15 ? `a quarter of the way to ${N}` : mm === 45 ? `three quarters of the way to ${N}` : `on the way to ${N}`;
  return `The short hand is the hour hand: past ${H}, ${where}.`;
}
function minuteCaption(M) {
  const mm = M.t.m;
  if (mm === 0) return 'The long hand is the minute hand. It points straight up to 12: on the hour.';
  const at = mm % 5 === 0 ? `points to ${mm / 5}` : `is between ${Math.floor(mm / 5) || 12} and ${Math.floor(mm / 5) + 1}`;
  return M.ring ? `The long hand is the minute hand. Count in fives: ${mm} minutes past.` : `The long hand is the minute hand. It ${at}: ${mm} minute${mm === 1 ? '' : 's'} past.`;
}
function convertCaption(M) {
  const { h: hh, m: mm } = M.t; const a = fmt24(hh, mm), b = fmt12(hh, mm);
  if (hh >= 13) return `Take 12 from hours after 12: ${a} is ${b}.`;
  if (hh === 12 && mm === 0) return `${a} is midday, so it is ${b}.`;
  if (hh === 12) return `${a} is just after midday, so it is ${b}.`;
  if (hh === 0) return `00 hours is the hour after midnight, so ${a} is ${b}.`;
  return `Hours before 12 are in the morning: ${a} is ${b}.`;
}
function plan(P) {
  const M = model(P); const { h: hh, m: mm } = M.t; const items = [];
  if (M.face) {
    items.push({ key: 'face', caption: 'A clock face: the numbers 1 to 12 go round clockwise.' });
    items.push({ key: 'hour', caption: handCaption(M) });
    items.push({ key: 'minute', caption: minuteCaption(M) });
    if (M.shade) items.push({ key: 'shade', caption: mm <= 30 ? `The shaded part is the ${durText(mm)} gone past ${hour12(hh)} o’clock.` : `The shaded part is the ${durText(60 - mm)} still to go until ${hour12(hh + 1)} o’clock.` });
  }
  if (M.digital) items.push({ key: 'digital', caption: M.h24 ? `A 24-hour clock counts the hours from 00 to 23: ${fmt24(hh, mm)}.` : `A digital clock: hours before the colon, minutes after it: ${fmt12(hh, mm)}.` });
  if (M.digital && M.h24) items.push({ key: 'convert', caption: convertCaption(M) });
  if (M.words) items.push({ key: 'words', caption: `We say ${sayTime(hh, mm, M.day)}.` });
  if (M.d) {
    items.push({ key: 'sweep', caption: M.face ? `${durText(M.d)[0].toUpperCase()}${durText(M.d).slice(1)} pass. The minute hand turns, and the hour hand creeps on too.` : `${durText(M.d)[0].toUpperCase()}${durText(M.d).slice(1)} pass.` });
    const e = M.end; const nd = e.days ? ', the next day' : '';
    items.push({ key: 'end', caption: `${durText(M.d)} after ${M.show(hh, mm)} is ${M.show(e.h, e.m)}${M.words ? `: ${sayTime(e.h, e.m, M.day)}` : ''}${nd}.` });
  }
  const summary = M.d ? `From ${M.show(hh, mm)} to ${M.show(M.end.h, M.end.m)}${M.end.days ? ' the next day' : ''} is ${durText(M.d)}.`
    : M.words ? `${M.show(hh, mm)} is ${sayTime(hh, mm, M.day)}.` : `The time is ${M.show(hh, mm)}.`;
  const sumW = M.d && M.words && !M.digital ? `From ${sayTime(hh, mm, M.day)} to ${sayTime(M.end.h, M.end.m, M.day)}${M.end.days ? ' the next day' : ''} is ${durText(M.d)}.` : null;
  return { M, items, summary: sumW || summary };
}
export function builds(P) { const { items, summary } = plan(P); return { steps: items.map(({ key, caption }) => ({ key, caption })), summary: { caption: summary } }; }

export function notes(P) {
  const { M, items } = plan(P); const { h: hh, m: mm } = M.t;
  const steps = items.map(it => {
    switch (it.key) {
      case 'face': return 'Ask: which way do the hands go round? Point out the small marks: there are 60 of them, one for each minute.';
      case 'hour': return mm === 0 ? 'On the hour, the hour hand points exactly at the number.' : `The hour hand moves slowly all hour. At ${fmtFace(hh, mm)} it has gone ${mm} sixtieths of the way to the next number, so read the number it has just passed.`;
      case 'minute': return 'The minute hand goes all the way round once every hour. Each number on the face is 5 more minutes.';
      case 'shade': return mm <= 30 ? 'Up to half past, we say minutes past the hour just gone.' : 'After half past, we count the minutes still to go and say “to” the next hour.';
      case 'digital': return M.h24 ? 'The 24-hour clock always uses four digits and never needs am or pm.' : 'am is from midnight to midday; pm is from midday to midnight.';
      case 'convert': return 'From 13:00 on, take 12 from the hours for the 12-hour clock. Before 10:00 the 24-hour clock starts with a 0. Midnight is 00:00.';
      case 'words': return 'Ask the class to say the time aloud, then to show it on mini clocks.';
      case 'sweep': return `Count on in steps: to the next o’clock first, then the rest. ${durText(M.d)} in all.`;
      case 'end': return M.end.days ? 'The time went past midnight, so it is the next day.' : 'Ask: what would the time be 15 minutes later?';
      default: return '';
    }
  });
  return { steps, summary: M.d ? 'Ask: how could you check the answer? Count back from the end time.' : 'Ask the class to draw the hands for a time 15 minutes later.' };
}

/* ------------------------------------------------------------------ render */
export function render(root, P, ctx) {
  const { M, items } = plan(P); const b = ctx.b; const N = ctx.N; const bi = k => b[k];
  const { h: hh, m: mm } = M.t; const has = k => b[k] != null;
  // the clock is as big as the stage allows (the five-minute ring needs room outside it). It sits in the middle
  // of the slide while the hands are the point, and moves left when the reading column first shows.
  const R = M.ring ? 204 : 250, out = M.ring ? 44 : 0, CY = (GRID.top + GRID.bottom) / 2;
  const CX = GRID.left + R + out + 20, CXC = GRID.W / 2;
  const minLen = R - 92, hourLen = R * .42; // both hands stop short of the numerals
  // reading column: right of the clock, or the middle of the slide with no clock
  const colX0 = M.face ? CX + R + out + 48 : 290, colX1 = M.face ? GRID.right : 990, cx = (colX0 + colX1) / 2, colW = colX1 - colX0;
  const endK = has('end') ? bi('end') : null;
  const kMove = M.face ? ['digital', 'words', 'sweep'].map(bi).filter(k => k != null).reduce((a, k) => Math.min(a, k), Infinity) : Infinity;
  const clk = h('g', {}, root);
  const place = u => clk.setAttribute('transform', `translate(${((CXC - CX) * (1 - u)).toFixed(2)} 0)`);
  place(kMove < Infinity ? 1 : 0);

  /* the analogue face */
  let F = null, elapsed = null, ghost = null;
  if (M.face) {
    F = clockFace(clk, hh, mm, { cx: CX, cy: CY, r: R, ring: false, a: { s: bi('face'), cls: 'rise' }, hourA: { s: bi('hour') }, minA: { s: bi('minute') }, computedPath: 'clock' });
    // flat face with one outline: no shadow, no second edge, no halos on the numerals
    F.g.querySelectorAll('.lift, .body, .halo-paper').forEach(el => el.classList.remove('lift', 'body', 'halo-paper'));
    F.minute.firstChild.setAttribute('y2', CY - minLen); F.hour.firstChild.setAttribute('y2', CY - hourLen);
    // where the minute hand points: a marker on the tick ring, outside the numerals, turning with the hand
    h('line', { x1: CX, y1: CY - (R - 12), x2: CX, y2: CY - (R - 34), stroke: 'var(--focus)', 'stroke-width': 'calc(var(--sw-data) * 1.4)', 'stroke-linecap': 'round' }, F.minute);
    const behind = F.g.childNodes[2]; // after the face and its rim: under the ticks, numbers and hands
    if (M.ring) {
      const rg = h('g', { s: bi('minute'), cls: 'rise' }, F.g);
      for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6 - Math.PI / 2; computed(T(rg, CX + (R + 42) * Math.cos(a), CY + (R + 42) * Math.sin(a) + 10, String(i * 5), 'ts-label', { 'text-anchor': 'middle', fill: 'var(--ink-2)' }), 'clock'); }
    }
    const sector = (a0, a1, rr) => { // angles in degrees clockwise from 12
      if (a1 - a0 >= 359.99) return `M${CX} ${CY - rr} A${rr} ${rr} 0 1 1 ${CX - .01} ${CY - rr} Z`;
      const P2 = a => { const r2 = (a - 90) * Math.PI / 180; return `${(CX + rr * Math.cos(r2)).toFixed(2)} ${(CY + rr * Math.sin(r2)).toFixed(2)}`; };
      return `M${CX} ${CY} L${P2(a0)} A${rr} ${rr} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${P2(a1)} Z`;
    };
    if (M.shade) {
      const [a0, a1] = mm <= 30 ? [0, mm * 6] : [mm * 6, 360];
      F.g.insertBefore(h('path', { d: sector(a0, a1, R - 4), fill: 'var(--compare-pale)', s: bi('shade'), hide: has('sweep') ? bi('sweep') : null }, null), behind);
    }
    if (M.d) {
      elapsed = h('path', { d: '', fill: 'var(--focus-pale)', s: bi('sweep') }, null); F.g.insertBefore(elapsed, behind);
      elapsed.sector = u => { const a0 = mm * 6, span = Math.min(M.d * u, 60) * 6, turns = M.d * u >= 60; elapsed.setAttribute('d', turns ? sector(0, 360, R - 4) : span > 0 ? sector(a0, a0 + span, R - 4) : ''); };
      // ghost of the minute hand where it started
      const a = (mm * 6 - 90) * Math.PI / 180;
      ghost = h('line', { x1: CX, y1: CY, x2: CX + minLen * Math.cos(a), y2: CY + minLen * Math.sin(a), stroke: 'var(--focus)', 'stroke-width': 'var(--sw-rule)', 'stroke-dasharray': '6 7', 'stroke-linecap': 'round', s: bi('sweep') }, null);
      F.g.insertBefore(ghost, F.minute.parentNode.parentNode);
    }
  }

  /* hand names: right next to the centred clock, only while the hands are the point */
  if (M.hands) {
    const until = bi('minute') + 1, x0 = CXC + R + out + 40, w = GRID.right - x0;
    // an earlier name steps back by colour (ink-2 at full opacity keeps AA contrast), not by fading
    const row = (y, len, sw, col, label, edit, s, hide, dim) => {
      const g = h('g', dim ? { s, hide } : { s, hide, cls: 'rise' }, root);
      h('line', { x1: x0, x2: x0 + len, y1: y, y2: y, stroke: dim ? 'var(--ink-3)' : col, 'stroke-width': sw, 'stroke-linecap': 'round' }, g);
      textBlock(g, x0, y + 46, label, { cls: 'ts-label', maxW: w, maxLines: 5, lh: 32, edit, a: { fill: dim ? 'var(--ink-2)' : 'var(--ink)' } });
    };
    const hourL = txt(P, 'label:hour', 'The short hand shows the hour.');
    row(CY - 150, 64, 'calc(var(--sw-data) * 1.8)', 'var(--ink)', hourL, 'text.label:hour', bi('hour'), bi('minute'));
    row(CY - 150, 64, 'calc(var(--sw-data) * 1.8)', 'var(--ink)', hourL, 'text.label:hour', bi('minute'), until, true);
    row(CY + 50, 112, 'var(--sw-data)', 'var(--focus)', txt(P, 'label:minute', 'The long hand shows the minutes.'), 'text.label:minute', bi('minute'), until);
  }

  /* the reading column: start (card, conversion, words), the minutes that pass, the end */
  // Two stacks share the column: the start (and the minutes counting on) until the end build, then one dimmed
  // summary of the start above the end, so each build has one focal point.
  const G = h('g', {}, root);
  const tmp = h('g', {}, root);
  const WCLS = M.d ? 'ts-h3' : 'ts-num', WLH = M.d ? 40 : 50;
  const wordsH = s => textBlock(tmp, 0, 0, s, { cls: WCLS, maxW: colW, maxLines: 2, lh: WLH }).h;
  const labH = (s, cls, lh) => textBlock(tmp, 0, 0, s, { cls, maxW: colW, maxLines: 2, lh }).h;
  const label = (s, edit, a) => ({ h: labH(s, 'ts-cap', 30) + 8, draw: y => textBlock(G, cx, y + 24, s, { cls: 'ts-cap', maxW: colW, maxLines: 2, lh: 30, anchor: 'middle', edit, a }) });
  const reading = (tag, H, Mi, k0, kWords, hide) => {
    const rows = [];
    if (M.d) rows.push(label(txt(P, `label:${tag}`, tag === 'start' ? 'Starts at' : 'Ends at'), `text.label:${tag}`, { s: k0, hide }));
    if (M.digital) rows.push({ h: 80, draw: y => digitalTime(G, cx, y + 60, H, Mi, { h24: M.h24, computedPath: 'time', a: { s: k0, cls: 'rise', hide } }) });
    if (M.digital && M.h24 && tag === 'start') rows.push({ h: 56, draw: y => computed(T(G, cx, y + 44, `= ${fmt12(H, Mi)}`, 'ts-num', { 'text-anchor': 'middle', fill: 'var(--focus-text)', s: bi('convert'), cls: 'rise', hide }), 'time') });
    if (M.words) { const s = sayTime(H, Mi, M.day); rows.push({ h: wordsH(s) + 6, draw: y => { const tb = textBlock(G, cx, y + WLH - 8, s, { cls: WCLS, maxW: colW, maxLines: 2, lh: WLH, anchor: 'middle', a: { fill: 'var(--ink)', s: kWords, cls: 'rise', hide } }); computed(tb.el, tag === 'start' ? 'time' : 'duration'); } }); }
    return rows;
  };
  const gapIn = 6, gapBlock = 18, top0 = GRID.top + 10, bot0 = GRID.bottom - 10;
  const stack = blocks => { // centred in the stage
    const total = blocks.reduce((s, bl) => s + bl.reduce((a, r) => a + r.h, 0) + gapIn * (bl.length - 1), 0) + gapBlock * Math.max(0, blocks.length - 1);
    if (total > bot0 - top0) ctx.warn(`The time column needs ${total | 0} units of height; the stage has ${bot0 - top0}.`);
    let y = Math.max(top0, (top0 + bot0) / 2 - total / 2);
    for (const bl of blocks) { for (const r of bl) { r.draw(y); y += r.h + gapIn; } y += gapBlock - gapIn; }
  };
  const startK = M.digital ? bi('digital') : bi('words');
  const A = [];
  if (M.digital || M.words) A.push(reading('start', hh, mm, startK, M.words ? bi('words') : null, endK));
  let counter = null;
  if (M.d) {
    A.push([{ h: 64, draw: y => {
      const g = h('g', { s: bi('sweep'), hide: endK }, G);
      counter = computed(T(g, cx, y + 44, `+ ${durText(M.d)}`, 'ts-num', { 'text-anchor': 'middle', fill: 'var(--focus-text)' }), 'duration');
    } }]);
  }
  stack(A);
  if (M.d) {
    const e = M.end, D = durText(M.d);
    const dim = (s, path) => ({ h: labH(s, 'ts-label', 36) + 4, draw: y => computed(textBlock(G, cx, y + 30, s, { cls: 'ts-label', maxW: colW, maxLines: 2, lh: 36, anchor: 'middle', a: { fill: 'var(--ink-2)', s: endK, cls: 'rise' } }).el, path) });
    const endRows = reading('end', e.h, e.m, endK, endK, null);
    if (e.days) endRows.push(label(txt(P, 'label:nextday', 'the next day'), 'text.label:nextday', { s: endK, cls: 'rise' }));
    stack([[dim(`${txt(P, 'label:start', 'Starts at')} ${M.digital ? M.show(hh, mm) : sayTime(hh, mm, M.day)}.`, 'time'), dim(`${D[0].toUpperCase()}${D.slice(1)} later:`, 'duration')], endRows]);
  }
  tmp.remove();

  /* motion: the clock moves aside for the reading column; the minute hand sweeps through the minutes that pass */
  const sweepK = has('sweep') ? bi('sweep') : null;
  const at = u => { if (F) F.set(hh, mm + M.d * u); if (elapsed) elapsed.sector(u); if (counter) counter.textContent = `+ ${durText(Math.round(M.d * u))}`; };
  const step = (k, u, k0) => k < k0 ? 0 : k > k0 ? 1 : eIO(u);
  return {
    dur: sweepK != null ? { sweep: clamp(1400 + M.d * 14, 1800, 4200) } : {},
    reset() { at(0); place(0); },
    still() { at(sweepK != null ? 1 : 0); place(kMove < Infinity ? 1 : 0); },
    tick(k, u) { place(step(k, u, kMove)); if (sweepK != null) at(step(k, u, sweepK)); },
  };
}
