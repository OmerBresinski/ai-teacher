// Patterns and sequences. Two kinds on one model:
//   repeating: a short unit of shapes, colours or objects repeats (AB, ABB, ABC …);
//   linear:    each term adds the same step, drawn as real tiles, real matchsticks or numbers.
// Builds: the first terms, then the repeat (rings round each repeat) or the growth (the new part
// of each term and the +step jumps), then the question: what comes next, a missing term, or any
// term (Y6: the rule in words, then as an nth-term formula, then a far term worked out).
// validate() refuses a unit that is not the shortest repeat, too few terms to see it twice,
// matchstick or tile counts that do not match the picture, and a step of 0.

import { countable, fmtNum, groupRing, isWholeNumber } from "../kit/batch-A.js";
import {
  computed,
  editable,
  GRID,
  h,
  headD,
  lanePlace,
  measure,
  normName,
  result,
  schemaCheck,
  T,
  TEXT_PARAM_FOR,
  TITLE_PARAM,
  textBlock,
  txt,
  withDefaults,
  wrap,
} from "../kit/index.js";

export const meta = {
  id: "sequences_patterns",
  name: "Patterns and sequences",
  kind: "info",
  version: 1,
  subjects: ["Maths"],
  years: ["Reception", "Y1", "Y2", "Y3", "Y4", "Y5", "Y6"],
  teaches:
    "A pattern follows a rule: a repeating pattern repeats the same unit, and a growing pattern or sequence changes by the same step each time, so we can say what comes next or find any term.",
};

/* ------------------------------------------------------------------ choices */
const COLOURS = ["red", "blue", "yellow", "green", "orange", "purple"];
const COL_TOK = {
  red: "--hue-red",
  blue: "--hue-blue",
  yellow: "--hue-gold",
  green: "--hue-green",
  orange: "--hue-orange",
  purple: "--hue-purple",
};
const SHAPES = ["circle", "square", "triangle", "star", "heart", "apple", "duck", "car"];
const OBJ = ["apple", "duck", "car"];
const PICS = ["tiles", "sticks-square", "sticks-triangle", "numbers"];
const UNIT_WORD = {
  tiles: "tiles",
  "sticks-square": "matchsticks",
  "sticks-triangle": "matchsticks",
};
const MINUS = "−";

export const params = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  title: "Patterns and sequences",
  properties: {
    title: TITLE_PARAM("What comes next?"),
    kind: {
      type: "string",
      title: "Kind of pattern",
      enum: ["repeating", "linear"],
      default: "repeating",
      "x-labels": [
        "Repeating pattern (AB, ABB, ABC)",
        "Growing pattern or number sequence (same step each time)",
      ],
    },
    unit: {
      type: "array",
      title: "The part that repeats",
      "x-item": "a thing",
      minItems: 2,
      maxItems: 4,
      description: "Repeating patterns: two to four things in order. They repeat again and again.",
      default: [
        { shape: "circle", colour: "red", name: "" },
        { shape: "circle", colour: "blue", name: "" },
      ],
      items: {
        type: "object",
        title: "Thing",
        default: { shape: "circle", colour: "red", name: "" },
        properties: {
          shape: {
            type: "string",
            title: "Shape or object",
            enum: SHAPES,
            default: "circle",
            "x-labels": ["Circle", "Square", "Triangle", "Star", "Heart", "Apple", "Duck", "Car"],
          },
          colour: {
            type: "string",
            title: "Colour",
            enum: COLOURS,
            default: "red",
            description: "Not used for the apple, duck or car.",
            "x-labels": ["Red", "Blue", "Yellow", "Green", "Orange", "Purple"],
          },
          name: {
            type: "string",
            title: "What children call it",
            maxLength: 24,
            default: "",
            description: "Leave empty to use the colour or shape.",
          },
        },
      },
    },
    picture: {
      type: "string",
      title: "Show a growing pattern as",
      enum: PICS,
      default: "tiles",
      "x-labels": [
        "Square tiles",
        "Matchstick squares in a row",
        "Matchstick triangles in a row",
        "Numbers only",
      ],
      description:
        "Pictures use real counts. Use numbers only for counting back, big numbers or decimals.",
    },
    start: { type: "number", title: "First term", default: 2, minimum: -1000000, maximum: 1000000 },
    step: {
      type: "number",
      title: "Step (added each time)",
      default: 2,
      minimum: -100000,
      maximum: 100000,
      description: "Use a negative step to count back (numbers only).",
    },
    terms: { type: "integer", title: "Terms shown", minimum: 3, maximum: 14, default: 5 },
    ask: {
      type: "string",
      title: "The question",
      enum: ["next", "missing", "nth"],
      default: "next",
      "x-labels": ["What comes next?", "A missing term", "Any term (the nth term)"],
    },
    missingAt: {
      type: "integer",
      title: "Which term is missing",
      minimum: 1,
      maximum: 14,
      default: 3,
    },
    farTerm: {
      type: "integer",
      title: "Term to work out",
      minimum: 1,
      maximum: 1000,
      default: 10,
      description:
        "For “any term”: the term worked out from the rule, such as the 10th or the 100th.",
    },
    showCode: {
      type: "boolean",
      title: "Show the letter code (AB, ABB)",
      default: true,
      "x-panel": "advanced",
    },
    // the row labels and the formula lead are labels: they live in a narrow column
    text: TEXT_PARAM_FOR({ countRow: "label", posRow: "label", nth: "label" }),
  },
};

export const presets = [
  {
    id: "rec-red-blue",
    name: "Reception: red, blue, red, blue…",
    params: {
      title: "What comes next?",
      kind: "repeating",
      terms: 8,
      ask: "next",
      showCode: false,
      unit: [
        { shape: "circle", colour: "red", name: "red" },
        { shape: "circle", colour: "blue", name: "blue" },
      ],
    },
  },
  {
    id: "y2-abb-20th",
    name: "Year 2: an ABB pattern, what is the 20th?",
    params: {
      title: "Find the 20th shape",
      kind: "repeating",
      terms: 9,
      ask: "nth",
      farTerm: 20,
      showCode: true,
      unit: [
        { shape: "star", colour: "yellow", name: "star" },
        { shape: "heart", colour: "red", name: "heart" },
        { shape: "heart", colour: "red", name: "heart" },
      ],
    },
  },
  {
    id: "y3-count-4s",
    name: "Year 3: count in 4s",
    params: {
      title: "Counting in 4s",
      kind: "linear",
      picture: "tiles",
      start: 4,
      step: 4,
      terms: 5,
      ask: "missing",
      missingAt: 4,
    },
  },
  {
    id: "y6-matchsticks",
    name: "Year 6: matchstick squares, 3n + 1",
    params: {
      title: "Matchstick squares",
      kind: "linear",
      picture: "sticks-square",
      start: 4,
      step: 3,
      terms: 3,
      ask: "nth",
      farTerm: 10,
    },
  },
];

/* ------------------------------------------------------------------ words and numbers */
const ord = (n) => {
  const a = Math.abs(n) % 100,
    b = Math.abs(n) % 10;
  return `${n}${a > 10 && a < 14 ? "th" : b === 1 ? "st" : b === 2 ? "nd" : b === 3 ? "rd" : "th"}`;
};
const fx = (v) => +(+v).toFixed(10);
const dp = (v) => {
  const s = String(fx(v));
  const i = s.indexOf(".");
  return i < 0 ? 0 : s.length - i - 1;
};
const list = (a) => a.join(", ");
const lookKey = (it) => (OBJ.includes(it.shape) ? it.shape : `${it.shape}/${it.colour}`);
function period(keys) {
  for (let p = 1; p < keys.length; p++)
    if (keys.length % p === 0 && keys.every((k, i) => k === keys[i % p])) return p;
  return keys.length;
}
function defaultNames(unit) {
  const plain = unit.filter((u) => !OBJ.includes(u.shape));
  const sD = new Set(plain.map((u) => u.shape)).size > 1,
    cD = new Set(plain.map((u) => u.colour)).size > 1;
  return unit.map((u) =>
    OBJ.includes(u.shape) ? u.shape : sD && cD ? `${u.colour} ${u.shape}` : cD ? u.colour : u.shape,
  );
}
// Names as shown. A name belongs to a look, so the picture always decides:
//  - same-looking things share one name: the first one given among them (renaming one renames all);
//  - a lone colour or shape word follows the picture (a blue circle called "red" shows as "blue");
//  - two different looks that end up with the same name are told apart by colour and shape.
// Returns {names, src, notes}: src[i] is the thing whose name field thing i shows (its edit path).
const cword = (s) => s.toLowerCase().replace(/[^a-z]/g, "");
function fitWords(s, u) {
  const toks = s.split(/(\s+)/),
    cols = toks.filter((t) => COLOURS.includes(cword(t))),
    shs = toks.filter((t) => SHAPES.includes(cword(t)));
  const swap = (t, w) => (/^[A-Z]/.test(t) ? cap(w) : w);
  return toks
    .map((t) => {
      const c = cword(t);
      if (!OBJ.includes(u.shape) && cols.length === 1 && COLOURS.includes(c) && c !== u.colour)
        return swap(t, u.colour);
      if (shs.length === 1 && SHAPES.includes(c) && c !== u.shape) return swap(t, u.shape);
      return t;
    })
    .join("");
}
function nameInfo(unit) {
  const def = defaultNames(unit),
    keys = unit.map(lookKey),
    raw = unit.map((u) => (u.name || "").trim());
  const notes = [],
    src = unit.map((u, i) => {
      const j = keys.findIndex((k, q) => k === keys[i] && raw[q]);
      return j < 0 ? i : j;
    });
  const names = unit.map((u, i) => {
    if (!raw[src[i]]) return def[i];
    const s = fitWords(raw[src[i]], u);
    if (src[i] === i && s !== raw[i])
      notes.push(
        `Thing ${i + 1} is ${OBJ.includes(u.shape) ? art(u.shape) : `a ${u.colour} ${u.shape}`}, so “${raw[i]}” is shown as “${s}” to match the picture.`,
      );
    if (src[i] !== i && raw[i] && cword(raw[i]) !== cword(raw[src[i]]))
      notes.push(
        `Thing ${i + 1} looks the same as thing ${src[i] + 1}, so it shows the same name: ${s}. Rename thing ${src[i] + 1} to rename both.`,
      );
    return s;
  });
  for (let i = 0; i < unit.length; i++)
    for (let j = 0; j < i; j++) {
      if (keys[i] !== keys[j] && names[i].toLowerCase() === names[j].toLowerCase()) {
        for (const q of [j, i])
          if (!OBJ.includes(unit[q].shape)) names[q] = `${unit[q].colour} ${unit[q].shape}`;
        notes.push(
          `Things ${j + 1} and ${i + 1} look different but had the same name, so they are shown as ${names[j]} and ${names[i]}.`,
        );
      }
    }
  return { names, src, notes: [...new Set(notes)] };
}
const unitNames = (unit) => nameInfo(unit).names;
// a repeating pattern always shows its repeat at least twice
const repTerms = (P) => Math.max(P.terms, 2 * P.unit.length);
// matchstick rows are fixed by the picture: one shape, then each new shape shares a side
const STICKS = { "sticks-square": [4, 3], "sticks-triangle": [3, 2] };
const seqOf = (P) =>
  STICKS[P.picture]
    ? { s0: STICKS[P.picture][0], a: STICKS[P.picture][1] }
    : { s0: fx(P.start), a: fx(P.step) };
// the widest number card, in slide units, at the smallest type size (tabular digits ~0.56em)
const cardMinW = (vals) => Math.max(...vals.map((v) => fmtNum(v).length)) * 22 * 0.58 + 32;
const TILE_MIN = 16;
// a matchstick shorter than this reads as a red blob from the back of the room
const STICK_MIN = 44;
const stickW = (pic, i) => (pic === "sticks-square" ? i + 1 : (i + 2) / 2);
// the matchstick length a row of d shapes gets, at the widest row-label column (240 + 32) and with the
// gaps widened so the counts underneath clear each other by 28 (the same steps render takes)
function stickLen(pic, d) {
  const s0 = STICKS[pic][0],
    a = STICKS[pic][1],
    W = GRID.right - 8 - (GRID.left + 240 + 32);
  const sumU = Array.from({ length: d }, (_, i) => stickW(pic, i)).reduce((s, v) => s + v, 0);
  const valW = String(s0 + a * (d - 1)).length * (d <= 6 ? 52 : 40) * 0.6;
  let G = d > 8 ? 32 : 30,
    u = Math.min(130, (W - G * (d - 1)) / sumU);
  for (let it = 0; it < 4; it++) {
    const need = Math.max(
      0,
      ...Array.from(
        { length: d - 1 },
        (_, i) => valW + 28 - ((stickW(pic, i) + stickW(pic, i + 1)) / 2) * u,
      ),
    );
    if (need <= G) break;
    G = need;
    u = Math.min(130, (W - G * (d - 1)) / sumU);
  }
  return u;
}
// captions stay one plain sentence: past about 110 letters the shorter wording is used
const fitCap = (long, short) => (long.length <= 110 ? long : short);
const cap = (s) => s.replace(/^./, (c) => c.toUpperCase());
// "a heart", "an apple", but "red" stays bare: only names built from a shape or object take an article
const art = (s) =>
  SHAPES.includes(s.trim().split(/\s+/).pop().toLowerCase())
    ? `${/^[aeiou]/i.test(s) ? "an" : "a"} ${s}`
    : s;
const plural = (n, w) => (n === 1 ? w.replace(/s$/, "") : w);
function formula(a, b) {
  const an = a === 1 ? "n" : a === -1 ? `${MINUS}n` : `${fmtNum(a)}n`;
  return b === 0 ? an : `${an} ${b > 0 ? "+" : MINUS} ${fmtNum(Math.abs(b))}`;
}
function ruleWords(a, b) {
  const head = a === 1 ? "Start with the position" : `Multiply the position by ${fmtNum(a)}`;
  return b === 0
    ? `${head}.`
    : `${head}, then ${b > 0 ? "add" : "take away"} ${fmtNum(Math.abs(b))}.`;
}

/* ------------------------------------------------------------------ validate */
// things children might call a pattern piece; a name with one of these must be the thing drawn, so a green
// star is never labelled "leaf" (names like "red", "big" or "clap" describe the piece and stay free)
const THINGS = {
  circle: [
    "circle",
    "dot",
    "spot",
    "ball",
    "bead",
    "button",
    "counter",
    "round",
    "ring",
    "disc",
    "coin",
  ],
  square: ["square", "block", "cube", "tile", "box"],
  triangle: ["triangle"],
  star: ["star"],
  heart: ["heart"],
  apple: ["apple"],
  duck: ["duck"],
  car: ["car"],
};
const OTHER_THINGS = [
  "leaf",
  "flower",
  "tree",
  "sun",
  "moon",
  "cloud",
  "fish",
  "cat",
  "dog",
  "bear",
  "teddy",
  "shell",
  "bus",
  "train",
  "banana",
  "pear",
  "orange",
  "strawberry",
  "cake",
  "sock",
  "shoe",
  "hat",
  "bird",
  "frog",
  "bee",
  "butterfly",
  "snowflake",
  "pencil",
  "crayon",
  "brick",
  "diamond",
  "oval",
  "rectangle",
  "hexagon",
  "pentagon",
  "spoon",
  "cup",
  "egg",
];
function nameClash(u) {
  const n = normName(u.name);
  if (!n) return null;
  const words = ` ${n} `;
  const own = (THINGS[u.shape] || []).some((w) => words.includes(` ${w} `));
  if (own) return null;
  const all = [
    ...Object.entries(THINGS)
      .filter(([k]) => k !== u.shape)
      .flatMap(([, v]) => v),
    ...OTHER_THINGS,
  ];
  return all.find((w) => words.includes(` ${w} `)) || null;
}
export function validate(raw) {
  const P = withDefaults(params, raw);
  const R = schemaCheck(params, P);
  const W = [];
  if (R.length) return result(R);
  if (P.kind === "repeating")
    (P.unit || []).forEach((u, i) => {
      const c = nameClash(u);
      if (c)
        R.push({
          path: `unit.${i}.name`,
          reason: `This piece is drawn as ${OBJ.includes(u.shape) ? "a" : `a ${u.colour}`} ${u.shape}, so calling it “${u.name}” would name a ${c} that is not on the slide. Choose a shape that matches, or a name like “${OBJ.includes(u.shape) ? u.shape : u.colour}”.`,
        });
    });
  if (R.length) return result(R);
  if (P.kind === "repeating") {
    const L = P.unit.length,
      keys = P.unit.map(lookKey),
      NI = nameInfo(P.unit),
      names = NI.names;
    // names never refuse: they follow the picture (see nameInfo), and say so
    W.push(...NI.notes);
    // a part that repeats inside itself is drawn as its shortest repeat (see model), and said so
    if (new Set(keys).size < 2)
      W.push(
        "Every thing in the repeating part looks the same, so there is no pattern to see yet. Change the shape or colour of one of them.",
      );
    else {
      const p = period(keys);
      if (p < L)
        W.push(
          `${list(names.slice(0, p))} already repeats inside the part you chose, so the slide shows the repeat as just ${list(names.slice(0, p))}.`,
        );
    }
    if (P.terms < 2 * L)
      W.push(
        `The repeating part has ${L} things, so the slide shows ${2 * L} terms for children to see it happen twice.`,
      );
  } else {
    const pic = P.picture,
      uw = UNIT_WORD[pic],
      { s0, a } = seqOf(P);
    const drawn = P.terms + (P.ask === "missing" ? 0 : 1);
    if (STICKS[pic]) {
      if (fx(P.start) !== s0 || fx(P.step) !== a)
        W.push(
          `One ${pic === "sticks-square" ? "square takes 4 matchsticks, and each square added takes 3 more" : "triangle takes 3 matchsticks, and each triangle added takes 2 more"} because it shares a side, so the picture starts at ${s0} and adds ${a}.`,
        );
      let fit = drawn;
      while (fit > 1 && stickLen(pic, fit) < STICK_MIN) fit--;
      const shape = pic === "sticks-square" ? "squares" : "triangles";
      if (fit < drawn)
        R.push({
          path: "terms",
          reason: `A row of ${drawn} matchstick ${shape} makes each match too small to count from the back of the room. Show ${fit - (P.ask === "missing" ? 0 : 1)} terms or fewer${P.ask === "missing" ? "" : " (the question adds one more picture)"}.`,
        });
    } else {
      if (a === 0)
        R.push({
          path: "step",
          reason:
            "A step of 0 makes every term the same, so nothing grows. Use a step of 1 or more, or a negative step to count back.",
        });
      if (pic === "tiles") {
        if (!isWholeNumber(s0) || s0 < 1)
          R.push({
            path: "start",
            reason: `A picture needs a real count, so the first term must be a whole number of ${uw}, 1 or more. For other numbers, show numbers only.`,
          });
        if (a !== 0 && (!Number.isInteger(a) || a < 1))
          R.push({
            path: "step",
            reason: `Each new term adds real ${uw}, so the step must be a whole number, 1 or more. To count back or use decimals, show numbers only.`,
          });
        if (!R.length) {
          const big = s0 + a * (drawn - 1);
          if (big > 60)
            R.push({
              path: "terms",
              reason: `The biggest picture would have ${big} tiles, too many to count from the back of the room. Show fewer terms, use a smaller step, or show numbers only.`,
            });
          else {
            // the tallest stack must keep tiles big enough to count
            const TW = Math.min(10, Math.max(s0, a)),
              rows = (d) => Math.ceil(s0 / TW) + (d - 1) * Math.ceil(a / TW) + 0.14 * (d - 1);
            // and the whole row must fit across beside the narrowest row-label column (120 + 32)
            const picH = P.ask === "nth" ? 200 : 280,
              Wd = GRID.right - GRID.left - 16 - 152;
            // gaps widen so neighbouring counts (at the label size, ~0.6em a digit) clear each other by 28
            const gapOf = (d) =>
              Math.max(d > 8 ? 32 : 44, String(s0 + a * (d - 1)).length * 18 + 28 - TW * TILE_MIN);
            const u = (d) => Math.min(picH / rows(d), (Wd - gapOf(d) * (d - 1)) / (d * TW));
            let fit = drawn;
            while (fit > 1 && u(fit) < TILE_MIN) fit--;
            if (fit < drawn)
              R.push({
                path: "terms",
                reason: `${drawn} tile pictures are too big to draw with tiles you can count from the back of the room. Show ${fit - (P.ask === "missing" ? 0 : 1)} terms or fewer${P.ask === "missing" ? "" : " (the question adds one more picture)"}, or show numbers only.`,
              });
          }
        }
      } else {
        if (dp(s0) > 2 || dp(a) > 2)
          R.push({
            path: dp(s0) > 2 ? "start" : "step",
            reason:
              "Use at most two decimal places so every term can be read from the back of the room.",
          });
        if (P.terms > 10)
          R.push({
            path: "terms",
            reason: "Number cards need room to read: show 10 terms or fewer.",
          });
        else if (!R.length) {
          // every card must fit across the slide at the smallest legible size
          const vals = Array.from({ length: drawn }, (_, i) => fx(s0 + a * i)),
            cw = cardMinW(vals);
          const fit = Math.floor((GRID.right - GRID.left - 16 + 20) / (cw + 20));
          if (fit < drawn)
            R.push({
              path: "terms",
              reason: `Numbers this long need wide cards, so only ${fit} fit across the slide. Show ${Math.max(1, fit - (P.ask === "missing" ? 0 : 1))} terms or fewer, or use smaller numbers.`,
            });
        }
      }
    }
  }
  const shownT = P.kind === "repeating" ? repTerms(P) : P.terms;
  if (P.ask === "missing" && P.missingAt > shownT)
    R.push({
      path: "missingAt",
      reason: `Only ${shownT} terms are shown, so term ${P.missingAt} can't be the missing one. Pick a term from 1 to ${shownT}.`,
    });
  if (P.ask === "nth" && P.farTerm <= shownT + (P.kind === "linear" ? 1 : 0))
    W.push("The term to work out is already on the slide.");
  return result(R, W);
}

/* ------------------------------------------------------------------ plan */
function model(P) {
  if (P.kind === "repeating") {
    // the repeat drawn is the shortest one (ABAB is drawn as AB; all-alike as a single thing)
    const L = period(P.unit.map(lookKey)),
      T = repTerms(P),
      NI = nameInfo(P.unit);
    const names = NI.names.slice(0, L),
      src = NI.src.slice(0, L);
    const keys = P.unit.slice(0, L).map(lookKey),
      seen = [];
    const letters = keys.map((k) => {
      if (!seen.includes(k)) seen.push(k);
      return "ABCD"[seen.indexOf(k)];
    });
    const n = T + (P.ask === "next" ? 1 : 0);
    const mi = P.ask === "missing" ? P.missingAt - 1 : P.ask === "next" ? T : -1;
    const far = P.farTerm,
      farJ = (far - 1) % L;
    return {
      rep: true,
      same: new Set(keys).size < 2,
      L,
      T,
      names,
      src,
      keys,
      letters,
      code: letters.join(""),
      n,
      mi,
      far,
      farJ,
      at: (i) => i % L,
    };
  }
  const { a, s0 } = seqOf(P),
    b = fx(s0 - a);
  const drawn = P.terms + (P.ask === "missing" ? 0 : 1);
  const vals = Array.from({ length: drawn }, (_, i) => fx(s0 + a * i));
  const mi = P.ask === "missing" ? P.missingAt - 1 : P.terms;
  return {
    rep: false,
    a,
    b,
    s0,
    vals,
    drawn,
    mi,
    far: P.farTerm,
    farV: fx(a * P.farTerm + b),
    uw: UNIT_WORD[P.picture],
  };
}

function plan(P) {
  const M = model(P);
  const steps = [];
  let summary;
  if (M.rep) {
    const seq = Array.from({ length: Math.min(4, M.T) }, (_, i) => M.names[M.at(i)]);
    if (M.same) {
      // every thing looks the same: nothing repeats, so there are no rings or letters to show
      const one = art(M.names[0]);
      steps.push({
        key: "first",
        caption: fitCap(
          `Every one is ${one}: nothing changes, so there is no repeating part yet.`,
          "Every one is the same: nothing changes, so there is no repeating part yet.",
        ),
      });
      if (P.ask === "next")
        steps.push({
          key: "next",
          caption: fitCap(
            `What comes next? Another ${M.names[0]}, because nothing changes.`,
            "What comes next? Another one the same, because nothing changes.",
          ),
        });
      else if (P.ask === "missing")
        steps.push({
          key: "missing",
          caption: fitCap(
            `The missing one is ${one} too: every one is the same.`,
            "The missing one is the same as all the others.",
          ),
        });
      else
        steps.push({
          key: "far",
          caption: fitCap(
            `Every one is the same, so the ${ord(M.far)} is ${one} too.`,
            `Every one is the same, so the ${ord(M.far)} is the same too.`,
          ),
        });
      summary = "Every one is the same. Change the shape or colour of one to make a pattern.";
      return { M, steps, summary };
    }
    steps.push({
      key: "first",
      caption:
        P.ask === "missing"
          ? "Look and say the pattern. One is missing."
          : fitCap(
              `Look and say the pattern: ${list(seq)}…`,
              "Look and say the pattern, one thing at a time.",
            ),
    });
    const code = P.showCode ? `: an ${M.code} pattern` : "";
    steps.push({
      key: "repeat",
      caption: fitCap(
        `The pattern ${list(M.names)} repeats again and again${code}.`,
        `The ringed part repeats again and again${code}.`,
      ),
    });
    if (P.ask === "next")
      steps.push({
        key: "next",
        caption: fitCap(
          `What comes next? After ${art(M.names[M.at(M.n - 2)])} comes ${art(M.names[M.at(M.n - 1)])}.`,
          `What comes next? The next one in the repeat: ${art(M.names[M.at(M.n - 1)])}.`,
        ),
      });
    else if (P.ask === "missing")
      steps.push({
        key: "missing",
        caption: `The missing one is ${art(M.names[M.at(M.mi)])}: the repeat tells us.`,
      });
    else
      steps.push({
        key: "far",
        caption: `Count in repeats of ${M.L}: the ${ord(M.far)} is ${art(M.names[M.farJ])}.`,
      });
    summary = fitCap(
      cap(`${list(M.names)}, then the same again: a pattern that repeats.`),
      "The same part again and again: a pattern that repeats.",
    );
  } else {
    const shown = M.vals.slice(0, P.terms).map((v, i) => (i === M.mi ? "?" : fmtNum(v)));
    const pic = P.picture !== "numbers",
      up = M.a > 0,
      abs = fmtNum(Math.abs(M.a));
    let nS = shown.length;
    const firstCap = (k) =>
      pic
        ? `The first terms have ${list(shown.slice(0, k))}${k < shown.length ? "…" : ""} ${M.uw}.`
        : `The sequence starts ${list(shown.slice(0, k))}…`;
    while (nS > 3 && firstCap(nS).length > 110) nS--;
    steps.push({ key: "first", caption: firstCap(nS) });
    steps.push({
      key: "growth",
      caption: pic
        ? `Each term adds ${abs} ${plural(Math.abs(M.a), M.uw)} to the one before.`
        : `Each term is ${abs} ${up ? "more" : "less"} than the one before.`,
    });
    const mv = fmtNum(M.vals[M.mi]);
    if (P.ask === "missing")
      steps.push({
        key: "missing",
        caption:
          M.mi > 0
            ? `The missing term is ${mv}: ${fmtNum(M.vals[M.mi - 1])} ${up ? "+" : MINUS} ${abs} = ${mv}.`
            : `The missing term is ${mv}: ${fmtNum(M.vals[1])} ${up ? MINUS : "+"} ${abs} = ${mv}.`,
      });
    else
      steps.push({
        key: "next",
        caption: pic ? `So the next term has ${mv} ${M.uw}.` : `So the next term is ${mv}.`,
      });
    if (P.ask === "nth") {
      steps.push({
        key: "words",
        caption: `Link each term to its position: ${ruleWords(M.a, M.b).replace(/^./, (c) => c.toLowerCase())}`,
      });
      steps.push({ key: "formula", caption: `So the nth term is ${formula(M.a, M.b)}.` });
      steps.push({ key: "far", caption: `The ${ord(M.far)} term is ${farSum(M)}.` });
    }
    summary = `Start at ${fmtNum(M.s0)} and ${up ? "add" : "take away"} ${abs} each time${P.ask === "nth" ? `: the nth term is ${formula(M.a, M.b)}` : ""}.`;
  }
  return { M, steps, summary };
}
function farSum(M) {
  const a = M.a === 1 ? "" : `${fmtNum(M.a)} × `;
  return `${a}${M.far}${M.b === 0 ? "" : ` ${M.b > 0 ? "+" : MINUS} ${fmtNum(Math.abs(M.b))}`} = ${fmtNum(M.farV)}`;
}
export function builds(P) {
  const { steps, summary } = plan(P);
  return { steps, summary: { caption: summary } };
}

export function notes(P) {
  const { M, steps } = plan(P);
  const N =
    M.rep && M.same
      ? {
          first:
            "Ask: what do you notice? Every one is the same, so nothing repeats yet. Ask children to change one to make a pattern.",
          next: "Ask: is this a pattern? What could we change to make one?",
          missing: "Ask: how do we know? Every one is the same.",
          far: "Ask: does it matter which term? Every one is the same.",
        }
      : M.rep
        ? {
            first:
              "Read the pattern aloud together, pointing at each one. Clap or move on each item to hear the beat.",
            repeat: `The rings show the part that repeats. Ask: where does it start again? ${P.showCode ? `The letters name the shape of the pattern: ${M.code} means ${M.L} things, ${new Set(M.letters).size} different.` : "Ask children to make the same pattern with cubes."}`,
            next: "Ask for a prediction before you show it, and a reason: “because after … always comes …”.",
            missing: "Ask: which ring is the missing one in, and what is that place in the repeat?",
            far: `Count in whole repeats: ${M.far} = ${Math.floor(M.far / M.L)} × ${M.L}${M.far % M.L ? ` + ${M.far % M.L}` : ""}. ${M.far % M.L ? `So the ${ord(M.far)} is the ${ord(M.far % M.L)} in the repeat.` : `So the ${ord(M.far)} ends a repeat: the last one.`} Check by continuing the pattern.`,
          }
        : {
            first:
              P.picture === "numbers"
                ? "Read the terms aloud. Ask: what do you notice?"
                : `Count the ${M.uw} in each term together. Ask: what stays the same and what changes?`,
            growth:
              P.picture === "numbers"
                ? "The jumps show the term-to-term rule. Check every jump, not just the first."
                : `The coloured part is what was added. Each term keeps everything from the one before and adds ${fmtNum(M.a)} more.`,
            next: "Ask for a prediction first, then check it with the rule.",
            missing:
              "Work forwards from the term before or backwards from the term after. Both must agree.",
            words:
              "The position is the term number. This rule links position to term, so we can find any term without counting on.",
            formula: `n stands for the position. Check it: when n = 1, ${formula(M.a, M.b).replace(/n/, M.a === 1 || M.a === -1 ? "1" : " × 1")} = ${fmtNum(M.vals[0])}.`,
            far: "Ask: how long would counting on take? The rule gets there in one step.",
          };
  return {
    steps: steps.map((s) => N[s.key]),
    summary:
      M.rep && M.same
        ? "Ask children to change one thing to make a repeating pattern, then name its repeat."
        : M.rep
          ? "Ask children to make their own repeating pattern and name its repeat."
          : "Ask: will 100 be in this sequence? How do you know?",
  };
}

/* ------------------------------------------------------------------ drawing parts */
function drawItem(p, it, x, y, size, a = {}) {
  if (OBJ.includes(it.shape)) return countable(p, it.shape, x, y, size * 1.05, a);
  const g = h("g", a, p);
  const inner = h("g", { transform: `translate(${x} ${y}) scale(${size / 60})` }, g);
  const c = `var(${COL_TOK[it.colour] || "--hue-red"})`;
  const st = {
    fill: c,
    stroke: `color-mix(in oklab, ${c} 62%, var(--shade))`,
    "stroke-width": "var(--sw-hair)",
    "stroke-linejoin": "round",
    "vector-effect": "non-scaling-stroke",
    cls: "body",
  };
  const S = {
    circle: () => h("circle", Object.assign({ r: 26 }, st), inner),
    square: () =>
      h("rect", Object.assign({ x: -24, y: -24, width: 48, height: 48, rx: 4 }, st), inner),
    triangle: () => h("polygon", Object.assign({ points: "0,-27 28,23 -28,23" }, st), inner),
    star: () =>
      h(
        "polygon",
        Object.assign(
          {
            points: Array.from({ length: 10 }, (_, i) => {
              const an = -Math.PI / 2 + (i * Math.PI) / 5,
                r = i % 2 ? 12.5 : 29;
              return `${(Math.cos(an) * r).toFixed(1)},${(Math.sin(an) * r + 2).toFixed(1)}`;
            }).join(" "),
          },
          st,
        ),
        inner,
      ),
    heart: () =>
      h(
        "path",
        Object.assign(
          {
            d: "M0 25 C -32 4 -30 -23 -14 -24 C -6 -25 -1 -19 0 -13 C 1 -19 6 -25 14 -24 C 30 -23 32 4 0 25 Z",
          },
          st,
        ),
        inner,
      ),
  };
  (S[it.shape] || S.circle)();
  return g;
}
// a dashed slot with a question mark: the term children work out
function slot(p, x, y, w, hh, a, qPath, qCls = "ts-big") {
  const g = h("g", a, p);
  h(
    "rect",
    {
      x: x - w / 2,
      y: y - hh / 2,
      width: w,
      height: hh,
      rx: "var(--r-mark)",
      fill: "var(--paper)",
      stroke: "var(--ink-2)",
      "stroke-width": "var(--sw-rule)",
      "stroke-dasharray": "8 7",
    },
    g,
  );
  if (qCls)
    computed(
      T(g, x, y, "?", qCls, {
        "text-anchor": "middle",
        "dominant-baseline": "central",
        fill: "var(--ink-2)",
      }),
      qPath,
    );
  return g;
}
// centre everything drawn into g in the content area (all builds together), below the title
function centre(g, top = GRID.top) {
  try {
    const bb = g.getBBox();
    if (!bb || !bb.height) return;
    let off = (top + GRID.bottom) / 2 - (bb.y + bb.height / 2);
    off = Math.min(off, GRID.bottom - (bb.y + bb.height));
    off = Math.max(off, top + 10 - bb.y);
    g.setAttribute("transform", `translate(0 ${off.toFixed(1)})`);
  } catch (e) {
    /* no layout engine: leave in place */
  }
}

// The biggest of `classes` at which every string wraps on whole words into at most `lines` lines of
// width w. A word is never broken across lines, and every string in a row shares the one size.
const words = (s) => String(s).split(/\s+/).filter(Boolean);
function wholeWordCls(p, strs, classes, w, lines) {
  return (
    classes.find((c) =>
      strs.every(
        (s) => words(s).every((wd) => measure(p, wd, c) <= w) && wrap(p, s, c, w).length <= lines,
      ),
    ) || null
  );
}

/* ------------------------------------------------------------------ title */
// The slide title, drawn here rather than by the engine so a two-line title keeps the same top margin
// as a one-line one: its first line sits on the usual baseline and the second line below it, and the
// figure moves down to make room. Sizes follow the engine: one line at the title size, then one step
// smaller, then two lines shrinking towards the smallest size; only a title that cannot fit two lines
// at the smallest size has its end cut, with a warning. Returns the top of the content area.
function drawTitle(root, s, ctx) {
  if (!s) return GRID.top;
  const maxW = GRID.right - GRID.left;
  const t = T(root, GRID.left, GRID.titleY, s, "ts-title");
  t.dataset.edit = "title";
  if (t.getComputedTextLength() <= maxW) return GRID.top;
  let tok = (n) => NaN;
  try {
    const cs = getComputedStyle(ctx.slide);
    tok = (n) => parseFloat(cs.getPropertyValue(n));
  } catch (e) {
    /* no styles */
  }
  const fs = tok("--fs-title") || 46,
    min = tok("--fs-min") || 22,
    one = Math.round(fs * 0.87);
  t.style.fontSize = one + "px";
  if (t.getComputedTextLength() <= maxW) return GRID.top;
  let size = Math.min(34, Math.round(fs * 0.74)),
    L;
  for (; ; size -= 2) {
    if (size < min) size = min;
    L = wrap(root, s, "ts-title", maxW, { style: `font-size:${size}px` });
    if (L.length <= 2 || size === min) break;
  }
  if (L.length > 2) {
    const a = { style: `font-size:${size}px` };
    let last = L.slice(1).join(" ");
    const fits = (x) => measure(root, x + "…", "ts-title", a) <= maxW;
    while (last.includes(" ") && !fits(last)) last = last.replace(/\s*\S*$/, "");
    while (last.length > 1 && !fits(last)) last = last.slice(0, -1);
    L = [L[0], last.trimEnd() + "…"];
    ctx.warn(
      `The title is too long for two lines (${s.length} letters); its end is cut. Shorten it.`,
    );
  }
  const lh = Math.round(size * 1.14);
  t.textContent = "";
  t.style.fontSize = size + "px";
  t.setAttribute("y", GRID.titleY);
  L.forEach((x, i) => h("tspan", { x: GRID.left, dy: i ? lh : 0, text: x }, t));
  return L.length > 1 ? GRID.top + lh : GRID.top;
}

/* ------------------------------------------------------------------ render */
export function render(root, P, ctx) {
  const { M } = plan(P);
  // what the slide changed from the settings (a name made to match the picture, matchstick counts
  // fixed by the shapes, a repeat drawn shorter) is said beside the slide, not just in validate()
  for (const w of validate(P).warnings) ctx.warn(w);
  const top = drawTitle(root, P.title, ctx);
  (M.rep ? renderRepeating : renderLinear)(root, P, ctx, M, top);
  return { noTitle: true };
}

function renderRepeating(root0, P, ctx, M, top) {
  const b = ctx.b,
    kF = b.first,
    kR = b.repeat,
    kA = b.next ?? b.missing ?? b.far;
  const far = P.ask === "nth";
  const root = h("g", {}, root0);
  const x0 = GRID.left + 8,
    x1 = GRID.right - 8,
    n = M.n;
  const size = Math.min(120, (x1 - x0) / (n + (n - 1) * 0.36)),
    gap = size * 0.36;
  const y = 320;
  const rowW = n * size + (n - 1) * gap,
    left = (x0 + x1) / 2 - rowW / 2;
  const X = (i) => left + size / 2 + i * (size + gap);
  // the hook: shapes threaded like beads on a string (objects sit on a shelf instead)
  const gBack = h("g", {}, root);
  if (P.unit.some((u) => OBJ.includes(u.shape))) {
    h(
      "rect",
      {
        x: X(0) - size * 0.7,
        y: y + size * 0.52,
        width: X(n - 1) - X(0) + size * 1.4,
        height: Math.max(10, size * 0.14),
        rx: "var(--r-mark)",
        fill: "var(--wood-line)",
        s: kF,
        cls: "rise",
      },
      gBack,
    );
  } else {
    const ax = X(0) - size * 0.75,
      bx = X(n - 1) + size * 0.75;
    h(
      "path",
      {
        d: `M${ax} ${y} L${bx} ${y}`,
        fill: "none",
        stroke: "var(--trunk)",
        "stroke-width": "var(--sw-struct)",
        "stroke-linecap": "round",
        s: kF,
        cls: "draw",
        pathLength: 1,
      },
      gBack,
    );
    for (const cx of [ax, bx])
      h(
        "circle",
        { cx, cy: y, r: Math.max(6, size * 0.07), fill: "var(--trunk)", s: kF, cls: "pop" },
        gBack,
      );
  }
  const gHiR = h("g", {}, root),
    gRow = h("g", {}, root),
    gMarks = h("g", {}, root);
  const qPath = P.ask === "missing" ? "missingAt" : "ask";
  // the far term: point at its place in every repeat (the row stays at full colour)
  // (its box stays inside the ring round the repeat, its corners rounded to match the ring's)
  const rPad = Math.max(6, gap / 2 - 4),
    hiP = Math.max(0, Math.min(6, rPad - 8)),
    hiR = Math.max(4, Math.min(28, size / 2 + rPad) - (rPad - hiP));
  if (far)
    for (let i = 0; i < n; i++)
      if (M.at(i) === M.farJ)
        h(
          "rect",
          {
            x: X(i) - size / 2 - hiP,
            y: y - size / 2 - hiP,
            width: size + 2 * hiP,
            height: size + 2 * hiP,
            rx: hiR,
            fill: "var(--focus-pale)",
            stroke: "var(--focus)",
            "stroke-width": "var(--sw-rule)",
            s: kA,
            cls: "pop",
            delay: i * 60,
          },
          gHiR,
        );
  for (let i = 0; i < n; i++) {
    const it = P.unit[M.at(i)];
    if (i === M.mi) {
      slot(
        gRow,
        X(i),
        y,
        size + 8,
        size + 8,
        { s: kF, hide: kA, cls: "pop", delay: i * 90 },
        qPath,
      );
      const ans = h("g", { s: kA, cls: "pop" }, gRow);
      h(
        "rect",
        {
          x: X(i) - size / 2 - 4,
          y: y - size / 2 - 4,
          width: size + 8,
          height: size + 8,
          rx: "var(--r-mark)",
          fill: "var(--focus-pale)",
        },
        ans,
      );
      drawItem(ans, it, X(i), y, size);
    } else drawItem(gRow, it, X(i), y, size, { s: kF, cls: "pop", delay: i * 90 });
  }
  // rings round each complete repeat in the shown terms
  const cyc = M.same ? 0 : Math.floor(M.T / M.L),
    pad = Math.max(6, gap / 2 - 4);
  for (let c = 0; c < cyc; c++) {
    const a = X(c * M.L) - size / 2,
      z = X(c * M.L + M.L - 1) + size / 2;
    groupRing(
      gMarks,
      { x: a, y: y - size / 2, w: z - a, h: size },
      { pad, s: kR, col: "var(--focus)", a: { delay: c * 140, c: ctx.rc("repeat") } },
    );
  }
  // letter code above every term (the answer's letter arrives with the answer)
  if (P.showCode && !M.same)
    for (let i = 0; i < n; i++) {
      computed(
        T(gMarks, X(i), y - size / 2 - pad - 18, M.letters[M.at(i)], "ts-label", {
          "text-anchor": "middle",
          fill: "var(--focus-text)",
          s: i === M.mi ? kA : kR,
          cls: "rise",
          delay: i === M.mi ? 0 : 300 + i * 40,
        }),
        "unit",
      );
    }
  // names under the first complete repeat that has no gap in it; with a letter code the letters take over
  let c0 = 0;
  while (c0 < cyc - 1 && M.mi >= c0 * M.L && M.mi < (c0 + 1) * M.L) c0++;
  // Fit: every name sits in its own column (one shape plus the gap, less the 28-unit lane gap), all at
  // one size, wrapping on whole words to 2 lines. A word is never broken: if any name will not fit its
  // column, all names move to a key below the row (one small picture and its name per look), across
  // the full width, then two to a row, then one to a row, again at one size for every name.
  let nameBot = y + size / 2 + pad;
  const ny = y + size / 2 + pad + 40,
    nameA = { fill: "var(--ink-2)", s: kF, cls: "rise", delay: 300 };
  // with the letter code on, the names stay on every build: under their letters, or in a key that gives each letter
  const code = P.showCode && !M.same;
  const colW = size + gap - 28;
  const inCol = wholeWordCls(gMarks, M.names, ["ts-label", "ts-tiny"], colW, 2);
  if (inCol) {
    for (let j = 0; j < M.L; j++) {
      const tb = textBlock(gMarks, X(c0 * M.L + j), ny, M.names[j], {
        cls: inCol,
        maxW: colW,
        maxLines: 2,
        lh: 34,
        anchor: "middle",
        a: nameA,
        edit: `unit.${M.src[j]}.name`,
      });
      nameBot = Math.max(nameBot, ny + (tb.lines.length - 1) * tb.lh + 10);
    }
  } else {
    const looks = [];
    M.keys.forEach((k, j) => {
      if (!looks.some((q) => M.keys[q] === k)) looks.push(j);
    });
    const K = looks.length,
      lw0 = code
        ? Math.max(...looks.map((j) => measure(gMarks, M.letters[j], "ts-label"))) + 14
        : 0,
      ic = 44,
      icGap = 14,
      lh = 34;
    let per = K,
      kc = null,
      tw = 0;
    for (const n of [...new Set([K, Math.min(K, 2), 1])]) {
      per = n;
      tw = (x1 - x0) / n - lw0 - ic - icGap - 28;
      kc = wholeWordCls(
        gMarks,
        looks.map((j) => M.names[j]),
        ["ts-label", "ts-tiny"],
        tw,
        n === K ? 3 : 2,
      );
      if (kc) break;
    }
    kc = kc || "ts-tiny";
    const cellW = (x1 - x0) / per,
      Ls = looks.map((j) => wrap(gMarks, M.names[j], kc, tw).length);
    let rowY = ny;
    for (let r = 0; r * per < K; r++) {
      const row = looks.slice(r * per, r * per + per),
        rowLines = Math.max(...Ls.slice(r * per, r * per + per));
      row.forEach((j, q) => {
        const g = h("g", nameA, gMarks),
          cell = h("g", {}, g);
        if (code)
          computed(
            T(cell, 0, 10, M.letters[j], "ts-label", {
              fill: "var(--focus-text)",
              s: kR,
              cls: "rise",
            }),
            "unit",
          );
        const tb = textBlock(cell, lw0 + ic + icGap, 10, M.names[j], {
          cls: kc,
          maxW: tw,
          maxLines: 3,
          lh,
          a: {},
          edit: `unit.${M.src[j]}.name`,
        });
        drawItem(cell, P.unit[j], lw0 + ic / 2, 0, ic);
        const w = lw0 + ic + icGap + tb.w,
          cx = x0 + cellW * (q + 0.5 + (per - row.length) / 2);
        cell.setAttribute("transform", `translate(${(cx - w / 2).toFixed(1)} ${rowY - 10})`);
      });
      const bot = rowY + Math.max(ic / 2, (rowLines - 1) * lh + 10);
      nameBot = Math.max(nameBot, bot);
      rowY = bot + 40;
    }
  }
  // the far term: "The 20th is" [item] name, and the working in repeats
  if (far) {
    const fy = Math.max(y + 190, nameBot + 80),
      it = P.unit[M.farJ],
      fs = 84;
    const g = h("g", { s: kA, cls: "rise" }, gMarks);
    const lead = `The ${ord(M.far)} is`;
    // the name wraps then shrinks in its own box, and the line is centred on what was drawn
    const gN = h("g", {}, g);
    // the name may use whatever width the lead and picture leave, at a size that keeps its words whole
    const lw = measure(g, lead, "ts-num"),
      nMax = Math.min(480, x1 - x0 - lw - 48 - fs);
    const nCls =
      wholeWordCls(g, [M.names[M.farJ]], ["ts-num", "ts-h3", "ts-label", "ts-tiny"], nMax, 2) ||
      "ts-tiny";
    const nb = textBlock(gN, 0, fy + 14, M.names[M.farJ], {
      cls: nCls,
      maxW: nMax,
      maxLines: 2,
      lh: nCls === "ts-num" ? 46 : 36,
      a: { fill: "var(--focus-text)" },
      edit: `unit.${M.src[M.farJ]}.name`,
    });
    if (nb.lines.length > 1) nb.el.setAttribute("y", fy + 8 - ((nb.lines.length - 1) * nb.lh) / 2);
    const nw = nb.w;
    const tot = lw + 24 + fs + 24 + nw,
      fx0 = 640 - tot / 2;
    gN.setAttribute("transform", `translate(${(fx0 + lw + 24 + fs + 24).toFixed(1)} 0)`);
    computed(T(g, fx0, fy + 14, lead, "ts-num", { fill: "var(--ink)" }), "farTerm");
    h(
      "rect",
      {
        x: fx0 + lw + 24 - 6,
        y: fy - fs / 2 - 6,
        width: fs + 12,
        height: fs + 12,
        rx: "var(--r-mark)",
        fill: "var(--focus-pale)",
        stroke: "var(--focus)",
        "stroke-width": "var(--sw-rule)",
      },
      g,
    );
    drawItem(g, it, fx0 + lw + 24 + fs / 2, fy, fs);
    const q = Math.floor(M.far / M.L),
      r = M.far % M.L;
    const work = r
      ? `${M.far} = ${q} repeats of ${M.L}, and ${r} more: the ${ord(r)} in the repeat`
      : `${M.far} = ${q} repeats of ${M.L}: the last in the repeat`;
    if (!M.same)
      computed(
        T(g, 640, fy + 86, work, "ts-label", {
          "text-anchor": "middle",
          fill: "var(--ink-2)",
          delay: 400,
        }),
        "farTerm",
      );
  }
  centre(root, top);
  return {};
}

function renderLinear(root0, P, ctx, M, top) {
  const b = ctx.b,
    kF = b.first,
    kG = b.growth,
    kA = b.next ?? b.missing,
    kW = b.words,
    kFo = b.formula,
    kFar = b.far;
  const nth = P.ask === "nth",
    pic = P.picture,
    isPic = pic !== "numbers";
  const root = h("g", {}, root0);
  const D = M.drawn,
    mi = M.mi;
  let valCls = isPic && D <= 6 ? "ts-big" : "ts-num";
  // rows (nominal; the whole figure is centred at the end)
  const picH = nth ? 200 : 280,
    picBase = 120 + picH,
    cardH = 92;
  const cardC = picBase - cardH / 2;
  const posY = isPic ? picBase + 50 : cardC - cardH / 2 - 30;
  const valY = isPic ? picBase + (nth ? 116 : 70) : cardC + 14;
  const jTop = isPic ? valY + 18 : cardC + cardH / 2 + 10;
  // the rule replaces the jumps (which leave when it arrives), then the formula, then the far term below it
  const ruleY = jTop + 60,
    formY = ruleY + 80,
    farY = formY + 72;
  // row labels on the left
  const gL = h("g", {}, root);
  const countLab = txt(
    P,
    "label:countRow",
    isPic ? (pic === "tiles" ? "Tiles" : "Matchsticks") : "Term",
  );
  const posLab = txt(P, "label:posRow", "Position");
  // a row of tiles may narrow the label column (to 120 at least) so its tiles stay countable
  const tilesW =
    pic === "tiles"
      ? Math.min(10, Math.max(M.s0, M.a)) * TILE_MIN * M.drawn +
        (M.drawn > 8 ? 32 : 44) * (M.drawn - 1)
      : 0;
  const labCap = Math.max(120, Math.min(240, GRID.right - GRID.left - 16 - 32 - tilesW));
  const showCount = isPic || nth,
    labW = showCount
      ? Math.min(
          labCap,
          Math.max(measure(gL, countLab, "ts-h3"), nth ? measure(gL, posLab, "ts-label") : 0),
        )
      : 0;
  const x0 = GRID.left + (labW ? labW + 32 : 8),
    x1 = GRID.right - 8;
  // tiles: each added group is a row of tiles stacked on the last, so every term has the same width
  const TW = Math.min(10, Math.max(M.s0, M.a)),
    rowsOf = (v) => Math.ceil(v / TW);
  const blocks = (i) => [M.s0, ...Array(i).fill(M.a)];
  const tileRows = (i) => blocks(i).reduce((s, v) => s + rowsOf(v), 0),
    BG = 0.14;
  let unitW,
    cardW = 0,
    cardCls = "ts-num";
  const wU = (i) =>
    pic === "tiles"
      ? TW
      : pic === "sticks-square"
        ? i + 1
        : pic === "sticks-triangle"
          ? (i + 2) / 2
          : 0;
  let G = D > 8 ? 32 : pic === "tiles" || !isPic ? 44 : 30;
  if (isPic) {
    const sumU = Array.from({ length: D }, (_, i) => wU(i)).reduce((s, v) => s + v, 0);
    const uMax =
      pic === "tiles" ? Math.min(64, picH / (tileRows(D - 1) + BG * (D - 1))) : Math.min(130, picH);
    unitW = Math.min(uMax, (x1 - x0 - G * (D - 1)) / sumU);
    // the counts under the pictures: the biggest size whose row fits, then widen the gaps
    // until neighbouring counts clear each other by 28 (validate keeps the tiles countable)
    let valW = 0;
    for (const c of D <= 6 ? ["ts-big", "ts-num", "ts-label"] : ["ts-num", "ts-label"]) {
      valCls = c;
      valW = Math.max(...M.vals.map((v) => measure(gL, fmtNum(v), c)));
      if (D * (valW + 28) - 28 <= x1 - x0) break;
    }
    for (let it = 0; it < 4; it++) {
      const need = Math.max(
        0,
        ...Array.from({ length: D - 1 }, (_, i) => valW + 28 - ((wU(i) + wU(i + 1)) / 2) * unitW),
      );
      if (need <= G) break;
      G = need;
      unitW = Math.min(uMax, (x1 - x0 - G * (D - 1)) / sumU);
    }
    if (unitW < (pic === "tiles" ? TILE_MIN : STICK_MIN) - 0.5)
      ctx.warn("The pictures are very small: show fewer terms.");
  } else {
    for (const c of ["ts-num", "ts-label", "ts-tiny"]) {
      cardCls = c;
      cardW = Math.max(
        c === "ts-num" ? 104 : 0,
        ...M.vals.map((v) => measure(gL, fmtNum(v), c) + (c === "ts-num" ? 40 : 32)),
      );
      if (D * cardW + 20 * (D - 1) <= x1 - x0) break;
    }
  }
  const wPx = (i) => (isPic ? wU(i) * unitW : cardW);
  const hgtT = (i) =>
    pic === "tiles"
      ? (tileRows(i) + BG * i) * unitW
      : pic === "sticks-square"
        ? unitW
        : unitW * 0.866;
  const Gp = isPic ? G : Math.max(0, Math.min(48, (x1 - x0 - D * cardW) / Math.max(1, D - 1)));
  const total =
    Array.from({ length: D }, (_, i) => wPx(i)).reduce((s, v) => s + v, 0) + Gp * (D - 1);
  const xs = [];
  {
    let x = (x0 + x1) / 2 - total / 2;
    for (let i = 0; i < D; i++) {
      xs.push(x + wPx(i) / 2);
      x += wPx(i) + Gp;
    }
  }

  const gPic = h("g", {}, root),
    gHi = h("g", {}, root);
  const gVal = h("g", {}, root),
    gJ = h("g", { c: ctx.rc(kA + 1), hide: nth ? kW : null }, root),
    gR = h("g", {}, root);
  const valPath = (i) => (i === 0 ? "start" : "step");
  const qPath = P.ask === "missing" ? "missingAt" : "ask";

  /* ---- one term's picture into g, with its newest part highlighted into hi ---- */
  function tiles(g, hi, i, cx, sHi) {
    const u = unitW,
      bs = blocks(i),
      xl = cx - wPx(i) / 2;
    let yb = picBase;
    bs.forEach((v, bi) => {
      const last = bi === bs.length - 1 && i > 0;
      const tg = last ? h("g", { s: sHi, cls: "rise" }, hi) : null;
      for (let t = 0; t < v; t++) {
        const tx = xl + (t % TW) * u,
          ty = yb - (Math.floor(t / TW) + 1) * u;
        const a = {
          x: tx + 1.5,
          y: ty + 1.5,
          width: u - 3,
          height: u - 3,
          rx: "var(--r-mark)",
          "stroke-width": "var(--sw-hair)",
          cls: "body",
        };
        h("rect", Object.assign({ fill: "var(--counter)", stroke: "var(--counter-edge)" }, a), g);
        if (tg)
          h(
            "rect",
            Object.assign(
              {
                fill: "var(--focus)",
                stroke: "color-mix(in oklab, var(--focus) 62%, var(--shade))",
              },
              a,
            ),
            tg,
          );
      }
      yb -= (rowsOf(v) + BG) * u;
    });
  }
  // a matchstick: a rounded wooden body with a small red head at one end
  const thick = Math.max(7, Math.min(12, (unitW || 0) * 0.1));
  function stick(g, ax, ay, bx, by, col) {
    const L = Math.hypot(bx - ax, by - ay),
      deg = (Math.atan2(by - ay, bx - ax) * 180) / Math.PI;
    const s = h(
      "g",
      {
        transform: `translate(${((ax + bx) / 2).toFixed(1)} ${((ay + by) / 2).toFixed(1)}) rotate(${deg.toFixed(1)})`,
      },
      g,
    );
    h(
      "rect",
      { x: -L / 2, y: -thick / 2, width: L, height: thick, rx: thick / 2, fill: col, cls: "body" },
      s,
    );
    h(
      "ellipse",
      {
        cx: L / 2 - thick * 0.55,
        cy: 0,
        rx: thick * 1.05,
        ry: thick * 0.82,
        fill: "var(--hue-red)",
      },
      s,
    );
  }
  function sticks(g, hi, i, cx, sHi) {
    const Lu = unitW,
      n = i + 1,
      inset = thick * 0.9;
    const segs = []; // [ax, ay, bx, by, termAdded]
    if (pic === "sticks-square") {
      const x = cx - (n * Lu) / 2,
        top = picBase - Lu;
      for (let k = 0; k <= n; k++)
        segs.push([x + k * Lu, picBase - inset, x + k * Lu, top + inset, Math.max(1, k)]);
      for (let k = 0; k < n; k++) {
        segs.push([x + k * Lu + inset, top, x + (k + 1) * Lu - inset, top, k + 1]);
        segs.push([x + k * Lu + inset, picBase, x + (k + 1) * Lu - inset, picBase, k + 1]);
      }
    } else {
      const hh = Lu * 0.866,
        x = cx - ((n + 1) * Lu) / 4,
        top = picBase - hh;
      const B = (j) => [x + j * Lu, picBase],
        Tp = (j) => [x + Lu / 2 + j * Lu, top];
      const sh = (p, q, k) => {
        const L = Math.hypot(q[0] - p[0], q[1] - p[1]),
          ux = ((q[0] - p[0]) / L) * inset,
          uy = ((q[1] - p[1]) / L) * inset;
        segs.push([p[0] + ux, p[1] + uy, q[0] - ux, q[1] - uy, k]);
      };
      for (let k = 1; k <= n; k++) {
        if (k % 2) {
          const j = (k - 1) / 2;
          if (k === 1) sh(B(0), Tp(0), 1);
          sh(B(j), B(j + 1), k);
          sh(B(j + 1), Tp(j), k);
        } else {
          const j = k / 2 - 1;
          sh(Tp(j), Tp(j + 1), k);
          sh(Tp(j + 1), B(j + 1), k);
        }
      }
    }
    // the sticks added by the last shape are drawn in the highlight colour at the growth build
    const tg = i > 0 ? h("g", { s: sHi, cls: "rise" }, hi) : null;
    for (const [ax, ay, bx, by, k] of segs) {
      stick(g, ax, ay, bx, by, "color-mix(in oklab, var(--hue-gold) 45%, var(--trunk))");
      if (tg && k === n) stick(tg, ax, ay, bx, by, "var(--focus)");
    }
  }

  for (let i = 0; i < D; i++) {
    const cx = xs[i],
      isQ = i === mi,
      sQ = isQ ? kA : kF;
    if (isPic) {
      // the unknown term's box is its own footprint (tiles) or one shape's footprint (matchsticks)
      if (isQ) {
        const sw = pic === "tiles" ? wPx(i) : unitW,
          sh = pic === "tiles" ? hgtT(i) : hgtT(0);
        // a narrow box (a one-tile column) is too thin for its own question mark: the count row asks
        const qc = Math.min(sw, sh) >= 64 ? "ts-big" : Math.min(sw, sh) >= 40 ? "ts-label" : null;
        slot(
          gPic,
          cx,
          picBase - sh / 2,
          sw,
          sh,
          { s: kF, hide: kA, cls: "pop", delay: i * 120 },
          qPath,
          qc,
        );
        // the picture's dashed box already asks; its count is a plain question mark, not a second box
        computed(
          T(gVal, cx, valY, "?", valCls, {
            "text-anchor": "middle",
            fill: "var(--ink-2)",
            s: kF,
            hide: kA,
            cls: "pop",
            delay: i * 120,
          }),
          qPath,
        );
      }
      const g = h("g", { s: sQ, cls: "pop", delay: isQ ? 0 : i * 120 }, gPic);
      (pic === "tiles" ? tiles : sticks)(g, gHi, i, cx, Math.max(kG, sQ));
      computed(
        T(gVal, cx, valY, fmtNum(M.vals[i]), valCls, {
          "text-anchor": "middle",
          fill: isQ ? "var(--focus-text)" : "var(--ink)",
          s: sQ,
          cls: "rise",
          delay: isQ ? 300 : i * 120 + 200,
        }),
        valPath(i),
      );
    } else {
      if (isQ)
        slot(gPic, cx, cardC, cardW, cardH, { s: kF, hide: kA, cls: "pop", delay: i * 120 }, qPath);
      const g = h("g", { s: sQ, cls: "pop", delay: isQ ? 0 : i * 120 }, gPic);
      h(
        "rect",
        {
          x: cx - cardW / 2,
          y: cardC - cardH / 2,
          width: cardW,
          height: cardH,
          rx: "var(--r-mark)",
          fill: isQ ? "var(--focus-pale)" : "var(--paper)",
          stroke: isQ ? "var(--focus)" : "var(--ink-3)",
          "stroke-width": "var(--sw-rule)",
          cls: "body",
        },
        g,
      );
      computed(
        T(
          g,
          cx,
          cardC + (cardCls === "ts-num" ? 14 : cardCls === "ts-label" ? 10 : 8),
          fmtNum(M.vals[i]),
          cardCls,
          { "text-anchor": "middle", fill: isQ ? "var(--focus-text)" : "var(--ink)" },
        ),
        valPath(i),
      );
    }
  }
  // the value row must not crowd
  if (isPic) {
    const lane = [];
    M.vals.forEach((v, i) => {
      if (!lanePlace(lane, measure(gVal, fmtNum(v), valCls), xs[i], { shift: 0, gap: 28 }))
        ctx.warn("The counts are too close together: show fewer terms.");
    });
  }

  // jumps: +step between neighbouring terms (the jump into the next slot comes with the answer)
  const jl = [];
  const jLab = `${M.a > 0 ? "+" : MINUS}${fmtNum(Math.abs(M.a))}`;
  const pitch = D > 1 ? Math.min(...xs.slice(1).map((x, i) => x - xs[i])) : 1e9;
  let jCls = "ts-num",
    jw = 0,
    stride = 1;
  for (const c of ["ts-num", "ts-label", "ts-tiny"]) {
    jCls = c;
    jw = measure(gL, jLab, c);
    if (jw + 20 <= pitch) break;
  }
  while (jw + 20 > stride * pitch && stride < D) stride++;
  for (let i = 0; i < D - 1; i++) {
    const xa = xs[i] + 6,
      xb = xs[i + 1] - 6,
      depth = 34;
    const s = P.ask !== "missing" && i + 1 === mi ? kA : kG;
    const g = h("g", { s, delay: s === kG ? i * 150 : 300 }, gJ);
    const d = `M${xa} ${jTop} C ${xa} ${jTop + depth * 1.3}, ${xb} ${jTop + depth * 1.3}, ${xb} ${jTop}`;
    h(
      "path",
      {
        d,
        fill: "none",
        stroke: "var(--focus)",
        "stroke-width": "var(--sw-arrow)",
        "stroke-linecap": "round",
        cls: "draw",
        pathLength: 1,
      },
      g,
    );
    h("path", { d: headD(xb, jTop, -Math.PI / 2, 14), fill: "var(--focus)" }, g);
    if (i % stride) continue;
    if (!lanePlace(jl, jw, (xa + xb) / 2, { shift: 0, gap: 20 })) continue;
    computed(
      T(g, (xa + xb) / 2, jTop + depth + 46, jLab, `${jCls} halo`, {
        "text-anchor": "middle",
        fill: "var(--focus-text)",
      }),
      "step",
    );
  }

  // row labels
  if (showCount) {
    const tb = textBlock(gL, GRID.left, valY, countLab, {
      cls: wholeWordCls(gL, [countLab], ["ts-h3", "ts-tiny"], labW, 4) || "ts-h3",
      maxW: labW,
      maxLines: 4,
      lh: 36,
      a: { fill: "var(--ink-2)", s: isPic ? kF : kW, cls: "rise" },
      edit: "text.label:countRow",
    });
    if (tb.lines.length > 1)
      tb.el.setAttribute("y", valY - 13 - (nth ? 0 : ((tb.lines.length - 2) * tb.lh) / 2));
  }
  if (nth) {
    const tb = textBlock(gL, GRID.left, posY, posLab, {
      cls: wholeWordCls(gL, [posLab], ["ts-label", "ts-tiny"], labW, 4) || "ts-label",
      maxW: labW,
      maxLines: 4,
      lh: 34,
      a: { fill: "var(--ink-2)", s: kW, cls: "rise" },
      edit: "text.label:posRow",
    });
    tb.el.setAttribute("y", posY - (tb.lines.length - 1) * tb.lh);
    for (let i = 0; i < D; i++)
      computed(
        T(gR, xs[i], posY, String(i + 1), "ts-label", {
          "text-anchor": "middle",
          fill: "var(--ink-2)",
          s: kW,
          cls: "rise",
          delay: i * 80,
        }),
        "terms",
      );
    // the rule in words, then as a formula, then a far term below it
    const rw = textBlock(gR, x0, ruleY, ruleWords(M.a, M.b), {
      cls: "ts-h3",
      maxW: x1 - x0,
      maxLines: 1,
      a: { fill: "var(--ink)", s: kW, cls: "rise", delay: 300 },
    });
    computed(rw.el, "step");
    const nLab = txt(P, "label:nth", "nth term =");
    const g = h("g", { s: kFo, cls: "rise" }, gR);
    const fstr = formula(M.a, M.b),
      fw = measure(g, fstr, "ts-big");
    // the lead takes the width the formula leaves: one line at the row-label size if it fits, else two
    // lines on whole words, balanced so the second line is not a lone word; smaller only if it must be
    const nAvail = Math.max(160, x1 - x0 - fw - 32 - 8 - 24);
    let nCls = wholeWordCls(g, [nLab], ["ts-h3", "ts-label"], nAvail, 1),
      nW = nAvail,
      nLines = 1;
    if (!nCls) {
      nLines = 2;
      nCls = wholeWordCls(g, [nLab], ["ts-h3", "ts-label", "ts-tiny"], nAvail, 2) || "ts-tiny";
      const longest = Math.max(...words(nLab).map((wd) => measure(g, wd, nCls)));
      for (let w = nAvail; w - 8 >= longest && wrap(g, nLab, nCls, w - 8).length <= 2; w -= 8)
        nW = w - 8;
    }
    const nb = textBlock(g, x0, formY, nLab, {
      cls: nCls,
      maxW: nW,
      maxLines: nLines,
      lh: nCls === "ts-h3" ? 36 : 32,
      a: { fill: "var(--ink-2)" },
      edit: "text.label:nth",
    });
    if (nb.lines.length > 1)
      nb.el.setAttribute("y", formY - 6 - ((nb.lines.length - 1) * nb.lh) / 2);
    const lw = nb.w;
    h(
      "rect",
      {
        x: x0 + lw + 8,
        y: formY - 46,
        width: fw + 32,
        height: 64,
        rx: "var(--r-mark)",
        fill: "var(--focus-pale)",
      },
      g,
    );
    computed(T(g, x0 + lw + 24, formY + 6, fstr, "ts-big", { fill: "var(--focus-text)" }), "step");
    const farS = `${ord(M.far)} term = ${farSum(M)}`;
    const ft = textBlock(gR, x0, farY, farS, {
      cls: "ts-h3",
      maxW: x1 - x0,
      maxLines: 2,
      lh: 30,
      a: { fill: "var(--ink)", s: kFar, cls: "rise" },
    });
    computed(ft.el, "farTerm");
  }
  centre(root, top);
  return {};
}
