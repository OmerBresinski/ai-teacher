// Algorithm grid: a floor robot on a squared mat runs a program one instruction per build.
// Any mat size, start, goal and obstacles; a program of moves with counts; an optional
// "repeat the whole program" loop; an optional one-instruction bug that runs first, misses
// the goal, is fixed and rerun. Every move is computed honestly from the program in code.

import { DIRS, gridMarker, gridWorld, robot, turn } from "../kit/batch-H.js";
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
  TEXT_PARAM_FOR,
  TITLE_PARAM,
  textBlock,
  txt,
  withDefaults,
} from "../kit/index.js";

export const meta = {
  id: "algorithm_grid",
  name: "Algorithm grid",
  kind: "scene",
  version: 1,
  subjects: ["Computing"],
  years: ["Reception", "Y1", "Y2", "Y3", "Y4"],
  teaches:
    "An algorithm is a precise sequence of instructions: a floor robot follows them one at a time, and a wrong step is a bug we can find and fix.",
};

const MOVES = ["forward", "back", "left", "right"];
const MOVE_WORDS = { forward: "Forward", back: "Back", left: "Turn left", right: "Turn right" };
const FACING_WORDS = { N: "up", E: "right", S: "down", W: "left" };
const GOAL_WORDS = { flower: "flower", flag: "flag", home: "house" };
const DV = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
const MAX_RUNS = 16;

const COL = (t, max) => ({ type: "integer", title: t, minimum: 1, maximum: max, default: 1 });
const MOVE = {
  type: "string",
  title: "Instruction",
  enum: MOVES,
  "x-labels": ["Forward", "Back", "Turn left", "Turn right"],
  default: "forward",
};

export const params = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  title: "Algorithm grid",
  required: ["program"],
  properties: {
    title: TITLE_PARAM("Program the robot"),
    robotName: {
      type: "string",
      title: "What we call the robot",
      description: "Used in the captions, like “the bee” or “the robot”.",
      default: "the robot",
      minLength: 1,
      maxLength: 24,
    },
    look: {
      type: "string",
      title: "What moves",
      description: "A floor robot on a mat, or a bee in a meadow.",
      enum: ["robot", "bee"],
      "x-labels": ["Floor robot on a mat", "Bee in a meadow"],
      default: "robot",
    },
    cols: { type: "integer", title: "Squares across", minimum: 3, maximum: 8, default: 5 },
    rows: { type: "integer", title: "Squares down", minimum: 3, maximum: 6, default: 4 },
    start: {
      type: "object",
      title: "Start",
      description: "Column 1 is on the left; row 1 is at the top.",
      default: { col: 1, row: 4, facing: "N" },
      properties: {
        col: COL("Column", 8),
        row: COL("Row", 6),
        facing: {
          type: "string",
          title: "Facing",
          enum: DIRS,
          "x-labels": ["Up", "Right", "Down", "Left"],
          default: "N",
        },
      },
    },
    goal: {
      type: "object",
      title: "Goal",
      default: { show: true, col: 3, row: 2, kind: "flower" },
      properties: {
        show: { type: "boolean", title: "Show a goal", default: true },
        col: COL("Column", 8),
        row: COL("Row", 6),
        kind: {
          type: "string",
          title: "Goal is a",
          enum: ["flower", "flag", "home"],
          "x-labels": ["Flower", "Flag", "House"],
          default: "flower",
        },
      },
    },
    obstacles: {
      type: "array",
      title: "Rocks in the way",
      "x-item": "a rock",
      maxItems: 6,
      default: [],
      items: {
        type: "object",
        required: ["col", "row"],
        default: { col: 2, row: 2 },
        properties: { col: COL("Column", 8), row: COL("Row", 6) },
      },
    },
    program: {
      type: "array",
      title: "Program",
      description: "The instructions, in order. Each one is a build.",
      "x-item": "an instruction",
      minItems: 1,
      maxItems: 8,
      default: [
        { move: "forward", count: 2 },
        { move: "right", count: 1 },
        { move: "forward", count: 2 },
      ],
      items: {
        type: "object",
        required: ["move"],
        default: { move: "forward", count: 1 },
        properties: {
          move: MOVE,
          count: {
            type: "integer",
            title: "How many times",
            description:
              "Forward 3 moves three squares. A turn is always a quarter turn on the spot.",
            minimum: 1,
            maximum: 6,
            default: 1,
          },
        },
      },
    },
    repeat: {
      type: "integer",
      title: "Repeat the whole program",
      description: "1 means run it once.",
      minimum: 1,
      maximum: 6,
      default: 1,
    },
    bug: {
      type: "object",
      title: "Debugging",
      description: "Run a program with one wrong instruction first, then fix it and run again.",
      default: { show: false, step: 1, move: "forward", count: 1 },
      properties: {
        show: { type: "boolean", title: "Start with a bug", default: false },
        step: {
          type: "integer",
          title: "Which instruction is wrong",
          minimum: 1,
          maximum: 8,
          default: 1,
        },
        move: Object.assign({}, MOVE, { title: "The wrong instruction" }),
        count: { type: "integer", title: "The wrong count", minimum: 1, maximum: 6, default: 1 },
      },
    },
    trail: { type: "boolean", title: "Draw the path", default: true, "x-panel": "advanced" },
    text: TEXT_PARAM_FOR({
      program: "label",
      repeat: "label",
      forward: "label",
      back: "label",
      left: "label",
      right: "label",
    }),
  },
};

export const presets = [
  {
    id: "rec-bee-flower",
    name: "Reception: get the bee to the flower",
    params: {
      title: "Get the bee to the flower",
      robotName: "the bee",
      look: "bee",
      cols: 4,
      rows: 4,
      start: { col: 1, row: 4, facing: "N" },
      goal: { show: true, col: 3, row: 2, kind: "flower" },
      program: [
        { move: "forward", count: 1 },
        { move: "forward", count: 1 },
        { move: "right", count: 1 },
        { move: "forward", count: 1 },
        { move: "forward", count: 1 },
      ],
    },
  },
  {
    id: "y2-debug",
    name: "Year 2: debug the route",
    params: {
      title: "Debug the route",
      robotName: "the robot",
      cols: 5,
      rows: 4,
      start: { col: 1, row: 4, facing: "E" },
      goal: { show: true, col: 5, row: 4, kind: "flag" },
      obstacles: [
        { col: 3, row: 4 },
        { col: 3, row: 3 },
      ],
      program: [
        { move: "left", count: 1 },
        { move: "forward", count: 2 },
        { move: "right", count: 1 },
        { move: "forward", count: 4 },
        { move: "right", count: 1 },
        { move: "forward", count: 2 },
      ],
      bug: { show: true, step: 4, move: "forward", count: 3 },
    },
  },
  {
    id: "y4-square",
    name: "Year 4: a repeat loop draws a square",
    params: {
      title: "A repeat loop draws a square",
      robotName: "the robot",
      cols: 6,
      rows: 6,
      start: { col: 2, row: 5, facing: "N" },
      goal: { show: false, col: 2, row: 5, kind: "flag" },
      program: [
        { move: "forward", count: 3 },
        { move: "right", count: 1 },
      ],
      repeat: 4,
    },
  },
];

/* ------------------------------------------------------------------ model of the data */
const word = (P, m) => txt(P, `label:${m}`, MOVE_WORDS[m]);
const lc = (s) => (s ? s[0].toLowerCase() + s.slice(1) : s);
const Uc = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const cardText = (P, st) => `${word(P, st.move)}${(st.count || 1) > 1 ? " " + st.count : ""}`;

/** The rocks drawn and obeyed: a rock typed onto the start or the goal square is left off (validate warns). */
const onStart = (o, P) => o.col === P.start.col && o.row === P.start.row;
const onGoal = (o, P) => P.goal && P.goal.show && o.col === P.goal.col && o.row === P.goal.row;
const rocks = (P) => (P.obstacles || []).filter((o) => !onStart(o, P) && !onGoal(o, P));
/** Run a program honestly: every card, every count, every round. Stops at the first impossible move:
 *  the instruction that would leave the mat or hit a rock is kept as a run (with the squares it managed) and marked err. */
function runAll(P, prog) {
  const blocked = new Set(rocks(P).map((o) => `${o.col},${o.row}`));
  let cur = {
    c: P.start.col,
    r: P.start.row,
    dir: P.start.facing || "N",
    deg: DIRS.indexOf(P.start.facing || "N") * 90,
  };
  const start = Object.assign({}, cur);
  const runs = [];
  let error = null;
  for (let r = 0; r < (P.repeat || 1) && !error; r++)
    for (let i = 0; i < prog.length && !error; i++) {
      const st = prog[i];
      const subs = [Object.assign({}, cur)];
      for (let n = 0; n < (st.count || 1); n++) {
        const nx = Object.assign({}, cur);
        if (st.move === "left" || st.move === "right") {
          nx.dir = turn(cur.dir, st.move);
          nx.deg = cur.deg + (st.move === "left" ? -90 : 90);
          nx.turn = true;
        } else {
          const [dx, dy] = DV[cur.dir],
            m = st.move === "forward" ? 1 : -1;
          nx.c += dx * m;
          nx.r += dy * m;
          nx.turn = false;
        }
        if (nx.c < 1 || nx.r < 1 || nx.c > P.cols || nx.r > P.rows) {
          error = { i, r, kind: "off", at: nx, done: n };
          break;
        }
        if (blocked.has(`${nx.c},${nx.r}`)) {
          error = { i, r, kind: "rock", at: nx, done: n };
          break;
        }
        cur = nx;
        subs.push(Object.assign({}, cur));
      }
      runs.push({ r, i, st, subs, err: error });
    }
  return { start, runs, end: cur, error };
}
const buggyProgram = (P) =>
  P.program.map((s, i) =>
    P.bug && P.bug.show && i === P.bug.step - 1 ? { move: P.bug.move, count: P.bug.count || 1 } : s,
  );
const cellsOf = (run) => {
  const out = [[run.start.c, run.start.r]];
  for (const x of run.runs) for (const s of x.subs.slice(1)) if (!s.turn) out.push([s.c, s.r]);
  return out;
};
/** What shape a closed path makes: corners from the visited cells. */
function shapeOf(run) {
  const cs = cellsOf(run);
  if (cs.length < 3) return null;
  const a = cs[0],
    z = cs[cs.length - 1];
  if (a[0] !== z[0] || a[1] !== z[1]) return null;
  // a path out and straight back ends where it began but encloses nothing: that is not a shape
  let area = 0;
  for (let i = 0; i < cs.length - 1; i++) area += cs[i][0] * cs[i + 1][1] - cs[i + 1][0] * cs[i][1];
  if (area === 0) return { kind: "back" };
  const corners = [];
  for (let i = 0; i < cs.length - 1; i++) {
    const p = cs[(i - 1 + cs.length - 1) % (cs.length - 1)],
      q = cs[i],
      n = cs[i + 1];
    if ((q[0] - p[0]) * (n[1] - q[1]) - (q[1] - p[1]) * (n[0] - q[0]) !== 0) corners.push(q);
  }
  if (corners.length !== 4) return { kind: "closed" };
  const side = (u, v) => Math.abs(u[0] - v[0]) + Math.abs(u[1] - v[1]);
  const sides = corners.map((c, i) => side(c, corners[(i + 1) % 4]));
  const axis = corners.every((c, i) => {
    const d = corners[(i + 1) % 4];
    return c[0] === d[0] || c[1] === d[1];
  });
  if (!axis) return { kind: "closed" };
  return sides.every((s) => s === sides[0])
    ? { kind: "square", side: sides[0] }
    : { kind: "rectangle", a: sides[0], b: sides[1] };
}
const at = (run, P) =>
  P.goal && P.goal.show && run.end.c === P.goal.col && run.end.r === P.goal.row;
const dist = (e, P) => Math.abs(e.c - P.goal.col) + Math.abs(e.r - P.goal.row);
const sq = (n) => `${n} square${n === 1 ? "" : "s"}`;
const would = (e) => (e.kind === "off" ? "take it off the mat" : "drive it into a rock");
/** Whether the debugging story can be told: a real goal, a wrong instruction that differs, a fixed program that
 *  reaches the goal and a buggy one that does not. When it cannot, the slide runs the program without the bug and says why. */
function bugState(P) {
  const B = P.bug;
  if (!B || !B.show) return { on: false };
  const g = GOAL_WORDS[P.goal.kind],
    R = P.robotName || "the robot";
  if (B.step > P.program.length)
    return {
      on: false,
      why: `The program has ${P.program.length} instructions, so there is no instruction ${B.step} to get wrong. The slide runs the program without a bug.`,
    };
  const right = P.program[B.step - 1];
  if (right.move === B.move && (right.count || 1) === (B.count || 1))
    return {
      on: false,
      why: `The wrong instruction is the same as the right one (${cardText(P, right)}), so there is no bug to show yet. Change the wrong instruction.`,
    };
  if (!P.goal.show)
    return {
      on: false,
      why: "A bug needs a goal, so the class can see the robot miss it. Turn on the goal to show the bug.",
    };
  const good = runAll(P, P.program);
  if (good.error || !at(good, P))
    return {
      on: false,
      why: `The right program does not take ${R} to the ${g} yet, so fixing the bug would not work. The slide runs the program without a bug until it does.`,
    };
  const bp = buggyProgram(P),
    bad = runAll(P, bp);
  if (!bad.error && at(bad, P))
    return {
      on: false,
      why: `With the wrong instruction ${R} still reaches the ${g}, so the class would not see a bug. Choose a different wrong instruction.`,
    };
  return { on: true, bp, bad };
}

/* ------------------------------------------------------------------ validate */
export function validate(raw) {
  const P = withDefaults(params, raw);
  const R = schemaCheck(params, P);
  const W = [];
  if (R.length) return result(R);
  const inside = (path, c, r, what) => {
    if (c > P.cols)
      R.push({
        path: `${path}.col`,
        reason: `${what} is in column ${c}, but the mat is only ${P.cols} squares across.`,
      });
    if (r > P.rows)
      R.push({
        path: `${path}.row`,
        reason: `${what} is in row ${r}, but the mat is only ${P.rows} squares down.`,
      });
  };
  inside("start", P.start.col, P.start.row, "The start");
  if (P.goal.show) inside("goal", P.goal.col, P.goal.row, `The ${GOAL_WORDS[P.goal.kind]}`);
  P.obstacles.forEach((o, i) => inside(`obstacles.${i}`, o.col, o.row, `Rock ${i + 1}`));
  if (R.length) return result(R);
  P.obstacles.forEach((o, i) => {
    if (onStart(o, P))
      W.push({
        path: `obstacles.${i}`,
        reason: `Rock ${i + 1} is on the start square, where the robot stands, so it is left off the mat. Move the rock to show it.`,
      });
    else if (onGoal(o, P))
      W.push({
        path: `obstacles.${i}`,
        reason: `Rock ${i + 1} is on the ${GOAL_WORDS[P.goal.kind]}, so it is left off the mat. Move the rock to show it.`,
      });
  });
  if (R.length) return result(R);
  const good = runAll(P, P.program);
  const e = good.error;
  let runs = good.runs.length;
  if (e)
    W.push({
      path: `program.${e.i}`,
      reason: `Instruction ${e.i + 1} (${cardText(P, P.program[e.i])})${P.repeat > 1 ? ` on round ${e.r + 1}` : ""} would ${would(e)}, so the slide stops the robot there. Change that instruction if you want it to finish.`,
    });
  const B = bugState(P);
  if (B.why) W.push({ path: "bug", reason: B.why });
  if (B.on) runs += B.bad.runs.length;
  if (runs > MAX_RUNS)
    R.push({
      path: P.repeat > 1 ? "repeat" : "program",
      reason: `That makes ${runs} instructions to run one at a time; one slide can step through ${MAX_RUNS}. Use fewer instructions or fewer repeats.`,
    });
  return result(R, W);
}

/* ------------------------------------------------------------------ builds */
function plan(P) {
  const R = P.robotName || "the robot";
  const g = GOAL_WORDS[P.goal.kind];
  const T2 = P.repeat || 1;
  const good = runAll(P, P.program);
  const B = bugState(P);
  const bug = B.on;
  const bp = bug ? B.bp : null;
  const bad = bug ? B.bad : null;
  const items = [];
  items.push({
    key: "mat",
    caption: `${Uc(R)} starts here, facing ${FACING_WORDS[P.start.facing]}.${P.goal.show ? (P.goal.col === P.start.col && P.goal.row === P.start.row ? ` Get it back to the ${g}.` : ` Get it to the ${g}.`) : ""}`,
  });
  const n = P.program.length;
  items.push({
    key: "program",
    caption: `The program: ${n} instruction${n === 1 ? "" : "s"}${T2 > 1 ? `, repeated ${T2} times` : ""}, in order.`,
  });
  const runCap = (x) => {
    const c = x.st.count || 1,
      pre = T2 > 1 ? `Round ${x.r + 1}: ` : "";
    if (x.err)
      return `${pre}${cardText(P, x.st)}: ${x.err.done ? `${R} moves ${sq(x.err.done)}, then the next move would ${would(x.err)}, so it stops.` : `the first move would ${would(x.err)}, so ${R} stops.`}`;
    if (x.st.move === "left" || x.st.move === "right")
      return `${pre}${cardText(P, x.st)}: ${R} turns on the spot, ${c === 1 ? "a quarter turn" : `${c} quarter turns`}.`;
    return `${pre}${cardText(P, x.st)}: ${R} moves ${sq(c)} ${x.st.move === "back" ? "back, still facing the same way" : "forward"}.`;
  };
  const steps = [];
  if (bug) {
    bad.runs.forEach((x) =>
      steps.push({ key: `try:${x.r}.${x.i}`, caption: runCap(x), run: x, buggy: true }),
    );
    items.push(...steps.splice(0));
    const d = dist(bad.end, P);
    items.push({
      key: "miss",
      caption: bad.error
        ? `${Uc(R)} stopped before the ${g}: instruction ${bad.error.i + 1} would ${would(bad.error)}. There is a bug.`
        : `${Uc(R)} stopped ${sq(d)} from the ${g}, not on it. There is a bug.`,
    });
    const right = P.program[P.bug.step - 1];
    items.push({
      key: "fix",
      caption: `Debug: instruction ${P.bug.step} should be ${cardText(P, right)}, not ${cardText(P, bp[P.bug.step - 1])}.`,
    });
    items.push({
      key: "rerun",
      caption: `Run the fixed program again: ${R} reaches the ${g}.`,
      rerun: true,
    });
  } else
    good.runs.forEach((x) => items.push({ key: `run:${x.r}.${x.i}`, caption: runCap(x), run: x }));
  // summary: the result
  const shape = good.error ? null : shapeOf(good);
  let summary;
  if (good.error)
    summary = `${Uc(R)} stopped at instruction ${good.error.i + 1}${T2 > 1 ? ` on round ${good.error.r + 1}` : ""}: the next move would ${would(good.error)}. What would you change?`;
  else if (shape && shape.kind === "square")
    summary = `${T2 > 1 ? `Repeat ${T2} times` : "This program"} draws a square, ${sq(shape.side)} on each side, and ends back at the start.`;
  else if (shape && shape.kind === "rectangle")
    summary = `${T2 > 1 ? `Repeat ${T2} times` : "This program"} draws a rectangle and ends back at the start.`;
  else if (shape && shape.kind === "back") summary = `${Uc(R)} ends back where it started.`;
  else if (shape) summary = `The path is a closed shape: ${R} ends back where it started.`;
  else if (P.goal.show && at(good, P) && P.goal.col === P.start.col && P.goal.row === P.start.row)
    summary = `${Uc(R)} ends back at the ${g}, where it started.`;
  else if (P.goal.show && at(good, P))
    summary = bug
      ? `Found and fixed: one wrong instruction stopped ${R} reaching the ${g}.`
      : `${n} instruction${n === 1 ? "" : "s"}${T2 > 1 ? `, repeated ${T2} times,` : ""} take ${R} from the start to the ${g}.`;
  else if (P.goal.show)
    summary = `The program ends ${sq(dist(good.end, P))} from the ${g}. What would you change?`;
  else summary = `${Uc(R)} followed all ${good.runs.length} instructions, one at a time.`;
  return { items, summary, good, bad, bug, bp, shape };
}
export function builds(P) {
  const { items, summary } = plan(P);
  return {
    steps: items.map(({ key, caption }) => ({ key, caption })),
    summary: { caption: summary },
  };
}

export function notes(P) {
  const { items, good, shape } = plan(P);
  const R = P.robotName || "the robot";
  const steps = items.map((it) => {
    if (it.key === "mat")
      return `Ask: which way is ${R} facing? Its front is where its eyes are. Every move depends on that.`;
    if (it.key === "program")
      return "Read the program aloud together before running it. Ask the class to predict, with a finger on the mat, where it will stop.";
    if (it.key === "miss")
      return "Ask: which instruction went wrong? Step through the program again, one instruction at a time, to find the first place it goes wrong.";
    if (it.key === "fix")
      return "Finding and fixing a mistake in a program is called debugging. We change only the wrong instruction, then test again.";
    if (it.key === "rerun")
      return "Testing after a fix matters: run the whole program again from the start.";
    const x = it.run;
    if (!x) return "";
    if (x.err)
      return `${R} only follows its instructions: it cannot see the ${x.err.kind === "off" ? "edge of the mat" : "rock"}. A real floor robot would ${x.err.kind === "off" ? "fall off" : "bump into it and get stuck"}, so we stop it here. Ask: which instruction would you change?`;
    const round =
      P.repeat > 1
        ? ` Round ${x.r + 1} of ${P.repeat}: the same instructions again, starting where the last round ended.`
        : "";
    if (x.st.move === "left" || x.st.move === "right")
      return `A turn happens on the spot: ${R} stays in its square and makes a quarter turn (90°). It does not move forward.${round}`;
    if (x.st.move === "back")
      return `Back moves ${R} without turning it round: it reverses.${round}`;
    return `Forward moves ${R} the way it is facing, one square for each press.${round}`;
  });
  const summary =
    shape && shape.kind === "square"
      ? `A loop saves writing the same instructions again: ${P.program.length} instructions repeated ${P.repeat} times make ${good.runs.length} moves. Ask: what would repeat 3 times draw?`
      : "Ask the class to write a different program that reaches the same place. Is there a shorter one?";
  return { steps, summary };
}

/* ------------------------------------------------------------------ render */
/** A bee seen from above, head first, the same pose interface as the kit robot. No wheels. */
function bee(p, { x = 0, y = 0, size = 64, dir = "N" } = {}) {
  const outer = h("g", {}, p);
  const pose = h("g", {}, outer);
  const body = h("g", { transform: `scale(${size / 64})` }, pose);
  const dark = "var(--hull)";
  for (const sx of [-1, 1])
    h(
      "ellipse",
      {
        cx: sx * 19,
        cy: 0,
        rx: 17,
        ry: 11,
        transform: `rotate(${sx * 28} ${sx * 19} 0)`,
        fill: "color-mix(in oklab,var(--hue-blue) 16%,var(--paper))",
        stroke: "var(--ink-3)",
        "stroke-width": "var(--sw-rule)",
      },
      body,
    );
  h("path", { d: "M-5 26 L0 35 L5 26 Z", fill: dark }, body);
  h("ellipse", { cx: 0, cy: 6, rx: 16, ry: 22, fill: "var(--energy)", cls: "body" }, body);
  // stripes follow the body's outline
  const hw = (yy) => 16 * Math.sqrt(Math.max(0, 1 - ((yy - 6) / 22) ** 2));
  for (const [a, z] of [
    [2, 8],
    [14, 20],
  ])
    h(
      "polygon",
      { points: `${-hw(a)},${a} ${hw(a)},${a} ${hw(z)},${z} ${-hw(z)},${z}`, fill: dark },
      body,
    );
  h("circle", { cx: 0, cy: -20, r: 11, fill: dark }, body);
  for (const ex of [-1, 1]) {
    h(
      "path",
      {
        d: `M${ex * 4} -29 Q${ex * 8} -38 ${ex * 13} -39`,
        fill: "none",
        stroke: dark,
        "stroke-width": "var(--sw-struct)",
        "stroke-linecap": "round",
      },
      body,
    );
    h("circle", { cx: ex * 5, cy: -22, r: 4, fill: "var(--paper)" }, body);
    h("circle", { cx: ex * 5, cy: -23, r: 2, fill: "var(--ink)" }, body);
  }
  outer.pose = (px, py, d) =>
    pose.setAttribute(
      "transform",
      `translate(${px} ${py}) rotate(${typeof d === "number" ? d : DIRS.indexOf(d) * 90})`,
    );
  outer.pose(x, y, dir);
  return outer;
}
export function render(root, P, ctx) {
  const { items, good, bad, bug, bp } = plan(P);
  const b = ctx.b;
  const N = ctx.N;
  const bi = (k) => b[k] ?? 0;
  /* layout: mat on the left, program cards on the right, the pair centred on the slide */
  const GAP = 64,
    top = GRID.top + 8,
    availH = GRID.bottom - top,
    LW = GRID.right - GRID.left;
  const cell = Math.floor(Math.min(140, (LW - 400 - GAP) / P.cols, availH / P.rows));
  const mw = P.cols * cell,
    mh = P.rows * cell;
  const PW = clamp(LW - mw - GAP, 400, 540);
  const x0 = GRID.left + (GRID.right - GRID.left - (mw + GAP + PW)) / 2;
  const my = top + (availH - mh) / 2;
  const W = gridWorld(root, P.cols, P.rows, { x: x0, y: my, cell, a: { s: 0 } });
  const cx = (c) => W.cx(c - 1),
    cy = (r) => W.cy(r - 1);
  // the setting: a meadow for the bee, a classroom floor mat for a robot; a tint only, nothing more
  const isBee = P.look === "bee";
  W.g.children[0].setAttribute(
    "fill",
    isBee
      ? "color-mix(in oklab,var(--hue-green) 30%,var(--panel))"
      : "color-mix(in oklab,var(--hue-brown) 24%,var(--panel))",
  );
  W.g.insertBefore(
    h("rect", {
      x: x0,
      y: my,
      width: mw,
      height: mh,
      fill: isBee
        ? "color-mix(in oklab,var(--hue-green) 14%,var(--paper))"
        : "color-mix(in oklab,var(--hue-brown) 8%,var(--paper))",
    }),
    W.g.children[2],
  );
  // squares a class can count from the back, in every theme
  const gl = {
    stroke: "color-mix(in oklab,var(--ink) 34%,var(--paper))",
    "stroke-width": "var(--sw-hair)",
  };
  for (let c = 1; c < P.cols; c++)
    h(
      "line",
      Object.assign({ x1: x0 + c * cell, x2: x0 + c * cell, y1: my, y2: my + mh }, gl),
      root,
    );
  for (let r = 1; r < P.rows; r++)
    h(
      "line",
      Object.assign({ x1: x0, x2: x0 + mw, y1: my + r * cell, y2: my + r * cell }, gl),
      root,
    );
  // start square: a pale tint, so the still shows where the path began
  h(
    "rect",
    {
      x: cx(P.start.col) - cell / 2 + 3,
      y: cy(P.start.row) - cell / 2 + 3,
      width: cell - 6,
      height: cell - 6,
      rx: "var(--r-mark)",
      fill: "color-mix(in oklab,var(--focus) 22%,var(--paper))",
      stroke: "color-mix(in oklab,var(--focus) 60%,var(--paper))",
      "stroke-width": "var(--sw-rule)",
    },
    root,
  );
  for (const o of rocks(P)) gridMarker(root, W, o.col - 1, o.row - 1, "block");
  // the goal: when the robot arrives it sits on the goal square, so the goal moves to the corner and the square is tinted
  const reached = P.goal.show && !good.error && at(good, P);
  let arriveK = null;
  if (reached)
    arriveK = bug
      ? bi("rerun")
      : bi(`run:${good.runs[good.runs.length - 1].r}.${good.runs[good.runs.length - 1].i}`);
  if (P.goal.show) {
    if (reached)
      h(
        "rect",
        {
          x: cx(P.goal.col) - cell / 2 + 3,
          y: cy(P.goal.row) - cell / 2 + 3,
          width: cell - 6,
          height: cell - 6,
          rx: "var(--r-mark)",
          fill: "color-mix(in oklab,var(--life) 22%,var(--paper))",
          s: arriveK,
          delay: 600,
        },
        root,
      );
    gridMarker(
      root,
      { cell: cell * 1.25, cx: W.cx, cy: W.cy },
      P.goal.col - 1,
      P.goal.row - 1,
      P.goal.kind,
      { a: { hide: reached ? arriveK : null } },
    );
  }

  /* trails: one polyline per run build, drawn on in step with the robot (tick) */
  const trailG = h("g", {}, root);
  const trails = [];
  const pt = (s) => [cx(s.c), cy(s.r)];
  const addTrail = (run, k, buggy, after) => {
    const pts = run.subs.filter((s, j) => j === 0 || !s.turn).map(pt);
    if (pts.length < 2 || !P.trail) return;
    const el = h(
      "polyline",
      {
        points: pts.map((p) => p.join(",")).join(" "),
        fill: "none",
        stroke: buggy ? "var(--event)" : "var(--focus)",
        "stroke-width": "var(--sw-data)",
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
        pathLength: 1,
        "stroke-dasharray": "1 1",
        "stroke-dashoffset": 1,
        s: k,
        c: buggy ? `${bi("fix")}:soft` : null,
      },
      trailG,
    );
    trails.push({ el, k, run });
  };
  // robot moves per build: a list of sub-poses; a run build walks them, other builds hold still
  const moves = {};
  if (bug) {
    bad.runs.forEach((x) => {
      const k = bi(`try:${x.r}.${x.i}`);
      moves[k] = x.subs;
      addTrail(x, k, true);
    });
    const k = bi("rerun");
    const all = [Object.assign({}, good.start)];
    good.runs.forEach((x) => all.push(...x.subs.slice(1)));
    moves[k] = all;
    good.runs.forEach((x) => addTrail(x, k, false));
    // where the bug ended: a ring that stays, quietly, as the ghost of the wrong run
    h(
      "rect",
      {
        x: cx(bad.end.c) - cell / 2 + 6,
        y: cy(bad.end.r) - cell / 2 + 6,
        width: cell - 12,
        height: cell - 12,
        rx: "var(--r-mark)",
        fill: "color-mix(in oklab,var(--event) 10%,transparent)",
        stroke: "var(--event)",
        "stroke-width": "var(--sw-struct)",
        "stroke-dasharray": "10 6",
        s: bi("miss"),
        cls: "pop",
        c: `${bi("miss") + 1}:soft`,
      },
      root,
    );
  } else {
    good.runs.forEach((x) => {
      const k = bi(`run:${x.r}.${x.i}`);
      moves[k] = x.subs;
      addTrail(x, k, false);
    });
    // a program that would leave the mat or hit a rock: the robot stops, and a dashed ring marks where it stopped
    if (good.error) {
      const k = bi(`run:${good.error.r}.${good.error.i}`);
      h(
        "rect",
        {
          x: cx(good.end.c) - cell / 2 + 6,
          y: cy(good.end.r) - cell / 2 + 6,
          width: cell - 12,
          height: cell - 12,
          rx: "var(--r-mark)",
          fill: "color-mix(in oklab,var(--event) 10%,transparent)",
          stroke: "var(--event)",
          "stroke-width": "var(--sw-struct)",
          "stroke-dasharray": "10 6",
          s: k,
          cls: "pop",
          delay: 600,
        },
        root,
      );
    }
  }
  const bot = (isBee ? bee : robot)(root, {
    x: cx(P.start.col),
    y: cy(P.start.row),
    size: cell * 0.76,
    dir: P.start.facing,
  });
  if (reached) {
    const small = {
      cell: cell * 0.42,
      cx: () => cx(P.goal.col) + cell * 0.3,
      cy: () => cy(P.goal.row) - cell * 0.3,
    };
    gridMarker(root, small, 0, 0, P.goal.kind, { a: { s: arriveK, cls: "pop", delay: 600 } });
  }
  // pose at the end of build k (or the start when nothing has moved yet)
  const ks = Object.keys(moves)
    .map(Number)
    .sort((a, z) => a - z);
  const restAt = (k) => {
    let s = good.start;
    for (const j of ks) if (j < k) s = moves[j][moves[j].length - 1];
    return s;
  };
  const restBefore = (k) => (bug && k === bi("rerun") ? good.start : restAt(k));

  /* program cards */
  const px = x0 + mw + GAP;
  const words = new Set();
  const loop = P.repeat > 1;
  const ix = loop ? 30 : 0;
  const n = P.program.length;
  const cw = PW - ix;
  const cards = [];
  // measure every card first so heights adapt to long edits: a long label wraps to three lines and shrinks
  // before anything is cut; if the block will not fit, labels drop to fewer lines
  const lab = (st) => word(P, st.move);
  const labW = (st) => cw - 92 - ((st.count || 1) > 1 ? 84 : 20);
  // the heading and the repeat row wrap to two lines on a long edit, and the cards make room for them
  const head = txt(P, "label:program", "Program");
  const rw = txt(P, "label:repeat", "Repeat");
  const roundW = loop
    ? measure(root, `Round ${P.repeat} of ${P.repeat}`, "ts-cap", { cls: "strong" })
    : 0;
  const timesW = loop ? measure(root, `× ${P.repeat}`, "ts-label", { cls: "strong" }) : 0;
  const repW = PW - roundW - timesW - 40;
  const tmpH = h("g", {}, root);
  const headTB = textBlock(tmpH, 0, 0, head, { cls: "ts-h3", maxW: PW, maxLines: 2, lh: 34 });
  const repTB = loop
    ? textBlock(tmpH, 0, 0, rw, {
        cls: "ts-label",
        maxW: repW,
        maxLines: 2,
        lh: 30,
        a: { cls: "strong" },
      })
    : null;
  tmpH.remove();
  const headX = (headTB.lines.length - 1) * headTB.lh,
    repX = repTB ? (repTB.lines.length - 1) * repTB.lh : 0;
  const gap = 10,
    room = GRID.bottom - 128,
    head0 = 50 + headX + (loop ? 52 + repX : 0);
  // cards shrink to the room the program needs (down to one label line), so 8 instructions and a loop still fit
  const minH = clamp(Math.floor((room - head0 - gap * (n - 1)) / n), 44, 84);
  let ML = 3,
    hs,
    blockH,
    cut = false;
  for (const [ml, pad] of [
    [3, 24],
    [2, 24],
    [2, 14],
    [1, 24],
    [1, 12],
  ]) {
    ML = ml;
    const tmp = h("g", {}, root);
    cut = false;
    const meas = (st) => {
      const t = textBlock(tmp, 0, 0, lab(st), {
        cls: "ts-label",
        maxW: labW(st),
        maxLines: ML,
        lh: 30,
      });
      if (/…$/.test(t.lines[t.lines.length - 1]) && !/…$/.test(lab(st))) cut = true;
      return t;
    };
    hs = P.program.map((st, i) => {
      const a = meas(st),
        z = bug && i === P.bug.step - 1 ? meas(bp[i]) : a;
      return Math.max(minH, Math.max(a.h, z.h) + pad);
    });
    tmp.remove();
    blockH = head0 + hs.reduce((s, v) => s + v, 0) + gap * (n - 1);
    if (blockH <= room) break;
  }
  if (blockH > room)
    ctx.warn("The program cards do not fit: use shorter instruction words or fewer instructions.");
  else if (cut)
    ctx.warn("An instruction label is too long to show in full on its card: shorten it.");
  const by = clamp(my, 128, GRID.bottom - blockH);
  const cardsG = h("g", { s: bi("program"), cls: "rise" }, root);
  textBlock(cardsG, px, by + 26, head, {
    cls: "ts-h3",
    maxW: PW,
    maxLines: 2,
    lh: 34,
    edit: "text.label:program",
  });
  let y = by + 50 + headX;
  if (loop) {
    const rt = textBlock(cardsG, px, y + 30, rw, {
      cls: "ts-label",
      maxW: repW,
      maxLines: 2,
      lh: 30,
      a: { fill: "var(--focus-text)", cls: "strong" },
      edit: "text.label:repeat",
    });
    const tw = rt.lines.length > 1 ? rt.w : measure(root, rt.lines[0], rt.cls, { cls: "strong" });
    computed(
      T(cardsG, px + Math.max(tw, rt.w) + 12, y + 30 + repX, `× ${P.repeat}`, rt.cls, {
        fill: "var(--focus-text)",
        cls: "strong",
      }),
      "repeat",
    );
    // round counter: which time round the loop we are on, one per round
    for (let r = 0; r < P.repeat; r++) {
      const ks0 = (bug ? bad : good).runs
        .filter((x) => x.r === r)
        .map((x) => bi(`${bug ? "try" : "run"}:${x.r}.${x.i}`));
      if (!ks0.length) continue;
      const k0 = Math.min(...ks0),
        k1 = Math.max(...ks0) + 1;
      computed(
        T(root, px + PW, y + 30, `Round ${r + 1} of ${P.repeat}`, "ts-cap", {
          "text-anchor": "end",
          fill: "var(--ink-2)",
          cls: "strong",
          s: k0,
          hide: k1,
        }),
        "repeat",
      );
    }
    y += 52 + repX;
  }
  const yTop = y;
  const drawFace = (g, st, i, cy0, hh, edit) => {
    // arrow glyph: forward up, back down, turns curl left or right
    const gx = 0,
      gy = 0;
    const gs = clamp(minH / 60, 1, 1.3);
    const ar = {
      stroke: "var(--ink-2)",
      "stroke-width": "var(--sw-struct)",
      fill: "none",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "vector-effect": "non-scaling-stroke",
    };
    const gg = g;
    g = h("g", { transform: `translate(${px + ix + 62} ${cy0}) scale(${gs})` }, gg);
    if (st.move === "forward") {
      h(
        "path",
        Object.assign(
          {
            d: `M${gx} ${gy + 13} L${gx} ${gy - 13} M${gx - 9} ${gy - 4} L${gx} ${gy - 13} L${gx + 9} ${gy - 4}`,
          },
          ar,
        ),
        g,
      );
    } else if (st.move === "back") {
      h(
        "path",
        Object.assign(
          {
            d: `M${gx} ${gy - 13} L${gx} ${gy + 13} M${gx - 9} ${gy + 4} L${gx} ${gy + 13} L${gx + 9} ${gy + 4}`,
          },
          ar,
        ),
        g,
      );
    } else {
      const s = st.move === "left" ? -1 : 1;
      h(
        "path",
        Object.assign(
          {
            d: `M${gx - 6 * s} ${gy + 14} L${gx - 6 * s} ${gy} Q${gx - 6 * s} ${gy - 9} ${gx + 3 * s} ${gy - 9} L${gx + 12 * s} ${gy - 9} M${gx + 5 * s} ${gy - 16} L${gx + 12 * s} ${gy - 9} L${gx + 5 * s} ${gy - 2}`,
          },
          ar,
        ),
        g,
      );
    }
    g = gg;
    const tb = textBlock(g, px + ix + 92, 0, lab(st), {
      cls: "ts-label",
      maxW: labW(st),
      maxLines: ML,
      lh: 30,
      a: { fill: "var(--ink)" },
      edit: `text.label:${st.move}`,
    });
    tb.el.setAttribute("y", cy0 + 10 - ((tb.lines.length - 1) * tb.lh) / 2);
    tb.el.querySelectorAll("tspan").forEach((s, j) => j || s.setAttribute("dy", 0));
    if ((st.count || 1) > 1)
      computed(
        T(g, px + PW - 18, cy0 + 12, `× ${st.count}`, "ts-label", {
          "text-anchor": "end",
          fill: "var(--ink)",
          cls: "strong",
        }),
        edit,
      );
    words.add(st.move);
  };
  const allRunKs = (bug ? bad.runs : good.runs).map((x) =>
    bi(`${bug ? "try" : "run"}:${x.r}.${x.i}`),
  );
  P.program.forEach((st, i) => {
    const hh = hs[i];
    const c0 = y + hh / 2;
    const isBug = bug && i === P.bug.step - 1;
    const card = h("g", {}, cardsG);
    h(
      "rect",
      {
        x: px + ix,
        y,
        width: cw,
        height: hh,
        rx: "var(--r-mark)",
        fill: "var(--paper)",
        stroke: "var(--rule)",
        "stroke-width": "var(--sw-rule)",
      },
      card,
    );
    // highlight while this card runs (and its fix)
    const runKs = (bug ? bad.runs : good.runs)
      .filter((x) => x.i === i)
      .map((x) => bi(`${bug ? "try" : "run"}:${x.r}.${x.i}`));
    for (const k of runKs)
      h(
        "rect",
        {
          x: px + ix,
          y,
          width: cw,
          height: hh,
          rx: "var(--r-mark)",
          fill: "var(--focus-pale)",
          stroke: "color-mix(in oklab,var(--focus) 55%,var(--paper))",
          "stroke-width": "var(--sw-rule)",
          s: k,
          hide: k + 1,
        },
        card,
      );
    if (isBug)
      h(
        "rect",
        {
          x: px + ix,
          y,
          width: cw,
          height: hh,
          rx: "var(--r-mark)",
          fill: "none",
          stroke: "var(--event)",
          "stroke-width": "var(--sw-lens)",
          s: bi("fix"),
          hide: bi("rerun"),
          cls: "pop",
        },
        card,
      );
    // one focal point: while an instruction runs (or is fixed) the other cards step back
    const dimKs = allRunKs
      .filter((k) => !runKs.includes(k))
      .concat(bug && !isBug ? [bi("fix")] : []);
    if (dimKs.length) card.dataset.c = dimKs.map((k) => `${k}-${k + 1}:quiet`).join(",");
    computed(
      T(card, px + ix + 22, c0 + 9, String(i + 1), "ts-cap", {
        "text-anchor": "middle",
        fill: "var(--ink-2)",
        cls: "strong",
      }),
      `program.${i}`,
    );
    if (isBug) {
      drawFace(h("g", { hide: bi("fix") }, card), bp[i], i, c0, hh, "bug.count");
      drawFace(h("g", { s: bi("fix"), cls: "rise" }, card), st, i, c0, hh, `program.${i}.count`);
    } else drawFace(card, st, i, c0, hh, `program.${i}.count`);
    cards.push({ y, hh });
    y += hh + gap;
  });
  if (loop)
    h(
      "line",
      {
        x1: px + 10,
        x2: px + 10,
        y1: yTop - 4,
        y2: y - gap,
        stroke: "var(--focus)",
        "stroke-width": "var(--sw-struct)",
        "stroke-linecap": "round",
      },
      cardsG,
    );

  /* motion: the robot walks its sub-poses, each move eased, pausing between presses like a real floor robot */
  const WT = (s) => (s.turn ? 0.7 : 1);
  const place = (subs, u) => {
    const ws = subs.slice(1).map(WT);
    const tot = ws.reduce((a, z) => a + z, 0) || 1;
    let t = u * tot,
      j = 0;
    while (j < ws.length - 1 && t > ws[j]) {
      t -= ws[j];
      j++;
    }
    const a = subs[j],
      z = subs[j + 1] || a;
    const v = eIO(clamp(t / (ws[j] || 1), 0, 1));
    const x = cx(a.c) + (cx(z.c) - cx(a.c)) * v,
      yy = cy(a.r) + (cy(z.r) - cy(a.r)) * v,
      d = a.deg + (z.deg - a.deg) * v;
    bot.pose(x, yy, d);
    // trail length covered so far in this build
    const seg = subs.slice(1).map((s, q) => (s.turn ? 0 : 1));
    const done =
      seg.slice(0, j).reduce((p, q) => p + q, 0) + (subs[j + 1] && !subs[j + 1].turn ? v : 0);
    return seg.reduce((p, q) => p + q, 0) ? done / seg.reduce((p, q) => p + q, 0) : 1;
  };
  const setTrails = (k, frac, subsK) => {
    for (const t of trails) {
      if (t.k < k) t.el.setAttribute("stroke-dashoffset", 0);
      else if (t.k > k) t.el.setAttribute("stroke-dashoffset", 1);
      else if (subsK && subsK.length > t.run.subs.length) {
        // the rerun draws many runs in one build: each fills in its share of the walk
        const all = trails.filter((q) => q.k === k);
        const lens = all.map((q) => q.run.subs.slice(1).filter((s) => !s.turn).length);
        const tot = lens.reduce((a, z) => a + z, 0) || 1;
        let acc = 0;
        const idx = all.indexOf(t);
        for (let q = 0; q < idx; q++) acc += lens[q];
        t.el.setAttribute(
          "stroke-dashoffset",
          1 - clamp((frac * tot - acc) / (lens[idx] || 1), 0, 1),
        );
      } else t.el.setAttribute("stroke-dashoffset", 1 - frac);
    }
  };
  const holdAt = (k) => {
    const s = restAt(k);
    bot.pose(cx(s.c), cy(s.r), s.deg);
  };
  // the mat alone is centred on the first build, then slides left as the program arrives
  const shift = (GAP + PW) / 2,
    kMat = bi("mat"),
    kProg = bi("program");
  const slide = (k) => (k === kMat ? shift : 0);
  const setShift = (v) => root.setAttribute("transform", `translate(${v} 0)`);
  const dur = { program: 1000 };
  for (const k of ks) {
    const subs = moves[k];
    const w = subs.slice(1).reduce((a, s) => a + WT(s), 0);
    dur[items[k].key] = clamp(w * (k === bi("rerun") && bug ? 650 : 1000), 900, 6000);
  }
  return {
    dur,
    reset() {
      setShift(shift);
      bot.pose(cx(good.start.c), cy(good.start.r), good.start.deg);
      trails.forEach((t) => t.el.setAttribute("stroke-dashoffset", 1));
    },
    still() {
      setShift(0);
      const e = good.end;
      bot.pose(cx(e.c), cy(e.r), e.deg);
      trails.forEach((t) => t.el.setAttribute("stroke-dashoffset", 0));
    },
    tick(k, u) {
      setShift(k === kProg ? shift * (1 - eIO(clamp(u, 0, 1))) : slide(k));
      if (moves[k]) {
        const subs = moves[k];
        const s0 = restBefore(k);
        const list = [Object.assign({}, subs[0], { c: s0.c, r: s0.r, deg: s0.deg })].concat(
          subs.slice(1),
        );
        const f = place(list, u);
        setTrails(k, f, subs);
      } else {
        holdAt(k);
        setTrails(k, 1, null);
      }
    },
  };
}
