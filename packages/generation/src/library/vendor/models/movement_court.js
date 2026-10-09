// Movement phases and space on a court (H5). Two modes on one model:
//  - technique: a skill (throw, catch, jump, hop) as a strip of figures, one phase per build,
//    each figure easing from the previous phase's pose into its own. Phases keep their true order.
//  - tactics: a real court (true markings and proportions from kit court()), players placed in
//    metres, one pass or run per build, then the space created is shaded and measured.
// Built only on the kit.
import {
  h, T, measure, wrap, clamp, eIO, lerp, overlaps,
  textBlock, line, labelGround,
  editable, computed, txt, TEXT_PARAM_FOR, TITLE_PARAM, LABEL_PARAM, PHRASE_PARAM, schemaCheck, withDefaults, result,
} from '../kit/index.js';
import { court, player, ball, SPORT_DIMS, NETBALL_POSITIONS, NETBALL_ALLOWED, netballAllowed } from '../kit/batch-H.js';

export const meta = {
  id: 'movement_court', name: 'Movement and space', kind: 'scene', version: 1,
  subjects: ['PE'],
  years: ['Y1', 'Y2', 'Y3', 'Y4', 'Y5', 'Y6'],
  teaches: 'How a skill is made of phases in order, and how passing and moving into space beats defenders on a real court.',
};

/* ------------------------------------------------------------------ skills: phases in true order */
// Pose angles in degrees from straight down, positive = forward (the figure faces right).
// a = arm [upper, fore], l = leg [thigh, shin]; N = near side (throwing arm), F = far side.
// ball: 'N' in the near hand, 'B' between both hands, {hx,hy} off the near hand, {x,y} off the feet.
const SKILLS = {
  'throw-under': { name: 'Underarm throw', key: 'release', phases: [
    { id: 'ready', name: 'Ready', cue: 'Hold the ball in both hands. Look at the target.', pose: { t: 4, aN: [25, 70], aF: [25, 70], lN: [6, 2], lF: [-6, -2], ball: 'B' } },
    { id: 'back', name: 'Swing back', cue: 'Swing the throwing arm back like a pendulum.', pose: { t: 8, aN: [-50, -40], aF: [70, 80], lN: [2, 2], lF: [10, 4], ball: 'N' } },
    { id: 'step', name: 'Step', cue: 'Step forward with the opposite foot.', pose: { t: 10, aN: [-15, 0], aF: [55, 70], lN: [-14, -24], lF: [28, 8], ball: 'N' } },
    { id: 'release', name: 'Let go', cue: 'Swing through and let go at waist height.', pose: { t: 8, aN: [35, 45], aF: [40, 30], lN: [-18, -34], lF: [24, 6], ball: { hx: 22, hy: 4 } } },
    { id: 'follow', name: 'Follow through', cue: 'Keep the hand pointing at the target.', pose: { t: 4, aN: [95, 100], aF: [20, 10], lN: [-24, -60], lF: [16, 2], ball: { x: 104, y: -186 } } },
  ] },
  'throw-over': { name: 'Overarm throw', key: 'release', phases: [
    { id: 'ready', name: 'Side-on', cue: 'Stand side-on. Hold the ball by your ear.', pose: { t: 0, aN: [-20, 160], aF: [30, 60], lN: [-8, -4], lF: [10, 4], ball: 'N' } },
    { id: 'back', name: 'Arm back', cue: 'Reach the throwing arm back. Point at the target.', pose: { t: -5, aN: [-95, -120], aF: [95, 95], lN: [-10, -6], lF: [14, 8], ball: 'N' } },
    { id: 'step', name: 'Step', cue: 'Step towards the target with the opposite foot.', pose: { t: 0, aN: [-100, -130], aF: [90, 80], lN: [-14, -20], lF: [30, 10], ball: 'N' } },
    { id: 'release', name: 'Throw', cue: 'Lead with the elbow and let go high.', pose: { t: 15, aN: [150, 110], aF: [20, -20], lN: [-20, -40], lF: [26, 6], ball: { hx: 22, hy: -10 } } },
    { id: 'follow', name: 'Follow through', cue: 'Bring the arm down and across the body.', pose: { t: 25, aN: [60, 20], aF: [-20, -30], lN: [-30, -80], lF: [24, 6], ball: { x: 96, y: -236 } } },
  ] },
  catch: { name: 'Two-handed catch', key: 'give', phases: [
    { id: 'watch', name: 'Watch', cue: 'Watch the ball all the way.', pose: { t: 2, aN: [12, 20], aF: [8, 15], lN: [8, 3], lF: [-6, -2], ball: { x: 104, y: -250 } } },
    { id: 'ready', name: 'Hands ready', cue: 'Hands up, fingers spread, thumbs close.', pose: { t: 6, aN: [70, 120], aF: [65, 115], lN: [14, -4], lF: [4, -10], ball: { x: 100, y: -214 } } },
    { id: 'reach', name: 'Reach', cue: 'Reach out to meet the ball.', pose: { t: 10, aN: [88, 92], aF: [85, 90], lN: [14, -4], lF: [4, -10], ball: 'B' } },
    { id: 'give', name: 'Give', cue: 'Pull the ball into your chest to cushion it.', pose: { t: 2, aN: [25, 150], aF: [20, 145], lN: [25, -12], lF: [15, -20], ball: 'B' } },
  ] },
  jump: { name: 'Standing long jump', key: 'drive', phases: [
    { id: 'crouch', name: 'Crouch', cue: 'Bend the knees and swing the arms back.', pose: { t: 45, aN: [-60, -50], aF: [-55, -45], lN: [70, -25], lF: [65, -30], dx: -30 } },
    { id: 'drive', name: 'Drive', cue: 'Swing the arms forward and push off both feet.', pose: { t: 35, aN: [150, 155], aF: [140, 145], lN: [-15, -20], lF: [-20, -25], dx: -20 } },
    { id: 'flight', name: 'Fly', cue: 'Bring the knees up and reach forward.', pose: { t: 20, aN: [110, 100], aF: [100, 95], lN: [80, 15], lF: [75, 10], air: 60, dx: 0 } },
    { id: 'land', name: 'Land', cue: 'Land on both feet and bend the knees.', pose: { t: 45, aN: [85, 85], aF: [80, 80], lN: [80, -15], lF: [75, -20], dx: 20 } },
  ] },
  hop: { name: 'Hop', key: 'land', phases: [
    { id: 'balance', name: 'Balance', cue: 'Stand on one foot, arms out.', pose: { t: 4, aN: [40, 60], aF: [-30, -10], lN: [2, 0], lF: [25, -75] } },
    { id: 'bend', name: 'Bend', cue: 'Bend the standing knee.', pose: { t: 15, aN: [-30, -20], aF: [-35, -25], lN: [40, -15], lF: [30, -80] } },
    { id: 'push', name: 'Push', cue: 'Push up off the toes. Swing the arms up.', pose: { t: 8, aN: [140, 150], aF: [130, 140], lN: [-8, -12], lF: [35, -70] } },
    { id: 'flight', name: 'Up', cue: 'Stay tall in the air.', pose: { t: 8, aN: [110, 120], aF: [100, 110], lN: [10, -10], lF: [35, -75], air: 40 } },
    { id: 'land', name: 'Land', cue: 'Land on the same foot and bend the knee.', pose: { t: 15, aN: [60, 70], aF: [50, 60], lN: [40, -15], lF: [30, -80] } },
  ] },
};
const SKILL_IDS = Object.keys(SKILLS);
const PHASE_IDS = [...new Set(SKILL_IDS.flatMap(s => SKILLS[s].phases.map(p => p.id)))];
const PHASE_NOTES = {
  'throw-under': { ready: 'Eyes on the target before anything moves.', back: 'The arm stays straight and swings like a pendulum, not a bent elbow.', step: 'Right hand throws, left foot steps (and the other way round). Ask: which foot did you step with?', release: 'Let go too early and the ball goes up; too late and it hits the floor. Ask them to find the moment.', follow: 'The hand finishes pointing where the ball should go.' },
  'throw-over': { ready: 'Side-on means the non-throwing shoulder points at the target.', back: 'The pointing arm aims; the throwing arm reaches back and high.', step: 'The step comes before the arm: legs, then body, then arm.', release: 'Elbow leads, hand follows, and the ball goes off high.', follow: 'The arm finishes across the body; the back foot comes through.' },
  catch: { watch: 'Eyes on the ball, not the thrower.', ready: 'Thumbs together for a ball above the waist, little fingers together below it.', reach: 'Meet the ball early with soft hands.', give: 'Giving with the ball stops it bouncing out. Ask: why do the arms bend?' },
  jump: { crouch: 'The arms swing back as the knees bend: loading up.', drive: 'The arm swing helps drive the body forward. Both feet leave together.', flight: 'Knees up and arms forward keep the body from falling back.', land: 'Bent knees soak up the landing. Measure from the back of the heels.' },
  hop: { balance: 'A hop takes off and lands on the same foot. Arms out help balance.', bend: 'A small bend gives a spring, like a coiled spring.', push: 'Push from the toes; the arms swing up to help lift.', flight: 'Stay tall and look forward, not down.', land: 'Land on the same foot, toes first, and bend the knee to absorb it.' },
};

/* ------------------------------------------------------------------ sports */
const SPORT_IDS = ['netball', 'football', 'hockey', 'tag-rugby', 'open'];
const SPORT_NAMES = { netball: 'netball court', football: 'football pitch', hockey: 'hockey pitch', 'tag-rugby': 'tag rugby pitch', open: 'playing area' };
const COURT_CAPTION = {
  netball: 'A netball court is split into thirds, with a goal circle at each end.',
  football: 'A football pitch: halfway line, centre circle and a penalty area at each end.',
  hockey: 'A hockey pitch: the 23-metre lines and a shooting circle at each end.',
  'tag-rugby': 'A tag rugby pitch: a try zone at each end and a halfway line.',
  open: 'Our playing area: a space marked out with four cones.',
};
const BOX = { x: 64, y: 140, w: 1152, h: 496 };
const R_PLAYER = 24;
const BALL_OFF = 24; // the held ball sits off the disc's shoulder, clear of a two-letter bib
// mirrors kit court(): the scale it fits the sport into BOX with
function geom(sport) {
  const { L, W } = SPORT_DIMS[sport] || SPORT_DIMS.open; const grass = sport !== 'netball' && sport !== 'open';
  const run = 4 * (grass ? 1 : .3); const k = Math.min(BOX.w / (L + 2 * run), BOX.h / (W + 2 * run));
  return { L, W, k };
}
// Each team's numbers are typed from its own end (across 0 = the end it defends), so the other team is
// turned half round to draw. A netball position then stays legal when its player switches team, and a
// scene keeps its shape when the court changes (netball used to be the only sport typed this way).
const metres = (sport, p) => { const { L, W } = geom(sport); const b = p.team === 'b';
  return { mx: (b ? 100 - p.across : p.across) / 100 * L, my: (b ? 100 - p.down : p.down) / 100 * W }; };
const thirdOf = (sport, mx) => { const { L } = geom(sport); return mx < L / 3 ? 1 : mx < 2 * L / 3 ? 2 : 3; };
const THIRD_NAME = ['', 'first third', 'centre third', 'goal third'];
const fmtM = d => d < 1 ? `${(Math.round(d * 10) / 10).toFixed(1)} m` : `${Math.round(d)} m`;

/* ------------------------------------------------------------------ params */
const PCT = (title, def) => ({ type: 'number', title, minimum: 0, maximum: 100, default: def });
export const params = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', title: 'Movement and space',
  properties: {
    title: TITLE_PARAM('Underarm throw'),
    mode: { type: 'string', title: 'Show', enum: ['technique', 'tactics'], 'x-labels': ['A skill, phase by phase', 'Players on a court'], default: 'technique' },
    skill: { type: 'string', title: 'Skill', enum: SKILL_IDS, 'x-labels': SKILL_IDS.map(s => SKILLS[s].name), default: 'throw-under' },
    phases: { type: 'array', title: 'Phases to show', description: 'Leave empty for every phase. They always run in the order the skill happens.', 'x-item': 'a phase', maxItems: 5, default: [],
      items: { type: 'string', enum: PHASE_IDS, default: 'ready' } },
    focus: { type: 'string', title: 'Phase to stress at the end', enum: ['auto', ...PHASE_IDS], 'x-labels': ['The key moment', ...PHASE_IDS], default: 'auto', 'x-panel': 'advanced' },
    sport: { type: 'string', title: 'Court or pitch', enum: SPORT_IDS, 'x-labels': ['Netball court', 'Football pitch', 'Hockey pitch', 'Tag rugby pitch', 'Open space with cones'], default: 'open' },
    scenario: { type: 'string', title: 'What it shows', enum: ['find-space', 'attack', 'centre-pass'], 'x-labels': ['Finding space', 'Attack against defence', 'Netball centre pass'], default: 'find-space' },
    teamA: LABEL_PARAM('Name for the team with the ball', 'Attackers', { minLength: 1 }),
    teamB: LABEL_PARAM('Name for the other team', 'Defenders', { minLength: 1 }),
    players: { type: 'array', title: 'Players', description: 'Where each player starts. Across: 0 is the left end, 100 the right end (the team with the ball attacks to the right). Down: 0 is the top side, 100 the bottom. The other team is seen from its own end instead: across 0 is the end it defends (the right end), down 0 is the bottom side.', 'x-item': 'a player', maxItems: 14,
      default: [{ team: 'a', label: 'A', across: 30, down: 50 }, { team: 'a', label: 'B', across: 55, down: 25 }, { team: 'b', label: 'X', across: 55, down: 60 }],
      items: { type: 'object', required: ['team', 'label'], default: { team: 'a', label: 'A', across: 50, down: 50 }, properties: {
        team: { type: 'string', title: 'Team', enum: ['a', 'b'], 'x-labels': ['With the ball', 'Other team'], default: 'a' },
        label: { type: 'string', title: 'Bib', description: 'One or two letters. In netball, the position (GS, GA, WA, C, WD, GD, GK).', minLength: 1, maxLength: 2 },
        across: PCT('Across (0–100)', 50), down: PCT('Down (0–100)', 50),
      } } },
    // Moves, the ball and the shaded space name players by their number in the list, not by bib, so renaming
    // a bib or switching a player's team never breaks a move that refers to them.
    ball: { type: 'integer', title: 'Who starts with the ball (player number)', description: 'The number of a player in the Players list: 1 is the first. 0 means nobody has the ball yet.', minimum: 0, maximum: 14, default: 1 },
    moves: { type: 'array', title: 'Moves (one per step)', 'x-item': 'a move', maxItems: 6, default: [],
      // a pass always comes from whoever has the ball, so a pass names only its catcher: the passer can
      // never disagree with the ball, and changing who starts with it never strands a later pass
      items: { type: 'object', required: ['type', 'who'], default: { type: 'run', who: 1, across: 50, down: 50 }, properties: {
        type: { type: 'string', title: 'Move', enum: ['pass', 'run'], 'x-labels': ['Pass', 'Run'], default: 'run' },
        who: { type: 'integer', title: 'Who (player number)', description: 'For a run, the player who runs. For a pass, the player who catches it: the pass comes from whoever has the ball. 1 is the first player in the list.', minimum: 1, maximum: 14, default: 1 },
        across: PCT('Run to: across', 50), down: PCT('Run to: down', 50),
      } } },
    space: { type: 'object', title: 'Shade the space', default: { show: true, who: 0 }, properties: {
      show: { type: 'boolean', title: 'Shade the space at the end', default: true },
      who: { type: 'integer', title: 'Around which player (player number)', description: '0 means the last player in the team with the ball to move or catch.', minimum: 0, maximum: 14, default: 0 },
    } },
    text: TEXT_PARAM_FOR(Object.assign({ third1: 'label', third2: 'label', third3: 'label', space: 'label' },
      ...PHASE_IDS.map(id => ({ [`phase:${id}`]: 'label', [`cue:${id}`]: 'phrase' })))),
  },
};

export const presets = [
  { id: 'y1-throw', name: 'Year 1: throw underarm', params: { title: 'Throwing underarm', mode: 'technique', skill: 'throw-under' } },
  { id: 'y2-catch', name: 'Year 2: catch with two hands', params: { title: 'Catching with two hands', mode: 'technique', skill: 'catch' } },
  { id: 'y3-find-space', name: 'Year 3: find the space', params: {
    title: 'Find the space', mode: 'tactics', sport: 'open', scenario: 'find-space', teamA: 'Attackers', teamB: 'Defenders', ball: 1,
    players: [{ team: 'a', label: 'A', across: 10, down: 50 }, { team: 'a', label: 'B', across: 35, down: 35 }, { team: 'a', label: 'C', across: 55, down: 90 },
      { team: 'b', label: 'X', across: 58, down: 48 }, { team: 'b', label: 'Y', across: 45, down: 38 }, { team: 'b', label: 'Z', across: 10, down: 15 }],
    moves: [{ type: 'run', who: 2, across: 30, down: 12 }, { type: 'pass', who: 2 }, { type: 'run', who: 3, across: 75, down: 50 }],
    space: { show: true, who: 3 },
  } },
  { id: 'y5-centre-pass', name: 'Year 5: netball centre pass', params: {
    title: 'The centre pass', mode: 'tactics', sport: 'netball', scenario: 'centre-pass', teamA: 'Our team', teamB: 'Opponents', ball: 1,
    players: [{ team: 'a', label: 'C', across: 50, down: 50 }, { team: 'a', label: 'WA', across: 70, down: 22 }, { team: 'a', label: 'GA', across: 80, down: 45 },
      { team: 'a', label: 'GS', across: 92, down: 45 }, { team: 'a', label: 'WD', across: 26, down: 70 },
      { team: 'b', label: 'C', across: 58, down: 70 }, { team: 'b', label: 'WD', across: 26, down: 66 }, { team: 'b', label: 'GD', across: 18, down: 38 }, { team: 'b', label: 'GK', across: 5, down: 40 }],
    moves: [{ type: 'run', who: 2, across: 58, down: 25 }, { type: 'pass', who: 2 },
      { type: 'run', who: 3, across: 70, down: 62 }, { type: 'pass', who: 3 }],
    space: { show: true, who: 3 },
  } },
];

/* ------------------------------------------------------------------ model of the data */
function phaseList(P) {
  const S = SKILLS[P.skill] || SKILLS['throw-under'];
  const ids = P.phases && P.phases.length ? P.phases : S.phases.map(p => p.id);
  return ids.map(id => S.phases.find(p => p.id === id)).filter(Boolean);
}
const phaseName = (P, ph) => txt(P, `label:phase:${ph.id}`, ph.name);
const phaseCue = (P, ph) => txt(P, `label:cue:${ph.id}`, ph.cue);

/** Play the moves through: positions and the ball holder after each move. */
function story(P) {
  const pl = (P.players || []).map((p, i) => ({ ...p, i }));
  const find = n => (Number.isInteger(n) && n >= 1 ? pl[n - 1] : null) || null;
  let pos = pl.map(p => metres(P.sport, p)); let holder = find(P.ball);
  const states = [{ pos, holder }]; const moves = [];
  (P.moves || []).forEach((m, j) => {
    const named = find(m.who);
    if (m.type === 'pass') { // from whoever has the ball to the named catcher
      const mv = { ...m, j, named, who: holder, to: named, team: holder ? holder.team : 'a', from: holder ? pos[holder.i] : null, dest: named ? pos[named.i] : null };
      mv.intercept = !!(holder && named && named.team !== holder.team); if (holder && named) holder = named;
      moves.push(mv); states.push({ pos, holder }); return;
    }
    const who = named; const mv = { ...m, j, named, who, team: who ? who.team : 'a', from: who ? pos[who.i] : null };
    if (who) { mv.dest = metres(P.sport, { ...m, team: who.team }); mv.dribble = holder === who; pos = pos.slice(); pos[who.i] = mv.dest; }
    moves.push(mv); states.push({ pos, holder });
  });
  return { pl, moves, states, find };
}
function spaceTarget(P, S) {
  if (!P.space || !P.space.show || !S.pl.some(p => p.team === 'b')) return null;
  let who = P.space.who ? S.find(P.space.who) : null;
  if (who && who.team === 'b') who = null;
  if (!who) for (let j = S.moves.length - 1; j >= 0 && !who; j--) { const m = S.moves[j]; const c = m.type === 'pass' ? m.to : m.who; if (c && c.team === 'a') who = c; }
  if (!who) { const h0 = S.states[S.states.length - 1].holder; who = h0 && h0.team === 'a' ? h0 : S.pl.find(p => p.team === 'a'); }
  if (!who) return null;
  const fin = S.states[S.states.length - 1].pos; const at = fin[who.i];
  let near = null, d = Infinity; for (const q of S.pl) if (q.team === 'b' && q !== who) { const e = Math.hypot(fin[q.i].mx - at.mx, fin[q.i].my - at.my); if (e < d) { d = e; near = q; } }
  return { who, at, near, d };
}

/* ------------------------------------------------------------------ validate */
export function validate(raw) {
  const P = withDefaults(params, raw);
  const R = schemaCheck(params, P); const Wn = [];
  if (R.length) return result(R);
  if (P.mode === 'technique') {
    const S = SKILLS[P.skill]; const order = S.phases.map(p => p.id); let last = -1; const seen = new Set();
    (P.phases || []).forEach((id, i) => {
      const at = order.indexOf(id);
      if (at < 0) R.push({ path: `phases.${i}`, reason: `“${id}” is not a phase of the ${S.name.toLowerCase()}. Its phases are: ${S.phases.map(p => p.name.toLowerCase()).join(', ')}.` });
      else if (seen.has(id)) R.push({ path: `phases.${i}`, reason: `${S.phases[at].name} is already in the list. Each phase happens once.` });
      else if (at < last) R.push({ path: `phases.${i}`, reason: `${S.phases[at].name} comes before ${S.phases[last].name.toLowerCase()} in a real ${S.name.toLowerCase()}. Put the phases in the order they happen.` });
      seen.add(id); if (at >= 0) last = Math.max(last, at);
    });
    if (P.focus !== 'auto' && !order.includes(P.focus)) R.push({ path: 'focus', reason: `“${P.focus}” is not a phase of the ${S.name.toLowerCase()}.` });
    return result(R, Wn);
  }
  // tactics
  const sport = P.sport; const net = sport === 'netball'; const { L, W, k } = geom(sport);
  const pl = P.players || [];
  if (!pl.length) R.push({ path: 'players', reason: 'Add at least one player.' });
  // moves name players by number, so two equal bibs are only confusing to read: a warning, which also
  // lets two players swap teams one change at a time
  pl.forEach((p, i) => { if (pl.findIndex(q => q.team === p.team && q.label === p.label) !== i) Wn.push(`Two players in ${p.team === 'b' ? P.teamB : P.teamA} both wear ${p.label}.${net ? ' A netball team has one player in each position.' : ''} Give each player a different bib.`); });
  if (net) pl.forEach((p, i) => {
    if (!NETBALL_POSITIONS.includes(p.label)) { R.push({ path: `players.${i}.label`, reason: `In netball each player wears a position bib: GS, GA, WA, C, WD, GD or GK. “${p.label}” is not one.` }); return; }
    const m = metres(sport, p); const ok = p.team === 'b' ? netballAllowed(p.label, L - m.mx, W - m.my) : netballAllowed(p.label, m.mx, m.my);
    if (!ok) R.push({ path: `players.${i}.label`, reason: `${p.label} isn’t allowed there. ${p.label} may only play in ${areaWords(p.label, p.team)}. Move the player or change the bib.` });
  });
  if (R.length) return result(R);
  const S = story(P);
  const nPl = pl.length, who = n => `player ${n}`;
  if (P.ball && !S.find(P.ball)) R.push({ path: 'ball', reason: `There are only ${nPl} players, so there is no ${who(P.ball)} to start with the ball.` });
  else if (S.states[0].holder && S.states[0].holder.team === 'b') Wn.push(`${S.states[0].holder.label} starts with the ball but is in the other team.`);
  S.moves.forEach(m => {
    const j = m.j, path = `moves.${j}`;
    if (!m.named) { R.push({ path: `${path}.who`, reason: `Move ${j + 1}: there are only ${nPl} players, so there is no ${who(P.moves[j].who)}.` }); return; }
    const holder = S.states[j].holder;
    if (m.type === 'pass') {
      if (!holder) R.push({ path: 'ball', reason: 'Nobody has the ball, so nobody can pass. Choose who starts with it.' });
      else if (m.to === holder) Wn.push(`Move ${j + 1}: ${holder.label} already has the ball, so this pass has nobody to go to. Choose the player who catches it.`);
      else if (m.intercept) Wn.push(`Move ${j + 1}: ${m.to.label} is in the other team, so the pass is intercepted.`);
      else {
        if (net && Math.abs(thirdOf(sport, m.from.mx) - thirdOf(sport, m.dest.mx)) >= 2) R.push({ path: `${path}.who`, reason: `In netball the ball can’t cross a whole third without being caught in it. Pass to someone in the centre third first.` });
        if (sport === 'tag-rugby' && (m.team === 'b' ? m.dest.mx < m.from.mx - .01 : m.dest.mx > m.from.mx + .01)) R.push({ path: `${path}.who`, reason: `In tag rugby the ball can only be passed sideways or backwards. Move ${m.to.label} level with or behind ${m.who.label}.` });
      }
    } else {
      // netball fouls are shown and named on the slide (a free pass), so they warn rather than refuse
      const foul = runFoul(P, S, m);
      if (foul === 'footwork') Wn.push(`Move ${j + 1}: in netball the player with the ball can’t run with it, so the slide shows it as a footwork foul.`);
      if (foul === 'offside') Wn.push(`Move ${j + 1}: ${m.who.label} may only play in ${areaWords(m.who.label, m.team)}, so the slide shows the run as offside.`);
    }
  });
  if (P.scenario === 'centre-pass' && !net) Wn.push('A centre pass is a netball restart, so on this pitch the moves are shown as an attack.');
  else if (P.scenario === 'centre-pass' && !hasCentre(P)) Wn.push(`A centre pass is taken by C, and ${P.teamA} has no C, so the moves are shown as an attack.`);
  if (scen(P) === 'centre-pass') {
    {
      const c = S.pl.find(p => p.team === 'a' && p.label === 'C');
      {
        const m = metres(sport, c); if (Math.hypot(m.mx - L / 2, m.my - W / 2) > .5) R.push({ path: `players.${c.i}.across`, reason: 'At a centre pass, C stands in the centre circle. Set C to across 50, down 50.' });
        if (S.states[0].holder !== c) R.push({ path: 'ball', reason: `At a centre pass, C has the ball. C is player ${c.i + 1}.` });
      }
      S.pl.forEach(p => { if (p.team === 'b' && p.label === 'C' && thirdOf(sport, metres(sport, p).mx) !== 2) R.push({ path: `players.${p.i}.across`, reason: 'At a centre pass both centres start in the centre third. Move the other team’s C into it.' }); });
      S.pl.forEach(p => { if (p.label !== 'C' && thirdOf(sport, metres(sport, p).mx) === 2) R.push({ path: `players.${p.i}.across`, reason: `At a centre pass only the two centres may be in the centre third until the whistle. Move ${p.label} back into a goal third.` }); });
      const bad = badCentreCatch(P, S);
      if (bad) Wn.push(`Move ${bad.j + 1}: the centre pass is caught outside the centre third, so in a game it would be a free pass to ${P.teamB}. The slide says so.`);
    }
  }
  if (R.length) return result(R);
  // discs that would touch are drawn just apart (see display()), so closeness is a warning, never a refusal
  let close = null;
  S.states.forEach((st, s) => { if (!close) for (let a = 0; a < S.pl.length && !close; a++) for (let b2 = a + 1; b2 < S.pl.length && !close; b2++)
    if (Math.hypot(st.pos[a].mx - st.pos[b2].mx, st.pos[a].my - st.pos[b2].my) * k < 2 * R_PLAYER + 4) close = [S.pl[a], S.pl[b2], s]; });
  if (close) Wn.push(`${close[0].label} and ${close[1].label} stand closer than their discs can show${close[2] ? ` after move ${close[2]}` : ''}, so they are drawn just apart.`);
  if (P.space && P.space.who) { const q = S.find(P.space.who);
    if (!q) R.push({ path: 'space.who', reason: `There are only ${nPl} players, so there is no ${who(P.space.who)} to shade the space around.` });
    else if (q.team === 'b') Wn.push(`${q.label} is in the other team, so the space is shaded around the last player with the ball to move.`); }
  if (P.space && P.space.show && !S.pl.some(p => p.team === 'b')) Wn.push('There are no defenders, so there is no space to measure.');
  return result(R, Wn);
}
/** Where to draw each player: true metres, except that discs which would touch are eased just apart
 *  (by at most a disc's width), so a bib is never drawn over another disc. A player who did not move
 *  keeps the place it was drawn at in the build before. Measures (the space disc) use the true metres. */
function display(S, { L, W, k }) {
  const minD = (2 * R_PLAYER + 4) / k; let prevTrue = null, prevDisp = null;
  const states = S.states.map(st => {
    const pos = st.pos.map((q, i) => ({ ...(prevTrue && prevTrue[i] === q ? prevDisp[i] : q) }));
    for (let it = 0; it < 40; it++) {
      let moved = false;
      for (let a = 0; a < pos.length; a++) for (let c = a + 1; c < pos.length; c++) {
        const dx = pos[c].mx - pos[a].mx, dy = pos[c].my - pos[a].my, d = Math.hypot(dx, dy); if (d >= minD - 1e-6) continue;
        const ux = d > 1e-6 ? dx / d : Math.cos(a * 2.4 + 1), uy = d > 1e-6 ? dy / d : Math.sin(a * 2.4 + 1), push = (minD - d) / 2 + 1e-3;
        pos[a].mx -= ux * push; pos[a].my -= uy * push; pos[c].mx += ux * push; pos[c].my += uy * push; moved = true;
      }
      for (const q of pos) { q.mx = clamp(q.mx, 0, L); q.my = clamp(q.my, 0, W); }
      if (!moved) break;
    }
    prevTrue = st.pos; prevDisp = pos; return { ...st, pos };
  });
  const moves = S.moves.map(m => {
    if (!m.who || !m.from) return m;
    return { ...m, from: states[m.j].pos[m.who.i], dest: m.type === 'pass' ? (m.to ? states[m.j].pos[m.to.i] : null) : states[m.j + 1].pos[m.who.i] };
  });
  return { ...S, states, moves };
}
/** A netball run that breaks a rule: running with the ball (footwork) or leaving the position's areas (offside). */
function runFoul(P, S, m) {
  if (P.sport !== 'netball' || m.type !== 'run' || !m.who || !m.dest) return null;
  if (S.states[m.j].holder === m.who) return 'footwork';
  const { L, W } = geom(P.sport); const t = m.dest;
  const ok = NETBALL_POSITIONS.includes(m.who.label) && (m.team === 'b' ? netballAllowed(m.who.label, L - t.mx, W - t.my) : netballAllowed(m.who.label, t.mx, t.my));
  return ok ? null : 'offside';
}
function areaWords(pos, team) {
  const words = { 'third-1': 'their defending third', 'third-2': 'the centre third', 'third-3': 'their attacking third', 'circle-1': 'their own goal circle', 'circle-3': 'the goal circle they shoot at' };
  const list = (NETBALL_ALLOWED[pos] || []).map(a => words[a]);
  return list.length > 1 ? list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1] : list[0] || '';
}

/* ------------------------------------------------------------------ builds */
// a centre pass is netball only; on another pitch the same moves read as an attack (validate warns)
// and it is taken by the C of the team with the ball, so without one it reads as an attack too
const hasCentre = P => (P.players || []).some(p => p.team === 'a' && p.label === 'C');
const scen = P => P.scenario === 'centre-pass' && (P.sport !== 'netball' || !hasCentre(P)) ? 'attack' : P.scenario;
// a centre pass caught outside the centre third is a real infringement: shown, and named on the slide
const badCentreCatch = (P, S) => { if (scen(P) !== 'centre-pass') return null;
  const f = S.moves.find(m => m.type === 'pass' && m.to !== m.who); return f && f.dest && thirdOf(P.sport, f.dest.mx) !== 2 ? f : null; };
function plan(P) {
  const items = [];
  if (P.mode === 'technique') {
    const S = SKILLS[P.skill]; const ph = phaseList(P);
    ph.forEach((p, i) => items.push({ key: `phase:${p.id}`, caption: `${i + 1}. ${phaseName(P, p)}: ${phaseCue(P, p)}` }));
    const names = ph.map((p, i) => i ? phaseName(P, p).toLowerCase() : phaseName(P, p));
    return { items, summary: `${S.name}: ${names.join(', then ')}.`.replace(/, then ([^,]*)\.$/, ' and $1.').replace(/, then /g, ', ') };
  }
  const S = story(P); const A = P.teamA || 'Attackers', B = P.teamB || 'Defenders'; const hasB = S.pl.some(p => p.team === 'b');
  items.push({ key: 'court', caption: COURT_CAPTION[P.sport] });
  items.push({ key: 'players', caption: scen(P) === 'centre-pass' ? 'At the centre pass, only the two centres may stand in the centre third.' : hasB ? `${A} and ${B.toLowerCase()} take their places.` : 'The players take their places.' });
  S.moves.forEach(m => {
    const w = m.who ? m.who.label : m.who;
    let c;
    if (m.type === 'pass' && m.to && m.to === m.who) c = `${w} keeps the ball.`;
    else if (m.type === 'pass' && m === badCentreCatch(P, S)) c = `${w} passes to ${m.to.label}, caught outside the centre third: a free pass to ${B.toLowerCase()}.`;
    else if (m.type === 'pass') c = m.intercept ? `${m.to.label} intercepts the pass from ${w}.` : `${w} passes to ${m.to ? m.to.label : ''}.`;
    else if (runFoul(P, S, m) === 'footwork') c = `${w} runs with the ball: a footwork foul in netball, so a free pass to ${(m.team === 'b' ? A : B).toLowerCase()}.`;
    else if (runFoul(P, S, m) === 'offside') c = `${w} runs out of their areas: offside, so a free pass to ${(m.team === 'b' ? A : B).toLowerCase()}.`;
    else if (P.sport === 'netball' && m.dest) c = `${w} dodges into the ${THIRD_NAME[thirdOf(P.sport, m.dest.mx)]}${m.from && thirdOf(P.sport, m.from.mx) === thirdOf(P.sport, m.dest.mx) ? ', away from their marker' : ''}.`;
    else c = m.dribble ? `${w} runs with the ball into space.` : `${w} moves away from the defenders, into space.`;
    items.push({ key: `move:${m.j}`, caption: c });
  });
  const sp = spaceTarget(P, S);
  if (sp) items.push({ key: 'space', caption: S.states[S.states.length - 1].holder === sp.who
    ? `${sp.who.label} caught the ball ${fmtM(sp.d)} from the nearest defender, in space.`
    : `${sp.who.label} is ${fmtM(sp.d)} from the nearest defender: free to receive the ball.` });
  const summary = scen(P) === 'centre-pass' ? 'The centre pass: dodge into the centre third, catch, then pass on into space.'
    : scen(P) === 'attack' ? 'Pass and move: the ball goes to the player in space.' : 'Find space: move away from defenders so a teammate can pass to you.';
  return { items, summary, S, sp };
}
export function builds(P) { P = withDefaults(params, P); const { items, summary } = plan(P); return { steps: items.map(({ key, caption }) => ({ key, caption })), summary: { caption: summary } }; }

export function notes(P) {
  P = withDefaults(params, P); const pl = plan(P);
  if (P.mode === 'technique') {
    const ph = phaseList(P); const N = PHASE_NOTES[P.skill] || {};
    return { steps: ph.map(p => N[p.id] || ''), summary: 'Ask pupils to say the phases in order while they practise, then watch a partner and spot the missing one. Figures show the shape, not a measured pose.' };
  }
  const { L, W } = geom(P.sport);
  const steps = pl.items.map(it => {
    if (it.key === 'court') return `Positions are to scale on a ${L} m by ${W} m ${SPORT_NAMES[P.sport]}.${P.sport === 'football' ? ' Primary games use a smaller pitch with the same shape.' : ''}${P.sport === 'netball' ? ' Each position may only play in its own areas.' : ''}`;
    if (it.key === 'players') return scen(P) === 'centre-pass' ? 'Point out that everyone else waits in a goal third until the whistle.' : 'Ask: who is free? Who is marked?';
    if (it.key === 'space') return 'The shaded circle reaches the nearest defender: the bigger it is, the more time the player has to catch. Ask: where else is there space?';
    const m = pl.S.moves[+it.key.slice(5)];
    if (m.type === 'pass') return `Ask: why pass to ${m.to ? m.to.label : 'them'} now? ${P.sport === 'netball' ? 'The catcher lands, then has 3 seconds to pass.' : ''}`.trim();
    return P.sport === 'netball' ? 'A dodge: a sharp change of direction to lose the marker, then a strong lead into space.' : 'Ask: where did they move, and why there?';
  });
  return { steps, summary: scen(P) === 'centre-pass' ? 'Walk it through on the court: who moves first, who catches, where the next space is.' : 'Play it in small groups: 3 v 3, score a point for each pass caught in space.' };
}

/* ------------------------------------------------------------------ figure (technique) */
const SEG = { torso: 72, neck: 6, head: 17, upper: 40, fore: 38, thigh: 50, shin: 50, foot: 15 };
const rad = d => d * Math.PI / 180;
const down = (p, a, l) => [p[0] + l * Math.sin(rad(a)), p[1] + l * Math.cos(rad(a))];
function solve(pose) {
  const H = [0, 0]; const t = rad(pose.t || 0);
  const Sh = [Math.sin(t) * SEG.torso, -Math.cos(t) * SEG.torso];
  const Hd = [Sh[0] + Math.sin(t) * (SEG.neck + SEG.head) + 3, Sh[1] - Math.cos(t) * (SEG.neck + SEG.head)];
  const arm = a => { const e = down(Sh, a[0], SEG.upper); return [Sh, e, down(e, a[1], SEG.fore)]; };
  const leg = l => { const kn = down(H, l[0], SEG.thigh), an = down(kn, l[1], SEG.shin); const sr = rad(l[1]); return [H, kn, an, [an[0] + SEG.foot * Math.cos(sr), an[1] - SEG.foot * Math.sin(sr) * .4]]; };
  const out = { Sh, Hd, aN: arm(pose.aN), aF: arm(pose.aF), lN: leg(pose.lN), lF: leg(pose.lF) };
  const low = Math.max(...[out.lN, out.lF].flatMap(l => [l[2][1], l[3][1]])) + 5;
  out.lift = -low - (pose.air || 0); // hip y above the ground
  return out;
}
const lerpPose = (a, b, u) => {
  const o = {}; for (const k of ['t', 'air', 'dx']) o[k] = lerp(a[k] || 0, b[k] || 0, u);
  for (const k of ['aN', 'aF', 'lN', 'lF']) o[k] = [lerp(a[k][0], b[k][0], u), lerp(a[k][1], b[k][1], u)];
  return o;
};
const NEUTRAL = { t: 0, aN: [8, 12], aF: [-6, -4], lN: [4, 2], lF: [-4, -2] };
// a limb or body segment: round ends of two widths joined by straight sides (tapers like a real limb)
function taper(p1, p2, w1, w2 = w1) {
  const dx = p2[0] - p1[0], dy = p2[1] - p1[1], L = Math.hypot(dx, dy) || .001; const ux = -dy / L, uy = dx / L; const r1 = w1 / 2, r2 = w2 / 2;
  const f = n => n.toFixed(1);
  return `M${f(p1[0] + ux * r1)} ${f(p1[1] + uy * r1)} L${f(p2[0] + ux * r2)} ${f(p2[1] + uy * r2)} A${r2} ${r2} 0 1 0 ${f(p2[0] - ux * r2)} ${f(p2[1] - uy * r2)} L${f(p1[0] - ux * r1)} ${f(p1[1] - uy * r1)} A${r1} ${r1} 0 1 0 ${f(p1[0] + ux * r1)} ${f(p1[1] + uy * r1)} Z`;
}
const BALL_R = 24;
function figure(p, x, gy, s, a) {
  const g = h('g', a, p); const inner = h('g', {}, g);
  const far = 'color-mix(in oklab,var(--focus) var(--depth-shade),var(--shade))', near = 'var(--focus)';
  const kit2 = 'color-mix(in oklab,var(--focus) 55%,var(--shade))', kit2far = 'color-mix(in oklab,var(--focus) 40%,var(--shade))';
  h('ellipse', { cx: 0, cy: 0, rx: 38, ry: 7, fill: 'var(--ground-shadow)' }, inner).dataset.role = 'shadow';
  const mk = col => h('path', { fill: col }, inner);
  const P = { aF1: mk(far), aF2: mk(far), hF: h('circle', { r: 7.5, fill: far }, inner), lF1: mk(kit2far), lF2: mk(far), lF3: mk(kit2far),
    neck: mk(near), torso: mk(near), shorts: mk(kit2), head: h('circle', { r: 18, fill: near }, inner),
    lN1: mk(kit2), lN2: mk(near), lN3: mk(kit2), aN1: mk(near), aN2: mk(near), hN: h('circle', { r: 7.5, fill: near }, inner) };
  const bl = h('g', {}, inner); ball(bl, 0, 0, { r: BALL_R });
  const shadow = inner.querySelector('[data-role=shadow]');
  function set(pose, ballSpec) {
    const f = solve(pose); const oy = f.lift, ox = pose.dx || 0; const Q = q => [q[0] + ox, q[1] + oy];
    inner.setAttribute('transform', `translate(${x} ${gy}) scale(${s})`);
    shadow.setAttribute('cx', ox); shadow.setAttribute('rx', 38 - Math.min(20, (pose.air || 0) / 4));
    const seg = (el, A, B, w1, w2) => el.setAttribute('d', taper(Q(A), Q(B), w1, w2));
    const dot = (el, A) => { const q = Q(A); el.setAttribute('cx', q[0].toFixed(1)); el.setAttribute('cy', q[1].toFixed(1)); };
    seg(P.aF1, f.aF[0], f.aF[1], 15, 12); seg(P.aF2, f.aF[1], f.aF[2], 12, 9); dot(P.hF, f.aF[2]);
    seg(P.lF1, f.lF[0], f.lF[1], 22, 16); seg(P.lF2, f.lF[1], f.lF[2], 15, 10); seg(P.lF3, f.lF[2], f.lF[3], 11, 11);
    const hd = Q(f.Hd); seg(P.neck, f.Sh, [f.Hd[0] - 1, f.Hd[1]], 11, 11);
    // torso: narrow at the waist, broad at the shoulders; shorts over the hips
    const waist = [f.Sh[0] * .2, f.Sh[1] * .2];
    seg(P.torso, waist, f.Sh, 26, 34); seg(P.shorts, [0, 6], [f.Sh[0] * .28, f.Sh[1] * .28], 28, 27);
    P.head.setAttribute('cx', hd[0].toFixed(1)); P.head.setAttribute('cy', hd[1].toFixed(1));
    seg(P.lN1, f.lN[0], f.lN[1], 22, 16); seg(P.lN2, f.lN[1], f.lN[2], 15, 10); seg(P.lN3, f.lN[2], f.lN[3], 11, 11);
    seg(P.aN1, f.aN[0], f.aN[1], 15, 12); seg(P.aN2, f.aN[1], f.aN[2], 12, 9); dot(P.hN, f.aN[2]);
    let b = null; const hN = Q(f.aN[2]), hF = Q(f.aF[2]);
    if (ballSpec === 'N') b = [hN[0] + 14, hN[1] + 8];
    else if (ballSpec === 'B') b = [(hN[0] + hF[0]) / 2 + 20, (hN[1] + hF[1]) / 2];
    else if (ballSpec && ballSpec.hx != null) b = [hN[0] + ballSpec.hx, hN[1] + ballSpec.hy];
    else if (ballSpec && ballSpec.x != null) b = [ballSpec.x + ox, ballSpec.y];
    bl.style.display = b ? '' : 'none'; if (b) bl.setAttribute('transform', `translate(${b[0]} ${b[1]})`);
    return f;
  }
  return { g, set };
}

/* ------------------------------------------------------------------ render */
export function render(root, P, ctx) {
  P = withDefaults(params, P);
  return P.mode === 'technique' ? renderTechnique(root, P, ctx) : renderTactics(root, P, ctx);
}

function renderTechnique(root, P, ctx) {
  const S = SKILLS[P.skill]; const ph = phaseList(P); const n = ph.length; const N = ctx.N; const b = ctx.b;
  const focusId = P.focus !== 'auto' && ph.some(p => p.id === P.focus) ? P.focus : (ph.some(p => p.id === S.key) ? S.key : ph[ph.length - 1].id);
  const x0 = 64, x1 = 1216, slot = Math.min(300, (x1 - x0) / n); const sx0 = 640 - slot * n / 2; let s = n >= 5 ? 1.08 : 1.18;
  // the ground line rises (as far as the tallest pose allows) when long names or cues need more lines
  const cueCls = ph.some(p => wrap(root, phaseCue(P, p), 'ts-cap', slot - 32).length > 3) ? 'ts-small' : 'ts-cap';
  const nameOpt = { cls: 'ts-label', maxW: slot - 16, maxLines: 3, lh: 30, anchor: 'middle' }, cueOpt = { cls: cueCls, maxW: slot - 32, lh: 26, anchor: 'middle' }; // a clear gutter between neighbouring cues
  const tmpG = h('g', {}, root);
  const need = Math.max(...ph.map(p => { const a = textBlock(tmpG, 0, 0, phaseName(P, p), nameOpt), c = textBlock(tmpG, 0, 0, phaseCue(P, p), Object.assign({}, cueOpt, { maxLines: 6 }));
    return 90 + (a.lines.length - 1) * a.lh + 32 + (c.lines.length - 1) * c.lh + 12; })); tmpG.remove(); // + 12: the last cue line stays clear of the caption rule
  // long names or cues first lift the ground line; when the tallest pose would then reach the title
  // band, the figures shrink (down to 0.6) so every word still shows in full
  const topU = Math.min(...ph.map(p => figTop(p.pose)));
  if (640 - need < 124 - topU * s) s = Math.max(.6, (640 - need - 124) / -topU);
  const top = topU * s;
  const GY = Math.round(clamp(640 - need, 124 - top, 424));
  // a sports-hall floor: boards, with a painted court line
  h('rect', { x: 0, y: GY, width: 1280, height: 18, fill: 'var(--wood-1)' }, root);
  h('line', { x1: 0, x2: 1280, y1: GY, y2: GY, stroke: 'var(--wood-line)', 'stroke-width': 'var(--sw-rule)' }, root);
  h('line', { x1: 0, x2: 1280, y1: GY + 10, y2: GY + 10, stroke: 'color-mix(in oklab,var(--hue-blue) 55%,var(--wood-1))', 'stroke-width': 'var(--sw-struct)' }, root);
  // the strip: slots are reserved only once filled, so the shown figures stay centred on the stage
  const strip = h('g', {}, root); const off = v => (n - Math.max(1, v)) * slot / 2;
  const figs = [];
  ph.forEach((p, i) => {
    const key = `phase:${p.id}`, k = b[key]; const cx = sx0 + slot * (i + .5);
    const soft = p.id === focusId ? null : `${N}:soft`;
    const c = [ctx.rc(key, null, 'soft'), soft].filter(Boolean).join(',') || null;
    const F = figure(strip, cx, GY, s, { s: k, cls: 'rise', c });
    F.set(p.pose, p.pose.ball);
    figs.push({ F, p, k, prev: i ? ph[i - 1].pose : NEUTRAL });
    // number badge, the name under it, then the cue
    const g = h('g', { s: k, cls: 'rise', delay: 300, c }, strip);
    const name = phaseName(P, p), num = String(i + 1); const isF = p.id === focusId;
    h('circle', { cx, cy: GY + 38, r: 16, fill: isF ? 'var(--focus)' : 'var(--ink-2)' }, g);
    computed(T(g, cx, GY + 46, num, 'ts-badge', { 'text-anchor': 'middle' }), 'phases');
    const nt = textBlock(g, cx, GY + 90, name, { cls: 'ts-label', maxW: slot - 16, maxLines: 3, lh: 30, anchor: 'middle', a: { fill: isF ? 'var(--focus-text)' : 'var(--ink)', cls: 'strong' }, edit: `text.label:phase:${p.id}` });
    const cueY = GY + 90 + (nt.lines.length - 1) * nt.lh + 32;
    textBlock(g, cx, cueY, phaseCue(P, p), { cls: cueCls, maxW: slot - 32, maxLines: Math.max(1, Math.floor((628 - cueY) / 26) + 1), lh: 26, anchor: 'middle', edit: `text.label:cue:${p.id}` });
    if (nt.lines.some(l => /…$/.test(l))) ctx.warn(`The phase name “${name}” is cut short.`);
  });
  const shift = x => strip.setAttribute('transform', `translate(${x.toFixed(1)} 0)`);
  const final = () => { shift(0); figs.forEach(f => f.F.set(f.p.pose, f.p.pose.ball)); };
  return {
    dur: Object.fromEntries(ph.map(p => [`phase:${p.id}`, 1000])),
    still: final, reset: () => { final(); shift(off(1)); },
    tick(k, u) {
      const v = figs.filter(f => f.k <= k).length; shift(lerp(off(v - 1), off(v), eIO(clamp(u))));
      for (const f of figs) {
        if (f.k !== k) { f.F.set(f.p.pose, f.p.pose.ball); continue; }
        const e = eIO(clamp(u)); f.F.set(lerpPose(f.prev, f.p.pose, e), e > .6 ? f.p.pose.ball : (ballBefore(f) ?? f.p.pose.ball));
      }
    },
  };
}
// highest point of a pose above the ground, in figure units (negative is up)
function figTop(pose) {
  const f = solve(pose); const ys = [f.Hd[1] - 18, f.aN[1][1], f.aN[2][1], f.aF[1][1], f.aF[2][1]].map(y => y + f.lift);
  const b = pose.ball; if (b && b.x != null) ys.push(b.y - BALL_R); else if (b) ys.push(Math.min(f.aN[2][1], f.aF[2][1]) + f.lift - 10 - BALL_R);
  return Math.min(...ys) - 6;
}
// a ball that leaves the hand stays in the hand until late in the move
function ballBefore(f) { const b = f.p.pose.ball; return b && (b.x != null || b.hx != null) ? 'N' : b; }

function renderTactics(root, P, ctx) {
  const N = ctx.N, b = ctx.b; const pl0 = plan(P); const S = display(pl0.S, geom(P.sport));
  const sp = pl0.sp && { ...pl0.sp, at: S.states[S.states.length - 1].pos[pl0.sp.who.i] };
  const kC = b.court ?? 0, kP = b.players ?? 0;
  const indoor = P.sport === 'netball' || P.sport === 'open';
  // a honey-coloured hall floor, the marked court a shade lighter
  root.style.setProperty('--mc-floor', 'color-mix(in oklab,var(--hue-gold) 16%,var(--wood-2))'); root.style.setProperty('--mc-court', 'color-mix(in oklab,var(--hue-gold) 14%,var(--wood-1))');
  const quietC = sp ? `${b.space}-${N}:quiet` : null;
  // indoor courts sit on a sports-hall floor: boards with painted hall lines
  if (indoor) {
    const fl = h('g', { s: kC, cls: 'rise', c: quietC }, root);
    h('rect', { x: BOX.x, y: BOX.y, width: BOX.w, height: BOX.h, rx: 'var(--r-card)', fill: 'var(--mc-floor)' }, fl);
    for (let y = BOX.y + 31; y < BOX.y + BOX.h; y += 31) h('line', { x1: BOX.x + 6, x2: BOX.x + BOX.w - 6, y1: y, y2: y, stroke: 'var(--wood-line)', 'stroke-width': 'var(--sw-hair)', opacity: .35 }, fl);
    for (const y of [BOX.y + 5, BOX.y + BOX.h - 5]) h('line', { x1: BOX.x + 6, x2: BOX.x + BOX.w - 6, y1: y, y2: y, stroke: 'color-mix(in oklab,var(--hue-blue) 55%,var(--mc-floor))', 'stroke-width': 'var(--sw-struct)' }, fl);
  }
  const C = court(root, P.sport, { x: BOX.x, y: BOX.y, w: BOX.w, h: BOX.h, a: { s: kC, cls: 'rise', c: quietC } });
  const X = p => [C.mx(p.mx), C.my(p.my)];
  if (indoor) {
    const [runoff, inner] = C.g.querySelectorAll('rect'); runoff.style.setProperty('fill', 'none'); inner.style.setProperty('fill', 'var(--mc-court)');
    if (P.sport === 'netball') for (const gx of [0, C.L]) h('circle', { cx: C.mx(gx), cy: C.my(C.Wd / 2), r: 11, fill: 'none', stroke: 'var(--counter)', 'stroke-width': 'var(--sw-struct)' }, C.g);
  }
  // netball thirds named in the run-off above the court
  if (P.sport === 'netball') {
    const names = [txt(P, 'label:third1', 'Goal third'), txt(P, 'label:third2', 'Centre third'), txt(P, 'label:third3', 'Goal third')];
    // each name keeps to its own third with a clear gap to the next; a two-line name gets a card that
    // ends just above the court's top line instead of sitting on it
    const tw = C.box.w / 3 - 30, LH = 22; const tmp = h('g', {}, root); const nl = names.map(nm => textBlock(tmp, 0, 0, nm, { cls: 'ts-tiny', maxW: tw, maxLines: 2, lh: LH }).lines.length); tmp.remove();
    names.forEach((nm, i) => {
      const g = h('g', { s: kC, cls: 'rise' }, root); const cx = C.mx(C.L * (i + .5) / 3), y = nl[i] > 1 ? C.box.y - 32 : C.box.y - 10; // a card spans the title band's edge (124) to 4 px above the court line
      const gr = nl[i] > 1 ? labelGround(g, { x: cx - tw / 2 - 6, y: y - 18, w: tw + 12, h: LH + 24 }) : null;
      const tb = textBlock(g, cx, y, nm, { cls: 'ts-tiny', maxW: tw, maxLines: 2, lh: LH, anchor: 'middle', edit: `text.label:third${i + 1}` });
      if (gr && gr.setAttribute) { gr.setAttribute('x', cx - tb.w / 2 - 6); gr.setAttribute('width', tb.w + 12); }
    });
  }
  // legend in the title band, right-aligned; each name wraps to two lines in a capped width, so the
  // engine's title always keeps the left of the band
  const hasB = S.pl.some(p => p.team === 'b');
  {
    const items = [['a', P.teamA, 'teamA'], ...(hasB ? [['b', P.teamB, 'teamB']] : [])];
    const NW = 300, opt = { cls: 'ts-small', maxW: NW, maxLines: 2, lh: 26, a: { fill: 'var(--ink)' } };
    const tmp = h('g', {}, root); const fit = items.map(it => textBlock(tmp, 0, 0, it[1], opt)); tmp.remove();
    const lg = h('g', { s: kP, cls: 'rise' }, root); let x = 1216 - fit.reduce((w, f) => w + 34 + f.w + 28, -28);
    items.forEach(([team, name, path], i) => {
      const f = fit[i];
      h('circle', { cx: x + 12, cy: 70, r: 12, fill: team === 'b' ? 'var(--compare)' : 'var(--focus)' }, lg);
      textBlock(lg, x + 34, 78 - (f.lines.length - 1) * f.lh / 2, name, Object.assign({}, opt, { edit: path }));
      x += 34 + f.w + 28;
    });
  }
  // the space created: a disc out to the nearest defender, clipped to the court
  const layerSpace = h('g', {}, root), layerMoves = h('g', {}, root), layerPlayers = h('g', {}, root), layerTop = h('g', {}, root);
  const finalPos = S.states[S.states.length - 1].pos;
  const blockers = [], markBoxes = []; // boxes labels must avoid; markBoxes leaves out court lines, which may pass under a label's ground
  const mark = q => { blockers.push(q); markBoxes.push(q); };
  S.pl.forEach(p => { for (const st of S.states) { const [x, y] = X(st.pos[p.i]); mark({ x: x - R_PLAYER - 4, y: y - R_PLAYER - 4, w: 2 * R_PLAYER + 8, h: 2 * R_PLAYER + 12 }); } });
  const borderBoxes = [];
  { const bx = C.box, t = 5; borderBoxes.push({ x: bx.x - t, y: bx.y - t, w: bx.w + 2 * t, h: 2 * t }, { x: bx.x - t, y: bx.y + bx.h - t, w: bx.w + 2 * t, h: 2 * t }, { x: bx.x - t, y: bx.y - t, w: 2 * t, h: bx.h + 2 * t }, { x: bx.x + bx.w - t, y: bx.y - t, w: 2 * t, h: bx.h + 2 * t }); blockers.push(...borderBoxes);
    if (P.sport === 'netball') {
      for (const tx of [C.L / 3, 2 * C.L / 3]) blockers.push({ x: C.mx(tx) - t, y: bx.y, w: 2 * t, h: bx.h });
      for (const [gx, sd] of [[0, 1], [C.L, -1]]) for (let a = -90; a <= 90; a += 8) { const r = 4.9, q = [C.mx(gx + sd * r * Math.cos(rad(a))), C.my(C.Wd / 2 + r * Math.sin(rad(a)))]; blockers.push({ x: q[0] - t, y: q[1] - t, w: 2 * t, h: 2 * t }); }
    }
    if (P.sport === 'open') for (const [qx, qy] of [[0, 0], [C.L, 0], [0, C.Wd], [C.L, C.Wd]]) mark({ x: C.mx(qx) - 18, y: C.my(qy) - 26, w: 36, h: 40 });
  }
  if (sp) {
    const id = `mc-clip-${ctx.uid}`; const defs = h('defs', {}, layerSpace); const cp = h('clipPath', { id }, defs);
    h('rect', { x: C.box.x, y: C.box.y, width: C.box.w, height: C.box.h }, cp);
    const [cx, cy] = X(sp.at); const r = sp.d * C.k;
    const g = h('g', { s: b.space, cls: 'pop' }, layerSpace);
    // a see-through tint in every theme, so the court markings stay visible under it
    h('circle', { cx, cy, r, fill: 'color-mix(in oklab,var(--focus) 15%,transparent)', stroke: 'var(--focus)', 'stroke-width': 'var(--sw-rule)', 'stroke-dasharray': '8 8', 'clip-path': `url(#${id})` }, g);
    for (let a = 0; a < 360; a += 6) { const q = [cx + r * Math.cos(rad(a)), cy + r * Math.sin(rad(a))]; mark({ x: q[0] - 3, y: q[1] - 3, w: 6, h: 6 }); }
    // the radius, drawn as a measure out to the nearest defender
    const [dx, dy] = X(S.states[S.states.length - 1].pos[sp.near.i]); const ang = Math.atan2(dy - cy, dx - cx);
    const m1 = [cx + Math.cos(ang) * (R_PLAYER + 6), cy + Math.sin(ang) * (R_PLAYER + 6)], m2 = [dx - Math.cos(ang) * (R_PLAYER + 6), dy - Math.sin(ang) * (R_PLAYER + 6)];
    h('line', { x1: m1[0], y1: m1[1], x2: m2[0], y2: m2[1], stroke: 'var(--focus-text)', 'stroke-width': 'var(--sw-struct)', 'stroke-linecap': 'round' }, g);
    for (const q of [m1, m2]) h('line', { x1: q[0] - Math.sin(ang) * 8, y1: q[1] + Math.cos(ang) * 8, x2: q[0] + Math.sin(ang) * 8, y2: q[1] - Math.cos(ang) * 8, stroke: 'var(--focus-text)', 'stroke-width': 'var(--sw-struct)', 'stroke-linecap': 'round' }, g);
    mark({ x: Math.min(m1[0], m2[0]) - 10, y: Math.min(m1[1], m2[1]) - 10, w: Math.abs(m2[0] - m1[0]) + 20, h: Math.abs(m2[1] - m1[1]) + 20 });
  }
  const lineBoxes = [];
  // moves: runs are dashed in the team colour, passes solid ink; a numbered badge says the order
  const badgeSpots = [];
  S.moves.forEach(m => {
    const key = `move:${m.j}`, k = b[key]; if (!m.from || !m.dest) return;
    const [x1, y1] = X(m.from), [x2, y2] = X(m.dest); const ang = Math.atan2(y2 - y1, x2 - x1), L = Math.hypot(x2 - x1, y2 - y1);
    const off = R_PLAYER + 8; if (L < 2 * off + 8) return;
    const a1 = [x1 + Math.cos(ang) * off, y1 + Math.sin(ang) * off], a2 = [x2 - Math.cos(ang) * off, y2 - Math.sin(ang) * off];
    const col = m.type === 'pass' ? 'var(--ink-2)' : m.team === 'b' ? 'var(--compare)' : 'var(--focus)';
    const c = [ctx.rc(key), sp ? `${b.space}-${N}:quiet,${N}:soft` : null].filter(Boolean).join(',') || null;
    line(ctx, layerMoves, a1[0], a1[1], a2[0], a2[1], col, 'var(--sw-struct)', { draw: k, dash: m.type === 'run' ? '10 9' : null, k: .8, g: { c } });
    if (m.type === 'run') h('circle', { cx: x1, cy: y1, r: R_PLAYER - 2, fill: 'none', stroke: col, 'stroke-width': 'var(--sw-rule)', 'stroke-dasharray': '5 6', s: k, c }, layerMoves);
    // badge
    for (let d = 0; d <= 1; d += 12 / Math.max(12, L)) lineBoxes.push({ x: a1[0] + (a2[0] - a1[0]) * d - 6, y: a1[1] + (a2[1] - a1[1]) * d - 6, w: 12, h: 12 });
    const nx = -Math.sin(ang), ny = Math.cos(ang); let spot = null;
    for (const off2 of [22, 32, 44]) for (const t of [.5, .38, .62, .28, .72, .2, .8]) for (const sd of [1, -1]) { if (spot) break; const bx = x1 + (x2 - x1) * t + nx * off2 * sd, by = y1 + (y2 - y1) * t + ny * off2 * sd; const box = { x: bx - 15, y: by - 15, w: 30, h: 30 }; if (!blockers.some(q => overlaps(box, q, 2)) && !badgeSpots.some(q => overlaps(box, q, 4)) && !lineBoxes.some(q => overlaps(box, q, 2))) spot = [bx, by, box]; }

    if (!spot) { const bx = (x1 + x2) / 2 + nx * 22, by = (y1 + y2) / 2 + ny * 22; spot = [bx, by, { x: bx - 15, y: by - 15, w: 30, h: 30 }]; }
    badgeSpots.push(spot[2]);
    const bg = h('g', { s: k, cls: 'pop', delay: 500, c }, layerMoves);
    h('circle', { cx: spot[0], cy: spot[1], r: 15, fill: 'var(--paper)', stroke: col, 'stroke-width': 'var(--sw-rule)' }, bg);
    computed(T(bg, spot[0], spot[1] + 8, String(m.j + 1), 'ts-badge', { 'text-anchor': 'middle', fill: 'var(--ink)' }), `moves.${m.j}`);
  });
  if (sp) {
    const [cx, cy] = X(sp.at); const r = sp.d * C.k;
    // label: try spots around the disc, inside the court, clear of every player
    const lab = txt(P, 'label:space', 'Space to receive'); const dist = `${fmtM(sp.d)} to the nearest defender`;
    // nearest clear spot to the disc, anywhere on the stage; a narrower, wrapped label if the wide one has no room
    // every width is tried and scored together: a spot further from the disc beats squeezing the
    // label into a tall narrow column (each extra line costs more than a disc's width of distance)
    let best = null, LW = 210, tb, db, w, hh;
    const pass = (avoid, gap = 10) => { let pick = null;
      for (const tryW of [260, 230, 210, 190, 170, 140]) {
        const tmp = h('g', {}, root);
        const t1 = textBlock(tmp, 0, 0, lab, { cls: 'ts-small', maxW: tryW, maxLines: 3, lh: 28, a: { cls: 'strong' } }), d1 = textBlock(tmp, 0, 0, dist, { cls: 'ts-tiny', maxW: tryW, maxLines: 3, lh: 26 }); tmp.remove();
        if (tryW !== 260 && [...t1.lines, ...d1.lines].some(l => /…$/.test(l))) continue; // a width that would cut the wording
        const w1 = Math.max(t1.w, d1.w) + 24, h1 = t1.lines.length * 28 + d1.lines.length * 26 + 10, pen = (t1.lines.length + d1.lines.length) * 80;
        for (let y = 124; y + h1 <= 640; y += 8) for (let x = 64; x + w1 <= 1216; x += 8) {
          const bx = { x, y, w: w1, h: h1 }; const qx = clamp(cx, x, x + w1), qy = clamp(cy, y, y + h1); const d = Math.hypot(qx - cx, qy - cy);
          const sc = Math.max(0, d - r * .85) + d * .05 + pen; if (pick && sc >= pick.sc) continue;
          if (!avoid.some(q => overlaps(bx, q, gap))) pick = { bx, sc, tryW, t1, d1, w1, h1 };
        }
      }
      return pick; };
    // a card may sit over an inner court line (it is opaque) at a small cost, which beats a five-line column;
    // it keeps off the court's outer edge unless there is no other room
    const p1 = pass([...blockers, ...badgeSpots, ...lineBoxes]), p2 = pass([...markBoxes, ...borderBoxes, ...badgeSpots, ...lineBoxes], 6) || pass([...markBoxes, ...badgeSpots, ...lineBoxes]);
    const pk = p1 && (!p2 || p1.sc <= p2.sc + 40) ? p1 : p2;
    if (pk) { best = pk.bx; LW = pk.tryW; tb = pk.t1; db = pk.d1; w = pk.w1; hh = pk.h1; }
    else { const tmp = h('g', {}, root); tb = textBlock(tmp, 0, 0, lab, { cls: 'ts-small', maxW: LW, maxLines: 3, lh: 28, a: { cls: 'strong' } }); db = textBlock(tmp, 0, 0, dist, { cls: 'ts-tiny', maxW: LW, maxLines: 3, lh: 26 }); tmp.remove();
      w = Math.max(tb.w, db.w) + 24; hh = tb.lines.length * 28 + db.lines.length * 26 + 10; }
    if (!best) { ctx.warn('No clear spot for the space label.'); best = { x: clamp(cx - w / 2, C.box.x, C.box.x + C.box.w - w), y: clamp(cy - r - hh, C.box.y, C.box.y + C.box.h - hh), w, h: hh }; }
    const lg = h('g', { s: b.space, cls: 'rise', delay: 400 }, layerTop);
    labelGround(lg, best);
    textBlock(lg, best.x + 12, best.y + 26, lab, { cls: 'ts-small', maxW: LW, maxLines: 3, lh: 28, a: { fill: 'var(--focus-text)', cls: 'strong' }, edit: 'text.label:space' });
    const dt = textBlock(lg, best.x + 12, best.y + 26 + tb.lines.length * 28, dist, { cls: 'ts-tiny', maxW: LW, maxLines: 3, lh: 26 }); computed(dt.el, `players.${sp.who.i}.across`);
    blockers.push(best);
  }
  // players: placed by tick so a run eases from start to end
  const P_ = S.pl.map(p => {
    const outer = h('g', { s: kP, cls: 'rise', delay: (p.team === 'b' ? 200 : 0) + p.i * 40, c: sp && sp.who !== p ? `${b.space}-${N}:soft,${N}:soft` : null }, layerPlayers);
    const inner = h('g', {}, outer); player(inner, 0, 0, { team: p.team, label: p.label, edit: `players.${p.i}.label`, r: R_PLAYER });
    return { p, inner };
  });
  const ballG = h('g', { s: kP, cls: 'pop', delay: 400 }, layerTop); const ballIn = h('g', {}, ballG); ball(ballIn, 0, 0, { r: 11 });
  if (!S.states[0].holder) ballG.style.display = 'none';
  const moveAt = {}; S.moves.forEach(m => { moveAt[b[`move:${m.j}`]] = m; });
  const place = (k, u) => {
    // state before build k's move, then that move eased by u
    const m = moveAt[k]; const done = m ? m.j : (k >= N || k === b.space ? S.moves.length : 0);
    const st = S.states[done]; const e = eIO(clamp(u));
    P_.forEach(({ p, inner }) => {
      let q = st.pos[p.i]; if (m && m.type === 'run' && m.who === p) q = { mx: lerp(m.from.mx, m.dest.mx, e), my: lerp(m.from.my, m.dest.my, e) };
      const [x, y] = X(q); inner.setAttribute('transform', `translate(${x} ${y})`); p._xy = [x, y];
    });
    const hb = st.holder; let bxy = null;
    if (m && m.type === 'pass' && m.to) { const [ax, ay] = X(m.from), [zx, zy] = X(m.dest); bxy = [lerp(ax, zx, e) + BALL_OFF, lerp(ay, zy, e) - BALL_OFF - Math.sin(Math.PI * e) * 26]; }
    else if (hb) bxy = [hb._xy[0] + BALL_OFF, hb._xy[1] - BALL_OFF];
    if (bxy) ballIn.setAttribute('transform', `translate(${bxy[0]} ${bxy[1]})`);
  };
  P_.forEach(o => { o.p._xy = null; }); S.pl.forEach(p => { P_[p.i].p = p; });
  const final = () => place(N, 1);
  final();
  return {
    dur: Object.fromEntries(S.moves.map(m => [`move:${m.j}`, 1100])),
    still: final, reset: () => place(-1, 0),
    tick(k, u) { place(k, u); },
  };
}
