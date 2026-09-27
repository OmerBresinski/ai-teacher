/**
 * The `triangle` Figure template's values and solver (ADR 0034, TEACH-221): the values' shape,
 * their editorial rules, `solveTriangle` and the unknown. Sides are named after the opposite
 * vertex (`a` is BC, `b` is CA, `c` is AB) and angles are in degrees. The drawing is `./triangle`.
 *
 * It reads nothing in the layouts ↔ figures import cycle (`./measure` and `./unicode` stand
 * outside it, and `./index` is a type import), so unlike the templates it loads first on its own.
 */
import { z } from "zod";
import { editorialIssue } from "../editorial";
import type { FigureUnknown } from "./index";
import { measureRules, measureShape } from "./measure";

/* ------------------------------------------------------------------ */
/* Values                                                              */
/* ------------------------------------------------------------------ */

export const VERTICES = ["A", "B", "C"] as const;
export const SIDES = ["a", "b", "c"] as const;
export type Vertex = (typeof VERTICES)[number];
export type Side = (typeof SIDES)[number];

/** Longest a side or angle label may be ("12.5 cm", "x", "40°"), and a vertex name ("Q′"). */
export const TRIANGLE_LABEL_MAX = 12;
export const TRIANGLE_VERTEX_MAX = 3;
/** Given angles agree within this many degrees, given sides within this share of their length. */
export const ANGLE_TOLERANCE = 0.5;
const SIDE_TOLERANCE = 0.01;

const names = z.object({
  A: z.string().optional(),
  B: z.string().optional(),
  C: z.string().optional(),
});

/** The values with no rules; every field is optional, so no union reaches the JSON schema. */
export const triangleShape = z.object({
  /** Printed vertex names, e.g. "P", "Q′"; none drawn when absent. */
  vertices: names.optional(),
  sides: z
    .object({
      a: measureShape.optional(),
      b: measureShape.optional(),
      c: measureShape.optional(),
    })
    .optional(),
  angles: z
    .object({
      A: measureShape.optional(),
      B: measureShape.optional(),
      C: measureShape.optional(),
    })
    .optional(),
  rightAngleAt: z.enum(VERTICES).optional(),
  /** Marked with single ticks. */
  equalSides: z.array(z.enum(SIDES)).optional(),
  /** Marked with double arcs. */
  equalAngles: z.array(z.enum(VERTICES)).optional(),
  /** The side or angle the question asks for. */
  unknown: z.enum([...SIDES, ...VERTICES]).optional(),
  /** Two sides and a non-included angle that allow two triangles: the one with the obtuse angle. */
  obtuse: z.boolean().optional(),
  /** A second triangle, similar (or congruent, `scale` 1) to the first, drawn beside it. */
  pair: z
    .object({
      scale: z.number(),
      vertices: names.optional(),
      /** Labels only: the lengths are the first triangle's times `scale`. */
      sides: z
        .object({ a: z.string().optional(), b: z.string().optional(), c: z.string().optional() })
        .optional(),
      angles: names.optional(),
      /** Drawn reflected. */
      mirror: z.boolean().optional(),
    })
    .optional(),
});

export type TriangleValues = z.infer<typeof triangleShape>;

/** Every length and angle of a solved triangle: lengths in the values' units, angles in degrees. */
export type SolvedTriangle = Record<Side | Vertex, number>;

const opposite = (v: Vertex): Side => v.toLowerCase() as Side;
export const vertexOf = (s: Side): Vertex => s.toUpperCase() as Vertex;
/** The two vertices at the ends of a side, in the order that names it: BC, CA, AB. */
export const ENDS: Record<Side, [Vertex, Vertex]> = { a: ["B", "C"], b: ["C", "A"], c: ["A", "B"] };
/** The next vertex round the triangle: A, B, C, A. */
export const next = (v: Vertex): Vertex => VERTICES[(VERTICES.indexOf(v) + 1) % 3] as Vertex;

export const rad = (deg: number) => (deg * Math.PI) / 180;
export const deg = (r: number) => (r * 180) / Math.PI;
const positive = (n: number | undefined) =>
  n !== undefined && Number.isFinite(n) && n > 0 ? n : undefined;

type Knowns = { sides: Partial<Record<Side, number>>; angles: Partial<Record<Vertex, number>> };

/**
 * The sides and angles the values give: positive lengths, angles strictly between 0° and 180°,
 * and 90° at `rightAngleAt` whatever its angle's value says. `skip` leaves one out (the unknown).
 */
function knownsOf(v: TriangleValues, skip?: Side | Vertex): Knowns {
  const known: Knowns = { sides: {}, angles: {} };
  for (const s of SIDES) {
    const value = positive(v.sides?.[s]?.value);
    if (value !== undefined && s !== skip) known.sides[s] = value;
  }
  for (const a of VERTICES) {
    const value = positive(v.angles?.[a]?.value);
    if (value !== undefined && value < 180 && a !== skip) known.angles[a] = value;
  }
  if (v.rightAngleAt && v.rightAngleAt !== skip) known.angles[v.rightAngleAt] = 90;
  return known;
}

/** Three lengths that make a triangle: each shorter than the other two together. */
const inequalityHolds = (a: number, b: number, c: number) => a < b + c && b < c + a && c < a + b;

function fromSides(a: number, b: number, c: number): SolvedTriangle | undefined {
  if (!inequalityHolds(a, b, c)) return undefined;
  const angle = (x: number, y: number, z: number) =>
    deg(Math.acos(Math.max(-1, Math.min(1, (y * y + z * z - x * x) / (2 * y * z)))));
  const A = angle(a, b, c);
  const B = angle(b, c, a);
  return { a, b, c, A, B, C: 180 - A - B };
}

/** Every side from the three angles and one side, by the sine rule. */
function fromAngles(
  angles: Record<Vertex, number>,
  side: Side,
  length: number,
): SolvedTriangle | undefined {
  if (VERTICES.some((v) => !(angles[v] > 0))) return undefined;
  const k = length / Math.sin(rad(angles[vertexOf(side)]));
  return {
    a: k * Math.sin(rad(angles.A)),
    b: k * Math.sin(rad(angles.B)),
    c: k * Math.sin(rad(angles.C)),
    ...angles,
  };
}

/** Two known angles and the third from 180°. */
function allAngles(pair: [Vertex, number][]): Record<Vertex, number> | undefined {
  const [first, second] = pair;
  if (!first || !second) return undefined;
  const third = VERTICES.find((v) => v !== first[0] && v !== second[0]) as Vertex;
  const rest = 180 - first[1] - second[1];
  if (!(rest > 0)) return undefined;
  return { [first[0]]: first[1], [second[0]]: second[1], [third]: rest } as Record<Vertex, number>;
}

/** How the triangle was fixed, in the order of preference `solveTriangle` tries them. */
type Method = "SSS" | "SAS" | "ASA" | "AAS" | "RHS" | "SSA" | "AA";

function solveKnowns(
  k: Knowns,
  obtuse: boolean,
): { triangle: SolvedTriangle; method: Method } | undefined {
  const { sides, angles } = k;
  const given = <K extends string>(r: Partial<Record<K, number>>, keys: readonly K[]) =>
    keys.flatMap((key) => (r[key] === undefined ? [] : [[key, r[key] as number] as [K, number]]));
  const knownSides = given(sides, SIDES);
  const knownAngles = given(angles, VERTICES);
  const done = (triangle: SolvedTriangle | undefined, method: Method) =>
    triangle && Object.values(triangle).every((n) => Number.isFinite(n) && n > 0)
      ? { triangle, method }
      : undefined;

  // SSS.
  if (sides.a !== undefined && sides.b !== undefined && sides.c !== undefined)
    return done(fromSides(sides.a, sides.b, sides.c), "SSS");

  // SAS: an angle and the two sides that meet at it.
  for (const [v, angle] of knownAngles) {
    const [p, q] = SIDES.filter((s) => s !== opposite(v)) as [Side, Side];
    const x = sides[p];
    const y = sides[q];
    if (x === undefined || y === undefined) continue;
    const third = Math.sqrt(x * x + y * y - 2 * x * y * Math.cos(rad(angle)));
    const all = { ...sides, [opposite(v)]: third } as Record<Side, number>;
    return done(fromSides(all.a, all.b, all.c), "SAS");
  }

  // ASA: a side and the two angles at its ends; AAS: a side and any two angles.
  if (knownSides.length > 0 && knownAngles.length >= 2) {
    for (const [s, length] of knownSides) {
      const [p, q] = ENDS[s];
      if (angles[p] === undefined || angles[q] === undefined) continue;
      const all = allAngles([
        [p, angles[p]],
        [q, angles[q]],
      ]);
      if (all) return done(fromAngles(all, s, length), "ASA");
    }
    const [first] = knownSides;
    const all = allAngles(knownAngles.slice(0, 2));
    if (first && all) return done(fromAngles(all, first[0], first[1]), "AAS");
    return undefined;
  }

  // RHS, then SSA: an angle, the side opposite it and one other side (the right angle first).
  if (knownSides.length === 2) {
    const candidates = knownAngles
      .filter(([v]) => sides[opposite(v)] !== undefined)
      .sort(([, x], [, y]) => (y === 90 ? 1 : 0) - (x === 90 ? 1 : 0));
    for (const [v, angle] of candidates) {
      const facing = sides[opposite(v)] as number;
      const [[other, length]] = knownSides.filter(([s]) => s !== opposite(v)) as [[Side, number]];
      const sine = (length * Math.sin(rad(angle))) / facing;
      if (sine > 1 + 1e-9) return undefined;
      const acute = deg(Math.asin(Math.min(1, sine)));
      // A second triangle exists when the other side is the longer and the angle given is acute.
      const two = angle < 90 && length > facing && acute < 90 - 1e-9;
      const at = two && obtuse ? 180 - acute : acute;
      const all = allAngles([
        [v, angle],
        [vertexOf(other), at],
      ]);
      if (!all) return undefined;
      return done(fromAngles(all, opposite(v), facing), angle === 90 ? "RHS" : "SSA");
    }
    return undefined;
  }

  // Two angles alone: the shape, its longest side 1.
  if (knownSides.length === 0 && knownAngles.length >= 2) {
    const all = allAngles(knownAngles.slice(0, 2));
    if (!all) return undefined;
    const largest = VERTICES.reduce((x, y) => (all[y] > all[x] ? y : x));
    return done(fromAngles(all, opposite(largest), 1), "AA");
  }
  return undefined;
}

/**
 * Every side and angle of the triangle the values fix, from the first subset of them that fixes
 * one, in this order: SSS, SAS, ASA, AAS, RHS, SSA (the acute solution, or the obtuse one with
 * `obtuse`); two angles alone give the shape with its longest side 1. `undefined` when the values
 * cannot fix a triangle. Values beyond the subset are not checked here (`triangleValuesSchema`).
 */
export function solveTriangle(values: TriangleValues): SolvedTriangle | undefined {
  return solveKnowns(knownsOf(values), values.obtuse ?? false)?.triangle;
}

/** Whether the values give enough to fix a triangle, whether or not the numbers make one. */
function enoughGiven(k: Knowns): boolean {
  const sides = Object.keys(k.sides).length;
  const angles = Object.keys(k.angles).length;
  return sides === 3 || (sides === 2 && angles >= 1) || angles >= 2;
}

/**
 * The values the triangle was drawn from agree with it: every given angle within 0.5° and, when
 * the triangle has a scale, every given side within 1 %.
 */
function agrees(v: TriangleValues, solved: SolvedTriangle, scaled: boolean): boolean {
  const angleOk = (a: Vertex, given: number | undefined) =>
    given === undefined || Math.abs(given - solved[a]) <= ANGLE_TOLERANCE;
  for (const a of VERTICES) if (!angleOk(a, v.angles?.[a]?.value)) return false;
  if (v.rightAngleAt && !angleOk(v.rightAngleAt, 90)) return false;
  if (!scaled) return true;
  return SIDES.every((s) => {
    const given = v.sides?.[s]?.value;
    return given === undefined || Math.abs(given - solved[s]) <= SIDE_TOLERANCE * solved[s];
  });
}

/**
 * What the model supplies for a triangle. Every rule is editorial: a miss becomes a finding for
 * Repair, never a failed Generate stage, and the drawing copes with it. The messages are our own
 * words, never the model's text, so none needs a `log` form (ADR 0015).
 */
export const triangleValuesSchema = triangleShape.superRefine((v, ctx) => {
  const labelRule = { maxLabel: TRIANGLE_LABEL_MAX, positive: true };
  for (const s of SIDES) {
    const m = v.sides?.[s];
    if (m) measureRules(ctx, ["sides", s], m, labelRule);
  }
  for (const a of VERTICES) {
    const m = v.angles?.[a];
    if (m) measureRules(ctx, ["angles", a], m, labelRule);
  }
  const nameRule = (given: TriangleValues["vertices"], path: PropertyKey[]) => {
    for (const a of VERTICES)
      if ((given?.[a]?.length ?? 0) > TRIANGLE_VERTEX_MAX)
        ctx.addIssue(
          editorialIssue(`Keep each vertex name to ${TRIANGLE_VERTEX_MAX} characters or fewer.`, [
            ...path,
            a,
          ]),
        );
  };
  nameRule(v.vertices, ["vertices"]);
  // A value that is not a positive number already has its issue; the rules below would only
  // repeat it in other words.
  const measures = [...SIDES.map((x) => v.sides?.[x]), ...VERTICES.map((x) => v.angles?.[x])];
  const nonPositive = measures.some((x) => x?.value !== undefined && !(x.value > 0));
  if (v.pair) {
    nameRule(v.pair.vertices, ["pair", "vertices"]);
    for (const [group, keys] of [
      ["sides", SIDES],
      ["angles", VERTICES],
    ] as const) {
      const labels: Partial<Record<string, string>> = v.pair[group] ?? {};
      for (const key of keys)
        if ((labels[key]?.length ?? 0) > TRIANGLE_LABEL_MAX)
          ctx.addIssue(
            editorialIssue(`Keep each label to ${TRIANGLE_LABEL_MAX} characters or fewer.`, [
              "pair",
              group,
              key,
            ]),
          );
    }
    if (!(v.pair.scale > 0))
      ctx.addIssue(editorialIssue("pair.scale is a positive number.", ["pair", "scale"]));
  }

  if (nonPositive) return;
  const k = knownsOf(v);
  // Every angle given, 180° or more included (the solver leaves those out), the right angle 90°.
  const given = { ...v.angles, ...(v.rightAngleAt ? { [v.rightAngleAt]: { value: 90 } } : {}) };
  const angles = VERTICES.flatMap((a) => positive(given[a]?.value) ?? []);
  const sum = angles.reduce((x, y) => x + y, 0);
  if (angles.length === 3 ? Math.abs(sum - 180) > ANGLE_TOLERANCE : sum >= 180) {
    ctx.addIssue(
      editorialIssue(
        angles.length === 3
          ? "The three angles, the right angle included, add up to 180°."
          : "The angles given, the right angle included, add up to less than 180°.",
        ["angles"],
      ),
    );
    return;
  }
  const { a, b, c } = k.sides;
  if (a !== undefined && b !== undefined && c !== undefined && !inequalityHolds(a, b, c)) {
    ctx.addIssue(
      editorialIssue(
        "The three sides do not make a triangle: each is shorter than the other two together.",
        ["sides"],
      ),
    );
    return;
  }
  if (v.rightAngleAt) {
    const hypotenuse = opposite(v.rightAngleAt);
    const h = k.sides[hypotenuse];
    if (h !== undefined && SIDES.some((s) => s !== hypotenuse && (k.sides[s] ?? 0) >= h)) {
      ctx.addIssue(
        editorialIssue(
          `The hypotenuse (side ${hypotenuse}, opposite the right angle) is the longest side.`,
          ["sides", hypotenuse, "value"],
        ),
      );
      return;
    }
  }
  if (!enoughGiven(k)) {
    ctx.addIssue(
      editorialIssue(
        "Give enough values to fix one triangle: three sides, two sides and an angle, one side and two angles, or two angles.",
      ),
    );
    return;
  }
  const solved = solveKnowns(k, v.obtuse ?? false);
  if (!solved) {
    ctx.addIssue(
      editorialIssue(
        "The sides and angles given do not make a triangle: the side opposite the angle is too short.",
        ["sides"],
      ),
    );
    return;
  }
  if (!agrees(v, solved.triangle, solved.method !== "AA"))
    ctx.addIssue(
      editorialIssue(
        "The sides and angles given disagree: make every value fit the one triangle (sine and cosine rules, angles adding up to 180°).",
      ),
    );
});

/**
 * The value of the side or angle the question asks for (`values.unknown`), solved from the other
 * values with the unknown's own value left out, so the answer is checked rather than echoed.
 * `undefined` when there is no unknown, when the rest cannot fix the triangle, or when the
 * unknown is a side of a triangle given only by its angles.
 */
export function triangleUnknown(values: TriangleValues): FigureUnknown | undefined {
  const asked = values.unknown;
  if (!asked) return undefined;
  const solved = solveKnowns(knownsOf(values, asked), values.obtuse ?? false);
  if (!solved) return undefined;
  const isSide = (SIDES as readonly string[]).includes(asked);
  if (isSide && solved.method === "AA") return undefined;
  return { value: solved.triangle[asked], unit: isSide ? "length" : "degrees" };
}

/**
 * What the drawing needs from the values: the triangle the preferred subset fixes, whether it has
 * a scale (not two angles alone), and whether every other value given agrees with it.
 */
export function solveForDrawing(
  values: TriangleValues,
): { triangle: SolvedTriangle; exact: boolean } | undefined {
  const solved = solveKnowns(knownsOf(values), values.obtuse ?? false);
  if (!solved) return undefined;
  return {
    triangle: solved.triangle,
    exact: agrees(values, solved.triangle, solved.method !== "AA"),
  };
}
