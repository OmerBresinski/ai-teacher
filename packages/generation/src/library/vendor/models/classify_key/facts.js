import { findSubject } from '../../kit/subjects.js'; // libdata
// What is true about the living things a primary key or sorting slide is likely to use.
// Used only by validate(): a known animal in the wrong group, or sent down the wrong side of a
// question we can read (feathers, fur, legs, six legs, wings, shell, backbone...), is refused.
// Anything not in this table is the teacher's call and is never refused.
//
// Trait values: 1 = true, 0 = false, undefined = not a clean yes or no (never checked).

export const CLASSES = ['mammal', 'bird', 'fish', 'reptile', 'amphibian', 'insect', 'arachnid', 'mollusc', 'crustacean', 'worm', 'plant'];
export const CLASS_WORD = { mammal: 'a mammal', bird: 'a bird', fish: 'a fish', reptile: 'a reptile', amphibian: 'an amphibian', insect: 'an insect',
  arachnid: 'an arachnid (the spider group)', mollusc: 'a mollusc', crustacean: 'a crustacean', worm: 'a worm', plant: 'a plant' };
export const VERTEBRATES = ['mammal', 'bird', 'fish', 'reptile', 'amphibian'];
const WHY = {
  mammal: 'it has hair or fur and feeds its babies milk', bird: 'it has feathers and a beak and lays eggs', fish: 'it breathes with gills and has fins',
  reptile: 'it has dry, scaly skin', amphibian: 'it has smooth, damp skin and starts life in water', insect: 'it has six legs and three body parts',
  arachnid: 'it has eight legs and two body parts', mollusc: 'it has a soft body and no legs', crustacean: 'it has a hard outer skeleton and many legs',
  worm: 'it has a soft, ringed body and no legs', plant: 'it makes its own food from sunlight',
};
const BASE = {
  mammal: { feathers: 0, fur: 1, scales: 0, backbone: 1, sixLegs: 0, eightLegs: 0, laysEggs: 0, shell: 0, wings: 0, flies: 0, legs: 1, fins: 0 },
  bird: { feathers: 1, fur: 0, backbone: 1, sixLegs: 0, eightLegs: 0, laysEggs: 1, shell: 0, wings: 1, flies: 1, legs: 1, fins: 0, water: undefined },
  fish: { feathers: 0, fur: 0, scales: 1, backbone: 1, sixLegs: 0, eightLegs: 0, shell: 0, wings: 0, flies: 0, legs: 0, fins: 1, water: 1 },
  reptile: { feathers: 0, fur: 0, scales: 1, backbone: 1, sixLegs: 0, eightLegs: 0, wings: 0, flies: 0, legs: 1, fins: 0, shell: 0 },
  amphibian: { feathers: 0, fur: 0, scales: 0, backbone: 1, sixLegs: 0, eightLegs: 0, laysEggs: 1, shell: 0, wings: 0, flies: 0, legs: 1, fins: 0 },
  insect: { feathers: 0, backbone: 0, sixLegs: 1, eightLegs: 0, legs: 1, laysEggs: 1, fins: 0, wings: 1, flies: 1 },
  arachnid: { feathers: 0, scales: 0, backbone: 0, sixLegs: 0, eightLegs: 1, legs: 1, wings: 0, flies: 0, shell: 0, fins: 0 },
  mollusc: { feathers: 0, fur: 0, scales: 0, backbone: 0, sixLegs: 0, eightLegs: 0, legs: 0, wings: 0, flies: 0, fins: 0 },
  crustacean: { feathers: 0, fur: 0, backbone: 0, sixLegs: 0, wings: 0, flies: 0, legs: 1, fins: 0 },
  worm: { feathers: 0, fur: 0, scales: 0, backbone: 0, sixLegs: 0, eightLegs: 0, legs: 0, wings: 0, flies: 0, shell: 0, fins: 0 },
  plant: { feathers: 0, fur: 0, backbone: 0, legs: 0, wings: 0, flies: 0, makesFood: 1 },
};
// name: [class, picture, trait overrides, why override]
const LAND = { water: 0 };
const T = {
  rabbit: ['mammal', 'rabbit', LAND], fox: ['mammal', 'fox', LAND], mouse: ['mammal', 'mouse', LAND], lion: ['mammal', 'lion', LAND],
  zebra: ['mammal', 'zebra', LAND], giraffe: ['mammal', 'giraffe', LAND], 'polar bear': ['mammal', 'polarbear'], seal: ['mammal', 'seal', { legs: undefined }],
  'sea lion': ['mammal', 'seal', { legs: undefined }],
  whale: ['mammal', 'whale', { fur: undefined, legs: 0, water: 1, fins: undefined }, 'it breathes air and feeds its babies milk'],
  dolphin: ['mammal', 'whale', { fur: undefined, legs: 0, water: 1, fins: undefined }, 'it breathes air and feeds its babies milk'],
  bat: ['mammal', 'bat', { wings: 1, flies: 1, water: 0 }, 'it has fur and feeds its babies milk; wings do not make it a bird'],
  human: ['mammal', 'none', LAND], person: ['mammal', 'none', LAND], dog: ['mammal', 'none', LAND], cat: ['mammal', 'none', LAND], cow: ['mammal', 'none', LAND],
  horse: ['mammal', 'none', LAND], sheep: ['mammal', 'none', LAND], pig: ['mammal', 'none', LAND], hedgehog: ['mammal', 'none', LAND],
  squirrel: ['mammal', 'none', LAND], elephant: ['mammal', 'none', LAND], deer: ['mammal', 'none', LAND], badger: ['mammal', 'none', LAND],
  bird: ['bird', 'bird', LAND], robin: ['bird', 'bird', LAND], sparrow: ['bird', 'bird', LAND], blackbird: ['bird', 'bird', LAND], owl: ['bird', 'owl', LAND],
  eagle: ['bird', 'bird', LAND], parrot: ['bird', 'bird', LAND], heron: ['bird', 'heron'], duck: ['bird', 'none'], swan: ['bird', 'none'],
  hen: ['bird', 'hen', { flies: undefined, water: 0 }], chicken: ['bird', 'hen', { flies: undefined, water: 0 }], chick: ['bird', 'chick', { flies: 0, water: 0 }],
  penguin: ['bird', 'penguin', { flies: 0 }, 'it has feathers and lays eggs, even though it cannot fly'],
  ostrich: ['bird', 'none', { flies: 0, water: 0 }, 'it has feathers and lays eggs, even though it cannot fly'],
  emu: ['bird', 'none', { flies: 0, water: 0 }], kiwi: ['bird', 'none', { flies: 0, water: 0 }],
  fish: ['fish', 'fish'], goldfish: ['fish', 'fish', { laysEggs: 1 }], salmon: ['fish', 'fish', { laysEggs: 1 }], cod: ['fish', 'fish', { laysEggs: 1 }],
  trout: ['fish', 'fish', { laysEggs: 1 }], stickleback: ['fish', 'fish', { laysEggs: 1 }], seahorse: ['fish', 'none', { scales: undefined }], 'sea horse': ['fish', 'none', { scales: undefined }], // bony plates, not scales
  shark: ['fish', 'shark', { scales: undefined }, 'it breathes with gills and has fins'],
  snake: ['reptile', 'snake', { legs: 0 }], 'grass snake': ['reptile', 'snake', { legs: 0, laysEggs: 1 }], adder: ['reptile', 'snake', { legs: 0 }],
  'slow worm': ['reptile', 'snake', { legs: 0 }, 'it is a lizard with no legs, with dry, scaly skin'], slowworm: ['reptile', 'snake', { legs: 0 }, 'it is a lizard with no legs, with dry, scaly skin'],
  lizard: ['reptile', 'lizard', LAND], gecko: ['reptile', 'lizard', LAND], crocodile: ['reptile', 'none', { laysEggs: 1 }], alligator: ['reptile', 'none', { laysEggs: 1 }],
  tortoise: ['reptile', 'none', { laysEggs: 1, shell: 1, water: 0 }], turtle: ['reptile', 'none', { laysEggs: 1, shell: 1 }],
  frog: ['amphibian', 'frog'], toad: ['amphibian', 'none'], newt: ['amphibian', 'newt'], salamander: ['amphibian', 'newt'],
  butterfly: ['insect', 'butterfly', LAND], moth: ['insect', 'none', LAND], bee: ['insect', 'bee', { fur: undefined, water: 0 }], bumblebee: ['insect', 'bee', { water: 0 }],
  wasp: ['insect', 'none', LAND], ladybird: ['insect', 'ladybird', LAND], ladybug: ['insect', 'ladybird', LAND], beetle: ['insect', 'beetle'],
  ant: ['insect', 'none', { wings: undefined, flies: undefined }], fly: ['insect', 'none'], housefly: ['insect', 'none'], dragonfly: ['insect', 'none'],
  grasshopper: ['insect', 'none', LAND], 'glow worm': ['insect', 'none', { wings: undefined, flies: undefined }, 'it is a beetle with six legs'],
  caterpillar: ['insect', 'caterpillar', { wings: 0, flies: 0, sixLegs: undefined }],
  spider: ['arachnid', 'spider', {}, 'it has eight legs and two body parts; insects have six'], scorpion: ['arachnid', 'none'], tick: ['arachnid', 'none'],
  snail: ['mollusc', 'snail', { shell: 1 }], slug: ['mollusc', 'none', { shell: undefined }], octopus: ['mollusc', 'none', { legs: undefined, eightLegs: undefined, water: 1 }],
  woodlouse: ['crustacean', 'woodlouse', { eightLegs: 0, shell: undefined }, 'it has fourteen legs and a hard outer skeleton, like a crab'],
  crab: ['crustacean', 'none', { shell: 1, eightLegs: undefined }], lobster: ['crustacean', 'none', { shell: 1 }],
  worm: ['worm', 'worm'], earthworm: ['worm', 'worm'],
  daisy: ['plant', 'flower'], sunflower: ['plant', 'flower'], dandelion: ['plant', 'flower'], tree: ['plant', 'tree'], grass: ['plant', 'grass'], oak: ['plant', 'tree'],
};
// a known head word after an adjective ("blue whale", "garden snail"); risky heads (worm, fish, horse, lion, spider) need an exact name
const SAFE_HEADS = new Set(['whale', 'dolphin', 'snail', 'bee', 'ant', 'beetle', 'butterfly', 'moth', 'owl', 'duck', 'eagle', 'parrot', 'penguin', 'robin', 'frog', 'toad', 'newt',
  'snake', 'lizard', 'crocodile', 'tortoise', 'turtle', 'shark', 'salmon', 'trout', 'rabbit', 'fox', 'deer', 'bat', 'dog', 'cat', 'squirrel', 'hedgehog', 'elephant', 'slug', 'crab', 'ladybird', 'wasp', 'fly', 'cow', 'pig', 'sheep',
  'spider', 'mouse', 'woodlouse', 'caterpillar', 'seal', 'heron', 'goldfish', 'earthworm']);
// "sea spider" and "sea mouse" are other animals that only share the name
const FALSE_FIRST = new Set(['sea']);

const norm = s => String(s || '').toLowerCase().replace(/[^a-z\s-]/g, '').replace(/-/g, ' ').replace(/\s+/g, ' ').trim().replace(/^(a|an|the) /, '');
const sing = w => w.endsWith('ies') ? w.slice(0, -3) + 'y' : w.endsWith('ice') && w === 'mice' ? 'mouse' : w === 'woodlice' ? 'woodlouse' : (w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us')) ? w.slice(0, -1) : w;
/** What we know about a thing called `name`, or null. */
export function factOf(name) {
  const n = norm(name); if (!n) return null;
  const words = n.split(' '); const last = words[words.length - 1];
  const keys = [n, words.slice(0, -1).concat(sing(last)).join(' ')];
  let key = keys.find(k => T[k]);
  if (!key && words.length > 1 && SAFE_HEADS.has(sing(last)) && !FALSE_FIRST.has(words[0])) key = sing(last);
  // "Goldfish in the pond", "Rabbit in the garden", "Bee on a flower": the thing is the words before the place
  if (!key) { const m = n.match(/^(.+?) (?:in|on|at|from|near|under|inside|by) .+$/); return m ? factOf(m[1]) : null; }
  const [cls, pic, over = {}, why] = T[key];
  return { key, cls, pic, traits: Object.assign({}, BASE[cls], over), why: why || WHY[cls] };
}
/** Picture for a name, or 'none'. */
export const pictureFor = name => { const f = factOf(name); if (f && f.pic !== 'none') return f.pic;
  const s = findSubject(f ? f.key : name); return s ? `lib:${s.id}` : 'none'; }; // libdata: the shared picture library

/** Which class a group name means: 'mammal' ... or 'vert' / 'invert', or null when it is the teacher's own rule. */
export function classOfGroup(name) {
  const n = norm(name); if (!n || /\b(not|non|other|no)\b/.test(n)) return null;
  if (/invertebrate/.test(n)) return 'invert';
  if (/vertebrate/.test(n)) return 'vert';
  const M = [[/\bmammals?\b/, 'mammal'], [/\bbirds?\b/, 'bird'], [/^fish(es)?$|\bfish(es)?\b(?!\w)/, 'fish'], [/\breptiles?\b/, 'reptile'], [/\bamphibians?\b/, 'amphibian'],
    [/\binsects?\b/, 'insect'], [/\barachnids?\b|\bspiders?\b/, 'arachnid'], [/\bmollus[ck]s?\b/, 'mollusc'], [/\bcrustaceans?\b/, 'crustacean'], [/\bplants?\b/, 'plant']];
  if (/jellyfish|starfish|shellfish/.test(n)) return null;
  for (const [re, c] of M) if (re.test(n)) return c;
  return null;
}
/** The class a negated group name excludes ("Not insects", "Non-mammals", "No backbone" -> null): 'insect' ... or null. */
export function negClassOfGroup(name) {
  const m = norm(name).match(/^(?:not|non|no) (.+)$/); return m ? classOfGroup(m[1]) : null;
}
export const groupFits = (gc, cls) => gc === 'vert' ? VERTEBRATES.includes(cls) : gc === 'invert' ? !VERTEBRATES.includes(cls) && cls !== 'plant' : gc === cls;

/** Which trait a yes/no question asks about, or null when we cannot read it. */
const Q = [
  [/feather/, 'feathers', ['has feathers', 'does not have feathers']],
  [/\bfur\b|\bfurry\b|\bhair/, 'fur', ['has fur or hair', 'does not have fur']],
  [/\bscales?\b|\bscaly\b/, 'scales', ['has scales', 'does not have scales']],
  [/\bfins?\b/, 'fins', ['has fins', 'does not have fins']],
  [/\b(six|6) legs\b/, 'sixLegs', ['has six legs', 'does not have six legs']],
  [/\b(eight|8) legs\b/, 'eightLegs', ['has eight legs', 'does not have eight legs']],
  [/\blegs?\b/, 'legs', ['has legs', 'has no legs']],
  [/\bwings?\b/, 'wings', ['has wings', 'has no wings']],
  [/\bfly\b|\bflies\b|\bflying\b/, 'flies', ['can fly', 'cannot fly']],
  [/\bshell\b/, 'shell', ['has a shell', 'has no shell']],
  [/backbone|\bspine\b|skeleton inside/, 'backbone', ['has a backbone', 'has no backbone']],
  [/lays? eggs/, 'laysEggs', ['lays eggs', 'does not lay eggs']],
  [/live[sd]? in (the )?(water|sea)|\bunderwater\b/, 'water', ['lives in water', 'does not live in water']],
];
const COUNT = /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fourteen|\d+|exactly|how many|pairs?)\b/;
export function traitOfQuestion(q) {
  const n = String(q || '').toLowerCase().replace(/\u2019/g, "'");
  if (/more than|fewer|less than|at least/.test(n)) return null; // comparisons: too easy to misread, so not checked
  // plain negatives read as the trait with the answer flipped: "have no X", "not have X", "without X"
  const neg = n.replace(/\b(have|has|got) no\b/, '$1').replace(/\b(does|do|did)n't (it|they) have\b/, '$1 $2 have').replace(/\b(does|do) (it|they) not have\b/, '$1 $2 have').replace(/\b(does|do) not have\b/, '$1 have').replace(/\bwithout\b/, 'with');
  if (neg !== n) {
    if (/\b(not|no|never|without)\b|n't/.test(neg)) return null;
    const t = traitOfQuestion(neg); return t ? { ...t, neg: !t.neg, says: [t.says[1], t.says[0]] } : null;
  }
  if (/\b(not|no|never|without)\b|n't/.test(n)) return null; // harder negatives: not checked
  for (const [re, cls] of [[/\bmammal/, 'mammal'], [/\bbird/, 'bird'], [/\bfish\b/, 'fish'], [/\breptile/, 'reptile'], [/\bamphibian/, 'amphibian'], [/\binsect/, 'insect']])
    if (/^\s*(is|are) (it|they) (an? )?/.test(n) && re.test(n)) return { cls, says: [`is ${CLASS_WORD[cls]}`, `is not ${CLASS_WORD[cls]}`] };
  if (/vertebrate/.test(n) && !/invertebrate/.test(n) && /^\s*(is|are)/.test(n)) return { trait: 'backbone', says: ['is a vertebrate', 'is not a vertebrate'] };
  for (const [re, trait, says] of Q) if (re.test(n)) {
    if (trait === 'legs' && COUNT.test(n)) return null; // a count we cannot read exactly ("six jointed legs"): not checked
    return { trait, says };
  }
  return null;
}
/** The true answer (true/false) for a fact and a read question, or undefined. */
export function answer(f, tq) {
  if (!f || !tq) return undefined;
  if (tq.cls) return (f.cls === tq.cls) !== !!tq.neg;
  const v = f.traits[tq.trait]; return v === undefined ? undefined : !!v !== !!tq.neg;
}
const WH = /^\s*(what|which|who|whose|where|when|why|how)\b/i;
/** A question a class can answer yes or no? Returns a reason when it clearly is not. */
export function notYesNo(q) {
  const s = String(q || '').trim();
  if (WH.test(s)) return `“${s}” cannot be answered yes or no. Ask something like “Does it have six legs?” instead.`;
  if (/\bor\b/i.test(s) && /\b(big|small|large|tall|short|long|fast|slow|light|dark)\b.*\bor\b.*\b(big|small|large|tall|short|long|fast|slow|light|dark)\b/i.test(s)) return `“${s}” asks for a choice, not a yes or no. Ask about one thing at a time.`;
  return null;
}
