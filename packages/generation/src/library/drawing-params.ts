/**
 * The params a model's drawing is built from, given the params as they will draw (TEACH-247 part
 * i). One the fill leaves out is refused, never defaulted: a default draws a different number from
 * the slide's ("half of 16" with no group size drew 2 groups of 2). The refusal goes to the fill's
 * one repair call; a fill that still leaves it out falls back to the drawer, so the slide keeps a
 * visual (fill.ts).
 *
 * `always` is also `required` in the schema the filler sees. `when` changes no schema or prompt.
 * Part de ("x = 5" drawn as 6 → 9) listed every model's values that print a default, by drawing
 * every preset with each value changed. What the drawing is about is here: a slide states it, so
 * the repair call can set it. A demonstration value a slide rarely states ("24 hours later") is
 * not: a refusal could only make the fill invent one or send the slide to the drawer.
 * `omitted-defaults.test.ts` holds new models to the audit, and names each value left out and why.
 */
import { NUMBER_MODELS } from "./consistency";
import type { J, LibRefusal } from "./types";

/** Named on every fill of the model, whatever else it chose. */
const each = (...keys: string[]) => ({ always: [], when: () => keys });

export const DRAWING_PARAMS: Record<string, { always: string[]; when?: (p: J) => string[] }> = {
  equal_groups: {
    always: [],
    when: (p) => (p.layout === "grid" ? ["grid"] : ["groups", "size"]),
  },
  fractions: { always: ["fractions"], when: (p) => (p.operation === "of" ? ["amount"] : []) },
  bar_model: {
    always: ["type"],
    when: (p) =>
      p.type === "fraction"
        ? ["amount", "fraction"]
        : p.type === "percentage"
          ? ["amount", "percent"]
          : p.type === "multiplicative"
            ? ["parts", "times"]
            : ["parts"],
  },
  number_line: {
    always: ["from", "to"],
    when: (p) => (p.task === "round" ? ["round"] : p.task === "position" ? ["marks"] : ["jumps"]),
  },
  number_bonds: { always: ["whole", "parts"] },
  place_value: { always: ["number"] },
  column_methods: { always: ["a", "b"] },
  coins_money: {
    always: ["amount"],
    when: (p) => (p.task === "change" ? ["paid", "item"] : []),
  },
  // TEACH-247 part de.
  balance_equations: {
    always: [],
    when: (p) =>
      p.mode === "machine"
        ? ["machine.input", "machine.steps"]
        : ["balance.left", "balance.right", ...(p.unknown === "letter" ? ["letter"] : [])],
  },
  counting_subitising: each("n"),
  sequences_patterns: {
    always: [],
    when: (p) => [
      "terms",
      ...(p.kind === "linear" ? ["start", "step"] : ["unit"]),
      ...(p.ask === "missing" ? ["missingAt"] : p.ask === "nth" ? ["farTerm"] : []),
    ],
  },
  measuring_scales: each("max", "interval", "value"),
  area_perimeter: {
    always: [],
    when: (p) => [
      "length",
      "width",
      ...(p.shape === "cuboid" ? ["height"] : []),
      ...(p.shape === "compound" ? ["cutLength", "cutWidth"] : []),
    ],
  },
  shape_2d: each("shapes"),
  shape_3d_nets: each("solids"),
  coordinate_grid: {
    always: [],
    when: (p) =>
      p.mode === "plot"
        ? ["points"]
        : p.mode === "translate"
          ? ["shape", "move.right"]
          : p.mode === "reflect"
            ? [
                "shape",
                ...(["vertical", "horizontal"].includes(String((p.mirror as J | undefined)?.line))
                  ? ["mirror.at"]
                  : []),
              ]
            : ["start.col", "start.row", "goal.col", "goal.row", "steps"],
  },
  data_chart: {
    always: [],
    when: (p) => [
      "data",
      "unit",
      ...(["block", "bar", "line"].includes(String(p.chart)) ? ["categoryName", "valueName"] : []),
      ...(p.chart === "pictogram" ? ["keyUnit"] : []),
    ],
  },
  sort_venn_carroll: each("rules", "items"),
  plant_growth: {
    always: [],
    when: (p) => (p.view === "needs" ? ["pots"] : p.view === "parts" ? ["parts"] : []),
  },
  food_chain: each("organisms"),
  body_map: each("parts"),
  classify_key: {
    always: [],
    when: (p) => ["things", "items", ...(p.mode === "groups" ? ["groups"] : [])],
  },
  evolution_adaptation: each("organism", "pressure"),
  microhabitat_survey: each("sites", "creatures"),
  mixtures_separating: {
    always: [],
    when: (p) => ((p.masses as J | undefined)?.show ? ["masses.a", "masses.b"] : []),
  },
  collision_theory: each("factors", "reactantA", "reactantB"),
  light_shadows: {
    always: [],
    when: (p) => ((p.move as J | undefined)?.show ? ["move.to"] : []),
  },
  circuits: each("components"),
  forces_magnets: {
    always: [],
    when: (p) => (p.context === "magnets" ? ["pairs"] : ["object", "forces"]),
  },
  rocks_soil_fossils: {
    always: [],
    when: (p) =>
      p.view === "soil"
        ? ["soil"]
        : p.view === "rocks"
          ? ["rocks"]
          : ["organism", ...((p.found as J | undefined)?.show ? ["found.text"] : [])],
  },
  earth_sun_moon: {
    always: [],
    when: (p) => (p.phenomenon === "planets" ? ["planets"] : []),
  },
  volcano_earthquake: {
    always: [],
    when: () => ["layers"],
  },
  rivers_coasts: { always: [], when: (p) => (p.view === "coast" ? ["coast"] : []) },
  climate_biomes: { always: [], when: (p) => (p.view === "biome" ? [] : ["places"]) },
  map_skills: {
    always: [],
    when: (p) => [
      "features",
      ...(p.task === "route" ? ["route.stops"] : []),
      ...(p.task === "compass" ? ["centre.place", "centre.label"] : []),
      ...(p.task === "scale" ? ["scale.bar"] : []),
    ],
  },
  place_change: each("place", "periods", "features"),
  seasons_weather: each("seasons"),
  movement_court: { always: [], when: (p) => (p.mode === "tactics" ? ["players"] : []) },
  community_helpers: each("helpers"),
  rhythm_grid: { always: [], when: (p) => (p.showRhythm ? ["rhythm"] : []) },
  colour_mixing: { always: [], when: (p) => (p.mode === "mix" ? ["mixes"] : []) },
  cycle_wheel: {
    always: [],
    when: () => ["stages"],
  },
};

/** The value at a dotted path, as a refusal names it ("machine.input"). */
const at = (o: J, path: string): unknown =>
  path.split(".").reduce<unknown>((v, k) => (v as J | null | undefined)?.[k], o);

/** The drawing-defining params `own` (what the filler sent) leaves out, as refusals. */
export function missingDrawingParams(id: string, own: J, params: J): LibRefusal[] {
  const d = DRAWING_PARAMS[id];
  if (!d) return [];
  const need = [...d.always, ...(d.when?.(params) ?? [])];
  return [...new Set(need)]
    .filter((k) => at(own, k) === undefined || at(own, k) === null)
    .map((k) => ({
      path: k,
      reason: NUMBER_MODELS.has(id)
        ? `${k} is missing: the drawing is built from it, and the model's default would draw a different number`
        : `${k} is missing: the drawing is built from it, and the model's default would draw something the slide does not say`,
    }));
}
