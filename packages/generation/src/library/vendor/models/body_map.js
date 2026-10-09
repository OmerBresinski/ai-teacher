// Body map: the human body for Reception to Year 6. One front-view figure (kit bodyOutline) that
// shows body parts, the senses, the skeleton, the digestive system (with food travelling through),
// or the skeleton with a side-view arm whose biceps and triceps work as a pair; plus one jaw of
// teeth from above. Parts sit in their true places (the code places them, never the writer), and
// each is labelled in its own build.
import {
  h, T, GRID, W, eIO, lerp, alongPts,
  textBlock, arrow,
  editable, computed, txt, TEXT_PARAM_FOR, LABEL_PARAM, TITLE_PARAM, schemaCheck, withDefaults, result,
} from '../kit/index.js';
import { bodyOutline, organ } from '../kit/batch-D.js';
import { face, skeleton, arm as armPart, jaw } from './body_map/parts.js';

export const meta = {
  id: 'body_map', name: 'Body map', kind: 'scene', version: 1,
  subjects: ['Science', 'PSHE', 'PE'],
  years: ['Reception', 'Y1', 'Y2', 'Y3', 'Y4', 'Y5', 'Y6'],
  teaches: 'The parts of the human body and what they do: body parts, the senses, the skeleton and muscles, teeth and the journey of food.',
};

/* ------------------------------------------------------------------ vocabulary */
const VIEWS = ['parts', 'senses', 'skeleton', 'muscles', 'digestion', 'teeth'];
const VIEW_LABELS = ['Body parts', 'The five senses', 'The skeleton', 'Skeleton and muscles (with the arm)', 'The digestive system', 'Teeth'];
const VIEW_NAME = { parts: 'body parts', senses: 'senses', skeleton: 'skeleton', muscles: 'skeleton and muscles', digestion: 'digestive system', teeth: 'teeth' };
const BONES = ['skull', 'jaw', 'collarbone', 'ribs', 'spine', 'pelvis', 'humerus', 'forearm', 'femur', 'kneecap', 'shin', 'shoulder', 'elbow', 'hip', 'knee'];
const ALLOWED = {
  parts: ['head', 'hair', 'eyes', 'ears', 'nose', 'mouth', 'neck', 'shoulder', 'arm', 'elbow', 'hand', 'chest', 'tummy', 'leg', 'knee', 'foot'],
  senses: ['eyes', 'ears', 'nose', 'tongue', 'skin'],
  skeleton: BONES, muscles: BONES,
  digestion: ['mouth', 'oesophagus', 'stomach', 'liver', 'smallIntestine', 'largeIntestine', 'rectum'],
  teeth: ['incisor', 'canine', 'premolar', 'molar'],
};
// [everyday, science] default label words
const WORDS = {
  head: ['head', 'head'], hair: ['hair', 'hair'], eyes: ['eyes', 'eyes'], ears: ['ears', 'ears'], nose: ['nose', 'nose'], mouth: ['mouth', 'mouth'],
  neck: ['neck', 'neck'], shoulder: ['shoulder', 'shoulder'], arm: ['arm', 'arm'], elbow: ['elbow', 'elbow'], hand: ['hand', 'hand'], chest: ['chest', 'chest'],
  tummy: ['tummy', 'abdomen'], leg: ['leg', 'leg'], knee: ['knee', 'knee'], foot: ['foot', 'foot'], tongue: ['tongue', 'tongue'], skin: ['skin', 'skin'],
  skull: ['skull', 'skull'], jaw: ['jaw', 'jawbone'], collarbone: ['collarbone', 'clavicle'], ribs: ['ribs', 'rib cage'], spine: ['backbone', 'spine'],
  pelvis: ['hip bone', 'pelvis'], humerus: ['upper arm bone', 'humerus'], forearm: ['forearm bones', 'radius and ulna'], femur: ['thigh bone', 'femur'],
  kneecap: ['kneecap', 'patella'], shin: ['shin bones', 'tibia and fibula'], hip: ['hip', 'hip joint'],
  oesophagus: ['food pipe', 'oesophagus'], stomach: ['stomach', 'stomach'], liver: ['liver', 'liver'], smallIntestine: ['small intestine', 'small intestine'],
  largeIntestine: ['large intestine', 'large intestine'], rectum: ['rectum', 'rectum'],
  incisor: ['incisors', 'incisors'], canine: ['canines', 'canines'], premolar: ['premolars', 'premolars'], molar: ['molars', 'molars'],
};
const ALL = Object.keys(WORDS);
const PART_LABELS = ALL.map(k => WORDS[k][0] === WORDS[k][1] ? cap(WORDS[k][0]) : `${cap(WORDS[k][0])} / ${WORDS[k][1]}`);
function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }
const SENSE_OF = { eyes: 'see', ears: 'hear', nose: 'smell', tongue: 'taste', skin: 'touch' };
const SENSES = ['see', 'hear', 'smell', 'taste', 'touch'];
const SENSE_NAME = { see: 'sight', hear: 'hearing', smell: 'smell', taste: 'taste', touch: 'touch' };
const SENSE_LABEL = { see: 'See (sight)', hear: 'Hear (hearing)', smell: 'Smell', taste: 'Taste', touch: 'Touch (feel)' };
const JOB_OF = { incisor: 'cut', canine: 'tear', premolar: 'grind', molar: 'grind' };
const JOB_WORDS = { cut: 'cut and bite', tear: 'tear and grip', grind: 'crush and grind' };
const JOB_ING = { cut: 'cutting and biting', tear: 'tearing and gripping', grind: 'crushing and grinding' };
const JOB_LABEL = { cut: 'Cut and bite', tear: 'Tear and grip', grind: 'Crush and grind' };
const MILK_TEETH = ['incisor', 'canine', 'molar'];
// the standard set each drawing labels when none of the listed parts belong on it
const USUAL = { parts: ['head', 'eyes', 'ears', 'mouth', 'hand', 'tummy', 'knee', 'foot'], skeleton: ['skull', 'ribs', 'spine', 'pelvis', 'femur'],
  muscles: ['skull', 'ribs', 'spine', 'pelvis', 'femur'], digestion: ['mouth', 'oesophagus', 'stomach', 'smallIntestine', 'largeIntestine', 'rectum'] };
const ARM_WORDS = ['armTitle', 'biceps', 'triceps', 'elbowJoint', 'contracts', 'relaxes'];
// every label on this slide is a name, so every override takes the label cap
const LABEL_ROLES = Object.fromEntries([...Object.keys(WORDS), ...['see', 'hear', 'smell', 'taste', 'touch'].map(s => 'sense:' + s), 'job:cut', 'job:tear', 'job:grind', ...ARM_WORDS].map(id => [id, 'label']));
const ON_PATH = ['mouth', 'oesophagus', 'stomach', 'smallIntestine', 'largeIntestine', 'rectum'];
const PATH_AT = { mouth: 0, oesophagus: 1.5, stomach: 3, smallIntestine: 7, largeIntestine: 11.5, rectum: 14.7 };

export const params = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', title: 'Body map',
  properties: {
    title: TITLE_PARAM('My body'),
    view: { type: 'string', title: 'What the slide shows', enum: VIEWS, 'x-labels': VIEW_LABELS, default: 'parts' },
    vocab: { type: 'string', title: 'Words used', description: 'Used for every label you have not typed yourself.', enum: ['everyday', 'science'], 'x-labels': ['Everyday words (tummy, backbone, food pipe)', 'Science words (abdomen, spine, oesophagus)'], default: 'everyday' },
    parts: {
      type: 'array', title: 'Parts to label, in order', description: 'Each part gets its own step and sits in its true place. Parts that are not on this drawing are left out; if none are, the usual parts are labelled. For the senses and teeth, leave the list empty to label them all.',
      'x-item': 'a part', maxItems: 8, default: [{ part: 'head' }, { part: 'eyes' }, { part: 'mouth' }, { part: 'arm' }, { part: 'hand' }, { part: 'leg' }, { part: 'foot' }],
      items: { type: 'object', required: ['part'], default: { part: 'head', label: '', sense: 'auto', job: 'auto' }, properties: {
        part: { type: 'string', title: 'Part', enum: ALL, 'x-labels': PART_LABELS },
        label: LABEL_PARAM('Label', '', { description: 'Leave empty to use ours.' }),
        sense: { type: 'string', title: 'Sense (senses only)', enum: ['auto', ...SENSES], 'x-labels': ['Worked out for you', ...SENSES.map(s => SENSE_LABEL[s])], default: 'auto' },
        job: { type: 'string', title: 'Job (teeth only)', enum: ['auto', 'cut', 'tear', 'grind'], 'x-labels': ['Worked out for you', JOB_LABEL.cut, JOB_LABEL.tear, JOB_LABEL.grind], default: 'auto' },
      } },
    },
    highlight: { type: 'string', title: 'Highlight at the end', description: 'One labelled part stands out on the last step.', enum: ['none', ...ALL], 'x-labels': ['Nothing', ...PART_LABELS], default: 'none' },
    journey: { type: 'boolean', title: 'Show food travelling through (digestive system)', default: false },
    arm: {
      type: 'object', title: 'The arm (skeleton and muscles)', default: { move: 'bend' }, properties: {
        move: { type: 'string', title: 'The arm', enum: ['bend', 'straighten', 'both'], 'x-labels': ['Bends', 'Straightens', 'Bends, then straightens'], default: 'bend' },
      },
    },
    teethSet: { type: 'string', title: 'Teeth (teeth only)', enum: ['adult', 'milk'], 'x-labels': ['Adult teeth (32)', 'Milk teeth (20)'], default: 'adult' },
    figure: { type: 'string', title: 'Body drawn as', enum: ['child', 'adult'], 'x-labels': ['A child', 'An adult'], default: 'child', 'x-panel': 'advanced' },
    text: TEXT_PARAM_FOR(LABEL_ROLES),
  },
};

export const presets = [
  { id: 'reception-my-body', name: 'Reception: my body', params: {
    title: 'My body', view: 'parts', vocab: 'everyday',
    parts: [{ part: 'head' }, { part: 'eyes' }, { part: 'ears' }, { part: 'mouth' }, { part: 'hand' }, { part: 'tummy' }, { part: 'knee' }, { part: 'foot' }],
  } },
  { id: 'y1-senses', name: 'Year 1: our five senses', params: {
    title: 'Our five senses', view: 'senses', vocab: 'everyday',
    parts: [{ part: 'eyes' }, { part: 'ears' }, { part: 'nose' }, { part: 'tongue' }, { part: 'skin' }],
  } },
  { id: 'y3-skeleton-muscles', name: 'Year 3: skeleton and muscles', params: {
    title: 'Skeleton and muscles', view: 'muscles', vocab: 'science',
    parts: [{ part: 'skull' }, { part: 'ribs' }, { part: 'spine' }, { part: 'pelvis' }, { part: 'femur' }], arm: { move: 'bend' },
  } },
  { id: 'y4-journey-of-food', name: 'Year 4: the journey of food', params: {
    title: 'The journey of food', view: 'digestion', vocab: 'science', figure: 'adult', journey: true,
    parts: [{ part: 'mouth' }, { part: 'oesophagus' }, { part: 'stomach' }, { part: 'smallIntestine' }, { part: 'largeIntestine' }, { part: 'rectum' }],
  } },
];

/* ------------------------------------------------------------------ the model of the data */
const vi = P => P.vocab === 'science' ? 1 : 0;
const defWord = (P, id) => WORDS[id] ? WORDS[id][vi(P)] : id;
/** The highlight only counts when that part is labelled on this slide (validate warns otherwise). */
function eff(P) { return P.highlight !== 'none' && !items(P).some(it => it.part === P.highlight) ? Object.assign({}, P, { highlight: 'none' }) : P; }
function labelOf(P, it) { return it.label ? it.label : txt(P, 'label:' + it.part, defWord(P, it.part)); }
function items(P) {
  const allowed = ALLOWED[P.view] || [];
  const listed = (P.parts || []).map((it, i) => Object.assign({}, it, { i }));
  // parts not on this drawing, and a second label for the same part, are left out (validate warns)
  const seen = {}; let list = listed.filter(it => allowed.includes(it.part) && !seen[it.part] && (seen[it.part] = true));
  const auto = part => ({ part, label: '', sense: 'auto', job: 'auto', i: null });
  if (!list.length && (P.view === 'senses' || P.view === 'teeth')) list = allowed.filter(id => P.view !== 'teeth' || P.teethSet !== 'milk' || MILK_TEETH.includes(id)).map(auto);
  else if (!list.length && listed.length && USUAL[P.view]) list = USUAL[P.view].map(auto);
  if (P.view === 'digestion' || P.view === 'teeth') list.sort((a, b) => allowed.indexOf(a.part) - allowed.indexOf(b.part));
  return list;
}
const fill = (s, P, id) => s.replace('{w}', defWord(P, id)).replace('{W}', cap(defWord(P, id)));

const BODY_CAP = {
  parts: 'This is a body. Every part of it has a name.',
  senses: 'We find out about the world around us through our senses.',
  skeleton: 'Inside our body is a skeleton, made of bones.',
  muscles: 'Inside our body is a skeleton. Bones give us our shape and hold us up.',
  digestion: 'The digestive system breaks food down so that our body can use it.',
};
const PART_CAP = {
  parts: { head: 'The head is at the top of the body.', hair: 'Hair grows on our head.', eyes: 'We see with our eyes.', ears: 'We hear with our ears.', nose: 'We smell with our nose.', mouth: 'We eat, drink and talk with our mouth.',
    neck: 'The neck holds up the head and lets it turn.', shoulder: 'The shoulder joins the arm to the body.', arm: 'We use our arms to reach, lift and carry.', elbow: 'The elbow is where the arm bends.',
    hand: 'We hold and feel things with our hands.', chest: 'The chest is at the front, below the neck.', tummy: 'The {w} is below the chest.', leg: 'We stand, walk and run on our legs.', knee: 'The knee is where the leg bends.', foot: 'Our feet carry us when we stand and walk.' },
  senses: { eyes: 'We see with our eyes. This sense is sight.', ears: 'We hear with our ears. This sense is hearing.', nose: 'We smell with our nose. This sense is smell.', tongue: 'We taste with our tongue. This sense is taste.', skin: 'We feel with our skin. This sense is touch.' },
  bones: { skull: 'The skull protects the brain.', jaw: 'The jaw is the only bone in the skull that moves. It lets us chew.', collarbone: 'The {w} holds the shoulder in place.', ribs: 'The ribs protect the heart and lungs.',
    spine: 'The {w} holds us upright and protects the nerves inside it.', pelvis: 'The {w} joins the legs to the spine.', humerus: 'The {w} is the long bone in the upper arm.', forearm: 'The forearm has two bones, side by side.',
    femur: 'The {w} is the longest bone in the body.', kneecap: 'The {w} protects the front of the knee.', shin: 'The lower leg has two bones. The thicker one carries our weight.',
    shoulder: 'Bones meet at joints. The shoulder joint moves in almost every direction.', elbow: 'The elbow is a hinge joint: it bends one way, like a door.', hip: 'The hip joint lets the leg swing forwards, backwards and out to the side.', knee: 'The knee is a hinge joint, like the elbow.' },
  digestion: { mouth: 'Food goes in at the mouth. Teeth chop it and saliva makes it soft.', oesophagus: 'The {w} squeezes the food down to the stomach.', stomach: 'The stomach churns the food with acid until it is a thick liquid.',
    liver: 'The liver makes bile, which helps to break down fats.', smallIntestine: 'In the small intestine, nutrients pass into the blood.', largeIntestine: 'The large intestine takes water out of what is left.', rectum: 'The rectum holds the waste until it leaves the body.' },
  teeth: { incisor: 'Incisors at the front are sharp and flat, for cutting and biting.', canine: 'Canines are pointed, for tearing and gripping.', premolar: 'Premolars are wide, for crushing and grinding.', molar: 'Molars at the back are the widest, for crushing and grinding.' },
};
const capFamily = v => (v === 'skeleton' || v === 'muscles') ? 'bones' : v;
const MOVES = { bend: { from: Math.PI / 2, to: -.42 }, straighten: { from: -.42, to: Math.PI / 2 } };
const movesOf = P => P.view !== 'muscles' ? [] : (P.arm.move === 'both' ? ['bend', 'straighten'] : [P.arm.move]);

function plan(P) {
  const view = P.view, list = items(P), steps = [];
  if (view === 'teeth') steps.push({ key: 'jaw', caption: P.teethSet === 'milk' ? 'This is a child’s lower jaw, seen from above. It has 10 milk teeth.' : 'This is an adult’s lower jaw, seen from above. It has 16 teeth.' });
  else steps.push({ key: 'body', caption: view === 'digestion' && P.journey ? 'Food is broken down as it travels through the digestive system.' : BODY_CAP[view] });
  for (const it of list) steps.push({ key: 'part:' + it.part, caption: fill(PART_CAP[capFamily(view)][it.part], P, it.part) });
  if (view === 'muscles') {
    steps.push({ key: 'arm', caption: 'Muscles are joined to bones. The biceps and the triceps work as a pair.' });
    for (const m of movesOf(P)) steps.push({ key: m, caption: m === 'bend' ? 'To bend the arm, the biceps contracts and pulls. The triceps relaxes.' : 'To straighten the arm, the triceps contracts and pulls. The biceps relaxes.' });
  }
  const hi = P.highlight !== 'none' ? list.find(it => it.part === P.highlight) : null;
  let summary;
  if (view === 'parts') summary = hi ? `Every part of the body has a name. Can you point to your ${defWord(P, hi.part)}?` : 'Every part of the body has a name.';
  else if (view === 'senses') summary = list.length === 5 ? 'Five senses: sight, hearing, smell, taste and touch.' : 'Each sense uses a different part of the body.';
  else if (view === 'skeleton') summary = 'The skeleton holds us up, protects the organs inside us and helps us move.';
  else if (view === 'muscles') summary = 'Muscles pull on bones to move them. Because a muscle can only pull, they work in pairs.';
  else if (view === 'digestion') summary = P.journey ? `Food goes one way: mouth, ${defWord(P, 'oesophagus')}, stomach, small intestine, large intestine.` : 'Each part of the digestive system has its own job.';
  else summary = 'Different teeth have different shapes, because they do different jobs.';
  return { list, steps, summary, hi };
}
export function builds(P) { P = eff(withDefaults(params, P)); const { steps, summary } = plan(P); return { steps: steps.map(({ key, caption }) => ({ key, caption })), summary: { caption: summary } }; }

const NOTE = {
  body: {
    parts: 'Children point to each part on themselves as it appears. Click any label to change its wording.',
    senses: 'Five senses is the usual primary model; scientists count more, such as balance. Ask: which sense tells you the milk has gone off?',
    skeleton: 'A simplified front view, not drawn to exact scale. An adult has 206 bones; a baby has about 300, and some join together as it grows.',
    muscles: 'A simplified front view, not drawn to exact scale. An adult has 206 bones.',
    digestion: 'Simplified drawing, not to scale: an adult’s small intestine is about 6 metres long, folded up inside. Food never goes through the liver.',
  },
  jaw: 'The lower jaw from above, front teeth at the top. Adults have 32 teeth (4 are wisdom teeth, which may never come through); children have 20 milk teeth.',
  parts: { tummy: 'Ask: what is inside your tummy?', hand: 'Ask: how many fingers on one hand?' },
  senses: {},
  bones: { skull: 'The skull is several bones joined together.', ribs: 'Most people have 12 pairs of ribs.', spine: 'The spine is a stack of 33 small bones called vertebrae.', femur: 'The femur is about a quarter of a person’s height.', elbow: 'Bend and straighten your arm: it only goes one way.', knee: 'Ask: which way can your knee not bend?' },
  digestion: { mouth: 'Digestion starts in the mouth: saliva begins to break down starch.', oesophagus: 'Muscles squeeze the food along, so it works even upside down.', stomach: 'Stomach acid also kills many germs.',
    liver: 'The liver is the largest organ inside the body.', smallIntestine: 'Its lining is folded into tiny villi, which give a huge surface for taking in nutrients.', largeIntestine: 'What is left is mostly fibre, water and bacteria.', rectum: 'Waste leaves the body through the anus.' },
  teeth: { incisor: 'Ask: which teeth do you bite into an apple with?', canine: 'Meat eaters such as dogs have long canines for gripping.', premolar: 'Premolars only come with adult teeth: milk teeth have none.', molar: 'Ask: which teeth do you chew with?' },
};
export function notes(P) {
  P = eff(withDefaults(params, P));
  const { steps } = plan(P);
  return {
    steps: steps.map(s => {
      if (s.key === 'body') return NOTE.body[P.view];
      if (s.key === 'jaw') return NOTE.jaw;
      if (s.key === 'arm') return 'Muscles can only pull, never push. That is why they work in pairs: one bends the joint, the other straightens it.';
      if (s.key === 'bend') return 'A muscle that contracts gets shorter and fatter. Feel your own biceps as you bend your arm.';
      if (s.key === 'straighten') return 'Now the triceps contracts and pulls the forearm straight, and the biceps relaxes.';
      const id = s.key.slice(5), fam = capFamily(P.view);
      const n = (NOTE[fam] || {})[id];
      if (n) return n;
      if (fam === 'senses') return `Ask: what can you ${SENSE_OF[id]} right now?`;
      if (fam === 'bones') return `Feel for your own ${defWord(P, id)}.`;
      return `Point to your own ${defWord(P, id)}.`;
    }),
    summary: P.view === 'digestion' ? 'Ask the class to retell the journey of food in order, saying what happens in each part.' : P.view === 'teeth' ? 'Ask: which teeth would a lion use most? Which would a cow use most?' : 'Ask the class to point to and name each part on themselves.',
  };
}

/* ------------------------------------------------------------------ validate */
export function validate(raw) {
  const P = withDefaults(params, raw);
  const R = schemaCheck(params, P); const Wn = [];
  if (R.length) return result(R);
  const allowed = ALLOWED[P.view]; const seen = {};
  P.parts.forEach((it, i) => {
    const w = it.label || defWord(P, it.part);
    if (!allowed.includes(it.part)) { Wn.push(`There is no “${defWord(P, it.part)}” on the ${VIEW_NAME[P.view]} drawing, so it is left out. Choose from: ${allowed.map(id => defWord(P, id)).join(', ')}.`); return; }
    if (seen[it.part]) { Wn.push(`“${w}” is listed twice, so it is labelled once.`); return; }
    seen[it.part] = true;
    if (P.view === 'senses' && it.sense && it.sense !== 'auto' && it.sense !== SENSE_OF[it.part]) {
      const ok = SENSE_OF[it.part];
      R.push({ path: `parts.${i}.sense`, reason: `We ${ok} with our ${defWord(P, it.part)}, not ${it.sense}. Set its sense to “${SENSE_LABEL[ok]}”.` });
    }
    if (P.view === 'teeth') {
      if (it.job && it.job !== 'auto' && it.job !== JOB_OF[it.part]) R.push({ path: `parts.${i}.job`, reason: `${cap(defWord(P, it.part))} are for ${JOB_ING[JOB_OF[it.part]]}, not ${JOB_ING[it.job]}. Set the job to “${JOB_LABEL[JOB_OF[it.part]]}”.` });
      if (P.teethSet === 'milk' && !MILK_TEETH.includes(it.part)) R.push({ path: `parts.${i}.part`, reason: 'Milk teeth have no premolars: a child’s back teeth are molars. Label molars instead, or choose adult teeth.' });
    }
  });
  const list = items(P);
  if (P.parts.length && !P.parts.some(it => ALLOWED[P.view].includes(it.part)) && USUAL[P.view]) Wn.push(`None of the parts listed are on the ${VIEW_NAME[P.view]} drawing, so the usual ones are labelled.`);
  if (P.highlight !== 'none' && !list.some(it => it.part === P.highlight)) Wn.push(`The ${defWord(P, P.highlight)} is not labelled on this slide, so nothing is highlighted.`);
  if (P.journey && P.view !== 'digestion') Wn.push('Food travelling through only shows on the digestive system.');
  return result(R, Wn);
}

/* ------------------------------------------------------------------ render */
const FIG = {
  parts: { H: 512, top: 116, cx: 640 }, senses: { H: 1150, top: 120, cx: 640, clip: true }, skeleton: { H: 512, top: 116, cx: 640 },
  muscles: { H: 512, top: 116, cx: 640 }, digestion: { H: 1000, top: 116, cx: 640, clip: true },
};

/** Labels in two columns beside the drawing, each with a leader to its point. Columns never
 *  overlap the drawing; labels in a column keep their points' order, so leaders never cross. */
function placeLabels(root, under, ctx, P, list, pts, o) {
  const N = ctx.N, out = [];
  const sides = { L: [], R: [] };
  const fixed = list.filter(it => pts[it.part].side !== 'auto'), auto = list.filter(it => pts[it.part].side === 'auto');
  for (const it of fixed) sides[o.oneSide || pts[it.part].side].push(it);
  for (const it of auto) sides[o.oneSide || (sides.R.length <= sides.L.length ? 'R' : 'L')].push(it);
  for (const side of ['L', 'R']) {
    const col = sides[side].sort((a, b) => pts[a.part].y - pts[b.part].y);
    const colX = side === 'L' ? o.xL : o.xR, maxW = side === 'L' ? o.xL - GRID.left : o.xRmax - o.xR;
    const anchor = side === 'L' ? 'end' : 'start';
    // a sub-label (the sense, the job) sits on the same line as its part, in the quieter ink, when
    // both fit on one line; otherwise it goes under the part. If the column is too tall for the
    // stage, every label is set again on fewer lines (the kit then shrinks, and only then cuts).
    const subA = { fill: 'var(--ink-2)', style: 'font-weight:400' };
    const setBlock = (bk, tight) => {
      const { it, focus, inner } = bk; inner.replaceChildren();
      const word = labelOf(P, it), path = it.label ? `parts.${it.i}.label` : `text.label:${it.part}`;
      const s = o.sub ? o.sub(it) : null, n = tight > 1 ? 1 : 2, ns = tight ? 1 : 2;
      const wg = h('g', {}, inner);
      const tb = textBlock(wg, 0, 0, word, { cls: 'ts-label', maxW, maxLines: n, lh: 32, anchor, edit: path, a: focus ? { fill: 'var(--focus-text)' } : {} });
      let nl = tb.lines.length;
      if (s) {
        const sg = h('g', {}, inner);
        const sb = textBlock(sg, 0, 0, s.text, { cls: tb.cls, maxW, maxLines: ns, lh: 32, anchor, edit: s.edit, a: subA });
        if (nl === 1 && sb.lines.length === 1 && tb.cls === sb.cls && tb.w + 14 + sb.w <= maxW) {
          if (side === 'L') wg.setAttribute('transform', `translate(${-(sb.w + 14)} 0)`); else sg.setAttribute('transform', `translate(${tb.w + 14} 0)`);
        } else { sg.setAttribute('transform', `translate(0 ${nl * tb.lh})`); nl += sb.lines.length; }
      }
      bk.bottom = (nl - 1) * 32 + 8;
    };
    const blocks = col.map(it => {
      const key = 'part:' + it.part, k = ctx.b[key] ?? 0, focus = P.highlight === it.part;
      const cAll = [ctx.rc(key, null, 'soft'), P.highlight !== 'none' && !focus ? `${N}:soft` : null].filter(Boolean).join(',') || null;
      const outer = h('g', { s: k, cls: 'rise', c: cAll }, root), inner = h('g', {}, outer);
      const bk = { it, k, focus, cAll, outer, inner, top: -26, y: pts[it.part].y };
      setBlock(bk, 0); return bk;
    });
    const need = () => blocks.reduce((a, bk) => a + bk.bottom - bk.top, 0) + 10 * Math.max(0, blocks.length - 1);
    for (let tier = 1; tier <= 2 && need() > (o.bottom ?? GRID.bottom) - GRID.top - 8; tier++) for (const bk of blocks) setBlock(bk, tier);
    // spread: each first line centres on its point where it can; then keep a gap and stay in the stage
    const gap = 10, lo = GRID.top + 8, hi = o.bottom ?? GRID.bottom;
    for (const bk of blocks) bk.base = bk.y + 9;
    for (let i = 0; i < blocks.length; i++) { const bk = blocks[i]; const minBase = i ? blocks[i - 1].base + blocks[i - 1].bottom + gap - bk.top : lo - bk.top; if (bk.base < minBase) bk.base = minBase; }
    for (let i = blocks.length - 1; i >= 0; i--) { const bk = blocks[i]; const maxBase = i < blocks.length - 1 ? blocks[i + 1].base + blocks[i + 1].top - gap - bk.bottom : hi - bk.bottom; if (bk.base > maxBase) bk.base = maxBase; }
    if (blocks.length && blocks[0].base + blocks[0].top < lo - 1) ctx.warn(`Too many labels on the ${side === 'L' ? 'left' : 'right'}: they do not fit beside the body.`);
    for (const bk of blocks) {
      bk.inner.setAttribute('transform', `translate(${colX} ${bk.base})`);
      const p = pts[bk.it.part], ex = side === 'L' ? colX + 10 : colX - 10, ey = bk.base - 10;
      const lg = h('g', { s: bk.k, c: bk.cAll }, under);
      const col = bk.focus ? 'var(--focus)' : 'var(--ink-2)';
      h('path', { d: `M${ex} ${ey} L ${p.x} ${p.y}`, fill: 'none', stroke: col, 'stroke-width': 'var(--sw-lead)', 'stroke-linecap': 'round', cls: 'draw', pathLength: 1, s: bk.k }, lg);
      h('circle', { cx: p.x, cy: p.y, r: bk.focus ? 10 : 8, fill: col, stroke: 'var(--paper)', 'stroke-width': 'var(--sw-struct)' }, lg);
      out.push(bk);
    }
  }
  return out;
}

export function render(root, P, ctx) {
  P = eff(P);
  const { list } = plan(P); const b = ctx.b, N = ctx.N; const bi = key => b[key] ?? 0;
  const view = P.view; const hooks = {};
  const off = view === 'muscles' ? { hide: bi('arm') } : {};
  const back = h('g', off, root), under = h('g', off, root), labels = h('g', off, root);

  if (view === 'teeth') {
    const g = h('g', { s: bi('jaw'), cls: 'rise' }, back);
    const J = jaw(g, { cx: 430, y0: 172, set: P.teethSet });
    const pts = {}; for (const t of Object.keys(J.rep)) pts[t] = { x: J.rep[t][0], y: J.rep[t][1], side: 'R' };
    // the teeth being named get a focus ring in their own step (and in the summary when highlighted)
    for (const it of list) {
      const k = bi('part:' + it.part), ring = h('g', { s: k, hide: P.highlight === it.part ? null : k + 1, cls: 'pop' }, under);
      for (const q of J.types[it.part] || []) h('circle', { cx: q.x, cy: q.y, r: it.part === 'molar' ? 32 : 25, fill: 'none', stroke: 'var(--focus)', 'stroke-width': 'var(--sw-struct)' }, ring);
    }
    placeLabels(labels, under, ctx, P, list, pts, { xL: 0, xR: J.box.x + J.box.w + 30, xRmax: GRID.right, oneSide: 'R',
      sub: it => { const job = it.job && it.job !== 'auto' ? it.job : JOB_OF[it.part]; return { text: txt(P, 'label:job:' + job, JOB_WORDS[job]), edit: `text.label:job:${job}` }; } });
    const cnt = P.teethSet === 'milk' ? 'A child has 20 milk teeth: 10 in each jaw.' : 'An adult has 32 teeth: 16 in each jaw.';
    computed(T(g, 430, Math.min(GRID.bottom - 6, J.bottom + 40), cnt, 'ts-small', { 'text-anchor': 'middle' }), 'teethSet');
    return hooks;
  }

  const F = FIG[view];
  let figHost = back;
  if (F.clip) {
    const id = 'bodyclip-' + ctx.uid; const defs = h('defs', {}, root); const cp = h('clipPath', { id }, defs);
    h('rect', { x: 0, y: 0, width: W, height: GRID.bottom + 8 }, cp);
    figHost = h('g', { 'clip-path': `url(#${id})` }, back);
  }
  // night: a lighter figure, so the body, face and organs stand off the dark ground
  const night = ctx.name === 'night';
  const fig = h('g', { s: bi('body'), cls: 'rise', style: night ? '--person-1:color-mix(in oklab,var(--hue-brown) 62%,var(--paper))' : null }, figHost);
  const bones = view === 'skeleton' || view === 'muscles';
  const Bd = bodyOutline(fig, { age: P.figure, x: F.cx, top: F.top, height: F.H, fill: 'skin', a: bones ? { cls: 'quiet' } : {} });
  const { H, L, top, cx } = Bd; const X = f => cx + f * H, Y = f => top + f * H, hx = L.hx * H, hb = L.headB * H;
  const sY = Y(L.shoulder), wY = Y(L.waist), cY = Y(L.crotch), T0 = wY - sY, sh = L.sh, hp = L.hip, lx = hp - L.leg / 2 - .004;
  const pts = {}; const P_ = (id, x, y, side) => { pts[id] = { x, y, side }; };
  let fc = null;
  if (!bones) fc = face(fig, Bd, { mouth: view === 'senses' ? 'open' : 'smile' });
  if (view === 'parts' || view === 'senses') {
    P_('head', cx - hx * .98, top + hb * .36, 'L'); P_('hair', cx + hx * .45, top + hb * .1, 'R');
    P_('eyes', cx + fc.eyeDX + hx * .2, fc.eyeY, 'R'); P_('ears', cx - fc.earDX, fc.earY, 'L'); P_('nose', cx + hx * .08, fc.noseY, view === 'senses' ? 'R' : 'auto');
    P_('mouth', cx - hx * .2, fc.mouthY, view === 'parts' ? 'auto' : 'L'); P_('tongue', cx + hx * .14, fc.mouthY + hb * .07, 'R');
    P_('neck', cx + hx * .3, Y(L.headB) + (sY - Y(L.headB)) * .55, 'R'); P_('shoulder', X(sh - .03), sY + .008 * H, 'R');
    P_('arm', X(-(sh + .006)), Y(L.shoulder + .1), 'L'); P_('elbow', X(-(sh + .016)), Y((L.shoulder + L.wrist) / 2), 'L');
    P_('hand', X(sh + .034), Y(L.wrist + .035), 'R'); P_('chest', X(sh * .35), sY + T0 * .3, 'R'); P_('tummy', X(-wa(L) * .3), wY + .015 * H, 'L');
    P_('leg', X(lx), Y((L.crotch + L.knee) / 2), 'R'); P_('knee', X(-lx), Y(L.knee), 'L'); P_('foot', X(lx + .012), Y(.982), 'R');
    P_('skin', X(sh + .034), Y((L.shoulder + L.wrist) / 2 + .03), 'R');
  }
  if (bones) {
    const S = skeleton(fig, Bd); const q = S.pts;
    const side = { skull: 'L', jaw: 'R', collarbone: 'R', ribs: 'L', spine: 'R', pelvis: 'L', humerus: 'R', forearm: 'L', femur: 'R', kneecap: 'L', shin: 'R' };
    for (const id of Object.keys(side)) P_(id, q[id][0], q[id][1], side[id]);
    P_('shoulder', q.shoulderR[0], q.shoulderR[1], 'L'); P_('elbow', q.elbowL[0], q.elbowL[1], 'R'); P_('hip', q.hipR[0], q.hipR[1], 'L'); P_('knee', q.kneeL[0], q.kneeL[1], 'R');
    // one label column: point at the matching bone on the viewer's left, so no leader crosses the body
    if (F.oneSide === 'L') for (const id in pts) if (pts[id].side === 'R') pts[id] = { x: 2 * cx - pts[id].x, y: pts[id].y, side: 'L' };
  }
  if (view === 'digestion') {
    const k = H / 480, J = Bd.journey;
    const has = id => list.some(it => it.part === id);
    const og = h('g', {}, fig);
    const sOf = id => has(id) ? { s: bi('part:' + id), cls: 'pop' } : {};
    for (const id of ['largeIntestine', 'smallIntestine', 'liver', 'stomach', 'oesophagus']) {
      if (id === 'liver' && !has(id)) continue;
      // each organ its own hue, darkened in the light themes so it reads against the skin
      const col = `color-mix(in oklab,${ORGAN_HUE[id]} ${night ? 100 : 82}%,var(--shade))`;
      for (const el of organ(og, Bd, id, sOf(id)).querySelectorAll('path,ellipse')) el.style.setProperty(el.getAttribute('fill') === 'none' ? 'stroke' : 'fill', col);
    }
    const at = i => { const a = Math.floor(i), f = i - a; const p0 = J.pts[a], p1 = J.pts[Math.min(J.pts.length - 1, a + 1)]; return [lerp(p0[0], p1[0], f), lerp(p0[1], p1[1], f)]; };
    P_('mouth', cx - hx * .2, fc.mouthY, 'L'); P_('oesophagus', cx, sY - (sY - Y(L.headB)) * .2, 'L');
    P_('stomach', Bd.slots.stomach.x + 12 * k, Bd.slots.stomach.y, 'R'); P_('liver', Bd.slots.liver.x - 14 * k, Bd.slots.liver.y, 'L');
    { const p = at(7); P_('smallIntestine', p[0], p[1], 'R'); } { const p = at(11.3); P_('largeIntestine', p[0], p[1], 'L'); } { const p = at(14.6); P_('rectum', p[0], p[1], 'R'); }
    if (P.journey) {
      // food token: it moves only in the steps of organs on its path, and the summary keeps its trail
      const cum = [0]; for (let i = 1; i < J.pts.length; i++) cum.push(cum[i - 1] + Math.hypot(J.pts[i][0] - J.pts[i - 1][0], J.pts[i][1] - J.pts[i - 1][1]));
      const vAt = i => { const a = Math.floor(i), f = i - a; return lerp(cum[a], cum[Math.min(cum.length - 1, a + 1)], f) / cum[cum.length - 1]; };
      const stops = list.filter(it => ON_PATH.includes(it.part)).map(it => ({ k: bi('part:' + it.part), v: vAt(PATH_AT[it.part]) }));
      if (stops.length) {
        const tok = h('circle', { r: 6.5 * k, fill: 'var(--ink)', stroke: 'var(--paper)', 'stroke-width': 'var(--sw-rule)', cls: 'lift', s: stops[0].k, hide: N }, labels);
        const put = v => { const p = alongPts(J.pts, v); tok.setAttribute('cx', p[0]); tok.setAttribute('cy', p[1]); };
        const vAfter = kk => { let v = 0; for (const s of stops) if (s.k <= kk) v = s.v; return v; };
        hooks.tick = (kk, u) => { const s = stops.find(q => q.k === kk); if (s) { const i = stops.indexOf(s); put(lerp(i ? stops[i - 1].v : 0, s.v, eIO(u))); } else put(vAfter(kk)); };
        hooks.reset = () => put(0); hooks.still = () => put(vAfter(N)); put(vAfter(N));
        hooks.dur = Object.fromEntries(list.filter(it => ON_PATH.includes(it.part)).map(it => ['part:' + it.part, 1500]));
      }
    }
  }

  const ext = (L.sh + .072) * H;
  const o = { xL: cx - ext - 40, xR: cx + ext + 40, xRmax: GRID.right, oneSide: F.oneSide };
  if (view === 'parts') o.bottom = GRID.bottom - 12;
  if (view === 'senses') o.sub = it => { const s = it.sense && it.sense !== 'auto' ? it.sense : SENSE_OF[it.part]; return { text: txt(P, 'label:sense:' + s, SENSE_NAME[s]), edit: `text.label:sense:${s}` }; };
  placeLabels(labels, under, ctx, P, list, pts, o);

  if (view === 'muscles') {
    // the arm steps: a small, faded skeleton keeps the place; the arm is the one thing to look at
    const th = h('g', { s: bi('arm'), cls: 'quiet' }, root);
    const Bt = bodyOutline(th, { age: P.figure, x: 210, top: 150, height: 470, fill: 'skin', a: { cls: 'quiet' } });
    skeleton(th, Bt);
    armPanel(root, ctx, P, hooks);
  }
  return hooks;
}
const wa = L => L.wa;
const ORGAN_HUE = { oesophagus: 'var(--hue-orange)', stomach: 'var(--hue-red)', liver: 'var(--hue-brown)', smallIntestine: 'var(--hue-gold)', largeIntestine: 'var(--hue-teal)' };

/* ------------------------------------------------------------------ the arm panel (muscles view) */
function armPanel(root, ctx, P, hooks) {
  const b = ctx.b, N = ctx.N, k0 = b.arm; const moves = movesOf(P);
  const box = { x: 392, y: GRID.top, w: GRID.right - 392, h: GRID.bottom - GRID.top };
  const g = h('g', { s: k0, cls: 'rise' }, root);
  h('rect', { x: box.x, y: box.y, width: box.w, height: box.h, rx: 'var(--r-card)', fill: 'var(--panel)' }, g);
  const sub = { fill: 'var(--ink-2)', style: 'font-weight:400' };
  // the panel name sits top left, clear of the shoulder; every word block wraps inside its own lane
  const ax = 750, ay = 196, laneL = ax - 44 - (box.x + 24), laneR = box.x + box.w - 24 - (ax + 56);
  // one line may run over the shoulder's height up to the biceps lane; a second line must stay left of the arm
  const tWord = txt(P, 'label:armTitle', 'The arm, from the side'), tg = h('g', {}, g);
  const t1 = textBlock(tg, box.x + 24, box.y + 46, tWord, { cls: 'ts-label', maxW: ax + 28 - (box.x + 24), maxLines: 1, lh: 32, edit: 'text.label:armTitle', a: sub });
  if (t1.cls !== 'ts-label' || t1.lines[0] !== tWord) { tg.replaceChildren(); textBlock(tg, box.x + 24, box.y + 46, tWord, { cls: 'ts-label', maxW: laneL, maxLines: 2, lh: 32, edit: 'text.label:armTitle', a: sub }); }
  // the arm is drawn at its own size, then scaled up to fill the panel; words stay at slide size
  const sc = 1.1, M = (x, y) => [ax + sc * x, ay + sc * y];
  const fx = h('g', { transform: `translate(${ax} ${ay}) scale(${sc})` }, g);
  const sx = 0, sy = 0;
  const A = armPart(fx, { sx, sy, up: 186, fore: 166 });
  const start = MOVES[moves[0]].from, angleAfter = kk => { let a = start; for (const m of moves) if (b[m] <= kk) a = MOVES[m].to; return a; };
  // ghost of where the forearm started, and the turn it makes, in each move's own step
  moves.forEach((m, i) => {
    const km = b[m], kn = i < moves.length - 1 ? b[moves[i + 1]] : null; const { from, to } = MOVES[m];
    const E = A.E, R = 166 + 40, f0 = [E[0] + Math.cos(from) * 196, E[1] + Math.sin(from) * 196];
    const gg = h('g', { s: km, hide: kn }, fx);
    h('path', { d: `M${E[0]} ${E[1]} L ${f0[0]} ${f0[1]}`, fill: 'none', stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-struct)', 'stroke-dasharray': '6 9', 'stroke-linecap': 'round' }, gg);
    const a0 = from + (to - from) * .12, a1 = to - (to - from) * .1, p0 = [E[0] + Math.cos(a0) * R, E[1] + Math.sin(a0) * R], p1 = [E[0] + Math.cos(a1) * R, E[1] + Math.sin(a1) * R];
    const sweep = to < from ? 0 : 1, dir = to < from ? -1 : 1, ang = a1 + dir * Math.PI / 2;
    arrow(ctx, gg, `M${p0[0]} ${p0[1]} A ${R} ${R} 0 0 ${sweep} ${p1[0]} ${p1[1]}`, p1[0], p1[1], ang, 'var(--event)', 'var(--sw-struct)', { draw: km, k: .8 });
  });
  // names right beside each muscle's belly; what each one does under its name
  // the biceps words stay above the raised forearm and hand (they reach no lower than y 282)
  const BI = [ax + 56, box.y + 46], TRI = [ax - 44, ay + sc * 84];
  const nm = (p, id, word, anchor, maxW) => textBlock(g, p[0], p[1], txt(P, 'label:' + id, word), { cls: 'ts-label', maxW, maxLines: 2, lh: 32, anchor, edit: 'text.label:' + id });
  const biB = nm(BI, 'biceps', 'biceps', 'start', laneR), triB = nm(TRI, 'triceps', 'triceps', 'end', laneL);
  const el = h('g', {}, g), EJ = M(sx - 40, A.E[1] + 66), l0 = M(sx - 34, A.E[1] + 44), l1 = M(sx - 16, A.E[1] + 12);
  textBlock(el, EJ[0], EJ[1], txt(P, 'label:elbowJoint', 'elbow joint'), { cls: 'ts-label', maxW: laneL, maxLines: 2, lh: 32, anchor: 'end', edit: 'text.label:elbowJoint', a: sub });
  h('path', { d: `M${l0[0]} ${l0[1]} L ${l1[0]} ${l1[1]}`, fill: 'none', stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-lead)', 'stroke-linecap': 'round' }, el);
  moves.forEach((m, i) => {
    const km = b[m], kn = i < moves.length - 1 ? b[moves[i + 1]] : null;
    const biC = m === 'bend', st = h('g', { s: km, hide: kn, cls: 'rise' }, g);
    const word = c => txt(P, c ? 'label:contracts' : 'label:relaxes', c ? 'contracts' : 'relaxes');
    const look = c => c ? { fill: 'var(--ink)', style: 'font-weight:700' } : sub;
    const state = (p, b0, c, anchor, maxW) => textBlock(st, p[0], p[1] + b0.h + 4, word(c), { cls: 'ts-label', maxW, maxLines: biB.lines.length > 1 && p === BI ? 1 : 2, lh: 32, anchor, edit: c ? 'text.label:contracts' : 'text.label:relaxes', a: look(c) });
    state(BI, biB, biC, 'start', laneR); state(TRI, triB, !biC, 'end', laneL);
  });
  A.set(angleAfter(N));
  const prev = { tick: hooks.tick, reset: hooks.reset, still: hooks.still };
  hooks.tick = (kk, u) => { const m = moves.find(q => b[q] === kk); A.set(m ? lerp(MOVES[m].from, MOVES[m].to, eIO(u)) : angleAfter(kk)); prev.tick && prev.tick(kk, u); };
  hooks.reset = () => { A.set(start); prev.reset && prev.reset(); };
  hooks.still = () => { A.set(angleAfter(N)); prev.still && prev.still(); };
  hooks.dur = Object.assign({}, hooks.dur || {}, Object.fromEntries(moves.map(m => [m, 1400])));
}
