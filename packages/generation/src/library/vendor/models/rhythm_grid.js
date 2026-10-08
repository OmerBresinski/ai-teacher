// Rhythm grid: beat, rhythm and pitch. Bars of a steady pulse, stick-notation rhythms on top
// (ta, ti-ti, ta-a, ta-a-a-a, rest), a clap-along pass one bar per build with a playhead, then
// optionally the pitch of each sound on a keyboard or a treble stave (with tone / semitone steps
// for a major or pentatonic scale). Every bar is checked against the time signature in code.
import {
  h, T, measure, clamp, GRID, textBlock, lanePlace,
  editable, computed, txt, TEXT_PARAM, TITLE_PARAM, schemaCheck, withDefaults, result,
} from '../kit/index.js';
// Batch H parts are not re-exported by kit/index.js, so they are imported directly.
import { beatGrid, playhead, rhythmRow, CELL_BEATS, barBeats, keys, noteToMidi, NOTE_LETTERS } from '../kit/batch-H.js';

export const meta = {
  id: 'rhythm_grid', name: 'Beat, rhythm and pitch', kind: 'info', version: 1,
  subjects: ['Music'],
  years: ['Reception', 'Y1', 'Y2', 'Y3', 'Y4', 'Y5', 'Y6'],
  teaches: 'The difference between the steady beat and the rhythm on top of it, how bars add up, and how notes step up and down in pitch.',
};

const CELLS = Object.keys(CELL_BEATS);
const CELL_HELP = 'Write the bar in rhythm words: ta (1 beat), ti-ti (two half beats), ta-a (2 beats), ta-a-a-a (4 beats), rest (1 silent beat).';

export const params = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', title: 'Beat, rhythm and pitch',
  properties: {
    title: TITLE_PARAM('Beat and rhythm'),
    beats: { type: 'integer', title: 'Beats in a bar', minimum: 2, maximum: 4, default: 4, description: '2, 3 or 4 beats in every bar.' },
    bars: { type: 'integer', title: 'Bars', minimum: 1, maximum: 4, default: 2 },
    showRhythm: { type: 'boolean', title: 'Show a rhythm on top of the beat', description: 'Off: just the steady beat, counted.', default: true },
    rhythm: {
      type: 'array', title: 'Rhythm, one line per bar', description: CELL_HELP, 'x-item': 'a bar', maxItems: 4, default: [{ cells: 'ta ta ti-ti ta' }, { cells: 'ti-ti ti-ti ta rest' }],
      items: { type: 'object', required: ['cells'], default: { cells: 'ta ta ta ta' }, properties: {
        cells: { type: 'string', title: 'Rhythm for this bar', minLength: 1, maxLength: 60, examples: ['ta ti-ti ta rest'] },
      } },
    },
    say: { type: 'string', title: 'Under the notes', enum: ['names', 'counts'], 'x-labels': ['Rhythm names (ta, ti-ti)', 'Counting (1, 2 and)'], default: 'names' },
    tempoWord: { type: 'string', title: 'How fast (tempo)', default: 'steady', maxLength: 24, description: 'A word like steady, slow, fast, or allegro.' },
    pitch: {
      type: 'object', title: 'Pitch', description: 'Give each sound in the rhythm a note, shown on a keyboard or a stave.', default: { view: 'none' },
      properties: {
        view: { type: 'string', title: 'Show pitch', enum: ['none', 'keyboard', 'stave'], 'x-labels': ['No pitch', 'On a keyboard', 'On a stave (treble clef)'], default: 'none' },
        pattern: { type: 'string', title: 'The notes are', enum: ['tune', 'major', 'pentatonic'], 'x-labels': ['A tune of my own', 'A major scale', 'A major pentatonic scale'], default: 'tune' },
        notes: { type: 'string', title: 'Notes, one for each sound', description: 'Letter names in order, like “C D E F G A B C” or “G4 E4 G4 E4”. Middle C is C4. Rests have no note.', default: 'C4 D4 E4 F4 G4 A4 B4 C5', maxLength: 90 },
      },
    },
    timeSignature: { type: 'boolean', title: 'Show the time signature (like 4/4)', default: false, 'x-panel': 'advanced' },
    text: TEXT_PARAM,
  },
};

export const presets = [
  { id: 'r-steady-beat', name: 'Reception: steady beat', params: {
    title: 'Keep a steady beat', beats: 4, bars: 2, showRhythm: false, tempoWord: 'steady', pitch: { view: 'none' },
  } },
  { id: 'y3-ta-titi', name: 'Year 3: ta and ti-ti rhythms', params: {
    title: 'Ta and ti-ti rhythms', beats: 4, bars: 4, showRhythm: true, say: 'names', tempoWord: 'moderate', timeSignature: true,
    rhythm: [{ cells: 'ta ta ti-ti ta' }, { cells: 'ti-ti ti-ti ta rest' }, { cells: 'ta ti-ti ta ta' }, { cells: 'ta-a ta rest' }],
  } },
  { id: 'y5-c-major', name: 'Year 5: the C major scale', params: {
    title: 'The C major scale', beats: 4, bars: 2, showRhythm: true, say: 'counts', tempoWord: 'andante (walking pace)', timeSignature: true,
    rhythm: [{ cells: 'ta ta ta ta' }, { cells: 'ta ta ta ta' }],
    pitch: { view: 'keyboard', pattern: 'major', notes: 'C4 D4 E4 F4 G4 A4 B4 C5' },
  } },
  { id: 'y6-pentatonic-stave', name: 'Year 6: a major pentatonic tune on the stave', params: {
    title: 'A major pentatonic scale on the stave', beats: 3, bars: 2, showRhythm: true, say: 'names', tempoWord: 'flowing', timeSignature: true,
    rhythm: [{ cells: 'ta ta ta' }, { cells: 'ti-ti ta-a' }],
    pitch: { view: 'stave', pattern: 'pentatonic', notes: 'G4 A4 B4 D5 E5 G5' },
  } },
];

/* ------------------------------------------------------------------ the music, worked out in code */
const SCALES = {
  major: { steps: [2, 2, 1, 2, 2, 2, 1], letters: [0, 1, 2, 3, 4, 5, 6, 7], word: 'major scale', size: [8] },
  pentatonic: { steps: [2, 2, 3, 2, 3], letters: [0, 1, 2, 4, 5, 7], word: 'major pentatonic scale', size: [5, 6] },
};
const LETTERS = 'CDEFGAB';
const letterOf = s => s[0].toUpperCase();
const showName = n => n.replace(/-?\d+$/, '');
/** Stave position from the written (spelled) octave, not the sounding pitch: E4 = 0, each letter step = 1. */
const stavePos = n => (+n.name.match(/-?\d+$/)[0] - 4) * 7 + LETTERS.indexOf(n.letter) - 2;

/** Parse "C D E" or "C4 E4 G4" into notes. A note with no octave goes to the octave nearest the one before (the first to octave 4). */
function parseNotes(str) {
  const words = String(str || '').trim().split(/[\s,]+/).filter(Boolean); const out = []; let prev = null;
  for (const raw of words) {
    const w = raw.replace('♯', '#').replace('♭', 'b'); const m = /^([A-Ga-g])([#b]?)(-?\d)?$/.exec(w);
    if (!m) return { error: `“${raw}” isn’t a note name. Use a letter from A to G, with # for sharp or b for flat, like C, F# or Bb.`, notes: out };
    const L = m[1].toUpperCase() + m[2];
    let midi;
    if (m[3] != null) midi = noteToMidi(L + m[3]);
    else { const base = noteToMidi(L + '4'); if (prev == null) midi = base; else { midi = base; while (midi - prev > 6) midi -= 12; while (prev - midi > 6) midi += 12; } }
    if (midi == null) return { error: `“${raw}” isn’t a note name.`, notes: out };
    const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0; const oct = Math.floor((midi - acc) / 12) - 1;
    out.push({ raw, label: L, midi, letter: L[0], name: L + oct }); prev = midi;
  }
  return { notes: out };
}

function sounds(P) {
  // one entry per sound in the rhythm (rests have none), each with its bar and cell
  const out = [];
  for (let b = 0; b < P.bars; b++) {
    if (!P.showRhythm) { for (let i = 0; i < P.beats; i++) out.push({ b, cell: i, beat: i, sub: 0 }); continue; }
    const cells = cellsOf(P, b); let beat = 0;
    cells.forEach((c, i) => { if (c === 'ti-ti') { out.push({ b, cell: i, beat, sub: 0 }); out.push({ b, cell: i, beat, sub: 1 }); } else if (c !== 'rest') out.push({ b, cell: i, beat, sub: 0 }); beat += CELL_BEATS[c] || 1; });
  }
  return out;
}
/** Where the pitch panel sits, shared by validate and render so the stave note cap matches what is drawn. */
const pitchCols = P => { const sc = SCALES[P.pitch.pattern]; const ix0 = sc ? GRID.left + 380 : GRID.left + 120, ix1 = sc ? GRID.right : GRID.right - 120; return { ix0, ix1, nx0: ix0 + 118, nx1: ix1 - 30 }; };
const STAVE_GAP = 46; // centre to centre, so names like “F♯” keep apart
const staveMax = P => { const c = pitchCols(P); return Math.floor((c.nx1 - c.nx0) / STAVE_GAP) + 1; };
const cellsOf = (P, b) => String((P.rhythm[b] || {}).cells || '').trim().toLowerCase().split(/\s+/).filter(Boolean);

/* ------------------------------------------------------------------ validate */
export function validate(raw) {
  const P = withDefaults(params, raw);
  const R = schemaCheck(params, P); const W = [];
  if (R.length) return result(R);
  if (P.showRhythm) {
    if (P.rhythm.length < P.bars) R.push({ path: 'rhythm', reason: `There ${P.bars === 1 ? 'is 1 bar' : `are ${P.bars} bars`} but only ${P.rhythm.length} rhythm line${P.rhythm.length === 1 ? '' : 's'}. Add a rhythm for each bar, or use fewer bars.` });
    for (let b = 0; b < Math.min(P.bars, P.rhythm.length); b++) {
      const cells = cellsOf(P, b); const bad = cells.find(c => !CELLS.includes(c));
      if (bad) { R.push({ path: `rhythm.${b}.cells`, reason: `“${bad}” isn’t one of the rhythm words. ${CELL_HELP}` }); continue; }
      const n = barBeats(cells);
      if (n !== P.beats) R.push({ path: `rhythm.${b}.cells`, reason: `Bar ${b + 1} adds up to ${n} beat${n === 1 ? '' : 's'}, but every bar has ${P.beats}. ${n > P.beats ? 'Take a note out' : 'Add a note or a rest'} so it fills exactly ${P.beats} (rests count as beats).` });
    }
    if (R.length) return result(R);
  }
  const perRow = P.beats * P.bars;
  if (P.pitch.view !== 'none') {
    const pn = parseNotes(P.pitch.notes);
    if (pn.error) R.push({ path: 'pitch.notes', reason: pn.error });
    if (R.length) return result(R);
    const notes = pn.notes, S = sounds(P);
    // a count mismatch is a warning, not a refusal, so pitch can be switched on (or the rhythm changed) one setting at a time
    if (notes.length < S.length) W.push({ path: 'pitch.notes', reason: `The rhythm has ${S.length} sounds but there are only ${notes.length} notes, so the last ${S.length - notes.length} sound${S.length - notes.length === 1 ? ' has' : 's have'} no note yet. Give every sound one note (rests have none, and ti-ti has two).` });
    if (notes.length > S.length) W.push({ path: 'pitch.notes', reason: `There are ${notes.length} notes but the rhythm has only ${S.length} sounds, so the last ${notes.length - S.length} note${notes.length - S.length === 1 ? ' is' : 's are'} not played. Give every sound one note (rests have none, and ti-ti has two).` });
    if (P.pitch.view === 'stave' && notes.length > staveMax(P)) R.push({ path: 'pitch.notes', reason: `One stave on a slide holds up to ${staveMax(P)} notes before the note names crowd together; you have ${notes.length}. Use fewer notes, or show them on a keyboard.` });
    const lo = Math.min(...notes.map(n => n.midi)), hi = Math.max(...notes.map(n => n.midi));
    if (P.pitch.view === 'keyboard' && hi - Math.floor(lo / 12) * 12 > 24) R.push({ path: 'pitch.notes', reason: 'These notes spread over more than two octaves, so the keys would be too small to read. Keep the tune within two octaves.' });
    if (P.pitch.view === 'stave' && notes.some(n => stavePos(n) < -2 || stavePos(n) > 10)) R.push({ path: 'pitch.notes', reason: 'On this stave the notes go from middle C (C4) up to A5. Move the tune into that range, or show it on a keyboard.' });
    const sc = SCALES[P.pitch.pattern];
    if (sc && notes.length) {
      const up = notes.length > 1 && notes[1].midi > notes[0].midi; const seq = up ? notes : [...notes].reverse();
      const what = `a ${sc.word}`;
      if (!sc.size.includes(notes.length)) R.push({ path: 'pitch.notes', reason: `${what[0].toUpperCase() + what.slice(1)} has ${sc.size.join(' or ')} notes from bottom to top; you have ${notes.length}.` });
      else {
        const steps = seq.slice(1).map((n, i) => n.midi - seq[i].midi); const want = sc.steps.slice(0, steps.length);
        const i = steps.findIndex((s, j) => s !== want[j]);
        const names = ['', 'a semitone', 'a tone', 'three semitones'];
        if (i >= 0) R.push({ path: 'pitch.notes', reason: `In ${what}, ${seq[i].label} to ${seq[i + 1].label} should be ${names[want[i]]} but it is ${names[Math.abs(steps[i])] || Math.abs(steps[i]) + ' semitones'}. ${P.pitch.pattern === 'major' ? 'A major scale goes tone, tone, semitone, tone, tone, tone, semitone.' : 'A major pentatonic scale goes tone, tone, three semitones, tone.'}` });
        else {
          const l0 = LETTERS.indexOf(seq[0].letter);
          const j = seq.findIndex((n, k) => LETTERS.indexOf(n.letter) !== (l0 + sc.letters[k]) % 7);
          if (j >= 0) R.push({ path: 'pitch.notes', reason: `The sounds are right, but ${seq[j].label} should be spelt with the letter ${LETTERS[(l0 + sc.letters[j]) % 7]} in this scale (each letter is used once). For example, write Bb not A#.` });
        }
      }
    }
  }
  return result(R, W);
}

/* ------------------------------------------------------------------ builds */
function plan(P) {
  P = withDefaults(params, P);
  const items = []; const bt = P.beats;
  items.push({ key: 'pulse', caption: `The pulse is a steady beat that never speeds up or slows down: ${bt} beats in every bar.` });
  if (P.showRhythm) items.push({ key: 'rhythm', caption: 'The rhythm sits on top of the beat. A beat can have one sound, two sounds, or none.' });
  for (let b = 0; b < P.bars; b++) {
    const cells = P.showRhythm ? cellsOf(P, b) : [];
    let bb = 0; const counted = cells.map(c => { const t = c === 'ti-ti' ? `${bb + 1} and` : c === 'rest' ? `(${bb + 1})` : String(bb + 1); bb += CELL_BEATS[c] || 1; return t; }).join(', ');
    items.push({ key: `clap:${b}`, caption: P.showRhythm ? (P.say === 'counts' ? `Bar ${b + 1}: clap the rhythm and count “${counted}”.` : `Bar ${b + 1}: clap the rhythm and say “${cells.map(c => c === 'rest' ? '(rest)' : c).join(' ')}”.`)
      : `Bar ${b + 1}: clap on every beat and count ${Array.from({ length: bt }, (_, i) => i + 1).join(', ')}.` });
  }
  const pv = P.pitch.view; const sc = SCALES[P.pitch.pattern];
  if (pv !== 'none') items.push({ key: 'pitch', caption: pv === 'keyboard' ? 'Each sound gets a note. On a keyboard, higher notes are further to the right.' : 'Each sound gets a note. On a stave, higher notes sit higher up.' });
  if (pv !== 'none' && sc) items.push({ key: 'steps', caption: P.pitch.pattern === 'major' ? 'A major scale steps tone, tone, semitone, tone, tone, tone, semitone.' : 'A major pentatonic scale has five notes and no semitone steps.' });
  const name = pv !== 'none' && sc ? scaleName(P) : null;
  const summary = name ? `The ${name}, played to a rhythm over a steady beat.` : P.showRhythm ? `${P.bars} bar${P.bars > 1 ? 's' : ''} of ${bt} beats: a rhythm played over a steady beat.` : `${P.bars * bt} steady beats, ${bt} in every bar.`;
  return { items, summary };
}
function scaleName(P) {
  P = withDefaults(params, P);
  const pn = parseNotes(P.pitch.notes).notes; if (!pn.length) return '';
  const up = pn.length < 2 || pn[1].midi > pn[0].midi; const root = up ? pn[0] : pn[pn.length - 1];
  return `${root.label} ${SCALES[P.pitch.pattern].word}`;
}
export function builds(P) { const { items, summary } = plan(P); return { steps: items.map(({ key, caption }) => ({ key, caption })), summary: { caption: summary } }; }

export function notes(P) {
  P = withDefaults(params, P);
  const { items } = plan(P);
  const steps = items.map(it => {
    if (it.key === 'pulse') return `Tap the beat on your knees before anything else. The tempo (${P.tempoWord}) is how fast the beat goes; it does not change the rhythm.`;
    if (it.key === 'rhythm') return 'Ta is one sound on a beat, ti-ti is two quick sounds sharing one beat, ta-a holds for two beats, and a rest is a silent beat that still counts.';
    if (it.key.startsWith('clap:')) { const b = +it.key.slice(5); return P.showRhythm ? `Half the class taps the beat while the other half claps bar ${b + 1}. Swap over. Bar ${b + 1} adds up to ${P.beats} beats.` : `Keep the claps evenly spaced. Ask: did we speed up?`; }
    if (it.key === 'pitch') return P.pitch.view === 'keyboard' ? 'The seven letter names A to G repeat up the keyboard; from one C to the next C is an octave (8 white keys counting both Cs). Middle C is C4. The black keys are sharps and flats.' : 'Lines from the bottom: E G B D F. Spaces: F A C E. Middle C sits on its own short line below the stave.';
    if (it.key === 'steps') return 'A tone is two keys apart counting black keys; a semitone is the very next key. Find the semitones: in C major they are E to F and B to C.';
    return '';
  });
  return { steps, summary: 'Ask: which stays the same all the way through, the beat or the rhythm? Then perform it with half tapping the beat.' };
}

/* ------------------------------------------------------------------ render */
export function render(root, P, ctx) {
  P = withDefaults(params, P);
  const b = ctx.b, N = ctx.N; const bi = key => b[key] ?? 0;
  const bt = P.beats, bars = P.bars, pv = P.pitch.view, hasPitch = pv !== 'none';
  const sc = hasPitch ? SCALES[P.pitch.pattern] : null;
  const kP = hasPitch ? bi('pitch') : N, kS = hasPitch && sc ? bi('steps') : N;
  // more than 8 beats: two rows of bars. With pitch as well, the rhythm gives way to the pitch panel
  // at the pitch build (the clap-along has been done), so the keyboard or stave gets the whole stage.
  const twoRows = bt * bars > 8, long = hasPitch && twoRows;
  const perRow = twoRows ? Math.ceil(bars / 2) : bars;
  const sigW = P.timeSignature ? 56 : 0;
  const gx = GRID.left + sigW, gw = GRID.right - gx;
  // without pitch the grid has the stage to itself: taller cells, and one row sits in the middle of the stage
  const gh = hasPitch ? 112 : twoRows ? 150 : 200;
  const rowsY = twoRows ? [206, 420] : hasPitch ? [196] : [290];
  const headY = rowsY[0] - 50;
  const kPulse = bi('pulse'), kRhythm = P.showRhythm ? bi('rhythm') : kPulse;
  const LAB_Y = 36; // label baseline below a grid row

  // the grid and everything on it. With pitch, it sits in the middle of the stage until the pitch panel
  // arrives, then moves up to make room and recedes, so the keyboard or stave is the one focal point.
  const grid = h('g', long ? { hide: kP } : { c: hasPitch ? `${kP}-${N}:quiet,${N}:soft` : null }, root);
  const head = h('g', { s: kPulse, hide: hasPitch ? kP : null }, grid);
  const headUp = header(head);
  const DY = hasPitch && !long ? Math.round((GRID.top + GRID.bottom) / 2 - ((headY - 24 - headUp) + (rowsY[0] + gh + LAB_Y + 8)) / 2) : 0;
  const RMq = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const placeGrid = k => { if (!hasPitch || long) return; grid.style.transition = RMq ? 'none' : 'transform var(--t-move) var(--ease-out)'; grid.style.transform = `translate(0px, ${k < kP ? DY : 0}px)`; };

  /* header: beats in a bar (computed) on the left, tempo on the right; with pitch it steps aside for the note names */
  // header: the tempo label takes the room the beats count leaves; a long label wraps upwards, away from the grid.
  // Returns how far it reaches above the one-line header.
  function header(hg) {
    const bw = computed(T(hg, gx, headY, `${bt} beats in every bar`, 'ts-small', { cls: 'strong', fill: 'var(--ink)' }), 'beats').getComputedTextLength();
    const tw = measure(root, P.tempoWord, 'ts-small', { cls: 'strong' });
    editable(T(hg, GRID.right, headY, P.tempoWord, 'ts-small', { 'text-anchor': 'end', cls: 'strong', fill: 'var(--ink)' }), 'tempoWord');
    const xr = GRID.right - tw - 10, room = xr - (gx + bw + 32);
    const tb = textBlock(hg, xr, headY, txt(P, 'label:tempo', 'Tempo:'), { cls: 'ts-small', maxW: room, maxLines: 2, lh: 28, anchor: 'end', edit: 'text.label:tempo' });
    const up = tb.h - tb.lh; tb.el.setAttribute('y', headY - up);
    return up;
  }

  /* the bars: one beatGrid per row; a bar's grid and its index on that row */
  const rows = rowsY.map((y, r) => {
    const n = r === 0 ? perRow : bars - perRow; const barW0 = (gw - 24 * (perRow - 1)) / perRow;
    return beatGrid(grid, bt, P.showRhythm ? 2 : 1, { x: gx, y, w: barW0 * n + 24 * (n - 1), h: gh, bars: n, pulseS: kPulse });
  });
  const at = bar => bar < perRow ? { g: rows[0], i: bar, row: 0 } : { g: rows[1], i: bar - perRow, row: 1 };
  if (P.timeSignature) rows.slice(0, 1).forEach((g, r) => {
    const ts = h('g', { s: kPulse }, grid); const cx = GRID.left + 20, cy = rowsY[r] + gh / 2;
    computed(T(ts, cx, cy - 4, String(bt), 'ts-num', { 'text-anchor': 'middle', fill: 'var(--ink)' }), 'beats');
    computed(T(ts, cx, cy + 36, '4', 'ts-num', { 'text-anchor': 'middle', fill: 'var(--ink)' }), 'beats');
  });

  /* the rhythm (or, beat only: a big dot and a count on every beat) */
  const words = []; // per bar: [{el, x, text}] for lighting along with the claps
  const countOf = (cell, beat) => cell === 'ti-ti' ? `${beat + 1} and` : cell === 'rest' ? `(${beat + 1})` : String(beat + 1);
  for (let bar = 0; bar < bars; bar++) {
    const { g, i } = at(bar); words[bar] = [];
    if (P.showRhythm) {
      const cells = cellsOf(P, bar); let beat = 0; const sylls = cells.map(c => { const s = P.say === 'counts' ? countOf(c, beat) : c; beat += CELL_BEATS[c]; return s; });
      const rr = rhythmRow(grid, g, i, cells, { s: kRhythm, delay: bar * 260, sylls });
      rr.items.forEach((it, j) => { const t = it.el.querySelector('text'); computed(t, `rhythm.${bar}.cells`);
        // rhythm words at label size, readable from the back of the room
        t.setAttribute('class', String(t.getAttribute('class') || '').replace('ts-small', 'ts-label')); t.setAttribute('y', g.y + gh + LAB_Y);
        words[bar].push({ x: +t.getAttribute('x'), y: g.y + gh + LAB_Y, text: t.textContent }); });
    } else {
      g.dots[i].forEach(d => d.setAttribute('display', 'none'));
      for (let j = 0; j < bt; j++) {
        const x = g.beatX(i, j), y = g.y + gh / 2 - 6;
        // the beat dot grows with its cell, so a short grid of big cells is not left mostly empty
        h('circle', { cx: x, cy: y, r: Math.round(Math.max(26, Math.min(48, Math.min(gh, g.cellW) * .3))), fill: 'var(--neutral)', s: kPulse, cls: 'pop', delay: (bar * bt + j) * 120 }, grid);
        computed(T(grid, x, g.y + gh + LAB_Y, String(j + 1), 'ts-label', { 'text-anchor': 'middle', s: kPulse, cls: 'rise', delay: (bar * bt + j) * 120 }), 'beats');
        words[bar].push({ x, y: g.y + gh + LAB_Y, text: String(j + 1), dot: [x, y] });
      }
    }
  }

  /* clap along: one bar per build; a playhead sweeps the bar and each sound lights as it passes */
  const BEAT_MS = 700, dur = {}, sweeps = [];
  const sx = []; // x of every sound, in order (for pitch letters)
  for (let bar = 0; bar < bars; bar++) {
    const { g, i } = at(bar); const k = bi(`clap:${bar}`), box = g.barBox(i); dur[`clap:${bar}`] = bt * BEAT_MS;
    const light = h('g', { s: k, hide: hasPitch ? kP : N }, grid);
    for (const w of words[bar]) {
      const f = clamp((w.x - box.x) / box.w); const d = f * bt * BEAT_MS;
      if (w.dot) h('circle', { cx: w.dot[0], cy: w.dot[1], r: 26, fill: 'var(--focus)', s: k, cls: 'pop', delay: d }, light);
      computed(T(light, w.x, w.y, w.text, 'ts-label', { 'text-anchor': 'middle', cls: 'strong', fill: 'var(--focus-text)', s: k, delay: d, vars: { '--t-build-enter': '160ms' } }), P.showRhythm ? `rhythm.${bar}.cells` : 'beats');
    }
    sweeps.push({ k, box });
  }
  // one playhead per row, shown during that row's clap builds only
  const heads = rows.map((g, r) => {
    const mine = sweeps.filter((s, bar) => at(bar).row === r); if (!mine.length) return null;
    const ph = playhead(grid, g, { a: { s: mine[0].k, hide: mine[mine.length - 1].k + 1 } });
    return { ph, mine };
  }).filter(Boolean);
  const placeHead = (k, u) => { for (const H of heads) { const s = H.mine.find(m => m.k === k) || (k > H.mine[H.mine.length - 1].k ? H.mine[H.mine.length - 1] : H.mine[0]); const x = s.box.x + (k === s.k ? u : k > s.k ? 1 : 0) * s.box.w; H.ph.marks[0].inner.setAttribute('transform', `translate(${x} 0)`); } };

  /* pitch: a note for every sound, shown over the rhythm and on a keyboard or stave */
  let setDiscs = () => {};
  if (hasPitch) {
    const notesP = parseNotes(P.pitch.notes).notes; const S = sounds(P);
    S.forEach((s, j) => { const { g, i } = at(s.b); const cells = cellsOf(P, s.b);
      const cell = cells[s.cell], x0 = g.beatX(i, s.beat) - g.cellW / 2;
      sx.push(cell === 'ti-ti' ? x0 + g.cellW * (s.sub ? .7 : .3) : x0 + g.cellW / 2); });
    // letters over the rhythm, one per sound, kept apart in a lane (drawn outside the receding grid: they are the link)
    const lane = [], ly = rowsY[0] - 14, NOTE_MS = 420;
    dur.pitch = 300 + notesP.length * NOTE_MS;
    if (!long) notesP.slice(0, sx.length).forEach((n, j) => {
      const w = measure(root, showName(n.label), 'ts-label', { cls: 'strong' }); const bb = lanePlace(lane, w, sx[j] + 5, { gap: 16, shift: 24, min: GRID.left, max: GRID.right });
      if (!bb) ctx.warn(`No room for the note name ${n.label} over the rhythm.`);
      computed(T(root, bb ? bb.cx : sx[j] + 5, ly, showName(n.label), 'ts-label', { 'text-anchor': 'middle', cls: 'strong', fill: 'var(--focus-text)', s: kP, delay: 300 + j * NOTE_MS }), 'pitch.notes').classList.add('pop');
    });
    // left column: the scale's name and the step key (only for a scale)
    const right = GRID.right, top = long ? 330 : 424, bottom = GRID.bottom;
    let colW = 0;
    if (sc) {
      colW = 380;
      const nm = textBlock(root, GRID.left, top + 48, scaleName(P), { cls: 'ts-label', maxW: colW - 24, maxLines: 2, lh: 36, a: { fill: 'var(--ink)', s: kP, cls: 'rise' } });
      computed(nm.el, 'pitch.pattern'); nm.el.classList.add('strong');
      const nUp = nm.h - nm.lh; nm.el.setAttribute('y', top + 48 - nUp); // a two-line name grows upwards, leaving the key its room
      const ky = top + 48 + nm.lh + 14; // as many lines as fit above the content bottom, so a long key wraps instead of being cut
      textBlock(root, GRID.left, ky, txt(P, 'label:steps', P.pitch.pattern === 'pentatonic' ? 'T = tone, T+S = a tone and a semitone' : 'T = tone, S = semitone'), { cls: 'ts-label', maxW: colW - 24, maxLines: Math.max(2, Math.floor((bottom - ky) / 34) + 1), lh: 34, a: { s: kS, cls: 'rise' }, edit: 'text.label:steps' });
    }
    const { ix0, ix1, nx0, nx1 } = pitchCols(P);
    const pg = h('g', { s: kP, cls: 'rise' }, root);
    // one interval label style for keyboard and stave: T in ink, S in the compare colour
    const stepLab = (x, y, s, j) => computed(T(root, x, y, s === 1 ? 'S' : s === 3 ? 'T+S' : 'T', 'ts-label', { 'text-anchor': 'middle', cls: 'strong', fill: s === 1 ? 'var(--compare-text)' : 'var(--ink-2)', s: kS, delay: j * 260 }), 'pitch.pattern').classList.add('rise');
    if (pv === 'keyboard') {
      const lo = Math.min(...notesP.map(n => n.midi)), hi = Math.max(...notesP.map(n => n.midi));
      const oct = Math.floor(lo / 12) - 1, span = Math.max(1, Math.ceil((hi - (oct + 1) * 12) / 12));
      const whites = span * 7 + 1; const kwMax = 96; const kbW = Math.min(ix1 - ix0, whites * kwMax);
      const kbX = sc ? ix1 - kbW : (GRID.left + GRID.right) / 2 - kbW / 2, kbY = top, kbH = bottom - top;
      const kb = keys(pg, oct, { x: kbX, y: kbY, w: kbW, h: kbH, octaves: span, closeC: true, labelPath: 'pitch.notes' });
      kb.g.querySelectorAll('text').forEach(t => t.setAttribute('class', String(t.getAttribute('class') || '').replace('ts-small', 'ts-label strong')));
      // one disc marks the key being played; it moves along the tune during the pitch build
      const discOf = new Map(), noteDisc = [];
      notesP.forEach(n => { const ky = kb.keyOf(n.name); if (!ky) { noteDisc.push(null); return; }
        if (!discOf.has(n.midi)) {
          const cy = ky.black ? kbY + ky.h - 26 : kbY + kbH * .62 + (kbH * .38 - 40) / 2;
          discOf.set(n.midi, h('circle', { cx: ky.x, cy, r: Math.min(16, ky.w * .36), fill: 'var(--focus)', display: 'none' }, root));
        }
        noteDisc.push(discOf.get(n.midi)); });
      setDiscs = (k, u = 1) => {
        let on = new Set();
        if (k === kP) { const j = Math.floor((u * dur.pitch - 300) / NOTE_MS); if (j >= 0) on.add(noteDisc[Math.min(notesP.length - 1, j)]); }
        else if (k > kP && !sc) on = new Set(noteDisc); // a tune with no scale steps keeps its keys marked
        for (const d of discOf.values()) d.setAttribute('display', on.has(d) ? 'inline' : 'none');
      };
      if (sc) notesP.slice(1).forEach((n, j) => {
        const a = kb.keyOf(notesP[j].name), c = kb.keyOf(n.name); if (!a || !c) return; const y = kbY - 6, mx = (a.x + c.x) / 2;
        h('path', { d: `M${a.x} ${y} Q${mx} ${y - 40} ${c.x} ${y}`, fill: 'none', stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-lead)', s: kS, cls: 'rise', delay: j * 260 }, root);
        stepLab(mx, y - 26, Math.abs(n.midi - notesP[j].midi), j);
      });
    } else {
      // treble stave: bottom line E4; each step of the letter scale is half a line gap
      const gap = 20, y0 = top + 100, sx0 = ix0 + 8, sx1 = ix1;
      for (let l = 0; l < 5; l++) h('line', { x1: sx0, x2: sx1, y1: y0 - l * gap, y2: y0 - l * gap, stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-rule)' }, pg);
      const gy = y0 - gap; const cx = sx0 + 34;
      h('path', { d: `M${cx + 3} ${gy + 3} C${cx - 9} ${gy + 4} ${cx - 10} ${gy - 13} ${cx + 3} ${gy - 15} C${cx + 18} ${gy - 16} ${cx + 20} ${gy + 9} ${cx + 2} ${gy + 12} C${cx - 20} ${gy + 14} ${cx - 25} ${gy - 13} ${cx - 9} ${gy - 30} L${cx + 7} ${gy - 50} C${cx + 15} ${gy - 60} ${cx + 13} ${gy - 80} ${cx + 4} ${gy - 78} C${cx - 5} ${gy - 76} ${cx - 7} ${gy - 60} ${cx - 3} ${gy - 42} L${cx + 6} ${gy + 34} C${cx + 8} ${gy + 48} ${cx - 6} ${gy + 52} ${cx - 11} ${gy + 42}`,
        fill: 'none', stroke: 'var(--ink)', 'stroke-width': 'var(--sw-struct)', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, pg);
      const step = notesP.length > 1 ? (nx1 - nx0) / (notesP.length - 1) : 0;
      // names sit below the lowest note: middle C hangs below the stave on its ledger line, so they drop clear of it
      const ly2 = y0 + 48 + (notesP.some(n => stavePos(n) < -1) ? 14 : 0);
      notesP.forEach((n, j) => {
        const x = nx0 + j * step, p = stavePos(n), y = y0 - p * gap / 2; const g = h('g', { s: kP, cls: 'pop', delay: 300 + j * NOTE_MS }, root);
        for (let q = -2; q >= p; q -= 2) h('line', { x1: x - 22, x2: x + 22, y1: y0 - q * gap / 2, y2: y0 - q * gap / 2, stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-rule)' }, g);
        for (let q = 10; q <= p; q += 2) h('line', { x1: x - 22, x2: x + 22, y1: y0 - q * gap / 2, y2: y0 - q * gap / 2, stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-rule)' }, g);
        h('ellipse', { cx: x, cy: y, rx: 12, ry: 9, transform: `rotate(-22 ${x} ${y})`, fill: 'var(--focus)' }, g);
        if (n.label.length > 1) computed(T(g, x - 22, y + 8, n.label[1] === '#' ? '♯' : '♭', 'ts-small', { 'text-anchor': 'end', fill: 'var(--ink)' }), 'pitch.notes');
        computed(T(g, x, ly2, showName(n.label), 'ts-label', { 'text-anchor': 'middle', cls: 'strong', fill: 'var(--ink)' }), 'pitch.notes');
      });
      // interval arcs under the note names, the same style as the keyboard's arcs
      if (sc) notesP.slice(1).forEach((n, j) => {
        const xa = nx0 + j * step + 14, xc = nx0 + (j + 1) * step - 14, y = ly2 + 10, mx = (xa + xc) / 2;
        h('path', { d: `M${xa} ${y} Q${mx} ${y + 34} ${xc} ${y}`, fill: 'none', stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-lead)', s: kS, cls: 'rise', delay: j * 260 }, root);
        stepLab(mx, y + 45, Math.abs(n.midi - notesP[j].midi), j);
      });
    }
  }

  return {
    dur,
    onStep(k) { placeGrid(k); setDiscs(k, 0); },
    still() { placeGrid(N); setDiscs(N); },
    reset() { placeGrid(-1); setDiscs(-1); placeHead(sweeps[0] ? sweeps[0].k : 0, 0); },
    tick(k, u) { if (heads.length) placeHead(k, u); setDiscs(k, u); },
  };
}
