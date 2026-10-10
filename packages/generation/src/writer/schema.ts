import { type WriterBundle, writerBundle } from "./bundle";
import { freeformLabels, teachesSchema, writerCaps } from "./contract";

/*
 * The lesson writer's strict output schema, built in code (TEACH-110 part b). The base shape is
 * the pinned set's own generator (`make_schema.py` with `schema_parts.py`) ported line for line;
 * the structured diagram step then puts the writer's per-kind diagram specs in place of the
 * `{kind, shows, labels}` diagram. Those per-kind defs are carried as pinned data
 * (`diagram-defs.gen.json`) until part d builds them from the drawer's own schema.
 *
 * K1: `flow` numbers every slide from 1 (title and objectives included), so its bounds are the
 * whole lesson, `min..max`; `slides` holds slide 3 onward, `min-2..max-2`. For Standard (9–12)
 * the output is the pinned schema byte for byte (`schemaText`); Quick and Detailed get the same
 * shape with their own bounds.
 */

export type WriterStage = "KS1" | "KS2" | "KS3-5";
type J = Record<string, unknown>;

const S = (): J => ({ type: "string" });
const NUL = (x: J): J => ({ anyOf: [x, { type: "null" }] });
const REF = (n: string): J => ({ $ref: `#/$defs/${n}` });
function arr(items: J, lo?: number, hi?: number): J {
  const a: J = { type: "array", items };
  if (lo !== undefined) a.minItems = lo;
  if (hi !== undefined) a.maxItems = hi;
  return a;
}
const obj = (props: J): J => ({
  type: "object",
  additionalProperties: false,
  required: Object.keys(props),
  properties: props,
});

const PIC: J = {
  shows: S(),
  must_see: arr(S(), 1, 4),
  subject: { type: "string", enum: ["named", "generic"] },
};
const visualDefs = (b: WriterBundle): J => ({
  picture: obj(PIC),
  diagram: obj({
    kind: { type: "string", enum: (JSON.parse(b.diagramKinds) as { kinds: string[] }).kinds },
    shows: S(),
    labels: arr(S()),
  }),
  figure: { anyOf: [REF("picture"), REF("diagram"), { type: "null" }] },
});
const THEMES = [
  "playground",
  "crayon",
  "splash",
  "treehouse",
  "chalk",
  "reading-room",
  "studio",
  "exam-hall",
];

/** `design` first (the title slide uses it), then the flow; the objectives come approved, as input. */
const front = (lo: number, hi: number): J => ({
  design: obj({
    theme: { type: "string", enum: THEMES },
    picture_style: { type: "string", enum: ["photo", "illustration"] },
  }),
  flow: arr(
    obj({
      slide: { type: "integer" },
      does: S(),
      look_at: obj({
        kind: { type: "string", enum: ["picture", "picture-sequence", "diagram", "none"] },
        shows: NUL(S()),
      }),
      // Objective coverage: the objective numbers this slide teaches or checks ([] for title, objectives).
      teaches: { type: "array", items: { type: "integer" } },
    }),
    lo,
    hi,
  ),
});

const capsOf = (b: WriterBundle, st: WriterStage) =>
  st === "KS1" ? b.capsKS1 : st === "KS2" ? b.capsKS2 : b.capsKS3_5;
/** The writer's layout menu, in schema order. */
export const WRITER_TEMPLATES = [
  "title",
  "objectives",
  "visual-text",
  "big-visual",
  "picture-sequence",
  "compare",
  "steps",
  "equation-hero",
  "discussion",
  "explain",
  "hinge",
  "question-set",
  "practice",
  "exit-ticket",
] as const;

function templates(c: Record<string, number>): J {
  // A support point is plain words, or {label, text}: a short label makes it a key card.
  const PT: J = { anyOf: [S(), obj({ label: S(), text: S() })] };
  const tpl = (name: string, slots: J = {}) =>
    obj({ template: { type: "string", enum: [name] }, ...slots });
  const cap = (k: string) => c[k] as number;
  return {
    title: tpl("title", { heading: S(), lead: S(), picture: NUL(REF("picture")) }),
    objectives: tpl("objectives"),
    explain: tpl("explain", { heading: S(), lead: S(), points: arr(PT, 0, cap("explain.points")) }),
    "visual-text": tpl("visual-text", {
      heading: S(),
      lead: NUL(S()),
      points: arr(PT, 0, cap("visual-text.points")),
      figure: { anyOf: [REF("picture"), REF("diagram")] },
    }),
    "big-visual": tpl("big-visual", {
      heading: S(),
      lead: NUL(S()),
      figure: { anyOf: [REF("picture"), REF("diagram")] },
    }),
    "picture-sequence": tpl("picture-sequence", {
      heading: S(),
      sequence: arr(obj({ ...PIC, caption: S() }), 2, cap("picture-sequence.sequence")),
    }),
    compare: tpl("compare", {
      heading: S(),
      columns: arr(
        obj({ label: S(), text: S(), picture: NUL(REF("picture")) }),
        2,
        cap("compare.columns"),
      ),
    }),
    steps: tpl("steps", {
      heading: S(),
      points: arr(S(), 2, cap("steps.points")),
      figure: REF("figure"),
    }),
    "equation-hero": tpl("equation-hero", {
      heading: S(),
      lead: NUL(S()),
      formula: S(),
      points: arr(S(), 1, cap("equation-hero.points")),
      figure: NUL(REF("diagram")),
    }),
    hinge: tpl("hinge", {
      heading: S(),
      stem: S(),
      options: arr(S(), 2, cap("hinge.options")),
      correct: { type: "integer", minimum: 1, maximum: cap("hinge.options") },
    }),
    "question-set": tpl("question-set", {
      heading: S(),
      questions: arr(S(), 1, cap("question-set.questions")),
      instruction: NUL(S()),
      picture: NUL(REF("picture")),
    }),
    practice: tpl("practice", {
      heading: S(),
      questions: arr(S(), 1, cap("practice.questions")),
      instruction: NUL(S()),
      picture: NUL(REF("picture")),
    }),
    "exit-ticket": tpl("exit-ticket", {
      heading: S(),
      questions: arr(S(), 1, cap("exit-ticket.questions")),
      instruction: NUL(S()),
    }),
    discussion: tpl("discussion", { heading: S(), lead: S(), picture: NUL(REF("picture")) }),
  };
}

/** The base shape (`make_schema.py`): `min`/`max` count the whole lesson. */
function baseSchema(b: WriterBundle, stage: WriterStage, lo: number, hi: number): J {
  const T = templates(JSON.parse(capsOf(b, stage)) as Record<string, number>);
  const teach = WRITER_TEMPLATES.filter((n) => n !== "title" && n !== "objectives");
  const schema = obj({
    ...front(lo - 2, hi - 2),
    slides: arr({ anyOf: teach.map(REF) }, lo - 2, hi - 2),
  });
  schema.$defs = { ...visualDefs(b), ...T };
  const props = schema.properties as Record<string, J>;
  const flow = props.flow as J;
  flow.minItems = lo;
  flow.maxItems = hi;
  // Slide 2 is laid by code from the approved objectives; the writer never writes it.
  schema.properties = {
    design: props.design,
    flow,
    title: REF("title"),
    slides: props.slides,
  };
  delete (schema.$defs as J).objectives;
  schema.required = Object.keys(schema.properties as J);
  return schema;
}

/** The structured diagram step: each diagram slot takes the per-kind spec defs for its size. */
function withDiagramSpecs(b: WriterBundle, schema: J, stage: WriterStage): J {
  const all = b.diagramDefs as Record<string, J | string[]>;
  const specs = all[stage] as Record<string, J>;
  const order = all[`${stage}:order`] as string[];
  const defs = schema.$defs as Record<string, J>;
  delete defs.diagram;
  defs.figure = { anyOf: [REF("picture"), REF("diagram-side"), { type: "null" }] };
  const props = (n: string) => (defs[n] as J).properties as J;
  props("visual-text").figure = { anyOf: [REF("picture"), REF("diagram-side")] };
  props("big-visual").figure = { anyOf: [REF("picture"), REF("diagram-full")] };
  props("equation-hero").figure = NUL(REF("diagram-side"));
  for (const k of order) if (k in specs) defs[k] = specs[k] as J;
  return schema;
}

/**
 * Tile visuals (TEACH-75 part d, LAYOUT-AUDIT finding 4): a compare card's visual and a sequence
 * stage may be a diagram as well as a picture, and a hinge takes a figure, so a comparison of
 * structures or a drawn process keeps its layout. Every older output still parses: a picture card
 * and a picture stage keep their shape, and the hinge's figure is nullable. Not in the pinned
 * schema (the lab's bytes). Off by default (`TILE_VISUALS_DEFAULT`) until the writer's menu names
 * it; a caller turns it on with `tileVisuals: true`.
 */
export const TILE_VISUALS_DEFAULT = false;

function withTileVisuals(schema: J): J {
  const defs = schema.$defs as Record<string, J>;
  const VIS: J = { anyOf: [REF("picture"), REF("diagram-side")] };
  const def = (n: string) => defs[n] as J;
  const setProps = (n: string, f: (p: J) => J) => {
    const props = f({ ...(def(n).properties as J) });
    defs[n] = { ...def(n), properties: props, required: Object.keys(props) };
  };
  setProps("compare", (p) => {
    const cols = p.columns as J;
    const card = cols.items as J;
    const props = { ...(card.properties as J), picture: NUL(VIS) };
    return { ...p, columns: { ...cols, items: { ...card, properties: props } } };
  });
  setProps("picture-sequence", (p) => {
    const seq = p.sequence as J;
    const drawn = obj({ caption: S(), diagram: REF("diagram-side") });
    return { ...p, sequence: { ...seq, items: { anyOf: [seq.items, drawn] } } };
  });
  setProps("hinge", (p) => ({ ...p, figure: REF("figure") }));
  return schema;
}

/**
 * The writer's strict schema for a lesson of `min..max` slides at this stage, with the contract
 * (contract.ts): the freeform diagram labels held to the drawer's limits and, given the approved
 * `objectives` count, `flow[].teaches` held to `1..objectives`, and the tile visuals
 * (`withTileVisuals`). `pinned` gives the lab's pinned
 * schema with no contract (the evidence pins compare against it).
 */
export function writerSchema(
  stage: WriterStage,
  slides: { min: number; max: number },
  b: WriterBundle = writerBundle(),
  opts: { objectives?: number; pinned?: boolean; tileVisuals?: boolean } = {},
): J {
  const s = withDiagramSpecs(b, baseSchema(b, stage, slides.min, slides.max), stage);
  if (opts.pinned) return s;
  if (opts.tileVisuals ?? TILE_VISUALS_DEFAULT) withTileVisuals(s);
  const defs = s.$defs as Record<string, J>;
  for (const [name, def] of Object.entries(defs)) {
    const m = /^dg-(.+)-(side|full)$/.exec(name);
    if (m) defs[name] = writerCaps(def, m[1] as string, stage, m[2] as "side" | "full");
  }
  const free = defs["diagram-freeform"];
  if (free)
    defs["diagram-freeform"] = {
      ...free,
      properties: { ...(free.properties as J), labels: freeformLabels() },
    };
  const n = opts.objectives ?? 0;
  if (n > 0) {
    const flow = (s.properties as Record<string, J>).flow as J;
    const entry = flow.items as J;
    flow.items = {
      ...entry,
      properties: { ...(entry.properties as J), teaches: teachesSchema(n) },
    };
  }
  return s;
}

/** The schema as the pinned file holds it (one-space indent, trailing newline). */
export const schemaText = (
  stage: WriterStage,
  slides: { min: number; max: number },
  b: WriterBundle = writerBundle(),
) => `${JSON.stringify(writerSchema(stage, slides, b, { pinned: true }), null, 1)}\n`;
