// Coordinate grid: position, direction, coordinates and transformations on one squared grid.
// Four modes share the grid: a route (forward, back and quarter turns, square to square, for
// Reception to Year 2), plotting coordinates (x before y, one point per build), a translation
// (every corner moves the same vector, shown as arrows while the shape slides) and a reflection
// (each corner the same distance from the mirror line, then a ghost flips over it).
// Every position, image corner and route end is computed in code; validate() refuses points off
// the grid, images that leave it, and routes that do not end where the teacher says.

import { gridPaper, mirrorLine } from "../kit/batch-C.js";
import { gridMarker, robot } from "../kit/batch-H.js";
import {
  clamp,
  computed,
  editable,
  eIO,
  h,
  line,
  lines,
  measure,
  nameFits,
  noteArt,
  pictureCard,
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
  id: "coordinate_grid",
  name: "Coordinate grid",
  kind: "info",
  version: 1,
  subjects: ["Maths"],
  years: ["Reception", "Y1", "Y2", "Y3", "Y4", "Y5", "Y6"],
  teaches:
    "Position and direction on a grid: following a route, reading and plotting coordinates (x before y), and moving shapes by translation and reflection.",
};

const MODES = ["route", "plot", "translate", "reflect"];
const MOVES = ["forward", "back", "left", "right"];
const DIRS = ["N", "E", "S", "W"];
const DEG = { N: 0, E: 90, S: 180, W: 270 };
const DV = { N: [0, 1], E: [1, 0], S: [0, -1], W: [-1, 0] };
const FACING = { N: "up", E: "right", S: "down", W: "left" };
const GOAL_WORD = { flower: "flower", flag: "flag", home: "house" };
const INT = (title, min, max, def, extra) =>
  Object.assign({ type: "integer", title, minimum: min, maximum: max, default: def }, extra || {});
const PT = (name, x, y) => ({ name, x, y });
const POINT_ITEM = {
  type: "object",
  required: ["name", "x", "y"],
  default: { name: "P", x: 1, y: 1 },
  properties: {
    name: { type: "string", title: "Name", maxLength: 12, minLength: 1 },
    x: INT("x (across)", -12, 12, 1),
    y: INT("y (up)", -10, 10, 1),
  },
};

export const params = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  title: "Coordinate grid",
  required: ["mode"],
  properties: {
    title: TITLE_PARAM("Coordinates"),
    mode: {
      type: "string",
      title: "What the grid shows",
      enum: MODES,
      "x-labels": [
        "A route (forward and turns)",
        "Plotting coordinates",
        "A translation (sliding a shape)",
        "A reflection (mirroring a shape)",
      ],
      default: "plot",
    },
    grid: {
      type: "object",
      title: "Grid",
      default: { quadrants: 1, across: 6, up: 6 },
      properties: {
        quadrants: {
          type: "integer",
          title: "Quadrants",
          description:
            "Four quadrants add negative numbers. A route mat has no axes, so this is ignored there.",
          enum: [1, 4],
          "x-labels": ["One (0 and up)", "Four (with negatives)"],
          default: 1,
        },
        across: INT("Squares across", 3, 12, 6, {
          description: "With four quadrants, how far the x-axis goes each way from 0 (6 at most).",
        }),
        up: INT("Squares up", 3, 10, 6, {
          description: "With four quadrants, how far the y-axis goes each way from 0 (6 at most).",
        }),
      },
    },
    points: {
      type: "array",
      title: "Points to plot",
      description: "Plotting only. Each point is one step.",
      "x-item": "a point",
      maxItems: 6,
      default: [PT("A", 2, 3)],
      items: POINT_ITEM,
    },
    join: {
      type: "boolean",
      title: "Join the points in order",
      description: "Plotting only: joins the points into a shape, in its own step.",
      default: false,
    },
    shape: {
      type: "array",
      title: "Shape corners",
      description: "Translation and reflection: the corners in order around the shape (3 to 6).",
      "x-item": "a corner",
      maxItems: 6,
      default: [PT("A", 1, 1), PT("B", 3, 1), PT("C", 1, 3)],
      items: POINT_ITEM,
    },
    move: {
      type: "object",
      title: "Translate by",
      description: "Translation only. A negative number moves left or down.",
      default: { right: 3, up: 0 },
      properties: { right: INT("Squares right", -12, 12, 3), up: INT("Squares up", -10, 10, 0) },
    },
    mirror: {
      type: "object",
      title: "Mirror line",
      description: "Reflection only.",
      default: { line: "y-axis", at: 0 },
      properties: {
        line: {
          type: "string",
          title: "Mirror line",
          enum: ["y-axis", "x-axis", "vertical", "horizontal"],
          "x-labels": ["The y-axis", "The x-axis", "A vertical line", "A horizontal line"],
          default: "y-axis",
        },
        at: INT("Where it crosses the axis", -12, 12, 3, {
          description:
            "For a vertical line, the x value (x = 3). For a horizontal line, the y value (y = 3).",
        }),
      },
    },
    mover: {
      type: "object",
      title: "Who moves",
      description: "Route only.",
      default: { kind: "bee", name: "the bee" },
      properties: {
        kind: {
          type: "string",
          title: "Picture",
          enum: ["bee", "robot"],
          "x-labels": ["Bee", "Robot"],
          default: "bee",
        },
        name: {
          type: "string",
          title: "What we call it",
          description: "Used in the captions, like “the bee”.",
          minLength: 1,
          maxLength: 24,
          default: "the bee",
        },
      },
    },
    start: {
      type: "object",
      title: "Start square",
      description:
        "Route only. Column 1 is on the left; row 1 is at the bottom. A route that runs past an edge makes the mat bigger.",
      default: { col: 1, row: 1, facing: "E" },
      properties: {
        col: INT("Column", 1, 12, 1),
        row: INT("Row", 1, 10, 1),
        facing: {
          type: "string",
          title: "Facing",
          enum: DIRS,
          "x-labels": ["Up", "Right", "Down", "Left"],
          default: "E",
        },
      },
    },
    goal: {
      type: "object",
      title: "Goal",
      description:
        "Route only. A route that misses the goal is shown missing it, for the class to debug.",
      default: { show: true, col: 4, row: 1, kind: "flower" },
      properties: {
        show: { type: "boolean", title: "Show a goal", default: true },
        col: INT("Column", 1, 12, 4),
        row: INT("Row", 1, 10, 1),
        kind: {
          type: "string",
          title: "Goal is a",
          enum: ["flower", "flag", "home"],
          "x-labels": ["Flower", "Flag", "House"],
          default: "flower",
        },
      },
    },
    steps: {
      type: "array",
      title: "Instructions",
      description: "Route only. Each instruction is one step.",
      "x-item": "an instruction",
      maxItems: 6,
      default: [{ move: "forward", count: 3 }],
      items: {
        type: "object",
        required: ["move"],
        default: { move: "forward", count: 1 },
        properties: {
          move: {
            type: "string",
            title: "Instruction",
            enum: MOVES,
            "x-labels": ["Forward", "Back", "Turn left", "Turn right"],
            default: "forward",
          },
          count: INT("How many", 1, 10, 1, {
            description:
              "Forward 3 moves three squares. A turn is a quarter turn on the spot; 2 makes a half turn.",
          }),
        },
      },
    },
    labels: {
      type: "boolean",
      title: "Write coordinates beside plotted points",
      default: true,
      "x-panel": "advanced",
    },
    // every slide label is a short name, so each override takes the label cap; the rule card is a phrase
    text: TEXT_PARAM_FOR({
      x: "label",
      y: "label",
      mirror: "label",
      pair: "label",
      program: "label",
      vector: "label",
      mirrorHead: "label",
      rule: "phrase",
    }),
  },
};

export const presets = [
  {
    id: "rec-bee-forward",
    name: "Reception: the bee goes forward 3",
    params: {
      title: "Forward 3",
      mode: "route",
      grid: { quadrants: 1, across: 5, up: 3 },
      mover: { kind: "bee", name: "the bee" },
      start: { col: 1, row: 2, facing: "E" },
      goal: { show: true, col: 4, row: 2, kind: "flower" },
      steps: [{ move: "forward", count: 3 }],
    },
  },
  {
    id: "y4-plot-square",
    name: "Year 4: plot a square in the first quadrant",
    params: {
      title: "Plot a square",
      mode: "plot",
      grid: { quadrants: 1, across: 8, up: 6 },
      points: [PT("A", 2, 1), PT("B", 6, 1), PT("C", 6, 5), PT("D", 2, 5)],
      join: true,
    },
  },
  {
    id: "y5-translate",
    name: "Year 5: translate a triangle",
    params: {
      title: "Translate the triangle",
      mode: "translate",
      grid: { quadrants: 1, across: 10, up: 7 },
      shape: [PT("A", 1, 3), PT("B", 4, 3), PT("C", 1, 6)],
      move: { right: 5, up: -2 },
    },
  },
  {
    id: "y6-reflect-y",
    name: "Year 6: reflect in the y-axis",
    params: {
      title: "Reflect in the y-axis",
      mode: "reflect",
      grid: { quadrants: 4, across: 6, up: 5 },
      shape: [PT("A", 1, 1), PT("B", 4, 1), PT("C", 4, 3), PT("D", 2, 4)],
      mirror: { line: "y-axis", at: 0 },
    },
  },
];

/* ------------------------------------------------------------------ the maths */
const num = (v) => (v < 0 ? "−" + -v : String(v));
const pair = (x, y) => `(${num(x)}, ${num(y)})`;
const cap1 = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const sq = (n) => `${n} square${n === 1 ? "" : "s"}`;
const listW = (a) =>
  a.length <= 1 ? a[0] || "" : a.slice(0, -1).join(", ") + " and " + a[a.length - 1];
const PRIME = "′";
function vecWords(dx, dy) {
  const parts = [];
  if (dx) parts.push(`${Math.abs(dx)} ${dx > 0 ? "right" : "left"}`);
  if (dy) parts.push(`${Math.abs(dy)} ${dy > 0 ? "up" : "down"}`);
  return parts.join(" and ") || "nowhere";
}
const mirrorAt = (M) => (M.line === "y-axis" || M.line === "x-axis" ? 0 : M.at);
const mirrorVertical = (M) => M.line === "y-axis" || M.line === "vertical";
const mirrorName = (M) =>
  M.line === "y-axis"
    ? "the y-axis"
    : M.line === "x-axis"
      ? "the x-axis"
      : M.line === "vertical"
        ? `x = ${num(M.at)}`
        : `y = ${num(M.at)}`;
function imageOf(P) {
  if (P.mode === "translate")
    return P.shape.map((p) => ({
      name: p.name + PRIME,
      x: p.x + P.move.right,
      y: p.y + P.move.up,
    }));
  if (P.mode === "reflect") {
    const a = mirrorAt(P.mirror),
      v = mirrorVertical(P.mirror);
    return P.shape.map((p) => ({
      name: p.name + PRIME,
      x: v ? 2 * a - p.x : p.x,
      y: v ? p.y : 2 * a - p.y,
    }));
  }
  return [];
}
function runRoute(P) {
  let c = P.start.col,
    r = P.start.row,
    dir = P.start.facing,
    deg = DEG[dir];
  const poses = [{ c, r, dir, deg }];
  P.steps.forEach((s) => {
    if (s.move === "left" || s.move === "right") {
      const n = s.count || 1;
      for (let j = 0; j < n; j++) dir = DIRS[(DIRS.indexOf(dir) + (s.move === "left" ? 3 : 1)) % 4];
      deg += (s.move === "left" ? -90 : 90) * n;
    } else {
      const m = s.move === "forward" ? 1 : -1,
        [dx, dy] = DV[dir];
      for (let j = 0; j < s.count; j++) {
        const nc = c + dx * m,
          nr = r + dy * m;
        c = nc;
        r = nr;
      }
    }
    poses.push({ c, r, dir, deg });
  });
  return { poses };
}
// the mat drawn: the teacher's mat, grown to hold the start, the goal and the whole route
function matOf(P) {
  const G = P.grid,
    { poses } = runRoute(P);
  const cs = [1, G.across, ...poses.map((p) => p.c)],
    rs = [1, G.up, ...poses.map((p) => p.r)];
  if (P.goal.show) {
    cs.push(P.goal.col);
    rs.push(P.goal.row);
  }
  return { c0: Math.min(...cs), c1: Math.max(...cs), r0: Math.min(...rs), r1: Math.max(...rs) };
}
// where the route ends compared with the goal, in words: "1 square left of", "2 squares below"
function missWords(end, goal) {
  const dc = end.c - goal.col,
    dr = end.r - goal.row,
    parts = [];
  if (dc) parts.push(`${sq(Math.abs(dc))} ${dc < 0 ? "left of" : "right of"}`);
  if (dr) parts.push(`${sq(Math.abs(dr))} ${dr < 0 ? "below" : "above"}`);
  return parts.join(" and ");
}
// the corner whose distance to the mirror line is counted on the slide: the farthest one (more to count)
// skip a corner whose count would run along one of the shape's own edges (it would read as a side length)
function farthest(S, v, a) {
  const along = (i) => {
    const p = S[i],
      c = v ? p.x : p.y,
      r = v ? p.y : p.x;
    return [S[(i + 1) % S.length], S[(i + S.length - 1) % S.length]].some(
      (q) =>
        (v ? q.y : q.x) === r &&
        Math.abs((v ? q.x : q.y) - a) < Math.abs(c - a) &&
        Math.sign((v ? q.x : q.y) - a) === Math.sign(c - a),
    );
  };
  let j = -1,
    best = 0,
    j2 = -1,
    best2 = 0;
  S.forEach((p, i) => {
    const d = Math.abs((v ? p.x : p.y) - a);
    if (d > best2) {
      best2 = d;
      j2 = i;
    }
    if (d > best && !along(i)) {
      best = d;
      j = i;
    }
  });
  return j >= 0 ? j : j2;
}
const stepWord = (s) =>
  s.move === "forward"
    ? `Forward ${s.count}`
    : s.move === "back"
      ? `Back ${s.count}`
      : `Turn ${s.move}${s.count === 2 ? " twice" : ""}`;

/* ------------------------------------------------------------------ validate */
export function validate(raw) {
  const P = withDefaults(params, raw);
  const R = schemaCheck(params, P);
  const W = [];
  if (R.length) return result(R);
  const G = P.grid,
    q4 = G.quadrants === 4 && P.mode !== "route";
  if (q4) {
    if (G.across > 6)
      R.push({
        path: "grid.across",
        reason: `With four quadrants the x-axis runs from −${G.across} to ${G.across}, and the squares get too small to read. Use 6 or fewer.`,
      });
    if (G.up > 6)
      R.push({
        path: "grid.up",
        reason: `With four quadrants the y-axis runs from −${G.up} to ${G.up}, and the squares get too small to read. Use 6 or fewer.`,
      });
    if (R.length) return result(R);
  }
  const x0 = q4 ? -G.across : 0,
    y0 = q4 ? -G.up : 0;
  const onGrid = (list, base, what) =>
    list.forEach((p, i) => {
      for (const [ax, v, lo, hi] of [
        ["x", p.x, x0, G.across],
        ["y", p.y, y0, G.up],
      ]) {
        if (v >= lo && v <= hi) continue;
        if (!q4 && v < 0)
          R.push({
            path: `${base}.${i}.${ax}`,
            reason: `${p.name} has a negative ${ax} (${num(v)}). Negative coordinates need four quadrants: change “Quadrants”.`,
          });
        else
          R.push({
            path: `${base}.${i}.${ax}`,
            reason: `${p.name}${what}: its ${ax} is ${num(v)}, but the ${ax}-axis only goes from ${num(lo)} to ${hi}. Make the grid bigger or move the point.`,
          });
        return;
      }
    });
  const dupes = (list, base) =>
    list.forEach((p, i) => {
      const j = list.findIndex((q, k) => k < i && q.x === p.x && q.y === p.y);
      if (j >= 0)
        R.push({
          path: `${base}.${i}.x`,
          reason: `${list[j].name} and ${p.name} are both at ${pair(p.x, p.y)}. Move one of them.`,
        });
    });
  const sameName = (list, base, what) =>
    list.forEach((p, i) => {
      if (list.some((q, k) => k < i && q.name.trim() === p.name.trim()))
        R.push({
          path: `${base}.${i}.name`,
          reason: `Two ${what} are called ${p.name}. Give each one its own name.`,
        });
    });
  // a closed outline whose sides cross (a bow-tie) is not the shape the corners describe
  const crosses = (list) => {
    const n = list.length;
    if (n < 4) return false;
    const o = (a, b, c) => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
    const on = (a, b, c) =>
      Math.min(a.x, b.x) <= c.x &&
      c.x <= Math.max(a.x, b.x) &&
      Math.min(a.y, b.y) <= c.y &&
      c.y <= Math.max(a.y, b.y);
    const hit = (p1, p2, p3, p4) => {
      const d1 = o(p3, p4, p1),
        d2 = o(p3, p4, p2),
        d3 = o(p1, p2, p3),
        d4 = o(p1, p2, p4);
      if (d1 * d2 < 0 && d3 * d4 < 0) return true;
      return (
        (!d1 && on(p3, p4, p1)) ||
        (!d2 && on(p3, p4, p2)) ||
        (!d3 && on(p1, p2, p3)) ||
        (!d4 && on(p1, p2, p4))
      );
    };
    for (let i = 0; i < n; i++)
      for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue;
        if (hit(list[i], list[(i + 1) % n], list[j], list[(j + 1) % n])) return true;
      }
    return false;
  };
  const CROSS = "The sides cross: list the corners in order round the shape.";

  if (P.mode === "plot") {
    if (!P.points.length) R.push({ path: "points", reason: "Add at least one point to plot." });
    onGrid(P.points, "points", "");
    dupes(P.points, "points");
    sameName(P.points, "points", "points");
    if (!R.length && P.join && crosses(P.points)) R.push({ path: "points", reason: CROSS });
  } else if (P.mode === "translate" || P.mode === "reflect") {
    const S = P.shape;
    if (S.length < 3)
      return result([{ path: "shape", reason: "A shape needs at least 3 corners." }]);
    onGrid(S, "shape", "");
    dupes(S, "shape");
    sameName(S, "shape", "corners");
    if (R.length) return result(R);
    const a = S[0];
    if (S.every((p) => (S[1].x - a.x) * (p.y - a.y) === (S[1].y - a.y) * (p.x - a.x)))
      return result([
        {
          path: "shape",
          reason:
            "All the corners are on one straight line, so they do not make a shape. Move one corner off the line.",
        },
      ]);
    if (crosses(S)) return result([{ path: "shape", reason: CROSS }]);
    if (P.mode === "translate" && !P.move.right && !P.move.up)
      return result([
        {
          path: "move.right",
          reason:
            "A translation of 0 right and 0 up does not move the shape. Choose how far it moves.",
        },
      ]);
    if (P.mode === "reflect") {
      const M = P.mirror,
        v = mirrorVertical(M),
        at = mirrorAt(M),
        lo = v ? x0 : y0,
        hi = v ? G.across : G.up;
      if (at < lo || at > hi)
        return result([
          {
            path: "mirror.at",
            reason: `The mirror line ${mirrorName(M)} is off the grid, which goes from ${num(lo)} to ${hi}. Choose a line on the grid.`,
          },
        ]);
      if (S.some((p) => (v ? p.x : p.y) < at) && S.some((p) => (v ? p.x : p.y) > at))
        W.push({
          path: "mirror.at",
          reason: "The shape crosses the mirror line, so the shape and its image overlap.",
        });
    }
    imageOf(P).forEach((p, i) => {
      if (p.x >= x0 && p.x <= G.across && p.y >= y0 && p.y <= G.up) return;
      const how =
        P.mode === "translate"
          ? `Moving ${vecWords(P.move.right, P.move.up)}`
          : `Reflecting in ${mirrorName(P.mirror)}`;
      const neg = !q4 && (p.x < 0 || p.y < 0);
      R.push({
        path: P.mode === "translate" ? "move.right" : "mirror.line",
        reason: `${how} puts ${p.name} at ${pair(p.x, p.y)}, off the grid. ${neg ? "That is in another quadrant: change “Quadrants” to four, or move the shape." : "Make the grid bigger, or move the shape."}`,
      });
    });
  } else {
    if (!P.steps.length) R.push({ path: "steps", reason: "Add at least one instruction." });
    P.steps.forEach((s, i) => {
      if ((s.move === "left" || s.move === "right") && s.count > 2)
        R.push({
          path: `steps.${i}.count`,
          reason: `${s.count} quarter turns ${s.move} is the same as ${s.count === 3 ? `one turn ${s.move === "left" ? "right" : "left"}` : "not turning at all"}. Use 1 or 2.`,
        });
    });
    if (R.length) return result(R);
    // a route that runs past the mat's edge grows the mat (a warning), up to what one slide can show
    const { poses } = runRoute(P),
      M = matOf(P),
      ac = M.c1 - M.c0 + 1,
      au = M.r1 - M.r0 + 1;
    if (ac > 12)
      return result([
        {
          path: "steps",
          reason: `This route needs a mat ${ac} squares across, and 12 is the most that fits on a slide. Shorten an instruction or move the start.`,
        },
      ]);
    if (au > 10)
      return result([
        {
          path: "steps",
          reason: `This route needs a mat ${au} squares up, and 10 is the most that fits on a slide. Shorten an instruction or move the start.`,
        },
      ]);
    if (ac > G.across || au > G.up)
      W.push({
        path: ac > G.across ? "grid.across" : "grid.up",
        reason: `The route runs past the edge of the ${G.across} by ${G.up} mat, so the mat is drawn ${ac} by ${au}.`,
      });
    // a route that misses the goal is a debugging task, not an error: the captions say where it stops
    const end = poses[poses.length - 1];
    if (P.goal.show && (end.c !== P.goal.col || end.r !== P.goal.row))
      W.push({
        path: "goal.col",
        reason: `The route stops ${missWords(end, P.goal)} the ${GOAL_WORD[P.goal.kind]}, not on it. The slide shows the miss.`,
      });
  }
  return result(R, W);
}

/* ------------------------------------------------------------------ builds */
function plan(P) {
  const items = [];
  const mode = P.mode;
  const add = (key, caption, note) => items.push({ key, caption, note });
  let summary = "",
    sumNote = "";
  if (mode === "route") {
    const nm = P.mover.name,
      g = GOAL_WORD[P.goal.kind];
    const { poses } = runRoute(P);
    add(
      "mat",
      P.goal.show
        ? `This is the mat. ${cap1(nm)} needs to get to the ${g}.`
        : `This is the mat. ${cap1(nm)} moves one square at a time.`,
      "Each forward or back moves one whole square. Turns happen on the spot: the bee does not move to a new square.".replace(
        "the bee",
        nm,
      ),
    );
    add(
      "start",
      `${cap1(nm)} starts here, facing ${FACING[P.start.facing]}.`,
      `Ask: which way is ${nm} facing? Forward always means the way it faces.`,
    );
    P.steps.forEach((s, i) => {
      const after = poses[i + 1];
      const c =
        s.move === "forward" || s.move === "back"
          ? `${stepWord(s)}: ${nm} moves ${sq(s.count)} ${s.move === "forward" ? "forward" : "backwards"}.`
          : `${stepWord(s)}: a ${s.count === 2 ? "half" : "quarter"} turn on the spot. Now ${nm} faces ${FACING[after.dir]}.`;
      const n =
        s.move === "forward" || s.move === "back"
          ? `Count the squares aloud as ${nm} moves: ${Array.from({ length: s.count }, (_, j) => j + 1).join(", ")}.`
          : `A turn changes the way ${nm} faces, not the square it is on. Ask the class to turn ${s.move} too.`;
      add(`step:${i}`, c, n);
    });
    const end = poses[poses.length - 1],
      dc = end.c - P.start.col,
      dr = end.r - P.start.row;
    const miss = P.goal.show && (end.c !== P.goal.col || end.r !== P.goal.row);
    summary = miss
      ? `${cap1(nm)} stops ${missWords(end, P.goal)} the ${g}.`
      : P.goal.show
        ? `${cap1(nm)} is on the ${g}.`
        : dc || dr
          ? `${cap1(nm)} ends ${[dc ? `${sq(Math.abs(dc))} ${dc > 0 ? "right" : "left"}` : "", dr ? `${sq(Math.abs(dr))} ${dr > 0 ? "up" : "down"}` : ""].filter(Boolean).join(" and ")} from the start.`
          : `${cap1(nm)} ends back where it started.`;
    sumNote = miss
      ? `Debug it: which instruction would you change so ${nm} lands on the ${g}?`
      : "Ask the class to retell the instructions in order, or to find a different route to the same square.";
  } else if (mode === "plot") {
    add(
      "grid",
      P.grid.quadrants === 4
        ? "The x-axis goes across and the y-axis goes up. They cross at 0, with negatives left and down."
        : "The x-axis goes across and the y-axis goes up. Both start at 0.",
      "The numbers sit on the lines, not in the squares. The axes meet at the origin, (0, 0).",
    );
    add(
      "rule",
      "A coordinate is written (x, y): go across first, then up.",
      "Say “along the corridor, then up the stairs”. Ask what (1, 3) and (3, 1) have in common, and how they differ.",
    );
    P.points.forEach((p, i) =>
      add(
        `pt:${i}`,
        `${p.name} is at ${pair(p.x, p.y)}: ${p.x ? `${Math.abs(p.x)} ${p.x > 0 ? "across" : "left"}` : "0 across"}, then ${p.y ? `${Math.abs(p.y)} ${p.y > 0 ? "up" : "down"}` : "0 up"}.`,
        `Start at 0. Go along the x-axis to ${num(p.x)}, then ${p.y >= 0 ? "up" : "down"} to ${num(p.y)}.${p.x === 0 || p.y === 0 ? " A point with a 0 sits on an axis." : ""}`,
      ),
    );
    if (P.join && P.points.length >= 2)
      add(
        "join",
        `Join ${listW(P.points.map((p) => p.name))} in order${P.points.length >= 3 ? " to make the shape" : ""}.`,
        "Ask: what shape is it? How do the coordinates show that its sides are straight across or straight up?",
      );
    summary = "Every point: x first, across; then y, up.";
    sumNote = "Ask the class to read each coordinate aloud, x first.";
  } else {
    const S = P.shape,
      I = imageOf(P),
      names = S.map((p) => p.name).join("");
    add(
      "grid",
      P.grid.quadrants === 4
        ? "The grid has four quadrants: negatives go left and down from 0."
        : "The grid starts at 0, where the x-axis and y-axis meet.",
      "The numbers sit on the lines, not in the squares.",
    );
    add(
      "shape",
      `The shape ${names}, with corners at ${S.map((p) => pair(p.x, p.y)).join(", ")}.`.length <=
        110
        ? `The shape ${names}, with corners at ${S.map((p) => pair(p.x, p.y)).join(", ")}.`
        : `The shape ${names}: read each corner, x first.`,
      "Read each corner’s coordinates, x first, before moving anything.",
    );
    if (mode === "translate") {
      const v = vecWords(P.move.right, P.move.up);
      add(
        "slide",
        `Translate ${v}: every corner moves ${v}.`,
        `Every corner moves the same way: add ${num(P.move.right)} to each x and ${num(P.move.up)} to each y. The shape does not turn, flip or change size.`,
      );
      add(
        "image",
        `The image ${I.map((p) => p.name).join("")} is the same shape, ${v} from the first.`,
        "Check one corner by counting squares on the grid, then by adding to its coordinates.",
      );
      summary = `Translated ${v}: same shape, same size, same way round.`;
      sumNote = "Ask: which corner moved furthest? (They all moved the same distance.)";
    } else {
      const M = P.mirror,
        v = mirrorVertical(M),
        mn = mirrorName(M),
        a = mirrorAt(M);
      const k = farthest(S, v, a),
        d = k < 0 ? 0 : Math.abs((v ? S[k].x : S[k].y) - a);
      add(
        "mirror",
        `The mirror line is ${mn}.`,
        M.line === "y-axis"
          ? "The y-axis is the line x = 0."
          : M.line === "x-axis"
            ? "The x-axis is the line y = 0."
            : `Every point on this line has ${v ? "x" : "y"} = ${num(a)}.`,
      );
      add(
        "dist",
        k < 0
          ? "Every corner is on the mirror line."
          : `${S[k].name} is ${sq(d)} from the mirror line. Count at right angles to it.`,
        "Count squares straight across to the mirror line, at a right angle to it, never diagonally.",
      );
      add(
        "flip",
        "The shape flips over the mirror line.",
        "The image is the same size, but it faces the other way.",
      );
      add(
        "image",
        k < 0
          ? "Each image corner is the same distance from the line."
          : `${I[k].name} is also ${sq(d)} from the line, on the other side.`,
        v
          ? a === 0
            ? "Reflecting in the y-axis changes the sign of x; y stays the same."
            : `Each new x is as far past ${num(a)} as the old x was before it; y stays the same.`
          : a === 0
            ? "Reflecting in the x-axis changes the sign of y; x stays the same."
            : `Each new y is as far past ${num(a)} as the old y was before it; x stays the same.`,
      );
      summary = "Every corner and its image are the same distance from the mirror line.";
      sumNote = "Ask the class to check another corner by counting squares to the mirror line.";
    }
  }
  return { items, summary, sumNote };
}
export function builds(P) {
  P = withDefaults(params, P);
  const { items, summary } = plan(P);
  return {
    steps: items.map(({ key, caption }) => ({ key, caption })),
    summary: { caption: summary },
  };
}
export function notes(P) {
  P = withDefaults(params, P);
  const { items, sumNote } = plan(P);
  return { steps: items.map((i) => i.note), summary: sumNote };
}

/* ------------------------------------------------------------------ label placement */
// A label box beside a point: tries eight sides, avoiding placed labels, dots, lines and axis numbers,
// and prefers the side that points away from the shape.
function placer(bounds) {
  const boxes = [],
    dots = [],
    segs = [],
    soft = [];
  let half = null;
  const hit = (b, q, pad = 0) =>
    b.x < q.x + q.w + pad &&
    q.x < b.x + b.w + pad &&
    b.y < q.y + q.h + pad &&
    q.y < b.y + b.h + pad;
  const segHit = (b, [x1, y1, x2, y2]) => {
    for (let t = 0; t <= 1; t += 1 / 30) {
      const x = x1 + (x2 - x1) * t,
        y = y1 + (y2 - y1) * t;
      if (x > b.x + 1 && x < b.x + b.w - 1 && y > b.y + 1 && y < b.y + b.h - 1) return true;
    }
    return false;
  };
  const polys = [];
  const inPoly = (x, y, P) => {
    let c = false;
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
      const [xi, yi] = P[i],
        [xj, yj] = P[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  const cost0 = (b) => {
    let cost = 0;
    if (
      b.x < bounds.x ||
      b.y < bounds.y ||
      b.x + b.w > bounds.x + bounds.w ||
      b.y + b.h > bounds.y + bounds.h
    )
      cost += 1000;
    // a clash is what a label must avoid: other labels, dots, axis numbers, the bounds and (for a reflection)
    // the other side of the mirror line; among the spots with the least clash, the cheapest wins
    cost +=
      boxes.filter((q) => hit(b, q, 6)).reduce((t, q) => t + (q.wt || 600), 0) +
      dots.filter((q) => hit(b, q, 2)).length * 500;
    // an axis number: grazing its padding only costs; covering the number itself is a clash
    const softGraze = soft.filter((q) => hit(b, q, 2)).length * 160,
      softCover = soft.filter((q) => hit(b, q, 0)).length * 450;
    cost += softCover;
    const nseg = segs.filter((s) => segHit(b, s)).length;
    if (half) {
      const [vx, m, sg] = half,
        lo = vx ? b.x : b.y,
        hi = vx ? b.x + b.w : b.y + b.h;
      if (sg > 0 ? lo < m - 4 : hi > m + 4) cost += 700;
    }
    b.clash = cost;
    cost += softGraze;
    for (const P of polys)
      for (const [x, y] of [
        [b.x + b.w / 2, b.y + b.h / 2],
        [b.x + 2, b.y + 2],
        [b.x + b.w - 2, b.y + 2],
        [b.x + 2, b.y + b.h - 2],
        [b.x + b.w - 2, b.y + b.h - 2],
      ])
        if (inPoly(x, y, P)) cost += 120;
    b.hard = b.clash; // what makes a label step down a size or reorder: a clash, never a masked line or the shape's inside
    return cost + nseg * 300;
  };
  // a box that fits nowhere inside the bounds is pulled back inside them, never left off the slide
  const keep = (b) => ({
    x: clamp(b.x, bounds.x, Math.max(bounds.x, bounds.x + bounds.w - b.w)),
    y: clamp(b.y, bounds.y, Math.max(bounds.y, bounds.y + bounds.h - b.h)),
    w: b.w,
    h: b.h,
  });
  return {
    inPoly,
    poly: (P) => polys.push(P),
    box: (b) => boxes.push(b),
    soft: (b) => soft.push(b),
    dot: (x, y, r) => dots.push({ x: x - r, y: y - r, w: 2 * r, h: 2 * r }),
    seg: (...s) => segs.push(s),
    // radial: the box sits outward along 'away' from the point, its nearest edge 'gap' from the point; turns in 22.5° steps only to dodge
    half: (v) => {
      half = v;
    },
    placeR(px, py, w, hh, away, gap, dry) {
      const a0 = Math.atan2(away[1], away[0]);
      let best = null;
      for (let k = 0; k < 80; k++) {
        if (k === 32 && !best.b.clash) break; // the far rings are only for a label that clashes close in
        const ring = Math.floor(k / 16),
          ang = a0 + ((k % 2 ? 1 : -1) * Math.ceil((k % 16) / 2) * Math.PI) / 8,
          ux = Math.cos(ang),
          uy = Math.sin(ang);
        const r =
          Math.min(
            Math.abs(ux) > 1e-6 ? w / 2 / Math.abs(ux) : 1e9,
            Math.abs(uy) > 1e-6 ? hh / 2 / Math.abs(uy) : 1e9,
          ) +
          gap +
          [0, 20, 44, 70, 100][ring];
        const b = keep({ x: px + ux * r - w / 2, y: py + uy * r - hh / 2, w, h: hh });
        const cost = cost0(b) + Math.ceil((k % 16) / 2) * 20 + ring * 30;
        // clear of every box, dot and number first; among those, the cheapest
        if (!best || b.hard < best.b.hard || (b.hard === best.b.hard && cost < best.cost))
          best = { cost, b };
      }
      if (dry) return best;
      boxes.push(best.b);
      return best.b;
    },
    box0: (b) => boxes.push(b),
    nBoxes: () => boxes.length,
    cut: (n) => {
      boxes.length = n;
    },
    place(px, py, w, hh, away, d = 14, only) {
      const C = only || [
        [1, -1],
        [-1, -1],
        [1, 1],
        [-1, 1],
        [1, 0],
        [-1, 0],
        [0, -1],
        [0, 1],
      ];
      let best = null;
      for (const [cx, cy] of C) {
        const x = cx > 0 ? px + d : cx < 0 ? px - d - w : px - w / 2,
          y = cy < 0 ? py - d - hh : cy > 0 ? py + d : py - hh / 2;
        const b = keep({ x, y, w, h: hh });
        let cost = 0;
        if (
          b.x < bounds.x ||
          b.y < bounds.y ||
          b.x + b.w > bounds.x + bounds.w ||
          b.y + b.h > bounds.y + bounds.h
        )
          cost += 1000;
        cost +=
          boxes.filter((q) => hit(b, q, 6)).length * 600 +
          dots.filter((q) => hit(b, q, 2)).length * 500 +
          soft.filter((q) => hit(b, q, 2)).length * 120 +
          segs.filter((s) => segHit(b, s)).length * 90;
        const L = Math.hypot(cx, cy);
        cost += (1 - (cx * away[0] + cy * away[1]) / L) * 8;
        if (!best || cost < best.cost) best = { cost, b };
      }
      boxes.push(best.b);
      return best.b;
    },
  };
}

/* ------------------------------------------------------------------ a mover with no art: a labelled card */
const MOVER_ART = {
  bee: ["bee", "bee bot", "beebot", "bumblebee", "floor robot", "it"],
  robot: ["robot", "floor robot", "bot", "rover", "it"],
};
function moverCard(p, name, cell, a) {
  const outer = h("g", a, p),
    pose = h("g", {}, outer),
    turn = h("g", {}, pose);
  const r = cell * 0.44;
  // the pointer turns with the heading; the card and its name stay upright so they always read
  h("path", { d: `M${r + 12} 0 L${r - 4} -12 L${r - 4} 12 Z`, fill: "var(--ink)" }, turn);
  pictureCard(pose, name, 0, r, { w: r * 2, h: r * 2, model: "coordinate_grid", hint: "mover" });
  outer.pose = (x, y, deg) => {
    pose.setAttribute("transform", `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
    turn.setAttribute("transform", `rotate(${deg})`);
  };
  return outer;
}
/* ------------------------------------------------------------------ the bee (a floor robot shaped like a bee) */
function bee(p, { size = 64, a = {} } = {}) {
  const outer = h("g", a, p);
  const pose = h("g", {}, outer);
  const body = h("g", { transform: `scale(${size / 64})` }, pose);
  for (const sx of [-1, 1])
    h(
      "ellipse",
      {
        cx: sx * 20,
        cy: 6,
        rx: 15,
        ry: 11,
        fill: "var(--paper)",
        stroke: "var(--ink-3)",
        "stroke-width": "var(--sw-rule)",
      },
      body,
    );
  h("ellipse", { cx: 0, cy: 4, rx: 20, ry: 26, fill: "var(--sun)", cls: "body" }, body);
  for (const y of [6, 18]) {
    const w = 2 * 20 * Math.sqrt(1 - ((y + 3 - 4) / 26) ** 2);
    h("rect", { x: -w / 2, y, width: w, height: 6, rx: 3, fill: "var(--ink)" }, body);
  }
  h("circle", { cx: 0, cy: -22, r: 12, fill: "var(--ink)" }, body);
  for (const ex of [-5, 5]) h("circle", { cx: ex, cy: -26, r: 3.5, fill: "var(--paper)" }, body);
  outer.pose = (x, y, deg) =>
    pose.setAttribute("transform", `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${deg})`);
  return outer;
}

/* ------------------------------------------------------------------ render */
export function render(root, P, ctx) {
  P = withDefaults(params, P);
  const b = ctx.b,
    N = ctx.N,
    k = (key) => b[key];
  const mode = P.mode,
    G = P.grid,
    route = mode === "route",
    q4 = G.quadrants === 4 && !route;
  const MT = route ? matOf(P) : null;
  const xMin = route ? MT.c0 - 1 : q4 ? -G.across : 0,
    yMin = route ? MT.r0 - 1 : q4 ? -G.up : 0;
  const xMax = route ? MT.c1 : G.across,
    yMax = route ? MT.r1 : G.up,
    spanX = xMax - xMin,
    spanY = yMax - yMin;
  // the grid and the right column (instructions, rule card or table) are sized together and centred as one
  // composition, so the grid never moves when the column appears
  const xName = txt(P, "label:x", "x"),
    yName = txt(P, "label:y", "y"),
    mirrorTxt = txt(P, "label:mirror", "mirror line");
  const S0 = mode === "plot" ? P.points : P.shape,
    I0 = imageOf(P);
  const rowCls = (() => {
    if (route || mode === "plot") return "ts-num";
    const tw = (c) =>
      Math.max(...S0.map((p) => measure(root, `${p.name} ${pair(p.x, p.y)}`, c))) +
      Math.max(...I0.map((p) => measure(root, `${p.name} ${pair(p.x, p.y)}`, c))) +
      measure(root, "→", c) +
      48;
    return tw("ts-num") <= 470 ? "ts-num" : "ts-label";
  })();
  const tableW = (c) =>
    Math.max(...S0.map((p) => measure(root, `${p.name} ${pair(p.x, p.y)}`, c))) +
    Math.max(...I0.map((p) => measure(root, `${p.name} ${pair(p.x, p.y)}`, c))) +
    measure(root, "→", c) +
    48;
  const cellCap = Math.min((route ? 500 : 434) / spanY, route ? 150 : 84),
    leftG = route ? 0 : q4 ? 8 : 52;
  let panelW;
  if (route)
    panelW = Math.max(
      240,
      measure(root, txt(P, "label:program", "Instructions"), "ts-small"),
      ...P.steps.map((s) => measure(root, stepWord(s), "ts-label") + 24),
    );
  else if (mode === "plot")
    panelW = clamp(measure(root, txt(P, "label:pair", "(x, y)"), "ts-big"), 300, 360);
  else {
    // a table too wide for the room left by the grid puts each image under its corner, so it needs only that width
    const cap = Math.min(520, Math.max(300, 1152 - leftG - 176 - Math.ceil(spanX * cellCap)));
    const cw = (c) =>
      Math.max(...[...S0, ...I0].map((p) => measure(root, `${p.name} ${pair(p.x, p.y)}`, c)));
    const tw =
      tableW(rowCls) <= cap
        ? tableW(rowCls)
        : Math.min(tableW("ts-label"), cw("ts-label") + 24 + measure(root, "→", "ts-label") + 12);
    panelW = Math.min(
      cap,
      Math.max(
        300,
        tw,
        measure(
          root,
          mode === "translate" ? vecWords(P.move.right, P.move.up) : mirrorName(P.mirror),
          "ts-label",
          { "font-weight": "var(--w-strong)" },
        ),
      ),
    );
  }
  const hMirror = mode === "reflect" && !mirrorVertical(P.mirror);
  // the x name (and a horizontal mirror line's name) sit past the grid's right end, wrapping in at most XW
  // ... but only the width the grid does not need at its full height, so a long name never shrinks the squares
  const slack = 1152 - leftG - panelW - spanX * cellCap - 76 - (mode === "reflect" ? 60 : 0); // a reflection keeps room beside the grid for image labels
  const XW = clamp(slack, 100, 170),
    xW = Math.min(XW, measure(root, xName, "ts-label")),
    mW = Math.min(XW, measure(root, mirrorTxt, "ts-small"));
  const reserve = route ? 56 : Math.max(36 + xW + 40, hMirror ? 16 + mW + 40 : 0);
  const top = route ? 132 : 164,
    bottom = route ? 632 : 598;
  const cell = Math.floor(
    Math.min((bottom - top) / spanY, (1152 - leftG - reserve - panelW) / spanX, route ? 150 : 84),
  );
  const gw = spanX * cell,
    gh = spanY * cell,
    gy = top + Math.floor((bottom - top - gh) / 2);
  const left = Math.max(
    64 + (q4 ? 20 : leftG),
    64 + Math.floor((1152 - (leftG + gw + reserve + panelW)) / 2) + leftG,
  );
  const layers = {};
  const gridG = h("g", { s: k(route ? "mat" : "grid"), cls: "rise" }, root);
  const GP = gridPaper(gridG, { x: left, y: gy, w: gw, h: gh }, cell, {
    quadrants: q4 ? 4 : 1,
    xMin,
    xMax,
    yMin,
    yMax,
    axes: !route,
    labels: false,
  });
  for (const n of ["shape", "lines", "gridText", "dots", "labels"])
    layers[n] = h("g", n === "gridText" ? { s: k(route ? "mat" : "grid"), cls: "rise" } : {}, root);
  const X = GP.X,
    Y = GP.Y,
    gx1 = left + gw;
  const RX = gx1 + reserve;
  const bx0 = Math.max(64, left - 60),
    by0 = Math.max(124, gy - 44);
  const L = placer({
    x: bx0,
    y: by0,
    w: Math.min(gx1 + reserve - 12, 1216) - bx0,
    h: Math.min(gy + gh + 88, 650) - by0,
  });
  if (!route) {
    // axis numbers: big enough for the back of the room, x below its axis, y left of its axis, 0 on its own at the corner;
    // a number that would touch another gives way, and the key ones (0, 5, 10) are bold
    const ax0 = clamp(0, xMin, G.across),
      ay0 = clamp(0, yMin, G.up),
      AX = X(ax0),
      AY = Y(ay0);
    const st = (v) =>
      Object.assign(
        { "font-size": "var(--fs-h3)" },
        v % 5 === 0 ? { "font-weight": "var(--w-strong)" } : {},
      );
    const placed = [];
    const put = (v, x, y, anchor) => {
      const s = num(v),
        w = measure(root, s, "ts-axis", st(v)),
        bx = anchor === "middle" ? x - w / 2 : anchor === "end" ? x - w : x;
      const b = { x: bx, y: y - 24, w, h: 30 };
      if (
        placed.some(
          (q) =>
            b.x < q.x + q.w + 14 &&
            q.x < b.x + b.w + 14 &&
            b.y < q.y + q.h + 4 &&
            q.y < b.y + b.h + 4,
        )
      )
        return;
      placed.push(b);
      L.soft({ x: b.x - 4, y: b.y - 2, w: b.w + 8, h: b.h + 4 });
      computed(
        T(layers.gridText, x, y, s, "ts-axis", Object.assign({ "text-anchor": anchor }, st(v))),
        "grid.across",
      );
    };
    // a mirror line one square off an axis would strike its numbers: those numbers move to the other side of the axis
    const mv =
      mode === "reflect" && mirrorAt(P.mirror) !== 0
        ? mirrorVertical(P.mirror)
          ? ["v", X(mirrorAt(P.mirror))]
          : ["h", Y(mirrorAt(P.mirror))]
        : null;
    const yRight = !!mv && mv[0] === "v" && mv[1] < AX && mv[1] > AX - 70,
      xAbove = !!mv && mv[0] === "h" && mv[1] > AY && mv[1] < AY + 50;
    if (xMin <= 0 && yMin <= 0)
      put(0, yRight ? AX + 12 : AX - 12, xAbove ? AY - 14 : AY + 36, yRight ? "start" : "end");
    const wMax = Math.max(
      measure(root, num(xMin), "ts-axis", st(1)),
      measure(root, num(G.across), "ts-axis", st(1)),
    );
    const ex = Math.max(1, Math.ceil((wMax + 28) / cell)),
      ey = Math.max(1, Math.ceil(44 / cell));
    for (let x = xMin; x <= G.across; x++)
      if (x && !(x % ex)) put(x, X(x), xAbove ? AY - 14 : AY + 36, "middle");
    for (let y = yMin; y <= G.up; y++)
      if (y && !(y % ey)) put(y, yRight ? AX + 12 : AX - 12, Y(y) + 11, yRight ? "start" : "end");
    // axis names: x past the end of its axis, y beside the top of its axis (clear of the top number, which sits left)
    // the x name clears the last axis number when one sits at the end of the axis
    const xEnd = placed.find((q) => q.x + q.w > gx1 && Math.abs(q.y + 15 - AY) < 50),
      xnX = xEnd ? Math.max(gx1 + 16, xEnd.x + xEnd.w + 8) : gx1 + 16;
    // a long x name wraps upwards from the axis line, inside the reserve; a long y name shrinks along the top
    const xb = textBlock(layers.gridText, xnX, AY + 11, xName, {
      cls: "ts-label",
      maxW: Math.max(XW, gx1 + reserve - 16 - xnX),
      maxLines: 5,
      a: { cls: "halo" },
      edit: "text.label:x",
    });
    if (xb.lines.length > 1)
      xb.el.setAttribute("transform", `translate(0 ${-(xb.lines.length - 1) * xb.lh})`);
    // a y name too long to fit right of the axis slides left along the top of the grid
    const yEdge = gx1 + reserve - 16,
      yb = textBlock(layers.gridText, AX + 14, gy - 14, yName, {
        cls: "ts-label",
        maxW: Math.max(60, yEdge - left),
        maxLines: 1,
        a: { cls: "halo" },
        edit: "text.label:y",
      });
    const yw = yb.w,
      yx = Math.max(left, Math.min(AX + 14, yEdge - yw));
    if (yx !== AX + 14) yb.el.setAttribute("transform", `translate(${yx - AX - 14} 0)`);
    L.box({
      x: xnX - 8,
      y: AY - 20 - (xb.lines.length - 1) * xb.lh,
      w: xb.w + 16,
      h: 34 + (xb.lines.length - 1) * xb.lh,
      wt: 3000,
    });
    L.box({ x: yx - 6, y: gy - 42, w: yw + 12, h: 34, wt: 3000 });
    L.seg(left, AY, gx1, AY);
    L.seg(AX, gy, AX, gy + gh);
    layers.AX = AX;
    layers.AY = AY;
    layers.xnX = xnX;
    layers.yNameBox = { x: yx - 6, w: yw + 12 };
  }
  const R = { x: RX, w: 1216 - RX };
  const hooks = { dur: {} };

  /* ---------------- route */
  if (route) {
    const { poses } = runRoute(P);
    const cx = (c) => X(c - 0.5),
      cy = (r) => Y(r - 0.5);
    const world = { cell, cx, cy };
    if (P.goal.show)
      gridMarker(
        layers.shape,
        { cell: cell * 0.42, cx: (c) => cx(c) + cell * 0.35, cy: (r) => cy(r) - cell * 0.33 },
        P.goal.col,
        P.goal.row,
        P.goal.kind,
        { a: { s: k("mat"), cls: "pop", delay: 300 } },
      );
    h(
      "rect",
      {
        x: cx(P.start.col) - cell / 2 + 3,
        y: cy(P.start.row) - cell / 2 + 3,
        width: cell - 6,
        height: cell - 6,
        rx: "var(--r-mark)",
        fill: "var(--focus-pale)",
        s: k("start"),
      },
      layers.shape,
    );
    const moves = [];
    P.steps.forEach((s, i) => {
      const a = poses[i],
        z = poses[i + 1],
        key = `step:${i}`,
        turn = s.move === "left" || s.move === "right";
      const dur = turn ? 1000 * s.count : clamp(500 + 500 * s.count, 1000, 2600);
      hooks.dur[key] = dur;
      moves.push({ k: k(key), a, z });
      if (!turn) {
        const tr = h(
          "path",
          {
            d: `M${cx(a.c)} ${cy(a.r)} L${cx(z.c)} ${cy(z.r)}`,
            fill: "none",
            stroke: "var(--focus)",
            "stroke-width": "var(--sw-data)",
            "stroke-linecap": "round",
            cls: "draw",
            pathLength: 1,
            s: k(key),
          },
          layers.lines,
        );
        tr.style.setProperty("--t-build-draw", `calc(${dur}ms * var(--pace))`);
      }
    });
    // the picture follows the name: "the pirate" is never drawn as the robot; it moves as a labelled card
    // with a pointer for the way it faces
    const fitsArt = nameFits(P.mover.name, MOVER_ART[P.mover.kind]);
    const mv = !fitsArt
      ? moverCard(layers.dots, P.mover.name.replace(/^(the|a|an|our|my)\s+/i, ""), cell, {
          s: k("start"),
          cls: "pop",
        })
      : P.mover.kind === "robot"
        ? robot(layers.dots, { size: cell * 0.66, a: { s: k("start"), cls: "pop" } })
        : bee(layers.dots, { size: cell * 0.74, a: { s: k("start"), cls: "pop" } });
    if (fitsArt) noteArt(P.mover.name, P.mover.kind);
    const setPose = (p, q, u) =>
      mv.pose(cx(p.c + (q.c - p.c) * u), cy(p.r + (q.r - p.r) * u), p.deg + (q.deg - p.deg) * u);
    const at = (kk, u) => {
      let m = null;
      for (const x of moves) if (x.k <= kk) m = x;
      if (!m) return setPose(poses[0], poses[0], 0);
      setPose(m.a, m.z, m.k === kk ? eIO(clamp(u)) : 1);
    };
    Object.assign(hooks, {
      tick: (kk, u) => at(kk, u),
      still: () => at(1e9, 1),
      reset: () => at(-1, 0),
    });
    at(-1, 0);
    // the instructions, one row per step; the running one is strong, finished ones recede
    if (P.steps.length) {
      const k0 = k("step:0"),
        rx = R.x;
      const head = textBlock(root, rx, gy + 30, txt(P, "label:program", "Instructions"), {
        cls: "ts-small",
        maxW: 1216 - rx,
        maxLines: 1,
        a: { s: k0, cls: "rise", fill: "var(--ink-2)" },
        edit: "text.label:program",
      });
      let y = gy + 30 + head.h + 22;
      P.steps.forEach((s, i) => {
        const key = `step:${i}`,
          kk = k(key);
        const row = h(
          "g",
          {
            s: kk,
            cls: "rise",
            c: [`${kk}-${kk + 1}:strong`, ctx.rc(key)].filter(Boolean).join(","),
          },
          root,
        );
        h(
          "rect",
          {
            x: rx - 12,
            y: y - 32,
            width: 6,
            height: 44,
            rx: 3,
            fill: "var(--focus)",
            s: kk,
            hide: kk + 1,
          },
          row,
        );
        computed(T(row, rx + 6, y, stepWord(s), "ts-label"), `steps.${i}.move`);
        y += 54;
      });
      if (y > 640) ctx.warn("The instructions run past the bottom of the stage.");
    }
    return hooks;
  }

  /* ---------------- shared drawing */
  const dotR = clamp(cell * 0.17, 7, 11);
  const S = mode === "plot" ? P.points : P.shape,
    I = imageOf(P);
  const poly = (pts) => pts.map((p) => `${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(" ");
  const centroid = (pts) => [
    pts.reduce((t, p) => t + X(p.x), 0) / pts.length,
    pts.reduce((t, p) => t + Y(p.y), 0) / pts.length,
  ];
  const away = (p, c) => {
    const dx = X(p.x) - c[0],
      dy = Y(p.y) - c[1],
      l = Math.hypot(dx, dy) || 1;
    return [dx / l, dy / l];
  };
  const edges = (pts) =>
    pts.forEach((p, i) => {
      const q = pts[(i + 1) % pts.length];
      if (pts.length > 2 || i === 0) L.seg(X(p.x), Y(p.y), X(q.x), Y(q.y));
    });
  // label: name (editable) and, when wanted, the coordinates (computed) on a paper ground
  const planOne = ({ p, c, opts: { coords } = {} }) => {
    // a long name on a crowded grid steps down a type size rather than land on another label, a dot or a line
    // and, for a name of several words, wraps onto two short lines
    if (mode === "reflect") {
      const M = P.mirror,
        v = mirrorVertical(M),
        m = v ? X(mirrorAt(M)) : Y(mirrorAt(M)),
        pv = v ? X(p.x) : Y(p.y);
      L.half(pv === m ? null : [v, m, Math.sign(pv - m)]);
    }
    let pick = null;
    const TIERS = [
      ["ts-label", 38, 28, 30],
      ["ts-small", 32, 23, 26],
      ["ts-small", 32, 23, 26, 2],
      ["ts-tiny", 30, 22, 24],
      ["ts-tiny", 30, 22, 24, 2],
    ];
    for (const [tc, h1, base0, lh, two] of TIERS) {
      let L1 = [p.name];
      if (two) {
        if (coords) continue;
        L1 = wrap(root, p.name, tc, measure(root, p.name, tc, { cls: "strong" }) * 0.6, {
          cls: "strong",
        });
        if (L1.length !== 2) continue;
      }
      const nw = Math.max(...L1.map((s) => measure(root, s, tc, { cls: "strong" }))),
        cs = coords ? pair(p.x, p.y) : "",
        cw = coords ? measure(root, cs, tc) : 0;
      const w = nw + (coords ? 10 + cw : 0) + 16,
        hh = h1 + (L1.length - 1) * lh;
      const best = L.placeR(X(p.x), Y(p.y), w, hh, away(p, c), dotR + 8, true);
      const cand = { tc, hh, base0, lh, L1, nw, cs, w, bx: best.b, hard: best.b.hard };
      if (!pick || cand.hard < pick.hard) pick = cand;
      if (!cand.hard) break;
    }
    L.box0(pick.bx);
    return pick;
  };
  const drawOne = (
    { i, base, attrs, opts: { coords, image } = {} },
    { tc, hh, base0, lh, L1, nw, cs, w, bx },
  ) => {
    const g = h("g", attrs, layers.labels);
    h(
      "rect",
      { x: bx.x, y: bx.y, width: w, height: hh, rx: "var(--r-mark)", fill: "var(--paper)" },
      g,
    );
    const t = lines(g, bx.x + 8, bx.y + base0, L1, tc, lh, {
      cls: "strong",
      fill: image ? "var(--compare-text)" : "var(--focus-text)",
    });
    if (image) computed(t, `${base}.${i}.name`);
    else editable(t, `${base}.${i}.name`);
    if (coords) computed(T(g, bx.x + 8 + nw + 10, bx.y + base0, cs, tc), `${base}.${i}.x`);
    return g;
  };
  // all the labels of a slide are placed together: in the given order if each lands clear, otherwise in the
  // order (a rotation, forwards or backwards) that leaves the fewest labels touching something
  const labelsAll = (items) => {
    const n0 = L.nBoxes(),
      idx = items.map((_, j) => j),
      orders = [];
    for (let r = 0; r < items.length; r++) {
      const o = idx.slice(r).concat(idx.slice(0, r));
      orders.push(o, [...o].reverse());
    }
    let best = null;
    for (const o of orders) {
      L.cut(n0);
      const picks = [];
      for (const j of o) picks[j] = planOne(items[j]);
      const clash = picks.filter((q) => q.hard >= 450).length,
        tot = picks.reduce((t, q) => t + q.hard, 0);
      if (!best || clash < best.clash || (clash === best.clash && tot < best.tot))
        best = { clash, tot, picks, o };
      if (!clash) break;
    }
    L.cut(n0);
    best.o.forEach((j) => L.box0(best.picks[j].bx));
    items.forEach((it, j) => drawOne(it, best.picks[j]));
  };
  const dot = (p, col, a) =>
    h(
      "circle",
      Object.assign(
        {
          cx: X(p.x),
          cy: Y(p.y),
          r: dotR,
          fill: col,
          stroke: "var(--paper)",
          "stroke-width": "var(--sw-rule)",
        },
        a,
      ),
      layers.dots,
    );

  /* ---------------- plot */
  if (mode === "plot") {
    const c = S.length >= 3 ? centroid(S) : [X(S[0].x) - cell, Y(S[0].y) + cell];
    if (P.join && S.length >= 3) L.poly(S.map((p) => [X(p.x), Y(p.y)]));
    S.forEach((p) => L.dot(X(p.x), Y(p.y), dotR + 4));
    if (P.join && S.length >= 2) edges(S);
    const items = [];
    S.forEach((p, i) => {
      const key = `pt:${i}`,
        kk = k(key),
        x0 = X(0 < xMin ? xMin : 0),
        y0 = Y(0 < yMin ? yMin : 0);
      // across the x-axis first, then up: the arrows show the order, then step back
      const cut = dotR + 5;
      if (p.x)
        line(
          ctx,
          layers.lines,
          x0,
          y0,
          X(p.x) - (p.y ? 0 : Math.sign(p.x) * cut),
          y0,
          "var(--compare)",
          "var(--sw-arrow)",
          { draw: kk, g: { hide: kk + 1 }, k: 0.8 },
        );
      if (p.y)
        line(
          ctx,
          layers.lines,
          X(p.x),
          y0,
          X(p.x),
          Y(p.y) + Math.sign(p.y) * cut,
          "var(--compare)",
          "var(--sw-arrow)",
          { draw: kk, delay: p.x ? 1000 : 0, g: { hide: kk + 1 }, k: 0.8 },
        );
      const dl = (p.x ? 1000 : 0) + (p.y ? 1000 : 0);
      dot(p, "var(--focus)", { s: kk, cls: "pop", delay: dl });
      items.push({
        p,
        i,
        base: "points",
        c,
        attrs: { s: kk, cls: "rise", delay: dl + 200 },
        opts: { coords: P.labels },
      });
    });
    labelsAll(items);
    if (b.join != null) {
      h(
        "polygon",
        {
          points: poly(S),
          fill: S.length >= 3 ? "var(--focus-pale)" : "none",
          stroke: "none",
          s: k("join"),
        },
        layers.shape,
      );
      h(
        "path",
        {
          d: `M${poly(S).replace(/ /g, " L")}${S.length >= 3 ? " Z" : ""}`,
          fill: "none",
          stroke: "var(--focus)",
          "stroke-width": "var(--sw-struct)",
          "stroke-linejoin": "round",
          cls: "draw",
          pathLength: 1,
          s: k("join"),
        },
        layers.shape,
      );
    }
    // the rule card: (x, y), across then up
    const ry = gy + 40;
    const pb = textBlock(root, R.x, ry + 20, txt(P, "label:pair", "(x, y)"), {
      cls: "ts-big",
      maxW: R.w,
      maxLines: 2,
      lh: 56,
      a: { s: k("rule"), cls: "rise" },
      edit: "text.label:pair",
    });
    textBlock(
      root,
      R.x,
      ry + 20 + pb.h + (pb.cls === "ts-big" ? 0 : 14),
      txt(P, "label:rule", "Across first, then up."),
      {
        cls: "ts-label",
        maxW: R.w,
        maxLines: 3,
        lh: 34,
        a: { s: k("rule"), cls: "rise", delay: 200, fill: "var(--ink-2)" },
        edit: "text.label:rule",
      },
    );
    return hooks;
  }

  /* ---------------- translate and reflect */
  const cS = centroid(S),
    cI = centroid(I);
  [...S, ...I].forEach((p) => L.dot(X(p.x), Y(p.y), dotR + 4));
  edges(S);
  edges(I);
  const polyS = S.map((p) => [X(p.x), Y(p.y)]),
    polyI = I.map((p) => [X(p.x), Y(p.y)]);
  L.poly(polyS);
  L.poly(polyI);
  const kImg = k("image"),
    kMove = k(mode === "translate" ? "slide" : "flip");
  const shapeAttrs = {
    fill: "var(--focus-pale)",
    stroke: "var(--focus)",
    "stroke-width": "var(--sw-struct)",
    "stroke-linejoin": "round",
  };
  // the original goes ghostly once a translation has moved it; a reflection keeps both, they are a pair
  const ghost = mode === "translate" ? `${kMove}:soft` : null;
  h(
    "polygon",
    Object.assign({ points: poly(S), s: k("shape"), cls: "rise", c: ghost }, shapeAttrs),
    layers.shape,
  );
  S.forEach((p, i) =>
    dot(p, "var(--focus)", { s: k("shape"), cls: "pop", delay: 200 + i * 80, c: ghost }),
  );
  // the moving copy: it starts on the original and ends as the image
  const mover = h("g", { s: kMove }, layers.shape);
  const inner = h("g", {}, mover);
  h(
    "polygon",
    {
      points: poly(S),
      fill: "var(--compare-pale)",
      stroke: "var(--compare)",
      "stroke-width": "var(--sw-struct)",
      "stroke-linejoin": "round",
    },
    inner,
  );
  S.forEach((p) =>
    h(
      "circle",
      {
        cx: X(p.x),
        cy: Y(p.y),
        r: dotR,
        fill: "var(--compare)",
        stroke: "var(--paper)",
        "stroke-width": "var(--sw-rule)",
      },
      inner,
    ),
  );
  let setU;
  if (mode === "translate") {
    const dx = P.move.right * cell,
      dy = -P.move.up * cell;
    setU = (u) =>
      inner.setAttribute("transform", `translate(${(dx * u).toFixed(1)} ${(dy * u).toFixed(1)})`);
    // every corner moves the same vector: one arrow per corner, drawn while the shape slides
    S.forEach((p, i) => {
      const q = I[i],
        ux = X(q.x) - X(p.x),
        uy = Y(q.y) - Y(p.y),
        ul = Math.hypot(ux, uy),
        cut = dotR + 5;
      line(
        ctx,
        layers.lines,
        X(p.x) + (ux / ul) * cut,
        Y(p.y) + (uy / ul) * cut,
        X(q.x) - (ux / ul) * cut,
        Y(q.y) - (uy / ul) * cut,
        "var(--ink-2)",
        "var(--sw-lead)",
        { draw: kMove, k: 0.7 },
      );
      L.seg(X(p.x), Y(p.y), X(q.x), Y(q.y));
    });
  } else {
    const M = P.mirror,
      v = mirrorVertical(M),
      a = mirrorAt(M),
      m = v ? X(a) : Y(a);
    setU = (u) => {
      const f = (1 - 2 * u).toFixed(3);
      inner.setAttribute(
        "transform",
        v
          ? `translate(${m} 0) scale(${f} 1) translate(${-m} 0)`
          : `translate(0 ${m}) scale(1 ${f}) translate(0 ${-m})`,
      );
    };
    const ml = v
      ? mirrorLine(layers.lines, m, gy, m, gy + gh, {
          col: "var(--ink)",
          extend: 0,
          a: { s: k("mirror"), cls: "wipe" },
        })
      : mirrorLine(layers.lines, left, m, gx1, m, {
          col: "var(--ink)",
          extend: 0,
          a: { s: k("mirror"), cls: "wipe" },
        });
    L.seg(...(v ? [m, gy, m, gy + gh] : [left, m, gx1, m]));
    // the mirror line's name sits on the line's own end, away from the axis names:
    // a vertical line's below the grid (or above it when the x numbers are below), a horizontal line's past its right end
    // a long name wraps (two lines where there is room below the grid) and is kept on the slide and off the right column
    const mt = mirrorTxt,
      MW = 260;
    let mw = Math.min(MW, measure(root, mt, "ts-small"));
    let mx,
      my,
      anchor = "middle",
      maxW = MW,
      maxLines = 1;
    const colEdge = RX - 16;
    if (v) {
      const below = layers.AY < gy + gh - 1; // the x-axis numbers are not along the bottom
      mx = m;
      my = below ? gy + gh + 34 : gy - 14;
      maxLines = below && my + 26 <= 640 ? 2 : 1;
      if (below) {
        maxW = Math.max(MW, gw);
        mw = Math.min(maxW, measure(root, mt, "ts-small"));
      } // nothing else sits under the grid
      const yb = layers.yNameBox;
      if (!below && mx - mw / 2 < yb.x + yb.w + 12 && mx + mw / 2 > yb.x - 12) {
        mx = Math.max(m + 12, yb.x + yb.w + 12);
        anchor = "start";
        maxW = Math.max(60, colEdge - mx);
      } else mx = clamp(mx, 64 + mw / 2, colEdge - mw / 2);
    } else {
      mx = layers.xnX;
      my = Math.abs(m - layers.AY) < 40 ? layers.AY + 46 : m + 9;
      anchor = "start";
      maxW = Math.max(60, colEdge - mx);
      maxLines = 2;
    }
    const mb = textBlock(layers.labels, mx, my, mt, {
      cls: "ts-small",
      maxW,
      maxLines,
      lh: 28,
      anchor,
      a: { s: k("mirror"), cls: "rise halo", fill: "var(--ink)" },
      edit: "text.label:mirror",
    });
    mw = mb.w;
    {
      const bx0 = anchor === "middle" ? mx - mw / 2 : mx;
      L.box({ x: bx0 - 4, y: my - 24, w: mw + 8, h: 32 + (mb.lines.length - 1) * mb.lh });
    }
    // the counted corner only: a dashed perpendicular from it to the line (dist), and from the line to its image (image)
    const kd = k("dist"),
      j = farthest(S, v, a);
    if (j >= 0) {
      const p = S[j],
        q = I[j],
        d = Math.abs((v ? p.x : p.y) - a),
        s = String(d),
        bw = measure(root, s, "ts-small", { cls: "strong" }) + 16;
      for (const [pt, kk, PG] of [
        [p, kd, polyS],
        [q, kImg, polyI],
      ]) {
        const P1 = [X(pt.x), Y(pt.y)],
          F = v ? [m, P1[1]] : [P1[0], m];
        h(
          "line",
          {
            x1: P1[0],
            y1: P1[1],
            x2: F[0],
            y2: F[1],
            stroke: "var(--ink-2)",
            "stroke-width": "var(--sw-lead)",
            "stroke-dasharray": "6 7",
            s: kk,
          },
          layers.lines,
        );
        L.seg(P1[0], P1[1], F[0], F[1]);
        // the badge goes on the guide where it runs outside the shape, between the mirror line and the shape's edge
        let tIn = 1;
        for (let t = 0; t <= 1; t += 1 / 80) {
          const x = F[0] + (P1[0] - F[0]) * t,
            y = F[1] + (P1[1] - F[1]) * t;
          if (L.inPoly(x, y, PG)) {
            tIn = t;
            break;
          }
        }
        const outLen = Math.hypot(P1[0] - F[0], P1[1] - F[1]) * tIn - (tIn === 1 ? dotR + 6 : 0);
        let bx;
        if (outLen >= (v ? bw : 32) + 12) {
          const mid = [F[0] + ((P1[0] - F[0]) * tIn) / 2, F[1] + ((P1[1] - F[1]) * tIn) / 2];
          bx = { x: mid[0] - bw / 2, y: mid[1] - 16, w: bw, h: 32 };
          L.box(bx);
        } else {
          const mid = v ? [(P1[0] + m) / 2, P1[1]] : [P1[0], (P1[1] + m) / 2];
          bx = L.place(
            mid[0],
            mid[1],
            bw,
            32,
            v ? [0, -1] : [1, 0],
            6,
            v
              ? [
                  [0, -1],
                  [0, 1],
                ]
              : [
                  [1, 0],
                  [-1, 0],
                ],
          );
        }
        const g = h("g", { s: kk, cls: "rise" }, layers.labels);
        h(
          "rect",
          {
            x: bx.x,
            y: bx.y,
            width: bx.w,
            height: bx.h,
            rx: "var(--r-mark)",
            fill: "var(--paper)",
            stroke: "var(--ink-2)",
            "stroke-width": "var(--sw-rule)",
          },
          g,
        );
        computed(
          T(g, bx.x + bx.w / 2, bx.y + 25, s, "ts-small", {
            cls: "strong",
            fill: "var(--ink)",
            "text-anchor": "middle",
          }),
          `shape.${j}.${v ? "x" : "y"}`,
        );
      }
    }
    void ml;
  }
  hooks.dur[mode === "translate" ? "slide" : "flip"] = 1500;
  const at = (kk, u) => setU(kk < kMove ? 0 : kk === kMove ? eIO(clamp(u)) : 1);
  Object.assign(hooks, { tick: (kk, u) => at(kk, u), still: () => setU(1), reset: () => setU(0) });
  setU(0);
  // labels: corner names on the grid; image names at the image step
  labelsAll([
    ...S.map((p, i) => ({
      p,
      i,
      base: "shape",
      c: cS,
      attrs: { s: k("shape"), cls: "rise", delay: 300, c: ghost },
    })),
    ...I.map((p, i) => ({
      p,
      i,
      base: "shape",
      c: cI,
      attrs: { s: kImg, cls: "rise", delay: i * 120 },
      opts: { image: true },
    })),
  ]);

  /* right column: what moves, then the table of corners */
  const rx = RX,
    rw = 1216 - rx;
  const headTxt =
    mode === "translate"
      ? txt(P, "label:vector", "Translation")
      : txt(P, "label:mirrorHead", "Mirror line");
  const kh = mode === "translate" ? kMove : k("mirror");
  let y = gy + 30;
  const hb = textBlock(root, rx, y, headTxt, {
    cls: "ts-h3",
    maxW: rw,
    maxLines: 2,
    lh: 36,
    a: { s: kh, cls: "rise", fill: "var(--ink-2)" },
    edit: mode === "translate" ? "text.label:vector" : "text.label:mirrorHead",
  });
  y += 48 + (hb.lines.length - 1) * hb.lh;
  const val = mode === "translate" ? vecWords(P.move.right, P.move.up) : mirrorName(P.mirror);
  const vt = computed(
    T(root, rx, y, val, "ts-label", {
      s: kh,
      cls: "rise",
      delay: 150,
      "font-weight": "var(--w-strong)",
    }),
    mode === "translate" ? "move.right" : "mirror.line",
  );
  void vt;
  y += 64;
  // the table of corners: one row per corner, in the largest type that fits the column's width and the
  // stage's height; long corner names put the image on its own line under the corner
  const n = S.length,
    yLast = 640;
  const TIERS = [
    [rowCls, rowCls === "ts-num" ? 56 : 48, 0],
    ["ts-label", 48, 0],
    ["ts-small", 38, 0],
    ["ts-label", 82, 36],
    ["ts-small", 66, 30],
    ["ts-tiny", 56, 26],
  ];
  const fitTier = ([c, rh, two]) => {
    const aw = measure(root, "→", c),
      cA = Math.max(...S.map((p) => measure(root, `${p.name} ${pair(p.x, p.y)}`, c))),
      cB = Math.max(...I.map((p) => measure(root, `${p.name} ${pair(p.x, p.y)}`, c)));
    const w = two ? Math.max(cA, 24 + aw + 12 + cB) : cA + cB + aw + 48;
    return { c, rh, two, aw, cA, ok: w <= rw && y + (n - 1) * rh + two <= yLast };
  };
  const tier = TIERS.map(fitTier).find((t) => t.ok) || fitTier(TIERS[TIERS.length - 1]);
  S.forEach((p, i) => {
    const q = I[i],
      g = h("g", { s: kImg, cls: "rise", delay: 150 + i * 120 }, root),
      c = tier.c;
    computed(
      T(g, rx, y, `${p.name} ${pair(p.x, p.y)}`, c, { fill: "var(--focus-text)" }),
      `shape.${i}.x`,
    );
    if (tier.two) {
      computed(T(g, rx + 24, y + tier.two, "→", c, { fill: "var(--ink-3)" }), `shape.${i}.x`);
      computed(
        T(g, rx + 24 + tier.aw + 12, y + tier.two, `${q.name} ${pair(q.x, q.y)}`, c, {
          fill: "var(--compare-text)",
        }),
        `shape.${i}.x`,
      );
    } else {
      computed(
        T(g, rx + tier.cA + 24 + tier.aw / 2, y, "→", c, {
          "text-anchor": "middle",
          fill: "var(--ink-3)",
        }),
        `shape.${i}.x`,
      );
      computed(
        T(g, rx + tier.cA + tier.aw + 48, y, `${q.name} ${pair(q.x, q.y)}`, c, {
          fill: "var(--compare-text)",
        }),
        `shape.${i}.x`,
      );
    }
    y += tier.rh;
  });
  return hooks;
}
