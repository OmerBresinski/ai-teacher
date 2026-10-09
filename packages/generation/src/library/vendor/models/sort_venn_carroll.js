// Sorting with hoops, Venn and Carroll diagrams: one, two or three rules, up to 12 things to
// sort. Builds: the empty diagram with everything waiting in the tray -> each thing flies to its
// place, with the reason in the caption -> the overlap (or the "fits both" box) is explained ->
// the things that fit no rule go outside (or into the "neither" box). Number rules ("even",
// "multiples of 3", "more than 20", "factors of 24", "square numbers", "prime") are checked in
// code and a wrong placement is refused; word rules are the teacher's choice.
import {
  h, measure, textBlock,
  txt, TEXT_PARAM, TITLE_PARAM, schemaCheck, withDefaults, result,
} from '../kit/index.js';
import { numberRule } from '../kit/batch-C.js';
import { COLS } from './sort_venn_carroll/venn.js';
import { solve } from './sort_venn_carroll/layout.js';
import { estW } from './sort_venn_carroll/textw.js';
import { picFor, drawPic } from './sort_venn_carroll/pictures.js';

export const meta = {
  id: 'sort_venn_carroll', name: 'Sorting: hoops, Venn and Carroll', kind: 'info', version: 1,
  subjects: ['Maths', 'Science'],
  years: ['Reception', 'Y1', 'Y2', 'Y3', 'Y4', 'Y5', 'Y6'],
  teaches: 'Sorting things by one, two or three rules, and reading where each one belongs: inside, in the overlap, or outside.',
};

const FIT = { type: 'string', enum: ['auto', 'yes', 'no'], 'x-labels': ['Work it out (number rules)', 'Fits', 'Does not fit'], default: 'auto' };
export const params = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', title: 'Sorting diagram',
  properties: {
    title: TITLE_PARAM('Sorting'),
    diagram: { type: 'string', title: 'Diagram', enum: ['hoops', 'venn', 'carroll'], 'x-labels': ['Sorting hoops (apart)', 'Venn diagram (hoops overlap)', 'Carroll diagram (a grid of boxes)'], default: 'venn',
      description: 'A Carroll diagram sorts by one rule (two boxes) or two rules (four boxes).' },
    rules: {
      type: 'array', title: 'Rules', 'x-item': 'a rule', minItems: 1, maxItems: 3,
      description: 'Number rules like “Even”, “Multiples of 3”, “More than 20”, “Factors of 24”, “Square numbers” or “Prime” are checked for you. Any other words are a rule you sort by hand.',
      default: [{ label: 'Even' }, { label: 'Multiples of 3' }],
      items: { type: 'object', required: ['label'], default: { label: 'New rule' }, properties: {
        label: { type: 'string', title: 'Rule', minLength: 1, maxLength: 24 /* libfix: what the lane holds at the most items (tools/laneFit); longer is refused, never cut */ },
        not: { type: 'string', title: 'Opposite (Carroll heading)', description: 'Leave empty to have it worked out, like “Not red” or “Does not have legs”.', maxLength: 40, default: '', 'x-panel': 'advanced' },
      } },
    },
    items: {
      type: 'array', title: 'Things to sort', 'x-item': 'a thing', minItems: 1, maxItems: 12,
      default: [{ label: '6' }, { label: '8' }, { label: '9' }, { label: '12' }, { label: '7' }],
      items: { type: 'object', required: ['label'], default: { label: '10' }, properties: {
        label: { type: 'string', title: 'Thing or number', description: 'One or two short words, so it fits on its card.', minLength: 1, maxLength: 16 },
        r1: Object.assign({}, FIT, { title: 'Rule 1' }),
        r2: Object.assign({}, FIT, { title: 'Rule 2' }),
        r3: Object.assign({}, FIT, { title: 'Rule 3' }),
      } },
    },
    cards: { type: 'string', title: 'Cards', enum: ['words', 'pictures'], 'x-labels': ['Words', 'Pictures with words'], default: 'words',
      description: 'Pictures show for everyday things like “red ball”, “blue car” or “banana”. Anything without a picture stays a word card.' },
    itemSteps: { type: 'string', title: 'How things arrive', enum: ['one-each', 'by-place'], 'x-labels': ['One step each', 'One step per place'], default: 'one-each', 'x-panel': 'advanced' },
    text: TEXT_PARAM,
  },
};

const nums = (...a) => a.map(v => ({ label: String(v) }));
export const presets = [
  // every thing says its colour, or is one colour in every class (a fire engine is red, a banana is
  // yellow, an orange is orange), and is plainly round or plainly not: no tomatoes, apples or coins
  { id: 'rec-red-round', name: 'Reception: red things and round things', params: {
    title: 'Red things and round things', diagram: 'venn', cards: 'pictures',
    rules: [{ label: 'Red' }, { label: 'Round' }],
    items: [{ label: 'fire engine', r1: 'yes' }, { label: 'red ball', r1: 'yes', r2: 'yes' }, { label: 'blue ball', r2: 'yes' }, { label: 'red brick', r1: 'yes' },
      { label: 'red button', r1: 'yes', r2: 'yes' }, { label: 'orange', r2: 'yes' }, { label: 'banana' }, { label: 'blue book' }],
  } },
  { id: 'y2-odd-even', name: 'Year 2: odd and even', params: {
    title: 'Odd and even numbers', diagram: 'hoops', cards: 'pictures',
    rules: [{ label: 'Odd' }, { label: 'Even' }],
    items: nums(3, 8, 11, 14, 5, 20, 17, 6, 19, 12),
  } },
  { id: 'y4-carroll', name: 'Year 4: Carroll diagram, even and more than 50', params: {
    title: 'Sorting numbers in a Carroll diagram', diagram: 'carroll',
    rules: [{ label: 'Even' }, { label: 'More than 50', not: '50 or less' }],
    items: nums(64, 37, 18, 81, 50, 95, 42, 23),
  } },
  { id: 'y5-mult-3-4', name: 'Year 5: multiples of 3 and of 4', params: {
    title: 'Multiples of 3 and multiples of 4', diagram: 'venn',
    rules: [{ label: 'Multiples of 3' }, { label: 'Multiples of 4' }],
    items: nums(9, 16, 12, 21, 8, 24, 15, 32, 36, 10, 25),
  } },
];

/* ------------------------------------------------------------------ the sort, worked out */
// number words up to 999 ("fifty", "twenty-four", "one hundred") become digits, so "greater than fifty" is checked
const UNITS = 'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'.split(' ');
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const NUMW = new RegExp(`\\b(?:(?:${UNITS.join('|')}|${Object.keys(TENS).join('|')}|hundred)(?:[\\s-]+(?:and[\\s-]+)?|\\b))+`, 'g');
function wordsToDigits(s) {
  return s.replace(NUMW, m => {
    let total = 0, cur = 0, any = false;
    for (const w of m.trim().split(/[\s-]+/)) {
      if (w === 'and') continue;
      if (UNITS.includes(w)) { cur += UNITS.indexOf(w); any = true; } else if (TENS[w]) { cur += TENS[w]; any = true; } else if (w === 'hundred') { cur = (cur || 1) * 100; any = true; }
    }
    total += cur; return any ? `${total}${/\s$/.test(m) ? ' ' : ''}` : m;
  }).trim();
}
const cleanWords = s => String(s || '').toLowerCase().trim().replace(/^(numbers?|things?)\s+(that are\s+|which are\s+)?/, '').replace(/^(that are|which are)\s+/, '');
const cleanRule = s => wordsToDigits(cleanWords(s))
  .replace(/\b(?:under|below|smaller than|fewer than)\s+(?=-?\d)/g, 'less than ')
  .replace(/\b(?:over|above|bigger than|greater than)\s+(?=-?\d)/g, 'more than ')
  .replace(/\bup to\s+(?=-?\d)/g, 'at most ')
  .replace(/^(-?\d+) or (?:more|over|above|greater|bigger)$/, 'at least $1')
  .replace(/^(-?\d+) or (?:less|fewer|under|below|smaller)$/, 'at most $1');
// a number rule, or two joined ("Multiples of 3 under fifty", "Even and more than 20"): both must hold
const BOUND = /\s+(?=(?:less than|more than|at least|at most)\s+-?\d)/;
function ruleOf(label) {
  const t = cleanRule(label), one = numberRule(t);
  if (one) return one;
  const parts = t.split(/\s*,\s*|\s+(?:and|that are|which are|but)\s+/).flatMap(q => q.split(BOUND)).map(q => numberRule(cleanWords(q).trim()));
  if (parts.length < 2 || parts.some(q => !q)) return null;
  return { kind: 'and', n: null, parts, test: v => parts.every(q => q.test(v)), label: parts.map(q => q.label).join(' and ') };
}
// a custom Carroll heading written as a number rule ("50 or less", "Not more than 50"), as a test, or null
function headingRule(s) {
  const t = cleanRule(s); let m;
  if ((m = t.match(/^(-?\d+) or (less|fewer|under|below|smaller)$/))) { const n = +m[1]; return v => v <= n; }
  if ((m = t.match(/^(-?\d+) or (more|over|above|greater|bigger)$/))) { const n = +m[1]; return v => v >= n; }
  if ((m = t.match(/^not (.+)$/))) { const r = ruleOf(m[1]); return r ? v => !r.test(v) : null; }
  const r = ruleOf(s); return r ? r.test : null;
}
const SAMPLE = Array.from({ length: 1201 }, (_, i) => i - 200);
const complementary = (a, b) => SAMPLE.every(v => !!a(v) !== !!b(v));
const parseNum = s => { const t = String(s).trim().replace(/^−/, '-'); return /^-?(\d{1,3}(,\d{3})+|\d+)$/.test(t) ? +t.replace(/,/g, '') : null; };
const FKEY = ['r1', 'r2', 'r3'];
// the default Carroll heading: the opposite of a rule in plain English. "Has legs" -> "Does not
// have legs", "Can fly" -> "Cannot fly", "Is a mammal" -> "Is not a mammal", "Red" -> "Not red".
const BASE = { has: 'have', does: 'do', goes: 'go', flies: 'fly', carries: 'carry', cries: 'cry', tries: 'try' };
const S_VERBS = new Set('has does goes flies carries lives eats makes grows swims floats sinks moves needs lays uses comes gives keeps melts bends conducts starts ends contains begins rolls bounces walks runs belongs holds hops crawls climbs lets stretches breaks changes gets likes hatches feeds hunts sleeps hides digs bites stings works helps'.split(' '));
function opposite(label) {
  const t = cleanWords(label) || String(label).toLowerCase().trim(), [w0, ...rest] = t.split(/\s+/), more = rest.join(' ');
  if (w0 === 'is' || w0 === 'are' || w0 === 'was' || w0 === 'were' || w0 === 'will' || w0 === 'should' || w0 === 'could' || w0 === 'would') return cap1(`${w0} not ${more}`.trim());
  if (w0 === 'can') return cap1(`cannot ${more}`.trim());
  if (w0 === 'have' || w0 === 'do') return cap1(`do not ${w0} ${more}`.trim());
  if (S_VERBS.has(w0)) return cap1(`does not ${BASE[w0] || w0.replace(/(ch|sh|ss|x)es$/, '$1').replace(/s$/, '')} ${more}`.trim());
  return `Not ${t}`;
}
const Q = s => `“${s}”`;
const cap1 = s => s ? s[0].toUpperCase() + s.slice(1) : s;
const listW = a => a.length <= 1 ? (a[0] || '') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`;

function model(P) {
  const rules = P.rules.map((r, j) => ({ j, label: r.label, rule: ruleOf(r.label), not: r.not && r.not.trim() ? r.not : opposite(r.label) }));
  const allNum = P.items.every(it => parseNum(it.label) != null);
  const items = P.items.map((it, i) => {
    const v = parseNum(it.label);
    const mem = rules.map((r, j) => (r.rule && v != null) ? !!r.rule.test(v) : it[FKEY[j]] === 'yes');
    // nothing can work out where it goes: a number under a word rule, or a word under a number rule,
    // left on "Work it out". It waits in the tray (never shown as fitting no rule) until Fits is set.
    const unk = rules.some((r, j) => (it[FKEY[j]] || 'auto') === 'auto' && (r.rule ? v == null : allNum));
    const pic = P.cards === 'pictures' && v == null ? picFor(it.label) : null;
    return { i, label: it.label, v, mem, unk, pic, key: mem.map(m => m ? 1 : 0).join('') };
  });
  const n = rules.length, kind = P.diagram === 'carroll' ? 'carroll' : P.diagram === 'hoops' ? 'hoops' : 'venn';
  const none = it => !it.unk && it.mem.every(m => !m), all = it => !it.unk && n >= 2 && it.mem.every(m => m);
  return { rules, items, n, kind, allNum, noun: allNum ? 'numbers' : 'things', none, all, wait: items.filter(it => it.unk) };
}

function predicate(r, v, yes) {
  if (r.rule.kind === 'and') {
    const ps = r.rule.parts.map(q => ({ rule: q, label: r.label }));
    return yes ? ps.map(q => predicate(q, v, true).replace(/ \(it ends in \d\)$/, '')).join(' and ') : predicate(ps.find(q => !q.rule.test(v)), v, false);
  }
  const k = r.rule.kind, n = r.rule.n;
  const ends = Math.abs(v) >= 10 ? ` (it ends in ${Math.abs(v) % 10})` : '';
  if (k === 'even') return (yes ? 'is even' : 'is odd') + ends;
  if (k === 'odd') return (yes ? 'is odd' : 'is even') + ends;
  if (k === 'multiple') return yes ? `is a multiple of ${n} (${n} × ${v / n})` : `is not a multiple of ${n}`;
  if (k === 'factor') return yes ? `is a factor of ${n} (${v} × ${n / v})` : `is not a factor of ${n}`;
  if (k === 'gt') return yes ? `is more than ${n}` : `is not more than ${n}`;
  if (k === 'lt') return yes ? `is less than ${n}` : `is not less than ${n}`;
  if (k === 'gte') return yes ? `is at least ${n}` : `is less than ${n}`;
  if (k === 'lte') return yes ? `is at most ${n}` : `is more than ${n}`;
  if (k === 'square') return yes ? `is a square number (${Math.round(Math.sqrt(v))} × ${Math.round(Math.sqrt(v))})` : 'is not a square number';
  if (k === 'prime') return yes ? 'is prime' : 'is not prime';
  return yes ? `fits ${Q(r.label)}` : `does not fit ${Q(r.label)}`;
}
function placeWords(M, mem) {
  const ins = M.rules.filter((r, j) => mem[j]);
  if (M.kind === 'carroll') return M.n === 1 ? `in the box for ${Q(mem[0] ? M.rules[0].label : M.rules[0].not)}` : `in the box for ${Q(mem[0] ? M.rules[0].label : M.rules[0].not)} and ${Q(mem[1] ? M.rules[1].label : M.rules[1].not)}`;
  if (!ins.length) return M.n === 1 ? 'outside the hoop' : 'outside the hoops';
  if (ins.length === 1) return `in ${Q(ins[0].label)}${M.n >= 2 && M.kind === 'venn' ? ' only' : ''}`;
  if (ins.length === M.n && M.n === 2) return 'in the overlap';
  if (ins.length === M.n) return 'in the middle, where all three overlap';
  return `where ${Q(ins[0].label)} and ${Q(ins[1].label)} overlap`;
}
function reason(M, it) {
  const where = placeWords(M, it.mem);
  if (it.v != null && M.rules.every(r => r.rule)) {
    // say each fact once: with "Odd" and "Even", "is odd" and "is not even" are the same fact
    const all = M.rules.map((r, j) => predicate(r, it.v, it.mem[j])).map(q => M.n === 3 ? q.replace(/ \(.*\)$/, '') : q);
    const ps = all.filter((q, i) => all.indexOf(q) === i);
    if (ps.length > 1) ps.forEach((q, i) => { ps[i] = q.replace(/ \(it ends in \d\)$/, ''); }); // keep two-rule captions to one line
    const mixed = it.mem.some(m => m) && it.mem.some(m => !m) && !(M.n === 2 && complementary(M.rules[0].rule.test, M.rules[1].rule.test));
    const joined = ps.length === 1 ? ps[0] : ps.length === 2 ? ps.join(mixed ? ' but ' : ' and ') : `${ps.slice(0, -1).join(', ')} and ${ps[ps.length - 1]}`;
    // a caption stays one plain sentence: past about 110 letters it says which rules fit instead
    const full = `${it.label} ${joined}, so it goes ${where}.`;
    if (full.length <= 110) return full;
    const ins = M.rules.filter((r, j) => it.mem[j]).map(r => Q(r.label));
    return `${it.label} ${!ins.length ? `fits none of the rules, so it stays ${where}` : ins.length === M.n ? `fits ${M.n === 2 ? 'both rules' : 'all three rules'}, so it goes ${where}` : ins.length === 1 ? `fits only ${ins[0]}` : `fits ${listW(ins)}, so it goes where they overlap`}.`;
  }
  const fits = M.rules.filter((r, j) => it.mem[j]).map(r => Q(r.label));
  const what = !fits.length ? (M.n === 1 ? `does not fit ${Q(M.rules[0].label)}` : 'fits neither rule') : fits.length === M.n && M.n > 1 ? (M.n === 2 ? 'fits both rules' : 'fits all three rules') : `fits ${listW(fits)}`;
  return `${cap1(it.label)} ${what}, so it goes ${where}.`;
}

/* ------------------------------------------------------------------ validate */
export function validate(raw) {
  const P = withDefaults(params, raw);
  const R = schemaCheck(params, P); const W = [];
  if (R.length) return result(R);
  // the same rule twice gives two hoops that always agree: refused, so the class never sees a hoop that adds nothing
  { const seen = new Map(); (P.rules || []).forEach((r, i) => { const k = String(r.label || '').trim().toLowerCase(); if (!k) return;
    if (seen.has(k)) R.push({ path: `rules.${i}.label`, reason: `Rule ${i + 1} is the same as rule ${seen.get(k) + 1} (${String(r.label).trim()}). Give each hoop a different rule.` }); else seen.set(k, i); }); }
  if (P.diagram === 'carroll' && P.rules.length > 2) R.push({ path: 'rules', reason: 'A Carroll diagram sorts by one or two rules: one across the top and one down the side. Remove a rule, or choose sorting hoops or a Venn diagram.' });
  const M = model(P);
  M.rules.forEach(r => {
    if (r.rule && r.rule.kind === 'multiple' && r.rule.n === 0) R.push({ path: `rules.${r.j}.label`, reason: 'Every multiple of 0 is 0, so this rule cannot sort anything. Choose a number bigger than 0.' });
    if (r.rule && r.rule.kind === 'factor' && r.rule.n === 0) R.push({ path: `rules.${r.j}.label`, reason: 'Every number is a factor of 0, so this rule cannot sort anything. Choose a number bigger than 0.' });
  });
  if (R.length) return result(R);
  M.rules.forEach(r => {
    const raw = P.rules[r.j], auto = M.items.filter(it => (P.items[it.i][FKEY[r.j]] || 'auto') === 'auto');
    // a word rule over numbers: nothing checks it, so "Work it out" would silently mean "does not fit"
    if (!r.rule && M.allNum && auto.length) W.push(`${Q(r.label)} is not a rule I can check, so ${auto.length === M.items.length ? 'every number' : 'each number left on “Work it out”'} waits in the tray. Write it like “More than 50”, or set Fits or Does not fit on each number.`);
    // a custom Carroll heading must still be the opposite of its rule after the rule is retyped
    if (M.kind !== 'carroll' || !(raw.not && raw.not.trim())) return;
    if (!r.rule && auto.length === M.items.length) { W.push(`Check the heading ${Q(raw.not)} still says the opposite of ${Q(r.label)}.`); return; }
    const opp = r.rule && headingRule(raw.not);
    if (opp && !complementary(r.rule.test, opp)) R.push({ path: `rules.${r.j}.not`, reason: `${Q(raw.not)} is not the opposite of ${Q(r.label)}, so some numbers would sit under the wrong heading. Change it, or clear it to use “Not ${cleanWords(r.label)}”.` });
  });
  if (R.length) return result(R);
  M.items.forEach(it => M.rules.forEach((r, j) => {
    if (!r.rule) return;
    // wording is the teacher's choice: a word under a number rule is sorted by its Fits setting, with a warning
    if (it.v == null) { const m = `${Q(it.label)} is not a whole number written in digits, so ${Q(r.label)} cannot check it: it goes where its Fits settings say, and waits in the tray while they say “Work it out”. Write it like 12, or change the rule to words.`; if (!W.some(q => q.startsWith(Q(it.label) + ' is not a whole'))) W.push(m); return; }
    const set = P.items[it.i][FKEY[j]];
    if (set === 'yes' && !it.mem[j]) R.push({ path: `items.${it.i}.${FKEY[j]}`, reason: `${it.label} ${predicate(r, it.v, false)}, so it cannot go inside ${Q(r.label)}. Set it to “Work it out”.` });
    if (set === 'no' && it.mem[j]) R.push({ path: `items.${it.i}.${FKEY[j]}`, reason: `${it.label} ${predicate(r, it.v, true)}, so it must go inside ${Q(r.label)}. Set it to “Work it out”.` });
  }));
  if (R.length) return result(R);
  if (M.kind === 'hoops') {
    // one message for all of them, naming the things that fit more than one rule
    const many = M.items.filter(it => it.mem.filter(Boolean).length >= 2);
    if (many.length) R.push({ path: 'diagram', reason: `${cap1(listW(many.map(it => it.label)))} ${many.length > 1 ? 'each fit' : 'fits'} more than one rule, but the hoops are apart, so there is nowhere for ${many.length > 1 ? 'them' : 'it'} to go. Choose “Venn diagram” so the hoops overlap.` });
  }
  // how many cards each region of a three-hoop Venn holds is left to the layout below, which knows
  if (!R.length) {
    // the same layout render() draws, with text widths that are never narrower than the slide's
    const L = solve(M, txt(P, 'label:tray', 'To sort'), estW);
    if (!L.ok) {
      const f = L.fails[0] || { mem: [], n: 0, fit: 0, names: [] }, where = placeWords(M, f.mem), more = f.n - f.fit, noun = M.allNum ? 'numbers' : 'things';
      const who = f.n > 4 ? `These ${f.n} ${noun}` : cap1(listW(f.names));
      if (!L.fails.length && L.tiny && !L.cut) R.push({ path: 'items', reason: `With this many things outside the hoops, the hoops would be too small to read. Sort fewer things, or choose a Venn diagram.` });
      else if (!L.fails.length) R.push({ path: 'rules', reason: 'The rule names are too long to fit beside the hoops in full with this many things to sort. Shorten a rule, or sort fewer things.' });
      else R.push({ path: 'items', reason: f.fit
        ? `${who} ${f.n === 2 ? 'both' : 'all'} go ${where}, but only ${f.fit} ${f.fit === 1 ? 'card fits' : 'cards fit'} there at a size the class can read. Take out ${more} of them, or sort fewer ${noun}.`
        : `There is no room ${where} for ${f.n > 4 ? `these ${f.n} ${noun}` : listW(f.names)} at a size the class can read. Sort fewer ${noun}.` });
    }
  }
  if (P.cards === 'pictures') {
    const bare = M.items.filter(it => it.v == null && !it.pic).map(it => Q(it.label));
    if (bare.length && bare.length < M.items.length) W.push(`There is no picture for ${listW(bare.slice(0, 4))}${bare.length > 4 ? ` and ${bare.length - 4} more` : ''}, so ${bare.length > 1 ? 'they show' : 'it shows'} as words.`);
    else if (bare.length) W.push('There are no pictures for these things, so they show as words.');
  }
  M.rules.forEach(r => { if (!r.rule && !(M.allNum && M.items.some(it => (P.items[it.i][FKEY[r.j]] || 'auto') === 'auto')) && M.items.every(it => !it.mem[r.j])) W.push(`Nothing is marked as fitting ${Q(r.label)}. For a word rule, set “Fits” on each thing that belongs.`); });
  return result(R.slice(0, 3), W);
}

/* ------------------------------------------------------------------ builds */
const placeOrder = M => {
  // regions in reading order: single rules first, then overlaps (outside comes last, in its own build)
  const keys = [...new Set(M.items.filter(it => !M.none(it) && !it.unk).map(it => it.key))];
  return keys.sort((a, b) => a.split('1').length - b.split('1').length || (b > a ? 1 : -1));
};
function plan(P) {
  const M = model(P); const steps = [];
  const R0 = M.rules.map(r => Q(r.label));
  let intro;
  if (M.kind === 'carroll' && M.n === 1) intro = `One rule: ${R0[0]}. Each ${M.allNum ? 'number' : 'thing'} goes in the box for ${R0[0]} or the box for ${Q(M.rules[0].not)}.`;
  else if (M.kind === 'carroll') intro = `Across: ${R0[1]} or not. Down: ${R0[0]} or not. Every ${M.allNum ? 'number' : 'thing'} has exactly one box.`;
  else if (M.n === 1) intro = `One rule: ${R0[0]}. Each ${M.allNum ? 'number' : 'thing'} goes inside the hoop or outside it.`;
  else if (M.kind === 'hoops') intro = `${M.n === 2 ? 'Two' : 'Three'} hoops: ${listW(R0)}. Each ${M.allNum ? 'number' : 'thing'} goes in the hoop it fits.`;
  else intro = `The hoops overlap, so one ${M.allNum ? 'number' : 'thing'} can fit ${M.n === 2 ? 'both rules' : 'more than one rule'}.`;
  steps.push({ key: 'empty', caption: intro });
  const inside = M.items.filter(it => !M.none(it) && !it.unk);
  if (P.itemSteps === 'by-place') placeOrder(M).forEach(key => {
    const its = M.items.filter(it => it.key === key && !it.unk);
    steps.push({ key: `place:${key}`, caption: `${cap1(listW(its.map(it => it.label)))} ${placeWords(M, its[0].mem).replace(/^in /, its.length > 2 ? 'all go in ' : its.length > 1 ? 'both go in ' : 'goes in ').replace(/^where /, its.length > 2 ? 'all go where ' : its.length > 1 ? 'both go where ' : 'goes where ')}.` });
  });
  else inside.forEach(it => steps.push({ key: `item:${it.i}`, caption: reason(M, it) }));
  const both = M.items.filter(M.all), out = M.items.filter(M.none);
  if (M.n >= 2 && M.kind !== 'hoops' && (both.length || !M.wait.length)) {
    const L = both.map(it => it.label);
    let c;
    if (M.kind === 'carroll') c = both.length ? `The top-left box holds what fits both rules: ${listW(L)}.` : 'Nothing fits both rules, so the top-left box stays empty.';
    else if (M.n === 2) c = both.length ? `${cap1(listW(L))} ${both.length > 1 ? 'fit' : 'fits'} both rules, so the overlap is where ${both.length > 1 ? 'they belong' : 'it belongs'}.` : 'Nothing fits both rules, so the overlap stays empty.';
    else c = both.length ? `${cap1(listW(L))} ${both.length > 1 ? 'fit' : 'fits'} all three rules, so ${both.length > 1 ? 'they go' : 'it goes'} in the middle.` : 'Nothing fits all three rules, so the middle stays empty.';
    steps.push({ key: 'overlap', caption: c });
  }
  if (out.length) {
    const L = cap1(listW(out.map(it => it.label))), many = out.length > 1;
    const fit = M.n === 1 ? `${many ? 'do' : 'does'} not fit ${R0[0]}` : `${many ? 'fit' : 'fits'} neither rule`;
    const fitN = M.n === 3 ? `${many ? 'fit' : 'fits'} none of the rules` : fit;
    steps.push({ key: 'outside', caption: M.kind === 'carroll' ? `${L} ${fitN}, so ${many ? 'they go' : 'it goes'} in the ${M.n === 1 ? 'right-hand' : 'bottom-right'} box.` : `${L} ${fitN}, so ${many ? 'they stay' : 'it stays'} outside the hoops.` });
  }
  if (M.wait.length) {
    const ws = M.wait.map(it => it.label), names = ws.length > 4 ? `${ws.slice(0, 3).join(', ')} and ${ws.length - 3} more` : listW(ws);
    const wr = M.rules.find(r => !r.rule), why = wr && M.allNum ? `${Q(wr.label)} is not a rule I can check` : `${M.wait.length > 1 ? 'they are' : 'it is'} not a number the rule can check`;
    steps.push({ key: 'wait', caption: `${names} ${M.wait.length > 1 ? 'wait' : 'waits'} to be sorted: ${why}, so set Fits on ${M.wait.length > 1 ? 'each' : 'it'}.` });
  }
  const cnt = j => M.items.filter(it => !it.unk && it.mem[j]).length;
  let summary;
  if (M.kind === 'carroll' && M.n === 1) summary = `${cnt(0)} ${M.noun} ${cnt(0) === 1 ? 'is' : 'are'} ${Q(M.rules[0].label)} and ${out.length} ${out.length === 1 ? 'is' : 'are'} ${Q(M.rules[0].not)}.`;
  else if (M.kind === 'carroll') summary = `${cnt(0)} ${M.noun} are ${Q(M.rules[0].label)}, ${cnt(1)} are ${Q(M.rules[1].label)}, and ${both.length} ${both.length === 1 ? 'is' : 'are'} both.`;
  else summary = M.rules.map((r, j) => `${cnt(j)} in ${Q(r.label)}`).join(', ') + (M.n >= 2 && M.kind === 'venn' ? `, ${both.length} in ${M.n === 2 ? 'both' : 'all three'}` : '') + `, ${out.length} outside.`;
  if (M.wait.length) summary = summary.replace(/\.$/, `, ${M.wait.length} not sorted yet.`);
  return { M, steps, summary: cap1(summary) };
}
export function builds(P) { P = withDefaults(params, P); const { steps, summary } = plan(P); return { steps, summary: { caption: summary } }; }
export function notes(P) {
  P = withDefaults(params, P); const { M, steps } = plan(P);
  const checkWord = M.rules.some(r => !r.rule);
  return {
    steps: steps.map(s => {
      if (s.key === 'empty') return M.kind === 'carroll' && M.n === 1
        ? 'One rule splits the grid in two: it fits, or it does not, so every item has exactly one box. Ask: is there anything that could go in both?'
        : M.kind === 'carroll'
        ? 'Each rule splits the grid in two: it fits, or it does not. Two rules make four boxes, so every item has exactly one place. Ask: which box would 0 go in?'
        : `Read the rule${M.n > 1 ? 's' : ''} together. ${checkWord ? 'For each thing, ask the class: does it fit? Agree before it moves.' : 'For each number, test it against each rule in turn.'}`;
      if (s.key === 'overlap') return M.kind === 'carroll' ? 'The top-left box is the same idea as the overlap in a Venn diagram.' : 'The overlap is inside both hoops at once. Ask: if the hoops were apart, where could these go?';
      if (s.key === 'wait') return 'The computer cannot check these against the rule, so it does not guess. Agree with the class where each one goes, then set Fits or Does not fit for each.';
      if (s.key === 'outside') return M.kind === 'carroll' ? 'The bottom-right box is the same idea as “outside the hoops” in a Venn diagram.' : 'Outside still counts as sorted: it means “fits no rule”.';
      if (s.key.startsWith('item:')) { const it = M.items[+s.key.slice(5)]; return it.v != null && M.rules.every(r => r.rule) ? `Check ${it.label} against ${M.n > 1 ? 'each rule' : 'the rule'} before it moves.` : `Ask: does ${it.label} fit ${M.n > 1 ? 'each rule' : 'the rule'}?`; }
      return 'Ask: what do these have in common?';
    }),
    summary: 'Ask: is anything in the wrong place? Can you think of one more to add, and where would it go?',
  };
}

/* ------------------------------------------------------------------ render */
// cards: flat pills (solid fill, thin rule, no shadow). Numbers in the diagram are the biggest
// type on the slide; word cards step down, then wrap to two lines, until every card fits its
// region (layout.js). Every wording is a textBlock in the space the layout reserved for it.
function card(p, cx, cy, shape, S, a, edit) {
  const g = h('g', a, p);
  h('rect', { x: cx - shape.w / 2, y: cy - shape.h / 2, width: shape.w, height: shape.h, rx: shape.pr || S.pr, fill: 'var(--paper)', stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-rule)' }, g);
  if (shape.pic) drawPic(g, shape.pic, cx + (shape.picDx || 0), cy + shape.picDy, shape.ps);
  textBlock(g, cx + ((shape.pic && shape.textDx) || 0), cy + (shape.pic ? shape.textDy : 0) - (shape.L.length - 1) * S.lh / 2 + S.dy, shape.L.join(' '), { cls: S.cls, maxW: shape.tw + 1, maxLines: 3, lh: S.lh, anchor: 'middle', edit, a: { fill: 'var(--ink)' } });
  return g;
}
const label = (p, x, y, s, f, maxW, maxLines, anchor, edit, col, a) => {
  const tb = textBlock(p, x, y, s, { cls: f.cls, maxW, maxLines, lh: f.lh, anchor, edit, a });
  if (col) tb.el.style.setProperty('fill', col);
  return tb;
};
export function render(root, P, ctx) {
  P = withDefaults(params, P);
  const { M, steps } = plan(P), b = ctx.b, N = ctx.N, hooks = { dur: {} };
  const stepOf = it => {
    if (b[`item:${it.i}`] != null) return b[`item:${it.i}`];
    if (it.unk) return N + 1; // never leaves the tray
    if (b[`place:${it.key}`] != null) return b[`place:${it.key}`];
    return b.outside != null ? b.outside : 0;
  };
  const trayLabel = txt(P, 'label:tray', 'To sort');
  // the layout with the slide's own text widths; if that cannot fit, the estimate's layout
  // (the one validate() checked) always can, as its cards are never narrower than the text
  let Lo = solve(M, trayLabel, (s, c) => measure(root, s, c));
  if (!Lo.ok) { const E = solve(M, trayLabel, estW); if (E.ok) Lo = E; }
  if (!Lo.ok) Lo.fails.forEach(f => ctx.warn(`no room for ${listW(f.names.slice(f.fit))} ${placeWords(M, f.mem)}`));
  const { tray, box, geo, S, cards, to } = Lo, TS = tray.TS;
  const seen = {}, delayOf = M.items.map(it => { const k = stepOf(it); seen[k] = (seen[k] || 0) + 1; return (seen[k] - 1) * 260; });

  /* tray: the things waiting to be sorted, in rows under the diagram, or (three hoops, which
     need the height) in columns down the left. It closes up as things leave. */
  const lastStep = Math.max(...M.items.map(stepOf));
  const trayG = h('g', { c: b.wait != null ? `1-${b.wait}:soft` : '1:soft' }, root);
  const tf = tray.fit;
  label(trayG, tray.lx, tray.ly, trayLabel, tf, tray.maxW, tray.maxLines, 'start', 'text.label:tray', null, { hide: lastStep, fill: 'var(--ink-2)' });
  const trayAt = Array.from({ length: Math.max(lastStep, 0) }, (_, j) => tray.layout(M.items.filter(it => stepOf(it) > j).map(it => it.i)));
  const from = M.items.map(it => { const k = stepOf(it); return (trayAt[k - 1] || trayAt[0] || tray.layout([it.i]))[it.i] || tray.layout([it.i])[it.i]; });
  M.items.forEach((it, i) => {
    const k = stepOf(it), shape = Object.assign({}, tray.shapes[i], { L: [it.label], tw: 1e4 });
    for (let j = 0; j < k;) {
      const at = trayAt[j][i]; let z = j + 1;
      while (z < k && trayAt[z][i][0] === at[0] && trayAt[z][i][1] === at[1]) z++;
      card(trayG, at[0], at[1], shape, TS, { s: j || null, hide: z, delay: z === k ? delayOf[i] : null }, `items.${i}.label`);
      j = z;
    }
  });

  /* the diagram */
  const diaG = h('g', {}, root), hiG = h('g', {}, root), itemG = h('g', {}, root);
  if (M.kind === 'carroll') {
    const { hw, hh, cw, ch } = geo, g = diaG, two = M.n === 2, cr = two ? 1 : 0;
    h('rect', { x: box.x + hw, y: box.y + hh, width: box.w - hw, height: box.h - hh, fill: 'var(--paper)', stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-struct)' }, g);
    h('line', { x1: box.x + hw + cw, x2: box.x + hw + cw, y1: box.y, y2: box.y + box.h, stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-struct)' }, g);
    if (two) h('line', { x1: box.x, x2: box.x + box.w, y1: box.y + hh + ch, y2: box.y + hh + ch, stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-struct)' }, g);
    // headings: across the top (rule 2, or the only rule) grow upwards from the grid; down the side (rule 1) centre on their row
    [M.rules[cr].label, M.rules[cr].not].forEach((s, i) => { const f = geo.colF[i]; label(g, box.x + hw + cw * (i + .5), box.y + hh - 20 - (f.L.length - 1) * f.lh, s, f, cw - 24, 2, 'middle', `rules.${cr}.${i ? 'not' : 'label'}`, COLS[cr][1]); });
    if (two) [M.rules[0].label, M.rules[0].not].forEach((s, i) => { const f = geo.rowF[i]; label(g, box.x + hw - 18, box.y + hh + ch * (i + .5) + 4 - (f.L.length - 1) * f.lh / 2, s, f, hw - 30, 3, 'end', i ? 'rules.0.not' : 'rules.0.label', COLS[0][1]); });
    if (b.overlap != null) { const c = geo.cell(0, 0); h('rect', { x: c.x + 4, y: c.y + 4, width: c.w - 8, height: c.h - 8, fill: 'var(--focus-pale)', stroke: 'var(--focus)', 'stroke-width': 'var(--sw-arrow)', s: b.overlap, c: ctx.rc('overlap') }, hiG); }
  } else {
    const g = h('g', {}, diaG);
    // the hoops as the layout placed the cards: stretched sideways (rx) when it widened them
    geo.circles.forEach((c, i) => h('ellipse', { cx: c.x, cy: c.y, rx: c.rx, ry: c.r, fill: `color-mix(in oklab, ${COLS[i][0]} 22%, transparent)`, stroke: COLS[i][0], 'stroke-width': 'var(--sw-arrow)' }, g));
    // where hoops overlap, the tints would multiply into a dark patch: paint each shared region a light, calm blend
    // of its hoops' colours instead (lighter than either hoop), so the cards in it read in every theme
    const lensFill = ids => `color-mix(in oklab, ${ids.map(i => COLS[i][0]).reduce((a, c, k) => `color-mix(in oklab, ${a} ${Math.round(100 * k / (k + 1))}%, ${c})`)} 16%, var(--paper))`;
    { const ld = h('defs', {}, g);
      geo.circles.forEach((c, i) => { const cp = h('clipPath', { id: `${ctx.uid}-l${i}` }, ld); h('ellipse', { cx: c.x, cy: c.y, rx: c.rx, ry: c.r }, cp); });
      const sets = M.n === 2 ? [[0, 1]] : [[0, 1], [0, 2], [1, 2], [0, 1, 2]];
      for (const ids of sets) { const c = geo.circles[ids[0]]; if (!c) continue;
        const gg = ids.slice(1).reduce((q, j) => h('g', { 'clip-path': `url(#${ctx.uid}-l${j})` }, q), g);
        h('ellipse', { cx: c.x, cy: c.y, rx: c.rx, ry: c.r, fill: lensFill(ids) }, gg); }
      // the hoop edges stay on top of the blends
      geo.circles.forEach((c, i) => h('ellipse', { cx: c.x, cy: c.y, rx: c.rx, ry: c.r, fill: 'none', stroke: COLS[i][0], 'stroke-width': 'var(--sw-arrow)' }, g)); }
    geo.specs.forEach((sp, i) => label(g, sp.x, sp.y, M.rules[i].label, sp.fit, sp.maxW, sp.maxLines || 2, sp.anchor, `rules.${i}.label`, COLS[i][1], { cls: 'halo' }));
    if (b.overlap != null) {
      // the overlap region: each hoop's edge, clipped to the other hoops, so only the shared part shows
      const want = M.n === 2 ? [0, 1] : [0, 1, 2], hg = h('g', { s: b.overlap, c: ctx.rc('overlap') }, hiG);
      const defs = h('defs', {}, hg);
      geo.circles.forEach((c, i) => { const cp = h('clipPath', { id: `${ctx.uid}-c${i}` }, defs); h('ellipse', { cx: c.x, cy: c.y, rx: c.rx, ry: c.r }, cp); });
      const clipped = (p, others) => others.reduce((gg, j) => h('g', { 'clip-path': `url(#${ctx.uid}-c${j})` }, gg), p);
      const c0 = geo.circles[want[0]];
      h('ellipse', { cx: c0.x, cy: c0.y, rx: c0.rx, ry: c0.r, fill: lensFill(want) }, clipped(hg, want.slice(1)));   // the highlight keeps the calm blend; its edge marks it
      want.forEach(i => { const c = geo.circles[i]; h('ellipse', { cx: c.x, cy: c.y, rx: c.rx, ry: c.r, fill: 'none', stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-lens)' }, clipped(hg, want.filter(j => j !== i))); });
    }
  }

  /* the things, flying from the tray to their place; staggered within a shared build */
  M.items.forEach((it, i) => {
    if (!to[i]) return; // only when the layout could not fit (warned above): never drawn on another card
    const k = stepOf(it), delay = delayOf[i];
    // one focal card per build: the card just placed is full strength, the ones placed before step
    // back to soft; in the overlap build only the overlap is full; the summary shows them all
    const ov = b.overlap, cs = [];
    if (ov != null && ov > k) {
      if (k + 1 < ov) cs.push(`${k + 1}-${ov}:soft`);
      if (!M.all(it)) cs.push(`${ov}-${ov + 1}:quiet`);
      if (ov + 1 < N) cs.push(`${ov + 1}-${N}:soft`);
    } else if (k + 1 < N) cs.push(`${k + 1}-${N}:soft`);
    card(itemG, to[i][0], to[i][1], cards[i], S, { s: k, cls: 'fly', delay, c: cs.join(',') || null, vars: { '--fx': `${from[i][0] - to[i][0]}px`, '--fy': `${from[i][1] - to[i][1]}px` } }, `items.${i}.label`);
    const key = steps[k] && steps[k].key; if (key) hooks.dur[key] = Math.max(hooks.dur[key] || 0, 1400 + delay);
  });
  if (!M.items.length) ctx.warn('nothing to sort');
  return { dur: hooks.dur };
}
