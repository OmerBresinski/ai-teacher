import diagramDefs from "./diagram-defs.gen.json" with { type: "json" };
import { capsKS1, capsKS2, capsKS3_5, diagramKinds } from "./writer-prompts.gen";

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

const KINDS = (JSON.parse(diagramKinds) as { kinds: string[] }).kinds;
const PIC: J = {
  shows: S(),
  must_see: arr(S(), 1, 4),
  subject: { type: "string", enum: ["named", "generic"] },
};
const visualDefs = (): J => ({
  picture: obj(PIC),
  diagram: obj({ kind: { type: "string", enum: KINDS }, shows: S(), labels: arr(S()) }),
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

const CAPS: Record<WriterStage, string> = { KS1: capsKS1, KS2: capsKS2, "KS3-5": capsKS3_5 };
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
function baseSchema(stage: WriterStage, lo: number, hi: number): J {
  const T = templates(JSON.parse(CAPS[stage]) as Record<string, number>);
  const teach = WRITER_TEMPLATES.filter((n) => n !== "title" && n !== "objectives");
  const schema = obj({
    ...front(lo - 2, hi - 2),
    slides: arr({ anyOf: teach.map(REF) }, lo - 2, hi - 2),
  });
  schema.$defs = { ...visualDefs(), ...T };
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
function withDiagramSpecs(schema: J, stage: WriterStage): J {
  const all = diagramDefs as unknown as Record<string, J | string[]>;
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

/** The writer's strict schema for a lesson of `min..max` slides at this stage. */
export function writerSchema(stage: WriterStage, slides: { min: number; max: number }): J {
  return withDiagramSpecs(baseSchema(stage, slides.min, slides.max), stage);
}

/** The schema as the pinned file holds it (one-space indent, trailing newline). */
export const schemaText = (stage: WriterStage, slides: { min: number; max: number }) =>
  `${JSON.stringify(writerSchema(stage, slides), null, 1)}\n`;
