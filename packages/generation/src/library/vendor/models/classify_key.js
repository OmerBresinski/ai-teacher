// Grouping and branching keys: up to 12 living things sorted into groups by what their bodies
// are like, or up to 8 named with a yes/no branching key. Builds: everything waiting in a row ->
// each question splits one group in two (or each group fills) -> every thing ends at its name.
// The things are cards that travel: they wait where the next question will be asked, and drop
// down the Yes or No side when it is. Known animals in the wrong group, or sent down the wrong
// side of a question we can read (feathers, fur, legs, six legs, wings, shell, backbone...), are
// refused in teacher words. Anything we do not know is the teacher's call.
import {
  clamp,
  computed,
  editable,
  eIO,
  GRID,
  h,
  measure,
  result,
  schemaCheck,
  T,
  TEXT_PARAM,
  TITLE_PARAM,
  textBlock,
  txt,
  withDefaults,
  wrap,
} from "../kit/index.js";
import {
  answer,
  CLASS_WORD,
  classOfGroup,
  factOf,
  groupFits,
  negClassOfGroup,
  notYesNo,
  pictureFor,
  traitOfQuestion,
} from "./classify_key/facts.js";
import {
  drawPictureFit,
  PICTURE_LABEL,
  PICTURES,
  pictureArea,
  pictureSize,
} from "./classify_key/pictures.js";

export const meta = {
  id: "classify_key",
  name: "Grouping and branching keys",
  kind: "info",
  version: 1,
  subjects: ["Science"],
  years: ["Y1", "Y2", "Y3", "Y4", "Y5", "Y6"],
  teaches:
    "Sorting living things into groups by what their bodies are like, and naming each one with a yes/no branching key.",
};

const PIC = {
  type: "string",
  title: "Picture",
  enum: ["auto", "none", ...PICTURES],
  "x-labels": ["Match the name", "No picture", ...PICTURES.map(PICTURE_LABEL)],
  default: "auto",
};
export const params = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  title: "Grouping and branching keys",
  properties: {
    title: TITLE_PARAM("A key for minibeasts"),
    mode: {
      type: "string",
      title: "Show it as",
      enum: ["key", "groups"],
      "x-labels": ["A branching key (yes/no questions)", "Sorting into groups"],
      default: "key",
    },
    things: {
      type: "string",
      title: "What you are sorting",
      description:
        "One word for the whole set, like “animals”, “minibeasts” or “plants”. It is used in the captions.",
      default: "minibeasts",
      minLength: 1,
      maxLength: 20,
      "x-panel": "advanced",
    },
    items: {
      type: "array",
      title: "Things to sort",
      "x-item": "a thing",
      minItems: 2,
      maxItems: 12,
      description: "A key fits up to 8 things; sorting into groups fits up to 12.",
      default: [
        { name: "Spider", picture: "auto", group: "Not insects" },
        { name: "Ladybird", picture: "auto", group: "Insects" },
        { name: "Woodlouse", picture: "auto", group: "Not insects" },
        { name: "Butterfly", picture: "auto", group: "Insects" },
        { name: "Snail", picture: "auto", group: "Not insects" },
        { name: "Worm", picture: "auto", group: "Not insects" },
      ],
      items: {
        type: "object",
        required: ["name"],
        default: { name: "New animal", picture: "auto", group: "" },
        properties: {
          name: {
            type: "string",
            title: "Name",
            minLength: 1,
            maxLength: 24,
            default: "New animal",
          },
          picture: PIC,
          group: {
            type: "string",
            title: "Its group (when sorting)",
            description: "Type the name of one of the groups.",
            maxLength: 24,
            default: "",
          },
        },
      },
    },
    groups: {
      type: "array",
      title: "Groups (when sorting)",
      "x-item": "a group",
      maxItems: 6,
      default: [
        { name: "Insects", feature: "Six legs and three body parts" },
        { name: "Not insects", feature: "Any other number of legs, or none" },
      ],
      items: {
        type: "object",
        required: ["name"],
        default: { name: "New group", feature: "" },
        properties: {
          name: {
            type: "string",
            title: "Group name",
            minLength: 1,
            maxLength: 24,
            default: "New group",
          },
          feature: { type: "string", title: "What they share", maxLength: 70, default: "" },
        },
      },
    },
    questions: {
      type: "array",
      title: "Questions (for a branching key)",
      "x-item": "a question",
      maxItems: 7,
      description:
        "Question 1 is asked first. For each answer, type the name of a thing, or “Question 3” to ask another question.",
      default: [
        { text: "Does it have legs?", yes: "Question 2", no: "Question 3" },
        { text: "Does it have six legs?", yes: "Question 4", no: "Question 5" },
        { text: "Does it have a shell?", yes: "Snail", no: "Worm" },
        { text: "Does it have a hard, spotty back?", yes: "Ladybird", no: "Butterfly" },
        { text: "Does it have eight legs?", yes: "Spider", no: "Woodlouse" },
      ],
      items: {
        type: "object",
        required: ["text"],
        default: { text: "Does it have…?", yes: "", no: "" },
        properties: {
          text: {
            type: "string",
            title: "Question",
            minLength: 1,
            maxLength: 60,
            default: "Does it have…?",
          },
          yes: { type: "string", title: "If yes, go to", maxLength: 24, default: "" },
          no: { type: "string", title: "If no, go to", maxLength: 24, default: "" },
        },
      },
    },
    text: TEXT_PARAM,
  },
};

export const presets = [
  {
    id: "y1-animal-groups",
    name: "Year 1: animal groups",
    params: {
      title: "Which group does each animal belong to?",
      mode: "groups",
      things: "animals",
      groups: [
        { name: "Mammals", feature: "Hair or fur; babies drink milk" },
        { name: "Birds", feature: "Feathers, a beak and wings" },
        { name: "Fish", feature: "Fins and gills; live in water" },
        { name: "Reptiles", feature: "Dry, scaly skin" },
      ],
      items: [
        { name: "Rabbit", group: "Mammals" },
        { name: "Whale", group: "Mammals" },
        { name: "Owl", group: "Birds" },
        { name: "Penguin", group: "Birds" },
        { name: "Goldfish", group: "Fish" },
        { name: "Shark", group: "Fish" },
        { name: "Snake", group: "Reptiles" },
        { name: "Lizard", group: "Reptiles" },
      ],
    },
  },
  {
    id: "y4-minibeast-key",
    name: "Year 4: minibeast key",
    params: { title: "A key for minibeasts", mode: "key", things: "minibeasts" },
  },
  {
    id: "y6-vertebrates",
    name: "Year 6: classifying living things",
    params: {
      title: "Five groups of vertebrates",
      mode: "groups",
      things: "animals",
      groups: [
        { name: "Mammals", feature: "Hair or fur; young drink milk" },
        { name: "Birds", feature: "Feathers; lay eggs with hard shells" },
        { name: "Fish", feature: "Gills, fins and scales" },
        { name: "Reptiles", feature: "Dry, scaly skin; most lay eggs on land" },
        { name: "Amphibians", feature: "Damp skin; young in water" },
      ],
      items: [
        { name: "Bat", group: "Mammals" },
        { name: "Whale", group: "Mammals" },
        { name: "Penguin", group: "Birds" },
        { name: "Owl", group: "Birds" },
        { name: "Shark", group: "Fish" },
        { name: "Salmon", group: "Fish" },
        { name: "Lizard", group: "Reptiles" },
        { name: "Slow worm", group: "Reptiles" },
        { name: "Frog", group: "Amphibians" },
        { name: "Newt", group: "Amphibians" },
      ],
    },
  },
  {
    id: "y2-vertebrate-key",
    name: "Year 2: a key for animals",
    params: {
      title: "Which animal is it?",
      mode: "key",
      things: "animals",
      items: [{ name: "Owl" }, { name: "Bat" }, { name: "Fox" }, { name: "Goldfish" }],
      questions: [
        { text: "Does it have fur?", yes: "Question 2", no: "Question 3" },
        { text: "Can it fly?", yes: "Bat", no: "Fox" },
        { text: "Does it have feathers?", yes: "Owl", no: "Goldfish" },
      ],
    },
  },
];

/* ------------------------------------------------------------------ model */
const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
const NUM = [
  "no",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
];
const cap1 = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const list = (a) =>
  a.length <= 1 ? a[0] || "" : `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`;
const groupName = (P, i) => P.groups[i].name;
const MAX_DEPTH = 3;

function target(s, P) {
  const t = String(s || "").trim();
  if (!t) return { empty: true };
  const m = t.match(/^(?:q(?:uestion)?\.?\s*)?(\d+)$/i);
  if (m) return { q: +m[1] - 1 };
  const i = P.items.findIndex((it) => norm(it.name) === norm(t));
  return i >= 0 ? { item: i } : { name: t };
}
/** The key as a tree. Leaves are cards {leaf, name, picture, edit, item, depth}; questions {q, depth, yes, no}.
 *  Only a key that cannot be drawn is refused. An answer naming nothing in the list gets a card of its own;
 *  when exactly one answer and one thing are unmatched (a rename on either side), they are the same thing.
 *  An empty answer shows “?” until it is filled, so questions can be added one field at a time. */
function keyTree(P) {
  const R = [],
    W = [];
  const usedQ = new Set();
  const Qs = P.questions || [];
  const leaves = [];
  const walk = (qi, depth, from) => {
    if (usedQ.has(qi)) {
      R.push({
        path: from,
        reason: `Question ${qi + 1} is reached from two places. In a key each question has one place, so write it again as a new question.`,
      });
      return null;
    }
    usedQ.add(qi);
    const node = { q: qi, depth };
    for (const side of ["yes", "no"]) {
      const path = `questions.${qi}.${side}`,
        t = target(Qs[qi][side], P),
        word = side === "yes" ? "Yes" : "No";
      if (t.q != null) {
        if (t.q < 0 || t.q >= Qs.length) {
          R.push({
            path,
            reason: `There is no question ${t.q + 1}. Add it, or point “${word}” at one of the ${NUM[Qs.length] || Qs.length} questions.`,
          });
          continue;
        }
        node[side] = walk(t.q, depth + 1, path);
        continue;
      }
      const lf = {
        leaf: leaves.length,
        depth: depth + 1,
        path,
        q: qi,
        word,
        item: t.item ?? -1,
        typed: t.name || "",
      };
      if (t.empty)
        W.push(
          `Question ${qi + 1} has nowhere to go for “${word}” yet, so it shows “?”. Type the name of a thing, or another question like “Question ${qi + 2}”.`,
        );
      leaves.push(lf);
      node[side] = lf;
    }
    return node;
  };
  const root = Qs.length ? walk(0, 0, "questions.0.text") : null;
  if (!Qs.length)
    R.push({ path: "questions", reason: "A branching key needs at least one yes/no question." });
  Qs.forEach((q, i) => {
    if (!usedQ.has(i) && Qs.length)
      W.push(
        `Question ${i + 1} is never reached, so it is not on the slide. Point a “Yes” or “No” answer at it (write “Question ${i + 1}”), or delete it.`,
      );
  });
  const reached = new Set(leaves.filter((l) => l.item >= 0).map((l) => l.item));
  const lost = P.items.map((_, i) => i).filter((i) => !reached.has(i));
  const odd = leaves.filter((l) => l.item < 0 && l.typed);
  if (odd.length === 1 && lost.length === 1) {
    odd[0].item = lost[0];
    W.push(
      `“${odd[0].word}” in question ${odd[0].q + 1} says “${odd[0].typed}”, which is not in the list, so it is taken to mean “${P.items[lost[0]].name}”, the one thing no answer leads to.`,
    );
  } else if (Qs.length && P.items.length && lost.length === P.items.length && odd.length) {
    // usually a switch from sorting: the questions still belong to another key
    W.push(
      `None of the answers in the key name any of the ${P.items.length} things in your list, so the key shows the names in its answers (${list(odd.map((l) => l.typed))}). Write questions and answers for your own things.`,
    );
  } else if (Qs.length) {
    for (const l of odd)
      W.push(
        `“${l.typed}” (question ${l.q + 1}, “${l.word}”) is not in the list of things, so its card shows the name as written. Add it to the list to choose its picture.`,
      );
    for (const i of lost)
      W.push(
        `No answer in the key leads to “${P.items[i].name}”, so it is not on the slide. Point a “Yes” or “No” answer at it.`,
      );
  }
  const twice = new Set();
  for (const l of leaves) {
    if (l.item >= 0) {
      const it = P.items[l.item];
      Object.assign(l, {
        name: it.name,
        picture: it.picture,
        edit: P._leafEdit ? P._leafEdit[l.item] : `items.${l.item}.name`,
      });
    } else
      Object.assign(l, { name: l.typed || "?", picture: l.typed ? "auto" : "none", edit: l.path });
    if (l.item >= 0 && leaves.some((o) => o !== l && o.item === l.item) && !twice.has(l.item)) {
      twice.add(l.item);
      W.push(
        `“${l.name}” is at the end of two branches. Each thing should end in exactly one place.`,
      );
    }
  }
  return { root, R, W, leaves };
}
const leavesOf = (n) => (!n ? [] : n.leaf != null ? [n] : [...leavesOf(n.yes), ...leavesOf(n.no)]);
const questionsOf = (n) =>
  !n || n.leaf != null ? [] : [n, ...questionsOf(n.yes), ...questionsOf(n.no)];
/** Questions in the order they are asked: top row first, left to right. */
const askOrder = (root) =>
  questionsOf(root).sort((a, b) => a.depth - b.depth || leafRank(root, a) - leafRank(root, b));
const leafRank = (root, n) => leavesOf(root).indexOf(leavesOf(n)[0]);

/** Which group each thing goes in (-1: it waits in the tray). A group renamed on its own carries its things with it. */
function groupsOf(P) {
  const W = [];
  const gIdx = new Map();
  P.groups.forEach((g, i) => {
    const k = norm(g.name);
    if (!gIdx.has(k)) gIdx.set(k, i);
  });
  const gi = P.items.map((it) => {
    const k = norm(it.group);
    return k && gIdx.has(k) ? gIdx.get(k) : -1;
  });
  const odd = [
    ...new Set(P.items.filter((it, i) => gi[i] < 0 && norm(it.group)).map((it) => norm(it.group))),
  ];
  const empty = P.groups.map((_, i) => i).filter((i) => !gi.includes(i));
  // groups renamed: an old name goes to the empty group of the same kind (“Mammals” -> “Furry mammals”),
  // and when the counts match, the rest pair up in order
  const pairs = [],
    oddL = [...odd],
    emptyL = [...empty];
  for (const o of odd) {
    const c = classOfGroup(o);
    if (!c) continue;
    const j = emptyL.find((e) => classOfGroup(P.groups[e].name) === c);
    if (j == null) continue;
    pairs.push([o, j]);
    oddL.splice(oddL.indexOf(o), 1);
    emptyL.splice(emptyL.indexOf(j), 1);
  }
  if (oddL.length && oddL.length === emptyL.length)
    oddL.forEach((o, k) => pairs.push([o, emptyL[k]]));
  for (const [o, j] of pairs) {
    const typed = P.items.find((it) => norm(it.group) === o).group;
    P.items.forEach((it, i) => {
      if (gi[i] < 0 && norm(it.group) === o) gi[i] = j;
    });
    W.push(
      `Some things say they go in “${typed}”, which is not a group now, so they are put in “${P.groups[j].name}”, the group it was renamed to.`,
    );
  }
  // a thing with no group yet goes where its body fits, when exactly one group says so (“Not insects”, “Mammals”)
  P.items.forEach((it, i) => {
    if (gi[i] >= 0 || norm(it.group)) return;
    const f = factOf(it.name);
    if (!f) return;
    const fit = P.groups
      .map((_, j) => j)
      .filter((j) => {
        const c = classOfGroup(P.groups[j].name),
          nc = negClassOfGroup(P.groups[j].name);
        return c ? groupFits(c, f.cls) : nc ? !groupFits(nc, f.cls) : false;
      });
    if (fit.length === 1) {
      gi[i] = fit[0];
      W.push(
        `“${it.name}” has no group yet, so it is put in “${P.groups[fit[0]].name}”, the group its body fits.`,
      );
    }
  });
  const names = P.groups.map((g) => `“${g.name}”`).join(", ");
  P.items.forEach((it, i) => {
    if (gi[i] >= 0) return;
    W.push(
      String(it.group || "").trim()
        ? `“${it.name}” is meant to go in “${it.group}”, which is not one of the groups, so it waits below. Choose one of ${names}.`
        : `“${it.name}” has no group yet, so it waits below. Choose one of ${names}.`,
    );
  });
  return { gi, W };
}

/** Groups layout in numbers only (validate uses it for capacity, render for places). */
const TH_G = 56,
  GAP_G = 16;
// width per letter, estimated (validate cannot measure): a feature at the type minimum with wrap slack; a group name at label size
const FEAT_CH = 10.7 * 1.35,
  NAME_CH = 15.5,
  CARD_CH = 15 * 1.15;
/** The most letters a thing's name can have and still fit its card in two lines when sorting. */
const nameRoom = (L) => Math.floor((2 * (L.colW - 28)) / CARD_CH);
function groupsLayout(P) {
  const n = P.items.length,
    G = Math.max(1, P.groups.length);
  const boxW = (GRID.right - GRID.left - GAP_G * (G - 1)) / G;
  const cols = boxW >= 540 ? 3 : boxW >= 340 ? 2 : 1;
  // the smallest card that still holds the longest thing's name in whole lines (24 type, 26 a line, no picture)
  const colW = (boxW - 16 - (cols - 1) * 10) / cols,
    nameLen = Math.max(0, ...P.items.map((it) => String(it.name).length));
  let thMin = 56;
  // (a name that needs a second line gets the full width of its column)
  const lines = (tw) => Math.min(2, Math.ceil((nameLen * CARD_CH) / (tw - 28))); // validate refuses a name that needs three
  const wide = lines(Math.min(168, colW)) > 1;
  for (; thMin < 90; thMin += 2)
    if (lines(wide ? colW : Math.min(thMin * 3, colW)) * 26 + 12 <= thMin) break;
  const TH_G = thMin,
    TW = wide ? colW : Math.min(thMin * 3, colW);
  const perRow = Math.max(1, Math.min(n, Math.floor((GRID.right - GRID.left + 16) / (TW + 16))));
  const trayRows = Math.ceil(n / perRow);
  // the groups sit under the title, sized to what they hold; the things wait in rows at the foot
  // the header holds the longest feature and a second line for a long group name (render measures the real ones)
  const featLen = Math.max(0, ...P.groups.map((g) => String(g.feature || "").length));
  const featLines = featLen ? clamp(Math.ceil((featLen * FEAT_CH) / (boxW - 24)), 1, 8) : 0;
  // (a one-word name never wraps: render sets every name smaller until each word fits, unless a word is too long even then)
  const nameX = P.groups.some((g) => {
    const s = String(g.name).trim();
    return s.length * NAME_CH > boxW - 24 && (/\s/.test(s) || s.length * 11 > boxW - 24);
  })
    ? 34
    : 0;
  // a feature of up to three lines keeps caption type (30 a line); a longer one is set at the minimum (26 a line)
  const featH = featLines <= 3 ? Math.max(1, featLines) * 30 : featLines * 26;
  const head = 74 + nameX + featH; // (8 clear below the last feature line before the rule)
  const trayTop = GRID.bottom - (trayRows * TH_G + (trayRows - 1) * 12);
  const boxTop = GRID.top + 6,
    boxMax = trayTop - 26;
  const rows = Math.max(1, Math.floor((boxMax - boxTop - head - 6 + 10) / (TH_G + 10)));
  return {
    boxW,
    cols,
    colW,
    wide,
    TW,
    perRow,
    trayRows,
    trayTop,
    boxTop,
    boxMax,
    rows,
    head,
    featLines,
    featH,
    nameX,
    thMin,
    cap: rows * cols,
  };
}

/* ---------------------------------------------- switching between sorting and a key */
// After a switch the other mode's settings may still belong to a different slide (the default
// minibeast key under "Five groups of vertebrates"). Then the model builds them from the things
// on this slide instead, so the slide never contradicts its own title, and says so.
const CLASS_GROUP = {
  mammal: ["Mammals", "Hair or fur; babies drink milk"],
  bird: ["Birds", "Feathers, a beak and wings"],
  fish: ["Fish", "Fins and gills; live in water"],
  reptile: ["Reptiles", "Dry, scaly skin"],
  amphibian: ["Amphibians", "Damp skin; young live in water"],
  insect: ["Insects", "Six legs and three body parts"],
  arachnid: ["Spiders", "Eight legs and two body parts"],
  mollusc: ["Molluscs", "A soft body, often with a shell"],
  crustacean: ["Crustaceans", "A hard outer skeleton and many legs"],
  worm: ["Worms", "A soft, ringed body and no legs"],
  plant: ["Plants", "Make their own food from sunlight"],
};
// questions a key can be built from, best first (body features before class names)
const GEN_Q = [
  "Does it have feathers?",
  "Does it have fur?",
  "Does it have scales?",
  "Does it have fins?",
  "Does it have six legs?",
  "Does it have eight legs?",
  "Does it have legs?",
  "Does it have wings?",
  "Can it fly?",
  "Does it have a shell?",
  "Does it lay eggs?",
  "Does it live in water?",
  "Does it have a backbone?",
  "Is it a mammal?",
  "Is it a bird?",
  "Is it a fish?",
  "Is it a reptile?",
  "Is it an amphibian?",
  "Is it an insect?",
].map((t) => [t, traitOfQuestion(t)]);
/** The answer for a unit (one thing, or a group of things): every member that has a clear answer agrees, or undefined. */
function unitAnswer(u, tq) {
  const a = u.facts.map((f) => answer(f, tq)).filter((v) => v !== undefined);
  return a.length && a.every((v) => v === a[0]) ? a[0] : undefined;
}
function genTree(units, depthLeft) {
  if (units.length === 1) return { leaf: units[0] };
  if (depthLeft <= 0 || units.length > 2 ** depthLeft) return null;
  const cap = 2 ** (depthLeft - 1),
    opts = [];
  GEN_Q.forEach(([text, tq], qi) => {
    const a = units.map((u) => unitAnswer(u, tq));
    if (a.some((v) => v === undefined)) return;
    const y = units.filter((_, j) => a[j]),
      n = units.filter((_, j) => !a[j]);
    if (!y.length || !n.length || y.length > cap || n.length > cap) return;
    opts.push({ text, y, n, score: Math.min(y.length, n.length) * 100 - qi - (tq.cls ? 150 : 0) });
  });
  opts.sort((a, b) => b.score - a.score);
  for (const o of opts.slice(0, 8)) {
    const Y = genTree(o.y, depthLeft - 1);
    if (!Y) continue;
    const N = genTree(o.n, depthLeft - 1);
    if (N) return { text: o.text, yes: Y, no: N };
  }
  return null;
}
/** The tree as key questions: question 1 first, then in the order they are reached. */
function flatten(t) {
  const qs = [],
    queue = [t];
  const num = new Map([[t, 1]]);
  while (queue.length) {
    const n = queue.shift();
    const q = { text: n.text };
    qs.push(q);
    for (const side of ["yes", "no"]) {
      const k = n[side];
      if (k.leaf) q[side] = k.leaf.name;
      else {
        num.set(k, num.size + 1);
        q[side] = `Question ${num.get(k)}`;
        queue.push(k);
      }
    }
  }
  return qs;
}
const STEP = /^(?:q(?:uestion)?\.?\s*)?\d+$/i;
function keyParams(P) {
  if (!P.questions || !P.questions.length || !P.items.length) return P;
  const names = new Set([
    ...P.items.map((it) => norm(it.name)),
    ...(P.groups || []).map((g) => norm(g.name)),
  ]);
  const was = P.questions
    .flatMap((q) => [q.yes, q.no])
    .map((s) => String(s || "").trim())
    .filter((s) => s && !STEP.test(s));
  if (!was.length || was.some((a) => names.has(norm(a)))) return P; // the key is the teacher's own (or still being written)
  const facts = P.items.map((it) => factOf(it.name)),
    known = facts.every(Boolean);
  const base = { _was: [...new Set(was)], _n: P.items.length };
  // things sorted into the teacher's groups (a renamed group keeps its things): the key leads to those groups.
  // A group card shows the picture of its first thing, so the leaves still show animals.
  const picOf = (i) => {
    const it = P.items[i];
    return it.picture && it.picture !== "auto" ? it.picture : pictureFor(it.name);
  };
  const unitsBy = (key, label) => {
    const out = [];
    P.items.forEach((it, i) => {
      const k = key(i);
      let u = out.find((o) => o.k === k);
      if (!u) out.push((u = { k, name: label(k), picture: "none", facts: [] }));
      if (u.picture === "none") u.picture = picOf(i);
      if (facts[i]) u.facts.push(facts[i]);
    });
    return out;
  };
  const toKey = (units, extra) => {
    const t =
      units.length >= 2 && units.length <= 8 && units.every((u) => u.facts.length)
        ? genTree(units, MAX_DEPTH)
        : null;
    return (
      t && {
        ...P,
        ...base,
        items: units.map((u) => ({
          name: u.name,
          picture: u.picture === "none" ? "none" : u.picture,
          group: "",
        })),
        questions: flatten(t),
        _gen: "groups",
        ...extra,
      }
    );
  };
  const { gi } = (P.groups || []).length >= 2 ? groupsOf(P) : { gi: [] };
  if (gi.length && gi.every((g) => g >= 0)) {
    const units = unitsBy(
      (i) => gi[i],
      (k) => P.groups[k].name,
    ).sort((a, b) => a.k - b.k);
    const r = toKey(units, { _leafEdit: units.map((u) => `groups.${u.k}.name`) });
    if (r) return r;
  }
  if (!known) return P; // a thing we do not know: the teacher writes the key
  if (P.items.length > 8) {
    // too many for a key of names: lead to the classes they belong to
    const order = Object.keys(CLASS_GROUP);
    const units = unitsBy(
      (i) => facts[i].cls,
      (c) => CLASS_GROUP[c][0],
    ).sort((a, b) => order.indexOf(a.k) - order.indexOf(b.k));
    const r = toKey(units, { _genCls: true });
    if (r) return r;
  }
  if (P.items.length <= 8) {
    const units = P.items.map((it, i) => ({ name: it.name, facts: [facts[i]] }));
    const t = genTree(units, MAX_DEPTH);
    if (t) return { ...P, ...base, questions: flatten(t), _gen: "items" };
  }
  return P;
}
function groupParams(P) {
  if (P.items.some((it) => norm(it.group))) return P; // the teacher has started sorting
  const facts = P.items.map((it) => factOf(it.name));
  if (!facts.every(Boolean)) return P;
  const { gi } = groupsOf(P);
  if (gi.every((g) => g >= 0) && P.groups.every((_, j) => gi.includes(j))) return P; // the groups fit these things
  const cls = [...new Set(facts.map((f) => f.cls))];
  if (cls.length < 2 || cls.length > 6) return P;
  return {
    ...P,
    groups: cls.map((c) => ({ name: CLASS_GROUP[c][0], feature: CLASS_GROUP[c][1] })),
    items: P.items.map((it, i) => ({ ...it, group: CLASS_GROUP[facts[i].cls][0] })),
    _gen: "groups",
    _was: P.groups.map((g) => g.name),
  };
}
/** The settings the slide is drawn from. */
const eff = (P) => {
  if (P._eff) return P;
  P = withDefaults(params, P);
  return { ...(P.mode === "key" ? keyParams(P) : groupParams(P)), _eff: true };
};
function genNote(P) {
  const things = P.things || "things",
    n = NUM[P._n || P.items.length] || P._n || P.items.length;
  if (P.mode === "key" && P._gen === "groups")
    return `The questions in the key were about other things (${list(P._was.slice(0, 3).map((s) => `“${s}”`))}), so this key is made from your ${P._genCls ? things : "groups"}: it leads to the ${NUM[P.items.length] || P.items.length} groups your ${n} ${things} ${P._genCls ? "belong to" : "are sorted into"}. Each group card shows one of them. Write your own questions to change it.`;
  if (P.mode === "key")
    return `The questions in the key were about other things (${list(P._was.slice(0, 3).map((s) => `“${s}”`))}), so this key is made from your ${n} ${things}. Write your own questions to change it.`;
  return `None of the ${things} has a group yet, and the groups (${list(P._was.slice(0, 3).map((s) => `“${s}”`))}) do not suit them, so they are sorted into ${list(P.groups.map((g) => g.name.toLowerCase()))}. Type a group for each thing to sort them your own way.`;
}

/* ------------------------------------------------------------------ validate */
export function validate(raw) {
  const P0 = withDefaults(params, raw);
  const R = schemaCheck(params, P0);
  const W = [];
  if (R.length) return result(R);
  const P = eff(P0);
  if (P._gen) W.push(genNote(P));
  const the = (s) => `the ${norm(s)}`;
  P.items.forEach((it, i) => {
    if (!it.picture || it.picture === "auto" || it.picture === "none") return;
    const f = factOf(it.name),
      pf = factOf(it.picture) || factOf(PICTURE_LABEL(it.picture));
    if (f && pf && pf.cls !== f.cls)
      R.push({
        path: `items.${i}.picture`,
        reason:
          `${cap1(the(it.name))} is ${CLASS_WORD[f.cls]}; choose ${CLASS_WORD[f.cls].replace(/ \(.*\)$/, "")} picture or “Match the name”.`
            .replace(/choose an? (\w+) picture/, "choose a $1 picture")
            .replace(/choose a ([aeiou])/, "choose an $1"),
      });
  });
  if (R.length) return result(R);
  if (P.mode === "key") {
    const seen = new Map();
    P.items.forEach((it, i) => {
      const k = norm(it.name);
      if (seen.has(k))
        R.push({
          path: `items.${i}.name`,
          reason: `Two things are both called “${it.name}”. Give each a different name so the key can tell them apart.`,
        });
      seen.set(k, i);
    });
    P.questions.forEach((q, i) => {
      const r = notYesNo(q.text);
      if (r) R.push({ path: `questions.${i}.text`, reason: r });
    });
    if (R.length) return result(R);
    const { root, R: KR, W: KW, leaves } = keyTree(P);
    R.push(...KR);
    W.push(...KW);
    if (R.length) return result(R, W);
    const D = Math.max(...leaves.map((l) => l.depth));
    if (D > MAX_DEPTH)
      return result(
        [
          {
            path: "questions",
            reason: `This key goes ${NUM[D] || D} questions deep, and a slide fits ${NUM[MAX_DEPTH]}. Ask questions that split each group more evenly, or split the key over two slides.`,
          },
        ],
        W,
      );
    // truth: a known animal must go down the side that is true for it
    const bad = new Set();
    for (const qn of questionsOf(root)) {
      const q = P.questions[qn.q];
      const tq = traitOfQuestion(q.text);
      if (!tq) continue;
      for (const side of ["yes", "no"])
        for (const lf of leavesOf(qn[side])) {
          if (bad.has(lf.leaf)) continue;
          const f = factOf(lf.name);
          const a = answer(f, tq);
          if (a === undefined || a === (side === "yes")) continue;
          bad.add(lf.leaf);
          R.push({
            path: `questions.${qn.q}.${side}`,
            reason: `${cap1(the(lf.name))} ${tq.says[a ? 0 : 1]}, so it belongs on the “${a ? "Yes" : "No"}” side of “${q.text}”.`,
          });
        }
    }
    if (P._gen !== "groups")
      [...new Set(leaves.filter((l) => l.typed !== "" || l.item >= 0).map((l) => l.name))].forEach(
        (nm) => {
          if (!factOf(nm)) W.push(`We do not know “${nm}”, so its answers are not checked.`);
        },
      );
    return result(R, W);
  }
  // groups
  if (!P.groups.length)
    return result([
      { path: "groups", reason: "Sorting needs at least one group. Add the groups to sort into." },
    ]);
  P.groups.forEach((g, i) => {
    if (P.groups.findIndex((o) => norm(o.name) === norm(g.name)) < i)
      R.push({
        path: `groups.${i}.name`,
        reason: `Two groups are both called “${g.name}”. Give each a different name.`,
      });
  });
  if (R.length) return result(R);
  const { gi: GI, W: GW } = groupsOf(P);
  W.push(...GW);
  const count = P.groups.map(() => 0);
  P.items.forEach((it, i) => {
    const path = `items.${i}.group`,
      gi = GI[i];
    if (gi < 0) return;
    count[gi]++;
    const f = factOf(it.name),
      gc = classOfGroup(P.groups[gi].name),
      nc = negClassOfGroup(P.groups[gi].name);
    if (!f) {
      W.push(`We do not know “${it.name}”, so its group is not checked.`);
      return;
    }
    const fits = (g) => {
      const c = classOfGroup(g.name),
        n = negClassOfGroup(g.name);
      return c ? groupFits(c, f.cls) : n ? !groupFits(n, f.cls) : false;
    };
    if (nc && groupFits(nc, f.cls)) {
      const fit = P.groups.find(fits);
      R.push({
        path,
        reason: `${cap1(the(it.name))} is ${CLASS_WORD[f.cls]}: ${f.why}.${fit ? ` Put it in “${fit.name}”.` : ""}`,
      });
    } else if (gc && !groupFits(gc, f.cls)) {
      const fit = P.groups.find(fits);
      const gw =
        gc === "vert" ? "a vertebrate" : gc === "invert" ? "an invertebrate" : CLASS_WORD[gc];
      R.push({
        path,
        reason: `${cap1(the(it.name))} is ${CLASS_WORD[f.cls]}, not ${gw}: ${f.why}.${fit ? ` Put it in “${fit.name}”.` : ""}`,
      });
    }
  });
  const L = groupsLayout(P);
  P.items.forEach((it, i) => {
    const m = nameRoom(L);
    if (String(it.name).length > m)
      R.push({
        path: `items.${i}.name`,
        reason: `“${it.name}” is too long for its card with ${NUM[P.groups.length] || P.groups.length} groups side by side. Shorten it to ${m} letters or fewer, or use fewer groups.`,
      });
  });
  count.forEach((c, i) => {
    if (c > L.cap)
      R.push({
        path: `groups.${i}.name`,
        reason: `“${P.groups[i].name}” has ${c} things, but its box on this slide holds ${L.cap}. ${L.featLines >= 4 || L.thMin > 56 ? `Shorten ${L.featLines >= 4 ? "what the groups share" : ""}${L.featLines >= 4 && L.thMin > 56 ? " and " : ""}${L.thMin > 56 ? "the longest names" : ""}, or use` : "Use"} fewer groups or fewer things.`,
      });
  });
  return result(R, W);
}

/* ------------------------------------------------------------------ builds */
function plan(P) {
  const things = P.things || "things";
  const items = [];
  if (P.mode === "key") {
    const { root, leaves } = keyTree(P);
    const order = root ? askOrder(root) : [];
    const n = leaves.length;
    const toGroups = P._gen === "groups";
    items.push({
      key: "all",
      caption: toGroups
        ? `${cap1(NUM[n] || String(n))} groups of ${things}. Each yes or no question splits the groups in two.`
        : `${cap1(NUM[n] || String(n))} ${things} to tell apart. Each yes or no question splits a group in two.`,
    });
    for (const qn of order) {
      const q = P.questions[qn.q];
      const ys = leavesOf(qn.yes).map((l) => l.name),
        ns = leavesOf(qn.no).map((l) => l.name);
      const side = (w, a) =>
        a.length === 1 && !toGroups
          ? a[0] === "?"
            ? `${w}: not chosen yet.`
            : `${w}: it is the ${norm(a[0])}.`
          : `${w}: ${list(a)}.`;
      let c = `“${q.text}” ${side("Yes", ys)} ${side("No", ns)}`;
      if (c.length > 110)
        c = `“${q.text}” ${cap1(NUM[ys.length] || String(ys.length))} ${ys.length === 1 ? "goes" : "go"} to Yes and ${NUM[ns.length] || ns.length} to No.`;
      if (c.length > 110) c = `“${q.text}”`;
      items.push({ key: `q:${qn.q}`, caption: c, qn, ys, ns });
    }
    // only claim the key works for every thing when it does: things no answer leads to are named
    const reached = new Set(leaves.map((l) => l.item));
    const lost = P.items.filter((_, i) => !reached.has(i)).map((it) => it.name);
    let summary = toGroups
      ? `Each of the ${NUM[n] || n} groups ends at its own name, so the key can sort every one of the ${things}.`
      : `Every one of the ${things} ends at its own name, so the key works.`;
    if (lost.length) {
      const named = leaves.filter((l) => l.name !== "?").length;
      summary = `${cap1(NUM[named] || String(named))} ${named === 1 ? "name ends" : "names end"} in a place of ${named === 1 ? "its" : "their"} own. ${list(lost)} ${lost.length === 1 ? "is" : "are"} not in this key yet.`;
      if (summary.length > 110)
        summary = `${cap1(NUM[named] || String(named))} ${named === 1 ? "name ends" : "names end"} in a place of ${named === 1 ? "its" : "their"} own. ${cap1(NUM[lost.length] || String(lost.length))} of the ${things} ${lost.length === 1 ? "is" : "are"} not in this key yet.`;
    }
    return { items, root, order, leaves, summary };
  }
  const { gi: GI } = groupsOf(P);
  const n = P.items.length;
  items.push({
    key: "all",
    caption: `${cap1(NUM[n] || String(n))} ${things} to sort into ${NUM[P.groups.length] || P.groups.length} groups by what their bodies are like.`,
  });
  P.groups.forEach((g, gi) => {
    const mem = P.items
      .map((it, i) => i)
      .filter((i) => GI[i] === gi)
      .map((i) => P.items[i].name);
    const gn = groupName(P, gi);
    let c = g.feature
      ? `${gn}: ${g.feature.replace(/\.$/, "")}. ${mem.length ? `${list(mem)} ${mem.length === 1 ? "goes" : "go"} here.` : "None of these belong here."}`
      : `${gn}: ${mem.length ? list(mem) : "none of these"}.`;
    if (c.length > 110) c = `${gn}: ${mem.length ? `${list(mem)}.` : "none of these."}`;
    if (c.length > 110) c = `${gn}: ${NUM[mem.length] || mem.length} of them.`;
    items.push({
      key: `g:${gi}`,
      caption: c,
      mem,
      idx: P.items.map((it, i) => i).filter((i) => GI[i] === gi),
    });
  });
  const wait = P.items.filter((_, i) => GI[i] < 0).map((it) => it.name);
  let summary = `Every one of the ${things} is in one group, and everything in a group gave the same answers to the key.`;
  if (wait.length) {
    summary = `${list(wait)} ${wait.length === 1 ? "is" : "are"} not in a group yet. The rest gave their group’s answers to the key.`;
    if (summary.length > 110)
      summary = `${cap1(NUM[wait.length] || String(wait.length))} of the ${things} ${wait.length === 1 ? "is" : "are"} not in a group yet. The rest gave their group’s answers to the key.`;
  }
  return { items, summary };
}
export function builds(P) {
  P = eff(P);
  const { items, summary } = plan(P);
  return {
    steps: items.map(({ key, caption }) => ({ key, caption })),
    summary: { caption: summary },
  };
}

export function notes(P) {
  P = eff(P);
  const pl = plan(P);
  const things = P.things || "things";
  const misc = (i) => {
    const f = factOf(P.items[i].name);
    return f && f.why ? `The ${norm(P.items[i].name)} is ${CLASS_WORD[f.cls]}: ${f.why}.` : "";
  };
  if (P.mode === "key") {
    const steps = pl.items.map((it) => {
      if (it.key === "all")
        return `Ask: what is different about these ${things}? Which question would split them into two groups? A good key question has one answer everyone agrees on: count legs, don’t ask “is it big?”.`;
      const q = P.questions[it.qn.q];
      return `Read the question aloud and check each ${things.replace(/s$/, "")} together. Yes side: ${list(it.ys)}. No side: ${list(it.ns)}.${traitOfQuestion(q.text) ? "" : " Agree on what counts as “yes” before you sort."}`;
    });
    return {
      steps,
      summary: `Test the key: pick one of the ${things}, start at question 1 and follow the answers. Does it reach the right name? Then ask the class to write a different question that would also work.`,
    };
  }
  const steps = pl.items.map((it) => {
    if (it.key === "all")
      return `Ask: which of these ${things} are alike? What would you look at to sort them: fur, feathers, scales, legs?`;
    const gi = +it.key.slice(2);
    const tricky = it.idx.filter((i) => {
      const f = factOf(P.items[i].name);
      return (
        f &&
        [
          "whale",
          "dolphin",
          "bat",
          "penguin",
          "ostrich",
          "spider",
          "woodlouse",
          "slow worm",
          "slowworm",
          "shark",
          "glow worm",
        ].includes(f.key)
      );
    });
    return (
      tricky.map(misc).join(" ") ||
      `Check each one against “${P.groups[gi].feature || P.groups[gi].name}”.`
    );
  });
  return {
    steps,
    summary:
      "Ask the class to explain one placement using the group’s features, not what the animal looks like or where it lives.",
  };
}

/* ------------------------------------------------------------------ render */
export function render(root, P, ctx) {
  P = eff(P);
  return P.mode === "key" ? renderKey(root, P, ctx) : renderGroups(root, P, ctx);
}

function pictureKind(th) {
  return th.picture && th.picture !== "auto" ? th.picture : pictureFor(th.name);
}

/* Cards for things. One type size for every card on the slide (the biggest at which every name fits
   in whole words). Pictures are all or none: every card gets one, all the same size, or no card does. */
const CARD_CLS = { 30: "ts-label", 26: "ts-cap", 24: "ts-small" },
  CARD_TA = { fill: "var(--ink)", cls: "strong" };
const PIC_GAP = 16,
  PIC_AREA = 0.5,
  STACK_GAP = 10,
  STACK_TOP = 6,
  STACK_AREA = 0.7; // the clear gap between a picture and its name; how much of its box a picture may cover
const longestWord = (s) =>
  String(s)
    .split(/\s+/)
    .reduce((a, w) => (w.length > a.length ? w : a), "");
/** How a card lays out at type size fs: {pic, pw, room, maxL}, or null when the name does not fit in whole words. */
function cardFit(p, th, W, H, layout, fs, pwSet) {
  const kind = pictureKind(th),
    cls = CARD_CLS[fs],
    lh = fs + 2,
    word = longestWord(th.name);
  const fits = (room, maxL) =>
    measure(p, word, cls, CARD_TA) <= room && wrap(p, th.name, cls, room, CARD_TA).length <= maxL;
  if (layout === "row") {
    // picture on the left, name beside it
    const maxL = clamp(Math.floor((H - 12) / lh), 1, 3),
      pw = pwSet ?? Math.round(Math.min(H * 1.05, W * 0.36));
    if (kind !== "none" && pw > 0 && fits(W - pw - PIC_GAP - 24, maxL))
      return { pic: true, pw, room: W - pw - PIC_GAP - 24, maxL };
    return fits(W - 28, maxL) ? { pic: false, pw: 0, room: W - 28, maxL } : null;
  }
  if (!fits(W - 20, 3)) return null; // stacked: picture above the name, with room left for it
  const nl = wrap(p, th.name, cls, W - 20, CARD_TA).length;
  return {
    pic: kind !== "none" && H - (nl * lh + 10) - STACK_GAP - STACK_TOP >= 28,
    room: W - 20,
    maxL: 3,
    nl,
  };
}
/** One type size, one arrangement and one picture rule for every card: {fs, layout, pw, pics, nl}.
 *  Pictures stay only if every thing has one and every name fits beside (or under) a picture of the same size;
 *  otherwise no card has one, so a row never mixes cards with and without. A “?” card (an answer not filled in) does not count. */
function cardType(p, things, W, H, layout) {
  const sizes = (L) =>
    [30, 26, 24].filter((f) => f <= ((L === "row" ? H >= 72 : H >= 110) ? 30 : 26));
  const real = things.filter((th) => th.name !== "?");
  const fitsAll = (L, f, keepPics, pw) =>
    things.every((th) => {
      const r = cardFit(p, th, W, H, L, f, pw);
      return r && (!keepPics || r.pic || th.name === "?");
    });
  const maxNl = (f) =>
    Math.max(1, ...things.map((th) => wrap(p, th.name, CARD_CLS[f], W - 20, CARD_TA).length));
  if (real.length && real.every((th) => pictureKind(th) !== "none")) {
    const full = Math.round(Math.min(H * 1.05, W * 0.36));
    // row cards: full-size pictures, then smaller ones (all the same size), then a picture above the name on a tall card
    const tries =
      layout === "row"
        ? [full, 0.8, 0.65, 0.5]
            .map((k) => (k > 1 ? k : Math.round(full * k)))
            .filter((pw) => pw >= 30)
            .map((pw) => ["row", pw])
        : [];
    if (layout !== "row" || H >= 96) tries.push(["stack"]);
    for (const [L, pw] of tries) {
      // stacked: every picture gets the box left under the longest name, so they all match
      const f = sizes(L).find(
        (f) =>
          fitsAll(L, f, true, pw) &&
          (L !== "stack" || H - (maxNl(f) * (f + 2) + 10) - STACK_GAP - STACK_TOP >= 28),
      );
      if (f && L === "row") {
        // then every picture takes the width the longest name leaves, the same for all
        const room = W - pw - PIC_GAP - 24,
          cls = CARD_CLS[f];
        const nameW = Math.max(
          ...things.map((th) =>
            Math.max(
              ...wrap(p, th.name, cls, room, CARD_TA).map((l) => measure(p, l, cls, CARD_TA)),
            ),
          ),
        );
        const row = {
          fs: f,
          layout: L,
          pw: Math.round(clamp(W - 24 - PIC_GAP - nameW - 2, pw, H * 1.3)),
          pics: true,
        };
        // a tall, narrow card gives the picture more room above the name than beside it
        if (H >= 96) {
          const fs2 = sizes("stack").find(
            (g) =>
              fitsAll("stack", g, true) &&
              H - (maxNl(g) * (g + 2) + 10) - STACK_GAP - STACK_TOP >= 28,
          );
          if (fs2) {
            const ph = H - (maxNl(fs2) * (fs2 + 2) + 10) - STACK_GAP - STACK_TOP;
            if (Math.min(W - 24, ph * 2) * ph > Math.min(row.pw, (H - 20) * 2) * (H - 20))
              return { fs: fs2, layout: "stack", pics: true, nl: maxNl(fs2) };
          }
        }
        return row;
      }
      if (f) return { fs: f, layout: L, pw, pics: true, nl: maxNl(f) };
    }
  }
  return {
    fs: sizes(layout).find((f) => fitsAll(layout, f, false, 0)) || 24,
    layout,
    pw: 0,
    pics: false,
  };
}
/** Pictures that match: none covers more than 1.4 times the area of the smallest one can reach. */
function matchPictures(p, things, W, H, CT) {
  if (!CT.pics) return CT;
  const A = things
    .filter((th) => th.name !== "?")
    .map((th) => {
      const kind = pictureKind(th);
      if (CT.layout === "row") return pictureArea(p, kind, CT.pw, H - 20, PIC_AREA);
      const ph = H - ((CT.nl || 1) * (CT.fs + 2) + 10) - STACK_GAP - STACK_TOP;
      return pictureArea(p, kind, W - 24, ph, STACK_AREA);
    })
    .filter((a) => a > 0);
  return A.length ? { ...CT, cap: Math.min(...A) * 1.4 } : CT;
}
/** A card for one thing {name, picture, edit}; drawn at (0,0) top-left, moved by the tick hook. Flat (no shadow), big type. */
function card(p, th, W, H, CT, a = {}) {
  const { layout, fs } = CT;
  const g = h("g", a, p);
  const kind = CT.pics ? pictureKind(th) : "none";
  h(
    "rect",
    {
      x: 0,
      y: 0,
      width: W,
      height: H,
      rx: "var(--r-card)",
      fill: "var(--paper)",
      stroke: "var(--rule)",
      "stroke-width": "var(--sw-rule)",
    },
    g,
  );
  const cls = CARD_CLS[fs],
    lh = fs + 2;
  const maxL = layout === "row" ? clamp(Math.floor((H - 12) / lh), 1, 3) : 3;
  const pic = kind !== "none" && !!pictureSize(kind);
  if (layout === "row") {
    const pw = pic ? CT.pw : 0,
      room = pic ? W - pw - PIC_GAP - 24 : W - 28;
    const tg = h("g", {}, g);
    const tb = textBlock(tg, 0, 0, th.name, {
      cls,
      maxW: room,
      maxLines: maxL,
      lh,
      anchor: "start",
      edit: th.edit,
      a: CARD_TA,
    });
    tb.el.setAttribute("y", H / 2 + fs * 0.36 - (tb.lh / 2) * (tb.lines.length - 1));
    // the picture and the name sit together as one block, centred in the card
    const tw = Math.min(room, tb.w || room),
      total = (pic ? pw + PIC_GAP : 0) + tw,
      left = Math.max(12, (W - total) / 2);
    if (pic) drawPictureFit(g, kind, left + pw / 2, H / 2, pw, H - 20, PIC_AREA, {}, CT.cap);
    tg.setAttribute("transform", `translate(${(left + (pic ? pw + PIC_GAP : 0)).toFixed(1)} 0)`);
  } else {
    // the name sits at the foot; every picture shares the box above the longest name on the slide
    const tb = textBlock(g, W / 2, 0, th.name, {
      cls,
      maxW: W - 20,
      maxLines: maxL,
      lh,
      anchor: "middle",
      edit: th.edit,
      a: CARD_TA,
    });
    const nl = tb.lines.length,
      nameH = (pic ? CT.nl || nl : nl) * tb.lh + 10,
      ph = H - nameH - STACK_GAP - STACK_TOP;
    if (pic && ph >= 28)
      drawPictureFit(g, kind, W / 2, STACK_TOP + ph / 2, W - 24, ph, STACK_AREA, {}, CT.cap);
    const yLast = pic && ph >= 28 ? H - 14 : H / 2 + fs * 0.36 + ((nl - 1) * tb.lh) / 2;
    tb.el.setAttribute("y", yLast - (nl - 1) * tb.lh);
  }
  return g;
}
/** Tokens travel between builds: pos[k] is each card's place at the end of build k (k = N is the still).
 *  They fly on a low arc; `scene(k0, k1, t)` moves anything else that travels with them. */
function mover(cards, pos, N, scene = () => {}) {
  const set = (i, x, y) =>
    cards[i].setAttribute("transform", `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
  const at = (k) => {
    k = clamp(k, 0, N);
    cards.forEach((c, i) => {
      const q = pos[i][k];
      set(i, q.x, q.y);
    });
    scene(k, k, 1);
  };
  at(N);
  return {
    tick(k, u) {
      const t = eIO(clamp((u - 0.08) / 0.8)),
        k0 = Math.max(0, k - 1);
      cards.forEach((c, i) => {
        const a = pos[i][k0],
          b = pos[i][k];
        const d = Math.hypot(b.x - a.x, b.y - a.y);
        set(
          i,
          a.x + (b.x - a.x) * t,
          a.y + (b.y - a.y) * t - Math.sin(Math.PI * t) * Math.min(70, d * 0.18),
        );
      });
      scene(k0, k, t);
    },
    still() {
      at(N);
    },
    reset() {
      at(0);
    },
  };
}

/* Type steps for the key: questions wrap first, then step down to the token minimum. */
const KEY_TYPE = [
  { q: "ts-label", qfs: 30, y: "ts-label strong", yfs: 30 },
  { q: "ts-cap", qfs: 26, y: "ts-small strong", yfs: 24 },
  { q: "ts-small", qfs: 24, y: "ts-small strong", yfs: 24 },
  { q: "ts-tiny", qfs: 22, y: "ts-tiny strong", yfs: 22 },
];
function renderKey(root, P, ctx) {
  const { root: tree, order } = plan(P);
  if (!tree) {
    ctx.warn("classify_key: the key has no questions");
    return {};
  }
  const b = ctx.b,
    N = ctx.N;
  const leaves = leavesOf(tree);
  const n = leaves.length;
  const x0 = GRID.left,
    x1 = GRID.right,
    pitch = (x1 - x0) / n;
  const lane = new Map(leaves.map((l, i) => [l, x0 + (i + 0.5) * pitch]));
  const D = Math.max(...leaves.map((l) => l.depth));
  const avail = GRID.bottom - (GRID.top + 4);
  // cards start tall enough for a picture over a two-line name, and shrink only while the rows need the room
  const TH0 = clamp(Math.floor((avail - D * 64) / (D + 1)), 90, 150);
  const qs = questionsOf(tree);
  const parentQ = new Map(); // node -> the question that leads to it
  for (const qn of qs) for (const side of ["yes", "no"]) parentQ.set(qn[side], qn.q);
  for (const qn of qs) {
    const span = leavesOf(qn).length;
    qn.x = leavesOf(qn).reduce((s, l) => s + lane.get(l), 0) / span;
    qn.w = clamp(span * pitch - 24, 200, 560);
  }
  // fit: questions wrap, then shrink; cards shrink; and the Yes/No words move onto the branch when rows are close
  const qOpts = (S, qn) => ({
    cls: S.q,
    maxW: qn.w - 76,
    maxLines: S.qfs <= 24 ? 4 : 3,
    lh: S.qfs + 6,
    anchor: "middle",
  });
  const probe = h("g", {}, root);
  const hCache = new Map();
  const heights = (S) => {
    if (!hCache.has(S))
      hCache.set(
        S,
        qs.map((qn) => {
          const t = textBlock(probe, 0, 0, P.questions[qn.q].text, qOpts(S, qn));
          t.el.remove();
          return Math.max(64, t.h + 28);
        }),
      );
    return hCache.get(S);
  };
  // a row is as tall as a card only where cards stop (a thing's name, or things waiting under a question);
  // the top row holds only question 1 once it is asked (the waiting cards there sit over the empty gap below)
  const cardRow = Array.from(
    { length: D + 1 },
    (_, r) => r > 0 && (leaves.some((l) => l.depth === r) || qs.some((q) => q.depth === r)),
  );
  const rows = (TH, hq) => {
    const rowH = Array.from({ length: D + 1 }, (_, r) =>
      Math.max(cardRow[r] ? TH : 0, ...qs.map((q, i) => (q.depth === r ? hq[i] : 0))),
    );
    const used = rowH.reduce((s, v) => s + v, 0);
    return { rowH, used, gap: Math.min(110, (avail - used) / D) };
  };
  const steps = KEY_TYPE.slice(D <= 2 ? 0 : 1);
  const fit = (modes) => {
    let pick = null;
    pass: for (const mode of modes)
      for (const S of steps) {
        const hq = heights(S),
          need = mode === "beside" ? 1.02 * S.yfs + 27 : 1.05 * S.yfs + 16;
        for (let TH = Math.max(TH0, 120); TH >= (mode === "beside" ? 80 : 72); TH -= 2) {
          const L = rows(TH, hq);
          pick = { mode, S, TH, hq, ...L };
          if (L.gap >= need) break pass;
        }
        pick.fail = true;
      }
    return pick;
  };
  // cards take the width their lane gives (up to a wide card), so a two-line name still leaves room for its picture;
  // a wide card puts the picture beside the name; whichever arrangement keeps every picture wins (stacked first on a narrow card)
  const widthFor = (TH) => Math.min(Math.max(176, Math.round(TH * 2.6)), pitch - 16);
  const cardsFor = (TH) => {
    const TW = widthFor(TH),
      tryL = TW >= TH * 1.9 ? ["row", "stack"] : ["stack", "row"];
    const cts = tryL.map((L) => cardType(probe, leaves, TW, TH, L));
    return cts.find((c) => c.pics) || cts[0];
  };
  let pick = fit(["beside", "bar"]),
    CT0 = cardsFor(pick.TH);
  // pictures lost for want of height: the Yes/No words move onto the branches, which frees room for taller cards
  if (!CT0.pics && pick.mode === "beside") {
    const p2 = fit(["bar"]);
    if (!p2.fail && p2.TH > pick.TH) {
      const c2 = cardsFor(p2.TH);
      if (c2.pics) {
        pick = p2;
        CT0 = c2;
      }
    }
  }
  probe.remove();
  if (pick.fail) ctx.warn("classify_key: the questions are too long for the rows on this slide");
  const { mode, S, TH, hq, rowH, used, gap } = pick;
  const TW = widthFor(TH);
  const under = h("g", {}, root),
    trays = h("g", {}, root),
    tokG = h("g", {}, root),
    top = h("g", {}, root);
  const y0 = GRID.top + 4 + Math.max(0, (avail - used - gap * D) / 2);
  const rowTop = [];
  rowH.reduce((y, hh, r) => {
    rowTop[r] = y;
    return y + hh + gap;
  }, y0);
  // things waiting under a question not yet asked sit together in a tray where that question will appear
  const cluster = (qn) => {
    const L = leavesOf(qn),
      m = L.length,
      cw = m * TW + (m - 1) * 8;
    return { L, cw, x: qn.x - cw / 2 };
  };
  qs.forEach((qn, qi) => {
    const k = b[`q:${qn.q}`];
    const qh = hq[qi],
      bx = qn.x - qn.w / 2,
      by = rowTop[qn.depth];
    if (qn !== tree) {
      const c = cluster(qn),
        kp = b[`q:${parentQ.get(qn)}`];
      h(
        "rect",
        {
          x: c.x - 10,
          y: by,
          width: c.cw + 20,
          height: TH + 20,
          rx: "var(--r-card)",
          fill: "var(--bg)",
          stroke: "var(--ink-3)",
          "stroke-width": "var(--sw-rule)",
          s: kp,
          hide: k,
        },
        trays,
      );
    }
    const cg = h("g", { s: k, cls: "rise" }, top);
    const fr = h("g", { c: ctx.rc(`q:${qn.q}`, null, "soft") }, cg); // past questions: the frame steps back, the words stay readable
    h(
      "rect",
      {
        x: bx,
        y: by,
        width: qn.w,
        height: qh,
        rx: "var(--r-card)",
        fill: "var(--paper)",
        stroke: "var(--ink-3)",
        "stroke-width": "var(--sw-rule)",
      },
      fr,
    );
    h(
      "rect",
      {
        x: bx - 5,
        y: by - 5,
        width: qn.w + 10,
        height: qh + 10,
        rx: "var(--r-card)",
        fill: "none",
        stroke: "var(--focus)",
        "stroke-width": "var(--sw-struct)",
        s: k,
        hide: k + 1,
      },
      top,
    );
    // question number (its place in the list): click focuses that question
    const cx = bx + 30,
      cy = by + qh / 2;
    h(
      "circle",
      { cx, cy, r: 18, fill: "none", stroke: "var(--ink-3)", "stroke-width": "var(--sw-rule)" },
      fr,
    );
    computed(
      T(fr, cx, cy + 8, String(qn.q + 1), "ts-small", { "text-anchor": "middle", cls: "strong" }),
      P._gen ? "questions" : `questions.${qn.q}.text`,
    );
    const lab = textBlock(
      cg,
      qn.x + 18,
      0,
      P.questions[qn.q].text,
      Object.assign(qOpts(S, qn), {
        edit: P._gen ? undefined : `questions.${qn.q}.text`,
        a: { fill: "var(--ink)", cls: "strong" },
      }),
    );
    if (P._gen) computed(lab.el, "questions");
    const ly = by + 14 + (lab.cls === "ts-tiny" ? 22 : S.qfs) * 0.8 + (qh - 28 - lab.h) / 2;
    lab.el.setAttribute("y", ly);
    // branches: elbow from the card's foot to the child's row; Yes/No beside the drop (or on the branch when rows are close)
    for (const side of ["yes", "no"]) {
      const kid = qn[side];
      const kx = kid.leaf != null ? lane.get(kid) : kid.x;
      const yA = by + qh,
        yB = rowTop[qn.depth + 1];
      const word = side === "yes" ? "Yes" : "No",
        inner = kx < qn.x ? 1 : -1;
      let t, d;
      if (mode === "beside") {
        const ym = yA + 14;
        d = `M${qn.x} ${yA} V ${ym} H ${kx} V ${yB}`;
        t = h(
          "text",
          {
            x: kx + inner * 12,
            y: ym + S.yfs * 0.8 + 4,
            "text-anchor": inner > 0 ? "start" : "end",
            cls: S.y,
            fill: "var(--ink-2)",
            text: word,
            s: k,
            delay: 250,
          },
          top,
        );
      } else {
        // the word sits on the level branch, which stops at its edges
        const ym = yA + 6 + S.yfs * 0.45,
          mx = (qn.x + kx) / 2,
          w = measure(top, word, S.y.split(" ")[0]);
        const a0 = mx + inner * (w / 2 + 8),
          a1 = mx - inner * (w / 2 + 8);
        d = `M${qn.x} ${yA} V ${ym} H ${a0} M ${a1} ${ym} H ${kx} V ${yB}`;
        t = h(
          "text",
          {
            x: mx,
            y: ym + S.yfs * 0.35,
            "text-anchor": "middle",
            cls: S.y,
            fill: "var(--ink-2)",
            text: word,
            s: k,
            delay: 250,
          },
          top,
        );
      }
      h(
        "path",
        {
          d,
          fill: "none",
          stroke: "var(--ink-3)",
          "stroke-width": "var(--sw-struct)",
          "stroke-linejoin": "round",
          s: k,
          cls: "draw",
          pathLength: 1,
        },
        under,
      );
      computed(t, P._gen ? "questions" : `questions.${qn.q}.${side}`);
    }
  });
  // cards: wait in a row (build 0, in list order), then drop down the side of each question as it is asked; once named they step back
  const wait = leaves
    .map((l, i) => i)
    .sort(
      (a, c) =>
        (leaves[a].item >= 0 ? leaves[a].item : 100 + a) -
        (leaves[c].item >= 0 ? leaves[c].item : 100 + c),
    );
  const waitAt = new Map(wait.map((li, j) => [leaves[li], j]));
  const CT = matchPictures(tokG, leaves, TW, TH, CT0);
  const cards = leaves.map((l) =>
    card(tokG, l, TW, TH, CT, { c: ctx.rc(`q:${parentQ.get(l)}`, null, "soft") }),
  );
  const askedAt = (qn) => b[`q:${qn.q}`];
  const placeAt = (l, k) => {
    if (k === 0) return { x: x0 + (waitAt.get(l) + 0.5) * pitch - TW / 2, y: rowTop[0] };
    let node = tree; // walk down while the question at this node has been asked
    while (node.leaf == null && askedAt(node) <= k)
      node = leavesOf(node.yes).includes(l) ? node.yes : node.no;
    if (node.leaf == null && node !== tree) {
      const c = cluster(node);
      return { x: c.x + c.L.indexOf(l) * (TW + 8), y: rowTop[node.depth] + 10 };
    }
    return { x: lane.get(l) - TW / 2, y: rowTop[node.depth] };
  };
  const pos = leaves.map((l) =>
    Array.from({ length: N + 1 }, (_, k) => placeAt(l, Math.min(k, N))),
  );
  const mv = mover(cards, pos, N);
  const dur = { all: 600 };
  for (const qn of order) dur[`q:${qn.q}`] = 1500;
  return { tick: mv.tick, still: mv.still, reset: mv.reset, dur };
}

function renderGroups(root, P, ctx) {
  const b = ctx.b,
    N = ctx.N;
  const n = P.items.length,
    G = P.groups.length;
  const L = groupsLayout(P);
  // header height from the longest feature as it wraps here (never more than the capacity check allowed)
  // features share one type size: caption type if every one fits the lines the header allows at 30 a line, else the minimum
  const probe = h("g", {}, root);
  const FW = L.boxW - 24,
    capMax = Math.max(1, Math.floor(L.featH / 30));
  const capFits = P.groups.every(
    (g) => !g.feature || wrap(probe, g.feature, "ts-cap", FW).length <= capMax,
  );
  const FT = capFits
    ? { cls: "ts-cap", maxLines: capMax, lh: 30 }
    : { cls: "ts-tiny", maxLines: Math.max(1, Math.floor(L.featH / 26)), lh: 26 };
  const fl = Math.max(
    0,
    ...P.groups.map((g) =>
      g.feature ? textBlock(probe, 0, 0, g.feature, { ...FT, maxW: FW }).lines.length : 0,
    ),
  );
  // group names share one heading size: the biggest at which every name's longest word fits; a long name takes a second line
  // (one line each when the capacity check allowed for one line)
  const NCLS =
    ["ts-h3", "ts-label", "ts-cap", "ts-small", "ts-tiny"].find((c) =>
      P.groups.every(
        (g) =>
          measure(probe, longestWord(g.name), c, { cls: "strong" }) <= FW &&
          (L.nameX || measure(probe, g.name, c, { cls: "strong" }) <= FW),
      ),
    ) || "ts-tiny";
  const NLH = NCLS === "ts-h3" ? 34 : NCLS === "ts-label" ? 32 : 28;
  const NX = Math.max(
    0,
    ...P.groups.map((g) => {
      const t = textBlock(probe, 0, 0, g.name, { cls: NCLS, maxW: FW, maxLines: 2, lh: NLH });
      return (t.lines.length - 1) * t.lh;
    }),
  );
  probe.remove();
  const HEAD = 74 + NX + Math.max(1, fl) * FT.lh;
  const { gi: GI } = groupsOf(P);
  const gOf = (i) => GI[i];
  const waiting = GI.some((g) => g < 0); // a thing with no group yet waits in the tray
  const slot = P.items.map(() => 0);
  const used = P.groups.map(() => 0);
  P.items.forEach((_, i) => {
    const gi = gOf(i);
    if (gi >= 0) slot[i] = used[gi]++;
  });
  const rowsUsed = Math.max(1, ...used.map((c) => Math.ceil(c / L.cols)));
  // the biggest cards for which the boxes and the waiting tray under them fit the stage together
  const STAGE = GRID.bottom - GRID.top - 8,
    GAPT = 28;
  let S;
  for (let TH = 110; TH >= L.thMin; TH -= 2) {
    const TW = Math.floor(L.wide ? L.colW : Math.min(TH * 3, L.colW));
    const perRow = Math.max(1, Math.min(n, Math.floor((GRID.right - GRID.left + 16) / (TW + 16)))),
      trayRows = Math.ceil(n / perRow);
    S = {
      TH,
      TW,
      perRow,
      trayH: trayRows * TH + (trayRows - 1) * 12,
      boxH: HEAD + 6 + rowsUsed * (TH + 10),
    };
    if (S.boxH + GAPT + S.trayH <= STAGE) break;
  }
  const { TH, TW, perRow, trayH, boxH } = S;
  // the scene re-centres: the tray alone (build 0), boxes and tray, then the boxes alone once the tray is empty
  const Sc = (GRID.top + GRID.bottom) / 2,
    minY = GRID.top + 4;
  const lastG = Math.max(...P.groups.map((g, gi) => b[`g:${gi}`]));
  // once the tray is empty the boxes sit a little above the middle (optical centre), not far from the title
  const off = (k) =>
    k === 0
      ? Sc - (boxH + GAPT + trayH / 2)
      : k >= lastG && !waiting
        ? minY + Math.max(0, GRID.bottom - minY - boxH) * 0.3
        : Math.max(minY, Sc - (boxH + GAPT + trayH) / 2);
  const sc = h("g", {}, root);
  const boxes = h("g", {}, sc),
    tokG = h("g", {}, sc);
  const boxX = (gi) => GRID.left + gi * (L.boxW + GAP_G);
  P.groups.forEach((g, gi) => {
    const k = b[`g:${gi}`];
    const x = boxX(gi),
      y = 0,
      w = L.boxW,
      hh = boxH;
    const bg = h("g", { s: k, cls: "rise", c: ctx.rc(`g:${gi}`, null, "soft") }, boxes);
    h(
      "rect",
      {
        x,
        y,
        width: w,
        height: hh,
        rx: "var(--r-card)",
        fill: "var(--bg)",
        stroke: "var(--ink-3)",
        "stroke-width": "var(--sw-rule)",
      },
      bg,
    );
    h(
      "rect",
      {
        x: x - 5,
        y: y - 5,
        width: w + 10,
        height: hh + 10,
        rx: "var(--r-card)",
        fill: "none",
        stroke: "var(--focus)",
        "stroke-width": "var(--sw-struct)",
        s: k,
        hide: k + 1,
      },
      boxes,
    );
    const gn = textBlock(bg, x + 12, y + 44, groupName(P, gi), {
      cls: NCLS,
      maxW: FW,
      maxLines: 2,
      lh: NLH,
      edit: P._gen ? undefined : `groups.${gi}.name`,
      a: { fill: "var(--ink)", cls: "strong" },
    });
    if (P._gen) computed(gn.el, "groups");
    if (g.feature) {
      const gf = textBlock(bg, x + 12, y + 80 + NX, g.feature, {
        ...FT,
        maxW: FW,
        edit: P._gen ? undefined : `groups.${gi}.feature`,
      });
      if (P._gen) computed(gf.el, "groups");
    }
    h(
      "line",
      {
        x1: x + 12,
        x2: x + w - 12,
        y1: y + HEAD - 6,
        y2: y + HEAD - 6,
        stroke: "var(--rule)",
        "stroke-width": "var(--sw-hair)",
      },
      bg,
    );
    if (used[gi] > L.cap)
      ctx.warn(`classify_key: “${g.name}” holds ${used[gi]} cards but has room for ${L.cap}`);
  });
  const things = P.items.map((it, i) => ({
    name: it.name,
    picture: it.picture,
    edit: `items.${i}.name`,
  }));
  const CT = matchPictures(tokG, things, TW, TH, cardType(tokG, things, TW, TH, "row"));
  const cards = things.map((th, i) =>
    card(tokG, th, TW, TH, CT, { c: gOf(i) >= 0 ? ctx.rc(`g:${gOf(i)}`, null, "soft") : null }),
  );
  // tray(j, m): the j-th of m cards waiting, in centred rows; once every group has filled, the ones left close up
  const tray = (i, m = n) => {
    const r = Math.floor(i / perRow),
      c = i % perRow;
    const inRow = Math.min(perRow, m - r * perRow);
    const rw = inRow * (TW + 16) - 16;
    return {
      x: (GRID.left + GRID.right) / 2 - rw / 2 + c * (TW + 16),
      y: boxH + GAPT + r * (TH + 12),
    };
  };
  const inBox = (i) => {
    const gi = gOf(i),
      s = slot[i];
    const c = s % L.cols,
      r = Math.floor(s / L.cols);
    const iw = L.cols * TW + (L.cols - 1) * 10;
    return { x: boxX(gi) + L.boxW / 2 - iw / 2 + c * (TW + 10), y: HEAD + 6 + r * (TH + 10) };
  };
  const left = P.items.map((_, i) => i).filter((i) => gOf(i) < 0);
  const pos = P.items.map((_, i) =>
    Array.from({ length: N + 1 }, (_, k) =>
      gOf(i) >= 0 && (k >= N || k >= b[`g:${gOf(i)}`])
        ? inBox(i)
        : k >= lastG && gOf(i) < 0
          ? tray(left.indexOf(i), left.length)
          : tray(i),
    ),
  );
  const mv = mover(cards, pos, N, (k0, k1, t) => {
    const y = off(k0) + (off(k1) - off(k0)) * t;
    sc.setAttribute("transform", `translate(0 ${y.toFixed(1)})`);
  });
  const dur = { all: 600 };
  P.groups.forEach((g, gi) => {
    dur[`g:${gi}`] = 1500;
  });
  return { tick: mv.tick, still: mv.still, reset: mv.reset, dur };
}
