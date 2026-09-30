import { PALETTE, type PaletteFormId, paletteFor } from "@tj/slides";
import { z } from "zod";

/*
 * Plan, objectives + structure call, "codes" arm (Option A, 30 Sept 2026; lab/sol-structure).
 * One call on gpt-6.1-sol replaces plan-objectives: it returns the objectives and the slide-by-slide
 * skeleton after the title slide (role, palette form, objective served, one-line aim). Luna still
 * writes each slide.
 *
 * The arm's bet is compactness: every choice the model makes is a code (role word, palette id,
 * objective number), constrained by a strict JSON schema, and the only prose it writes is the
 * objective text, the misconception and one aim line per slide. Output tokens cost 20x input on
 * Sol, so this is where the price and the latency live.
 *
 *  - `obj` comes before `slides`, so the objectives stream first: the plan screen can show them
 *    when the `"slides"` key arrives, before the skeleton finishes.
 *  - Role and form are paired in the schema (one `anyOf` branch per role group), so a form outside
 *    its role's row of the code table cannot be emitted; `o` is 1..4 for teaching roles and 0..4
 *    for open/close (0 = the whole lesson). The table is generated from palette.ts `useWhen`, so it
 *    cannot drift from the renderer. Off-slide forms (notes, worksheet) are not offered.
 *  - Counts are code's job. Strict mode may ignore min/maxItems, so the exact slide count is given
 *    as a number in the user message (title excluded, computed by code) and checked by
 *    `checkStructure`, as is "each objective has a teach, show and check slide".
 *  - No word counts (prompt-minimalism rule). Objective rules are v22's, compressed.
 *  - v2 (smoke, y5 fractions at 10 slides): v1's "aim is one line" gave full sentences (~30 tokens
 *    each, 639 visible tokens, $0.0101 a call); the aim is now "a phrase", the only change.
 *
 * Bump `version` whenever `system`, `user` or the table changes.
 */

export const STRUCTURE_ROLES = ["teach", "show", "practise", "check", "open", "close"] as const;
export type StructureRole = (typeof STRUCTURE_ROLES)[number];

/** The palette forms each role may use; open and close may use any slide form. */
const TEACH_FORMS = [
  "explain",
  "explain-callout",
  "list",
  "compare",
  "sequence",
  "vocabulary",
] as const satisfies readonly PaletteFormId[];
const SHOW_FORMS = [
  "photo",
  "figure",
  "diagram-slot",
  "worked-example",
] as const satisfies readonly PaletteFormId[];
const TASK_FORMS = [
  "hinge",
  "true-false",
  "matching",
  "fill-gap",
  "sort",
  "open-response",
  "discussion",
] as const satisfies readonly PaletteFormId[];

type RoleGroup = { roles: readonly StructureRole[]; forms: readonly PaletteFormId[] | "any" };
const ROLE_GROUPS: readonly RoleGroup[] = [
  { roles: ["teach"], forms: TEACH_FORMS },
  { roles: ["show"], forms: SHOW_FORMS },
  { roles: ["practise", "check"], forms: TASK_FORMS },
  { roles: ["open", "close"], forms: "any" },
];

const SLIDE_FORMS = PALETTE.filter((f) => f.renderer.on === "slide").map((f) => f.id);

/** The slide forms offered for a subject (palette gating, off-slide forms dropped). */
export function structureFormsFor(subject?: string): PaletteFormId[] {
  return paletteFor(subject)
    .filter((f) => f.renderer.on === "slide")
    .map((f) => f.id);
}

/** The forms a role may use for this subject. */
export function formsForRole(role: StructureRole, subject?: string): PaletteFormId[] {
  const legal = structureFormsFor(subject);
  const group = ROLE_GROUPS.find((g) => g.roles.includes(role));
  if (!group || group.forms === "any") return legal;
  return group.forms.filter((f) => legal.includes(f));
}

const useWhen = (id: PaletteFormId) => PALETTE.find((f) => f.id === id)?.useWhen ?? "";

/** The code table: one row per role group, `id = use when`, gated by subject. */
export function formTable(subject?: string): string {
  return ROLE_GROUPS.map((g) => {
    const head = g.roles.join(", ");
    if (g.forms === "any") return `${head}: any id above`;
    const legal = structureFormsFor(subject);
    const cells = g.forms.filter((f) => legal.includes(f)).map((f) => `${f} = ${useWhen(f)}`);
    return `${head}: ${cells.join("; ")}`;
  }).join("\n");
}

/* ------------------------------------------------------------------ schema */

export const StructureObjectiveSchema = z.strictObject({
  text: z.string().min(8).max(160),
  mis: z.string().min(1),
});

export const StructureSlideSchema = z.strictObject({
  role: z.enum(STRUCTURE_ROLES),
  form: z.enum(SLIDE_FORMS as [PaletteFormId, ...PaletteFormId[]]),
  o: z.number().int().min(0).max(4),
  aim: z.string().min(1),
});

export const PlanStructureOutputSchema = z.strictObject({
  obj: z.array(StructureObjectiveSchema).min(1).max(4),
  slides: z.array(StructureSlideSchema).min(1),
});
export type PlanStructureOutput = z.output<typeof PlanStructureOutputSchema>;

/**
 * The strict JSON schema sent to the model for one subject. Hand-written rather than generated,
 * because the role/form pairing is an `anyOf` of objects with per-branch enums.
 */
export function planStructureJsonSchema(subject?: string) {
  const branch = (g: RoleGroup) => {
    const forms =
      g.forms === "any" ? structureFormsFor(subject) : formsForRole(g.roles[0]!, subject);
    const whole = g.roles.includes("open");
    return {
      type: "object",
      additionalProperties: false,
      required: ["role", "form", "o", "aim"],
      properties: {
        role: { type: "string", enum: [...g.roles] },
        form: { type: "string", enum: forms },
        o: { type: "integer", enum: whole ? [0, 1, 2, 3, 4] : [1, 2, 3, 4] },
        aim: { type: "string" },
      },
    };
  };
  return {
    name: "plan_structure",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["obj", "slides"],
      properties: {
        obj: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["text", "mis"],
            properties: { text: { type: "string" }, mis: { type: "string" } },
          },
        },
        slides: { type: "array", items: { anyOf: ROLE_GROUPS.map(branch) } },
      },
    },
  };
}

/* ------------------------------------------------------------------ prompt */

export type PlanStructureInput = {
  topic: string;
  subject?: string | undefined;
  yearGroup?: string | undefined;
  /** First line of `shapeBlock` (verb and class confidence). */
  shapeLine: string;
  /** Total slides in the deck, title included. The model plans `slideCount - 1`. */
  slideCount: number;
  priorKnowledge?: string | undefined;
  curriculum?: { text: string } | undefined;
};

const ROLE_LINES = [
  "teach: new content, on the slide",
  "show: an example, image or demonstration of it",
  "practise: pupils do it, with support",
  "check: pupils answer, showing whether they have it",
  "open: a hook or recall before the teaching",
  "close: a review at the end",
];

export function planStructureSystem(subject?: string): string {
  return [
    "You plan one UK lesson: its learning objectives, then its slides after the title slide (code adds the title, which shows the objectives).",
    "Write in British English, pitched to the year group. Never name a pupil or member of staff.",
    "",
    "obj: each objective is one idea, starts with one observable verb and names the actual concepts or methods; none restates the topic. Levels rise: Recall (names or states), Explain (how or why), Apply (uses a method), Evaluate (judges, with a reason); the shape line's verb is the lesson's reach: the last objective sits at it, none above, none more than two levels below. mis: the misconception pupils most often hold about it, as they would say it.",
    "",
    "slides: exactly the number asked, in teaching order. role and form are codes from the tables; o is the objective number the slide serves (0 for an open or close slide on the whole lesson); aim is a phrase naming the specific idea, example or task on that slide.",
    "Every objective gets at least a teach, a show and a check slide. Choose as many objectives, one to four, as the slides can cover this way, and spend the rest where this topic needs them most. Fit the mix and order to the topic, subject and year group; open and close slides are optional.",
    "",
    "Roles:",
    ...ROLE_LINES,
    "",
    "Forms by role (id = use when):",
    formTable(subject),
  ].join("\n");
}

export const planStructureCodesPrompt = {
  version: "plan-structure-codes.v2",
  system: planStructureSystem,
  user(input: PlanStructureInput): string {
    const parts = [
      `Topic: ${input.topic}`,
      `Subject: ${input.subject ?? "not given"}`,
      `Year group: ${input.yearGroup ?? "not given"}`,
      `Shape: ${input.shapeLine}`,
    ];
    if (input.priorKnowledge) parts.push(`Already covered: ${input.priorKnowledge}`);
    if (input.curriculum)
      parts.push("Curriculum unit (context, not an order):", input.curriculum.text);
    parts.push(`Slides after the title: ${input.slideCount - 1}`);
    return parts.join("\n");
  },
} as const;

/* ------------------------------------------------------------------ checks */

export type StructureIssue = string;

/** Code checks the schema cannot hold: exact count, objective coverage, legal forms. */
export function checkStructure(
  out: PlanStructureOutput,
  slideCount: number,
  subject?: string,
): StructureIssue[] {
  const issues: StructureIssue[] = [];
  const want = slideCount - 1;
  if (out.slides.length !== want) issues.push(`count ${out.slides.length} != ${want}`);
  const n = out.obj.length;
  out.slides.forEach((s, i) => {
    if (s.o > n) issues.push(`slide ${i + 1} serves objective ${s.o} of ${n}`);
    if (s.o === 0 && s.role !== "open" && s.role !== "close")
      issues.push(`slide ${i + 1} ${s.role} o=0`);
    if (!formsForRole(s.role, subject).includes(s.form))
      issues.push(`slide ${i + 1} ${s.role}/${s.form} illegal`);
  });
  for (let k = 1; k <= n; k++) {
    const mine = out.slides.filter((s) => s.o === k);
    const roles = new Set(mine.map((s) => s.role));
    if (mine.length < 3) issues.push(`objective ${k}: ${mine.length} slides`);
    for (const r of ["teach", "show", "check"] as const) {
      if (!roles.has(r)) issues.push(`objective ${k}: no ${r}`);
    }
  }
  return issues;
}
