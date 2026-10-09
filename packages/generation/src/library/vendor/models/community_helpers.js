// People who help us: a street, school or hospital scene; each helper appears at their place with
// their own tools and vehicle, then what they do, then (optionally) "who would you call?" problems:
// the problem appears, then the helper who fixes it is highlighted, with the locale's emergency
// number when it is an emergency. Tools come from the helper's role (kit ROLES), never from free
// wording, so a firefighter can never carry a stethoscope. The cast is mixed by construction
// (kit look(): skin tones and hair styles vary from helper to helper).

import { EMERGENCY, figure, look, periodObject, ROLES } from "../kit/batch-G.js";
import {
  clamp,
  computed,
  editable,
  GRID,
  ground,
  h,
  labelGround,
  measure,
  noteArt,
  pictureCard,
  result,
  schemaCheck,
  sky,
  T,
  TEXT_PARAM_FOR,
  TITLE_PARAM,
  textBlock,
  withDefaults,
} from "../kit/index.js";
import { backdrop } from "./community_helpers/places.js";

export const meta = {
  id: "community_helpers",
  name: "People who help us",
  kind: "scene",
  version: 1,
  subjects: ["History", "Geography", "PSHE", "Understanding the world"],
  years: ["Reception", "Y1"],
  teaches:
    "Who the people who help us are, how we recognise them by their uniform, tools and vehicles, what they do, and who to call when something goes wrong.",
};

/* ------------------------------------------------------------------ truth tables */
const ROLE_IDS = [
  "firefighter",
  "nurse",
  "doctor",
  "police",
  "postal",
  "lollipop",
  "teacher",
  "refuse",
  "vet",
];
const ROLE_LABELS = [
  "Firefighter",
  "Nurse",
  "Doctor",
  "Police officer",
  "Postal worker",
  "Lollipop person (school crossing patrol)",
  "Teacher",
  "Refuse collector",
  "Vet",
];
const NAME = {
  firefighter: "Firefighter",
  nurse: "Nurse",
  doctor: "Doctor",
  police: "Police officer",
  postal: "Postal worker",
  lollipop: "Lollipop person",
  teacher: "Teacher",
  refuse: "Refuse collector",
  vet: "Vet",
};
const JOB = {
  firefighter: "puts out fires and rescues people",
  nurse: "cares for people who are ill or hurt",
  doctor: "finds out what is wrong and helps us get better",
  police: "keeps us safe and helps when we are lost",
  postal: "brings letters and parcels to our homes",
  lollipop: "helps us cross the road safely",
  teacher: "helps us learn new things",
  refuse: "takes away our rubbish and recycling",
  vet: "looks after animals when they are poorly",
};
// what the drawing shows for each role (kit ROLES props), in a sentence for the caption
const TOOLS = {
  firefighter: "wears a helmet and bright stripes",
  nurse: "wears a tunic with a watch pinned on",
  doctor: "listens to your heart with a stethoscope",
  police: "wears a hat and a bright yellow vest",
  postal: "carries a bag of letters",
  lollipop: "wears a bright coat and holds up a sign",
  teacher: "carries a book and wears a lanyard",
  refuse: "wears a bright jacket and wheels the bins",
  vet: "checks animals with a stethoscope",
};
// the vehicle each helper drives (nurses do not drive ambulances: paramedics do, so none here)
const VEHICLE = {
  firefighter: "fire_engine",
  police: "police_car",
  postal: "post_van",
  refuse: "bin_lorry",
};
const VEH_NAME = {
  fire_engine: "a fire engine",
  police_car: "a police car",
  post_van: "a post van",
  bin_lorry: "a bin lorry",
};
const VEH_EXT = {
  fire_engine: [-84, 86, 76],
  police_car: [-58, 60, 61],
  post_van: [-70, 66, 70],
  bin_lorry: [-90, 84, 84],
};
// words that name each role, for the "drawn as one helper, named as another" check
const KW = {
  firefighter: /\b(fire ?fighters?|fire(man|men|woman|women))\b/i,
  nurse: /\bnurses?\b/i,
  doctor: /\b(doctors?|gp|dr)\b/i,
  police: /\b(police|policeman|policewoman|pc|pcso)\b/i,
  postal: /\b(post(man|men|woman|women|ie|al)?|delivery)\b/i,
  lollipop: /\b(lollipop|crossing patrol)\b/i,
  teacher: /\b(teachers?|headteacher|teaching assistant)\b/i,
  refuse: /\b(refuse|bin ?(man|men|woman|women)|rubbish|recycling)\b/i,
  vet: /\bvets?\b/i,
};
// jobs the library has no figure for: a helper named as one of these (or as another role) is drawn as a
// labelled card, never in the wrong uniform (a lifeguard is never a firefighter)
const OTHER_JOBS =
  /\b(life ?guards?|coast ?guards?|rnli|lifeboat|paramedics?|ambulance|farmers?|librarians?|dentists?|pharmacists?|chemists?|optician|builders?|plumbers?|electricians?|mechanics?|chefs?|cooks?|bakers?|butchers?|shop ?keepers?|cleaners?|caretakers?|park ?rangers?|rangers?|soldiers?|pilots?|bus drivers?|drivers?|scientists?|zoo ?keepers?|astronauts?|judges?|lawyers?|carers?|midwi(fe|ves)|surgeons?|vicars?|imams?|rabbis?|priests?)\b/i;
const PROBLEMS = {
  fire: { words: "A house is on fire!", fix: ["firefighter"], emergency: true },
  hurt: {
    words: "Someone has fallen and is badly hurt.",
    fix: ["nurse", "doctor"],
    emergency: true,
  },
  crash: {
    words: "Two cars have crashed on the road.",
    fix: ["police", "firefighter"],
    emergency: true,
  },
  burglar: { words: "Someone is breaking into a house.", fix: ["police"], emergency: true },
  lost: { words: "A child is lost in the town.", fix: ["police"], emergency: false },
  poorly: {
    words: "I feel poorly and need a check-up.",
    fix: ["doctor", "nurse"],
    emergency: false,
  },
  graze: {
    words: "I grazed my knee in the playground.",
    fix: ["teacher", "nurse"],
    emergency: false,
  },
  pet: { words: "My rabbit is poorly.", fix: ["vet"], emergency: false },
  letter: { words: "I want to send a birthday card.", fix: ["postal"], emergency: false },
  bins: { words: "Our bins are full.", fix: ["refuse"], emergency: false },
  crossing: {
    words: "I need to cross the busy road to school.",
    fix: ["lollipop"],
    emergency: false,
  },
  reading: { words: "I want to learn to read.", fix: ["teacher"], emergency: false },
};
const PROBLEM_IDS = Object.keys(PROBLEMS);
// words that name each problem, so typed wording cannot describe a different problem (the slide would ring the wrong helper)
const PKW = {
  fire: /\b(fires?|burning|flames?|smoke)\b/i,
  hurt: /\b(hurt|injured|bleeding|blood|fallen|unconscious)\b/i,
  crash: /\b(crash\w*|collided|collision)\b/i,
  burglar:
    /\b(burglars?|burglary|breaking in|breaking into|break-in|broken into|robbers?|thief|thieves|stealing)\b/i,
  lost: /\blost\b/i,
  poorly: /\b(poorly|ill|sick|check-?up|unwell)\b/i,
  graze: /\b(graz\w*|scraped?|plaster)\b/i,
  pet: /\b(pets?|rabbits?|dogs?|cats?|hamsters?|guinea pigs?|animals?|kittens?|puppy|puppies)\b/i,
  letter: /\b(letters?|cards?|parcels?|post|stamps?)\b/i,
  bins: /\b(bins?|rubbish|recycling)\b/i,
  crossing: /\b(cross\w*|road)\b/i,
  reading: /\b(read\w*|learn\w*)\b/i,
};
// most specific first: "my dog is poorly" is about a pet, not about feeling poorly
const PKW_ORDER = [
  "fire",
  "burglar",
  "crash",
  "pet",
  "graze",
  "hurt",
  "lost",
  "letter",
  "bins",
  "crossing",
  "reading",
  "poorly",
];
// emergency words never belong in a non-emergency problem: the slide would show no emergency number
const EMERG_WORDS =
  /\b(fires?|on fire|hurt|bleeding|crash\w*|breaking in|breaking into|break-in|burglars?|burglary)\b/i;
const PROBLEM_LABELS = [
  "A fire (emergency)",
  "Someone badly hurt (emergency)",
  "A car crash (emergency)",
  "A break-in (emergency)",
  "A lost child",
  "Feeling poorly",
  "A grazed knee",
  "A poorly pet",
  "Sending a card",
  "Full bins",
  "Crossing the road",
  "Learning to read",
];
const LOCALES = ["GB", "IE", "IN", "US", "CA", "AU", "NZ", "ZA", "EU"];
const LOCALE_LABELS = [
  "United Kingdom (999)",
  "Ireland (112 or 999)",
  "India (112)",
  "United States (911)",
  "Canada (911)",
  "Australia (000)",
  "New Zealand (111)",
  "South Africa (112)",
  "Rest of Europe (112)",
];
const PLACE_SIGN = { street: "Our street", school: "Our school", hospital: "Hospital" };

export const params = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  title: "People who help us",
  properties: {
    title: TITLE_PARAM("People who help us"),
    place: {
      type: "string",
      title: "Where we are",
      enum: ["street", "school", "hospital"],
      "x-labels": ["Our street", "School", "Hospital"],
      default: "street",
    },
    placeName: {
      type: "string",
      title: "Name on the sign",
      description: "Leave empty for “Our street”, “Our school” or “Hospital”.",
      maxLength: 24,
      default: "",
    },
    helpers: {
      type: "array",
      title: "Helpers",
      "x-item": "a helper",
      minItems: 1,
      maxItems: 4,
      default: [{ role: "firefighter" }, { role: "police" }, { role: "postal" }],
      items: {
        type: "object",
        required: ["role"],
        default: { role: "firefighter", name: "", job: "", vehicle: true },
        properties: {
          role: {
            type: "string",
            title: "Who",
            description: "Their uniform, tools and vehicle come from this.",
            enum: ROLE_IDS,
            "x-labels": ROLE_LABELS,
            default: "firefighter",
          },
          name: {
            type: "string",
            title: "Name on the slide",
            description: "Leave empty for the job name, or write a real name like “Mrs Patel”.",
            maxLength: 32 /* round 2: what a name holds in two lines with a gutter to its neighbours; longer is refused */,
            default: "",
          },
          job: {
            type: "string",
            title: "What they do",
            description: "Leave empty to use ours.",
            maxLength: 40 /* libfix: what the lane holds at the most items (tools/laneFit); longer is refused, never cut */,
            default: "",
          },
          vehicle: { type: "boolean", title: "Show their vehicle", default: true },
        },
      },
    },
    jobs: {
      type: "boolean",
      title: "Show what they do",
      description: "One step per helper.",
      default: true,
    },
    asks: {
      type: "array",
      title: "Who would you call?",
      description: "A problem appears, then the helper who fixes it is picked out.",
      "x-item": "a problem",
      maxItems: 3,
      default: [],
      items: {
        type: "object",
        required: ["problem"],
        default: { problem: "fire", wording: "", helper: "auto" },
        properties: {
          problem: {
            type: "string",
            title: "Problem",
            enum: PROBLEM_IDS,
            "x-labels": PROBLEM_LABELS,
            default: "fire",
          },
          wording: {
            type: "string",
            title: "Wording",
            description: "Leave empty to use ours.",
            maxLength: 60,
            default: "",
          },
          helper: {
            type: "string",
            title: "Who helps",
            enum: ["auto", ...ROLE_IDS],
            "x-labels": ["Worked out for you", ...ROLE_LABELS],
            default: "auto",
          },
        },
      },
    },
    locale: {
      type: "string",
      title: "Country (for the emergency number)",
      enum: LOCALES,
      "x-labels": LOCALE_LABELS,
      default: "GB",
    },
    cast: {
      type: "integer",
      title: "Change who is drawn",
      description: "Mixes skin tones and hair differently. Every choice is a mixed group.",
      minimum: 0,
      maximum: 5,
      default: 0,
      "x-panel": "advanced",
    },
    text: TEXT_PARAM_FOR({ call: "label" }),
  },
};

export const presets = [
  {
    id: "r-street",
    name: "Reception: people who help us on our street",
    params: {
      title: "People who help us on our street",
      place: "street",
      helpers: [
        { role: "firefighter" },
        { role: "police" },
        { role: "postal" },
        { role: "refuse" },
      ],
      jobs: true,
    },
  },
  {
    id: "r-school",
    name: "Reception: who helps at school?",
    params: {
      title: "Who helps us at school?",
      place: "school",
      placeName: "Oak Tree School",
      helpers: [
        { role: "teacher", name: "Mrs Patel" },
        { role: "lollipop" },
        { role: "nurse", name: "School nurse", job: "looks after us if we feel ill at school" },
      ],
      jobs: true,
      asks: [{ problem: "crossing" }],
    },
  },
  {
    id: "y1-call",
    name: "Year 1: who would you call?",
    params: {
      title: "Who would you call?",
      place: "street",
      helpers: [{ role: "firefighter" }, { role: "police" }, { role: "doctor" }, { role: "vet" }],
      jobs: false,
      asks: [{ problem: "fire" }, { problem: "pet" }, { problem: "burglar" }],
    },
  },
];

/* ------------------------------------------------------------------ model of the data */
const an = (w) => (/^[aeiou]/i.test(w) ? "an" : "a");
const cap1 = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const lc1 = (s) => (s ? s[0].toLowerCase() + s.slice(1) : s);
// a name like "School nurse" or "Our lollipop lady" describes the role rather than naming a person
const roleDesc = (role, name) =>
  KW[role].test(name) &&
  name
    .trim()
    .split(/\s+/)
    .slice(1)
    .every((w) => w === w.toLowerCase());
function model(P) {
  const helpers = (P.helpers || []).map((x, i) => {
    const role = x.role || "firefighter";
    const custom = !!(x.name && x.name.trim());
    const veh = x.vehicle !== false ? VEHICLE[role] || null : null;
    const roleName = ROLES[role] ? ROLES[role].name : NAME[role].toLowerCase();
    const nm = custom ? x.name.trim() : NAME[role];
    const desc = custom && roleDesc(role, nm);
    const det = /^(the|our|my|your|a|an)\s/i.test(nm);
    const who = !custom
      ? `${cap1(an(roleName))} ${roleName}`
      : desc
        ? det
          ? cap1(nm)
          : `The ${lc1(nm)}`
        : nm;
    const the = !custom ? `the ${roleName}` : desc ? (det ? lc1(nm) : `the ${lc1(nm)}`) : nm;
    const card =
      custom &&
      !KW[role].test(nm) &&
      (OTHER_JOBS.test(nm) || ROLE_IDS.some((r) => r !== role && KW[r].test(nm)));
    return {
      i,
      role,
      name: nm,
      custom,
      desc,
      card,
      job: (x.job && x.job.trim()) || (card ? "does an important job" : JOB[role]),
      veh: card ? null : veh,
      roleName,
      who: card ? nm : who,
      the: card ? `the ${lc1(nm)}` : the,
    };
  });
  const num = EMERGENCY[P.locale] || EMERGENCY.GB;
  const asks = (P.asks || []).map((a, j) => {
    const pr = PROBLEMS[a.problem] || PROBLEMS.fire;
    const pick =
      a.helper && a.helper !== "auto"
        ? a.helper
        : pr.fix.find((r) => helpers.some((x) => x.role === r)) || pr.fix[0];
    const hp = helpers.find((x) => x.role === pick) || null;
    const own = !!(a.wording && a.wording.trim());
    const rn = ROLES[pick] ? ROLES[pick].name : NAME[pick].toLowerCase();
    return {
      j,
      id: a.problem,
      words: own ? a.wording.trim() : pr.words,
      own,
      emergency: pr.emergency,
      pick,
      hp,
      the: hp ? hp.the : `${an(rn)} ${rn}`,
    };
  });
  return {
    helpers,
    asks,
    num,
    sign: (P.placeName && P.placeName.trim()) || PLACE_SIGN[P.place] || PLACE_SIGN.street,
  };
}

/* ------------------------------------------------------------------ validate */
export function validate(raw) {
  const P = withDefaults(params, raw);
  const R = schemaCheck(params, P);
  const W = [];
  if (R.length) return result(R);
  const M = model(P);
  M.helpers.forEach((x) => {
    if (!x.custom) return;
    const own = KW[x.role].test(x.name);
    const other = ROLE_IDS.find((r) => r !== x.role && KW[r].test(x.name));
    if (other && !own)
      W.push({
        path: `helpers.${x.i}.name`,
        reason: `This helper is drawn as ${an(x.roleName)} ${x.roleName}, with their uniform and tools, but is named “${x.name}”. Children will see the uniform and the name disagree. Change “Who” to ${an(ROLES[other].name)} ${ROLES[other].name}, or change the name.`,
      });
  });
  const seen = {};
  M.helpers.forEach((x) => {
    if (seen[x.role] != null)
      W.push({
        path: `helpers.${x.i}.role`,
        reason: `There are two ${NAME[x.role].toLowerCase()}s. Children may find one of each easier to tell apart.`,
      });
    seen[x.role] = x.i;
  });
  M.asks.forEach((a) => {
    if (!a.own) return;
    const pr = PROBLEMS[a.id];
    const mine = PKW[a.id].test(a.words);
    const other = PKW_ORDER.find((k) => k !== a.id && PKW[k].test(a.words));
    const label = PROBLEM_LABELS[PROBLEM_IDS.indexOf(a.id)]
      .toLowerCase()
      .replace(/ \(emergency\)$/, "");
    if (!pr.emergency && EMERG_WORDS.test(a.words))
      R.push({
        path: `asks.${a.j}.wording`,
        reason: `“${a.words}” sounds like an emergency, but the problem is ${label}, so the slide would show no emergency number. Pick the matching problem, or change the wording.`,
      });
    else if (other && !mine)
      R.push({
        path: `asks.${a.j}.wording`,
        reason: `“${a.words}” describes ${PROBLEM_LABELS[PROBLEM_IDS.indexOf(other)].toLowerCase().replace(/ \(emergency\)$/, "")}, but the problem is ${label}. Pick the matching problem, or change the wording.`,
      });
  });
  M.asks.forEach((a) => {
    const pr = PROBLEMS[a.id];
    const list = pr.fix.map((r) => `${an(ROLES[r].name)} ${ROLES[r].name}`).join(" or ");
    if (!pr.fix.includes(a.pick))
      R.push({
        path: `asks.${a.j}.helper`,
        reason: `${an(ROLES[a.pick].name) === "an" ? "An" : "A"} ${ROLES[a.pick].name} ${JOB[a.pick]}, so they are not the one to help with “${a.words}” That needs ${list}.`,
      });
    else if (!a.hp)
      W.push({
        path: `asks.${a.j}.problem`,
        reason: `“${a.words}” needs ${list}, who is not on the slide, so the answer is written on the card instead of pointing at a helper. Add one to the helpers to show them.`,
      });
  });
  return result(R, W);
}

/* ------------------------------------------------------------------ builds */
function plan(P) {
  const M = model(P);
  const items = [];
  const where =
    {
      street: "This is our street.",
      school: "This is our school.",
      hospital: "This is the hospital.",
    }[P.place] || "This is our street.";
  items.push({ key: "scene", caption: `${where} Lots of people work here to help us.` });
  M.helpers.forEach((x) =>
    items.push({
      key: `helper:${x.i}`,
      subj: x.i,
      caption: x.card
        ? `${x.name} ${x.job}.`
        : `${x.custom && !x.desc ? `${x.name} is ${an(x.roleName)} ${x.roleName}, who` : x.who} ${TOOLS[x.role]}${x.veh ? ` and drives ${VEH_NAME[x.veh]}` : ""}.`,
    }),
  );
  if (P.jobs)
    M.helpers.forEach((x) =>
      items.push({ key: `job:${x.i}`, subj: x.i, caption: `${x.who} ${x.job}.` }),
    );
  M.asks.forEach((a) => {
    items.push({
      key: `ask:${a.j}`,
      caption: `${a.words} Who would you ${a.emergency ? "call" : "ask"}?`,
    });
    items.push({
      key: `who:${a.j}`,
      ans: a,
      caption: `${cap1(a.the)} can help.${a.emergency ? ` It is an emergency, so call ${M.num}.` : ""}`,
    });
  });
  const summary = M.asks.some((a) => a.emergency)
    ? `These people help us every day. In an emergency, call ${M.num}.`
    : "All these people help us every day.";
  return { M, items, summary };
}
export function builds(P) {
  const { items, summary } = plan(P);
  return {
    steps: items.map(({ key, caption }) => ({ key, caption })),
    summary: { caption: summary },
  };
}

export function notes(P) {
  const { M, items } = plan(P);
  const steps = items.map((it) => {
    if (it.key === "scene")
      return "Ask: who have you seen helping people here? Collect ideas before the helpers appear.";
    if (it.key.startsWith("helper:")) {
      const x = M.helpers[it.subj];
      if (x.card) return `Ask: what does ${x.the} do? How could we tell who they are?`;
      return `Ask: how can we tell this is ${an(x.roleName)} ${x.roleName}? Point to the uniform${x.veh ? " and the vehicle" : ""}. Uniforms help us know who to go to.`;
    }
    if (it.key.startsWith("job:")) {
      const x = M.helpers[it.subj];
      if (x.card) return `Ask: when might we need ${x.the}?`;
      return `Ask: when might we need ${an(x.roleName)} ${x.roleName}? Has anyone met one?`;
    }
    if (it.key.startsWith("ask:"))
      return "Let children tell a partner who could help before you show the answer.";
    const a = it.ans;
    return a.emergency
      ? `This is an emergency, so we call ${M.num}. Only call ${M.num} when someone is badly hurt or in danger, there is a fire, or a crime is happening. Ask a grown-up first if one is near.`
      : `This is not an emergency, so we do not call ${M.num}. We ask ${a.the}, or a grown-up who can help us find them.`;
  });
  return {
    steps,
    summary: M.asks.length
      ? `Recap: which helper would you go to for each problem? Which problems need ${M.num}?`
      : "Recap: point to each helper and ask the class to name them and say how they help.",
  };
}

/* ------------------------------------------------------------------ render */
export function render(root, P, ctx) {
  const { M, items } = plan(P);
  const b = ctx.b,
    N = ctx.N;
  const bi = (key) => b[key] ?? 0;
  // the scene sits as low as the words under it allow, so the helpers are big enough for the back row
  const FOOT = P.jobs ? 494 : 540,
    ROAD1 = FOOT - 14,
    ROAD0 = ROAD1 - 66,
    FAR = ROAD0 - 14,
    NEAR1 = FOOT + 12;
  const NAME_Y = FOOT + 46;
  const n = M.helpers.length;
  const sw = (GRID.right - GRID.left) / n;
  const FS = clamp(sw / 130, 1.6, 2.5),
    VS = clamp((sw - 40) / 170, 1, 1.5),
    GAP = 16;
  const signR = (s) =>
    Math.max(26 * s, measure(root, "STOP", "ts-tiny", { cls: "strong" }) / 2 + 10);
  const signTopAt = (s) => FOOT - 116 * s - 2 * signR(s);
  // the lollipop sign stays clear of the title
  let FSl = FS;
  while (FSl > 1 && signTopAt(FSl) < 100) FSl -= 0.02;
  // the problem card sits beside the lollipop sign (left of it, else right of it); only if neither fits is the lollipop person scaled down below it
  const CARD_Y = 124;
  let cardX = GRID.left,
    cardMax = 600;
  const LP = M.helpers.find((x) => x.role === "lollipop");
  // a helper who is not on the slide is named on the card (one more row) instead of being ringed
  const ANS = 38;
  const cardH = (mx) => {
    const tmp = h("g", {}, root);
    const v = Math.max(
      ...M.asks.map(
        (a) =>
          textBlock(tmp, 0, 0, a.words, { cls: "ts-label", maxW: mx, maxLines: 2, lh: 34 }).h +
          (a.hp ? 0 : ANS),
      ),
    );
    tmp.remove();
    return v;
  };
  // the call pill: its word wraps (two lines, then shrinks) inside a fixed width, and the card leaves room for it
  const EMERG = M.asks.some((a) => a.emergency);
  const callWord = (P.text && P.text["label:call"]) || "Call",
    numW = measure(root, M.num, "ts-num");
  const pillBlock = (p) =>
    textBlock(p, 0, 0, callWord, {
      cls: "ts-label",
      maxW: 300,
      maxLines: 2,
      lh: 28,
      a: { cls: "strong", fill: "var(--on-hue)" },
    });
  const pillSize = (() => {
    const tmp = h("g", {}, root);
    const tb = pillBlock(tmp);
    tmp.remove();
    return { w: tb.w + numW + 56, h: Math.max(64, tb.h + 30) };
  })();
  if (LP && M.asks.length) {
    const scx = GRID.left + (LP.i + 0.5) * sw + 18 * FSl,
      sL = scx - signR(FSl) - 20,
      sR = scx + signR(FSl) + 20;
    if (sL - 8 - GRID.left - 40 >= 360) cardMax = Math.min(600, sL - 8 - GRID.left - 40);
    else if (GRID.right - sR - 8 - 40 >= 360) {
      cardX = sR + 8;
      cardMax = Math.min(600, GRID.right - cardX - 40);
    } else {
      const hh = cardH(600);
      while (FSl > 1 && signTopAt(FSl) < CARD_Y + 30 + hh + 8) FSl -= 0.02;
    }
  }
  if (EMERG) cardMax = Math.min(cardMax, GRID.right - cardX - 40 - 24 - pillSize.w);
  const hMax = M.asks.length ? cardH(cardMax) : 34;
  const lolli = LP ? { top: signTopAt(FSl), bottom: FOOT - 116 * FSl } : null;

  /* the place: sky, buildings, pavement, road */
  const scene = h("g", { s: bi("scene") }, root);
  sky(scene, ctx, FAR);
  const bd = backdrop(scene, P.place, FAR, M.sign, "placeName", {
    lollipop: lolli,
    custom: !!(P.placeName && P.placeName.trim()),
  });
  const signLayer = h("g", {}, scene);
  ground(scene, 0, 1280, FAR, ROAD0, "var(--stone)");
  ground(scene, 0, 1280, ROAD0, ROAD1, "var(--road)");
  for (let x = 20; x < 1280; x += 80)
    h(
      "rect",
      { x, y: (ROAD0 + ROAD1) / 2 - 3, width: 40, height: 6, rx: 3, fill: "var(--road-line)" },
      scene,
    );
  ground(scene, 0, 1280, ROAD1, NEAR1, "var(--stone)");
  h("rect", { x: 0, y: ROAD1, width: 1280, height: 5, fill: "var(--stone-shade)" }, scene);

  /* focus: while a helper or their job is the subject, the others step back; at an answer, the rest go quiet */
  // names and jobs never go soft (they stay legible); they go quiet only at an answer
  const softFor = (i, words) => {
    const own = bi(`helper:${i}`);
    const parts = [];
    items.forEach((it, k) => {
      if (k <= own) return;
      if (!words && it.subj != null && it.subj !== i) parts.push(`${k}-${k + 1}:soft`);
      if (it.ans && it.ans.hp && it.ans.hp.i !== i) parts.push(`${k}-${k + 1}:quiet`);
    });
    return parts.join(",") || null;
  };

  /* helpers: one slot each, vehicle behind on the road, figure in front on the pavement, words below */
  const boxes = [],
    props = [];
  M.helpers.forEach((x) => {
    const sx = GRID.left + x.i * sw,
      cx = sx + sw / 2;
    const g = h("g", { s: bi(`helper:${x.i}`), cls: "rise", c: softFor(x.i) }, root);
    const fs = x.role === "lollipop" ? FSl : FS;
    // the figure is measured, then it and its vehicle sit side by side in the slot with a gap, never overlapping
    const fig = x.card
      ? pictureCard(g, x.name, cx, FOOT, {
          w: Math.min(sw - 24, 150),
          h: 84 * fs,
          model: "community_helpers",
          hint: "person",
        })
      : figure(g, x.role, cx, FOOT, fs, Object.assign({}, look(x.i + (P.cast || 0))));
    if (!x.card) noteArt(x.name, x.role);
    const bb = fig.getBBox();
    const fl = bb.x - cx,
      fr = bb.x + bb.width - cx;
    let fx = cx - (fl + fr) / 2,
      top = FOOT - 84 * fs,
      xR = fx + fr;
    if (x.veh) {
      const [l, r, ht] = VEH_EXT[x.veh];
      const vs = Math.min(VS, (sw - 20 - (fr - fl) - GAP) / (r - l));
      const x0 = cx - (fr - fl + GAP + (r - l) * vs) / 2;
      fx = x0 - fl;
      // the bin lorry gets a green body and a white cab, so it never reads as grey against the grey street
      const v = periodObject(
        g,
        x.veh,
        x0 + (fr - fl) + GAP - l * vs,
        ROAD1 - 6,
        vs,
        x.veh === "bin_lorry"
          ? {
              vars: {
                "--metal": "var(--hue-green)",
                "--metal-shade": "var(--life-shade)",
                "--life": "var(--cloud)",
              },
            }
          : {},
      );
      g.insertBefore(v, fig);
      xR = x0 + (fr - fl) + GAP + (r - l) * vs;
      top = Math.min(top, ROAD1 - 6 - ht * vs);
    }
    fig.setAttribute("transform", `translate(${fx - cx} 0)`);
    if (x.role === "lollipop") top = Math.min(top, lolli.top);
    const maxW = sw - 20; // a 10-unit gutter each side: names and jobs in neighbouring columns never touch
    const lg = h("g", { s: bi(`helper:${x.i}`), cls: "rise", c: softFor(x.i, true) }, root);
    const nb = textBlock(lg, cx, NAME_Y, x.name, {
      cls: "ts-label",
      maxW,
      maxLines: 2,
      lh: 32,
      anchor: "middle",
      a: { fill: "var(--ink)", cls: "strong" },
      edit: `helpers.${x.i}.name`,
    });
    const JOB_Y = NAME_Y + 34 + (nb.lines.length - 1) * nb.lh;
    let bottom = NAME_Y + (nb.lines.length - 1) * nb.lh + 8;
    if (P.jobs) {
      const jg = h("g", { s: bi(`job:${x.i}`), cls: "rise" }, lg);
      // a third line when it still sits above the last content line
      const jb = textBlock(jg, cx, JOB_Y, x.job, {
        cls: "ts-cap",
        maxW,
        maxLines: clamp(Math.floor((GRID.bottom - JOB_Y) / 30) + 1, 2, 3),
        lh: 30,
        anchor: "middle",
        a: { fill: "var(--ink-2)" },
        edit: `helpers.${x.i}.job`,
      });
      bottom = JOB_Y + (jb.lines.length - 1) * jb.lh + 8;
    }
    if (nb.w > maxW + 1) ctx.warn(`The name “${x.name}” is too wide for its place.`);
    boxes[x.i] = { x: sx + 6, y: top - 14, w: sw - 12, h: bottom - top + 28 };
    props.push({ x: fx + fl, y: top - 6, w: xR - fx - fl, h: FOOT - top });
  });

  // the place's sign: clear of every helper's figure and props, and of the problem card row
  if (M.asks.length)
    props.push({
      x: cardX,
      y: CARD_Y,
      w: cardMax + 40 + (EMERG ? 24 + pillSize.w : 0),
      h: Math.max(30 + hMax, EMERG ? pillSize.h : 0),
    });
  bd.sign = bd.placeSign(signLayer, props);
  signLayer.parentNode.appendChild(signLayer);

  /* who would you call: the problem card, then the helper is picked out (and the number, in an emergency) */
  const timed = [];
  M.asks.forEach((a, j) => {
    const kA = bi(`ask:${a.j}`),
      kW = bi(`who:${a.j}`);
    const g = h("g", { s: kA, hide: kW + 1 < N ? kW + 1 : N, cls: "rise" }, root);
    const tmp = h("g", {}, root);
    const tb = textBlock(tmp, 0, 0, a.words, {
      cls: "ts-label",
      maxW: cardMax,
      maxLines: 2,
      lh: 34,
    });
    tmp.remove();
    const ansText = a.hp ? "" : `${cap1(a.the)} can help.`;
    const ansW = a.hp
      ? 0
      : Math.min(cardMax, measure(root, ansText, "ts-label", { cls: "strong" }));
    const card = {
      x: cardX,
      y: CARD_Y,
      w: Math.max(tb.w, ansW) + 40,
      h: 30 + tb.h + (a.hp ? 0 : ANS),
    };
    timed.push(g);
    labelGround(g, card);
    h(
      "rect",
      {
        x: card.x,
        y: card.y,
        width: 8,
        height: card.h,
        fill: a.emergency ? "var(--heat)" : "var(--focus)",
      },
      g,
    );
    textBlock(g, card.x + 24, card.y + 40, a.words, {
      cls: "ts-label",
      maxW: cardMax,
      maxLines: 2,
      lh: 34,
      a: { fill: "var(--ink)" },
      edit: `asks.${a.j}.wording`,
    });
    if (!a.hp) {
      const ag = h("g", { s: kW, cls: "rise" }, g);
      computed(
        textBlock(ag, card.x + 24, card.y + 40 + tb.h + 4, ansText, {
          cls: "ts-label",
          maxW: cardMax,
          maxLines: 1,
          lh: 34,
          a: { fill: "var(--focus)", cls: "strong" },
        }).el,
        `asks.${a.j}.helper`,
      );
    }
    if (a.emergency)
      callPill(root, card.x + card.w + 24, card.y, card.h, {
        s: kW,
        hide: kW + 1 < N ? kW + 1 : N,
        cls: "pop",
      });
    if (!a.hp) return;
    const box = boxes[a.hp.i];
    const ring = h("g", { s: kW, hide: kW + 1 < N ? kW + 1 : N }, root);
    const top =
      bd.sign && box.x < bd.sign.x + bd.sign.w && bd.sign.x < box.x + box.w
        ? Math.max(box.y, bd.sign.y + bd.sign.h + 8)
        : box.y;
    h(
      "rect",
      {
        x: box.x,
        y: top,
        width: box.w,
        height: box.y + box.h - top,
        rx: "var(--r-card)",
        fill: "none",
        stroke: "var(--focus)",
        "stroke-width": "var(--sw-arrow)",
      },
      ring,
    );
  });
  if (EMERG) callPill(root, GRID.left, 124, 64, { s: N, cls: "pop" });

  function callPill(p, x, y, hh, a) {
    const g = h("g", a, p);
    timed.push(g);
    const H = Math.max(hh, pillSize.h),
      w = pillSize.w,
      w1 = w - numW - 56;
    const r = h("rect", { x, y, width: w, height: H, rx: "var(--r-pill)", fill: "var(--heat)" }, g);
    const tb = pillBlock(g);
    const t = tb.el;
    t.setAttribute(
      "transform",
      `translate(${x + 22} ${y + H / 2 + 10 - ((tb.lines.length - 1) * tb.lh) / 2})`,
    );
    editable(t, "text.label:call");
    if (tb.lines.length > 1) r.setAttribute("rx", "var(--r-card)");
    computed(
      T(g, x + 34 + w1, y + H / 2 + 14, M.num, "ts-num", { fill: "var(--on-hue)" }),
      "locale",
    );
    return g;
  }
  // hidden cards share a place with the visible one: only what is on screen takes clicks
  const pe = (k) =>
    timed.forEach((el) => {
      const s = +(el.dataset.s || 0),
        z = el.dataset.h != null ? +el.dataset.h : 1e9;
      el.style.pointerEvents = k >= s && k < z ? "" : "none";
    });
  pe(N);
  return {
    onStep: pe,
    still() {
      pe(N);
    },
    reset() {
      pe(-1);
    },
  };
}
