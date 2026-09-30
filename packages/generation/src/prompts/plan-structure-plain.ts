import { type PaletteFormId, paletteFor } from "@tj/slides";
import { z } from "zod";
import { type Audience, audienceBlock, houseRules } from "./shared";

/*
 * Plan, objectives + structure call (Option A, lab arm "plain", 30 Sept 2026). One call on
 * gpt-6.1-sol at effort low replaces plan-objectives: it returns the lesson's objectives and the
 * slide-by-slide skeleton (role, palette form, objective served, one-line aim) that the Luna
 * design-cycle calls then write. Code, not this call, adds the title slide (which carries the
 * objectives), so the skeleton is the deck after the title.
 *
 * Why it reads the way it does:
 *  - `objectives` comes before `slides` in the schema so the objectives stream out first and the
 *    plan screen can show them while the skeleton is still being written.
 *  - The slide count is computed by code and sent on the user turn ("Slides after the title");
 *    the system text names that line, never a number (CORE 2026-09-16). The schema does not pin
 *    the array length (strict mode may ignore minItems/maxItems); `structureChecks` does.
 *  - Role, form and objective are enums, so they cannot drift and cost few output tokens. The
 *    form enum is gated by subject (`structureForms`), so an illegal form cannot be returned.
 *  - The per-objective floor (teach, show, check) is a must-have, so it is stated as a rule and
 *    checked in code rather than offered as a choice (openai.md 2026-09-26: priced choices lose
 *    the checks first). Nothing else is fixed: no starter, no exit ticket.
 *  - No word counts; "one short line" and "one line" carry length.
 */

/** Slide roles, in the order the prompt glosses them. */
export const STRUCTURE_ROLES = ["open", "teach", "show", "practise", "check", "close"] as const;
export type StructureRole = (typeof STRUCTURE_ROLES)[number];

/** Forms that land off the slide are not skeleton slides. */
const OFF_SLIDE: readonly PaletteFormId[] = ["notes", "worksheet"];

/** The slide forms a skeleton may use for a subject (the palette's own subject gating). */
export function structureForms(subject?: string): PaletteFormId[] {
  return paletteFor(subject)
    .map((f) => f.id)
    .filter((id) => !OFF_SLIDE.includes(id));
}

/** The form menu: one line per form, id and when to use it. */
function formMenu(subject?: string): string {
  return paletteFor(subject)
    .filter((f) => !OFF_SLIDE.includes(f.id))
    .map((f) => `- ${f.id}: ${f.useWhen}`)
    .join("\n");
}

export const MAX_OBJECTIVES = 4;
const OBJECTIVE_NUMBERS = [1, 2, 3, 4] as const;

/** Zod: validates a parsed answer. */
export function planStructureSchemaFor(subject?: string) {
  const forms = structureForms(subject) as [PaletteFormId, ...PaletteFormId[]];
  return z.strictObject({
    objectives: z.array(z.string().min(8)).min(1).max(MAX_OBJECTIVES),
    slides: z.array(
      z.strictObject({
        role: z.enum(STRUCTURE_ROLES),
        form: z.enum(forms),
        objective: z
          .union(
            OBJECTIVE_NUMBERS.map((n) => z.literal(n)) as [
              z.ZodLiteral<1>,
              ...z.ZodLiteral<number>[],
            ],
          )
          .nullable(),
        aim: z.string().min(1),
      }),
    ),
  });
}
export type PlanStructureOutput = z.output<ReturnType<typeof planStructureSchemaFor>>;

/** The strict JSON schema sent as `response_format` (every field required, no extras). */
export function planStructureJsonSchema(subject?: string) {
  return {
    name: "lesson_plan",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["objectives", "slides"],
      properties: {
        objectives: { type: "array", items: { type: "string" } },
        slides: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["role", "form", "objective", "aim"],
            properties: {
              role: { type: "string", enum: [...STRUCTURE_ROLES] },
              form: { type: "string", enum: structureForms(subject) },
              objective: { type: ["integer", "null"], enum: [...OBJECTIVE_NUMBERS, null] },
              aim: { type: "string" },
            },
          },
        },
      },
    },
  } as const;
}

export type PlanStructureInput = {
  topic: string;
  audience: Audience;
  durationMin?: number | undefined;
  /** Total slides in the deck, title included. The skeleton is one fewer. */
  slideCount: number;
  /** Optional: the lesson-shape line production already computes (`shapeBlock`). */
  shapeLine?: string | undefined;
};

export const planStructurePlainPrompt = {
  version: "plan-structure-plain.v2",
  system(subject?: string): string {
    return [
      "You plan one lesson for a UK teacher: first its learning objectives, then its slides in order.",
      "",
      houseRules("british", "names", "pitch"),
      "",
      "Objectives: one to four, in teaching order. Each is one idea in one short line, starting with an observable verb and naming the actual concept or method. Together they cover the core of the topic at this year group's level, as much as the slides can teach well, and no two share an idea.",
      "",
      'Slides: the title slide, which shows the objectives, is added for you. Plan exactly as many slides after it as the "Slides after the title" line says. For each slide give:',
      "- role: open (gets the class thinking before new teaching), teach (puts new content on the slide), show (makes it concrete: an example, a worked example, a picture or a diagram), practise (pupils use it themselves), check (a quick question that shows the teacher who has got it) or close (draws the lesson together)",
      "- form: the form from the list below that best carries it",
      "- objective: the number of the objective it serves, or null for a slide that serves the whole lesson",
      "- aim: a short phrase naming what the slide holds (the idea, example, question or task); the slide's writer fills in the detail",
      "",
      "Every objective has at least a teach, a show and a check slide, its check after its teaching. Everything pupils must learn goes on a slide; the teacher's notes carry only what is said aloud. Order and mix the slides as a good teacher of this subject and year group would for this topic.",
      "",
      "Forms:",
      formMenu(subject),
    ].join("\n");
  },
  user(input: PlanStructureInput): string {
    const parts = [`Topic: ${input.topic}`, audienceBlock(input.audience)];
    if (input.durationMin) parts.push(`Lesson length: ${input.durationMin} minutes`);
    if (input.shapeLine) parts.push(`Lesson shape: ${input.shapeLine}`);
    parts.push(`Slides after the title: ${input.slideCount - 1}`);
    return parts.join("\n");
  },
} as const;

/** What code checks on a parsed answer; `valid` is all of the hard checks. */
export type StructureCheck = {
  valid: boolean;
  countExact: boolean;
  objectivesCovered: boolean;
  formsLegal: boolean;
  objectiveRefsOk: boolean;
  /** Soft: each objective's first check comes after its first teach. */
  checkAfterTeach: boolean;
  problems: string[];
};

export function structureChecks(
  out: PlanStructureOutput,
  slideCount: number,
  subject?: string,
): StructureCheck {
  const problems: string[] = [];
  const countExact = out.slides.length === slideCount - 1;
  if (!countExact) problems.push(`slides ${out.slides.length}, want ${slideCount - 1}`);
  const legal = new Set(structureForms(subject));
  const bad = out.slides.filter((s) => !legal.has(s.form)).map((s) => s.form);
  const formsLegal = bad.length === 0;
  if (!formsLegal) problems.push(`illegal forms ${bad.join(",")}`);
  const n = out.objectives.length;
  const objectiveRefsOk = out.slides.every((s) => s.objective === null || s.objective <= n);
  if (!objectiveRefsOk) problems.push("slide refers to a missing objective");
  let objectivesCovered = true;
  let checkAfterTeach = true;
  for (let o = 1; o <= n; o++) {
    const mine = out.slides.map((s, i) => ({ ...s, i })).filter((s) => s.objective === o);
    const roles = new Set(mine.map((s) => s.role));
    const ok = mine.length >= 3 && roles.has("teach") && roles.has("show") && roles.has("check");
    if (!ok) {
      objectivesCovered = false;
      problems.push(`objective ${o}: ${mine.map((s) => s.role).join(",") || "no slides"}`);
    }
    const t = mine.find((s) => s.role === "teach")?.i;
    const c = mine.find((s) => s.role === "check")?.i;
    if (t !== undefined && c !== undefined && c < t) checkAfterTeach = false;
  }
  return {
    valid: countExact && formsLegal && objectiveRefsOk && objectivesCovered,
    countExact,
    objectivesCovered,
    formsLegal,
    objectiveRefsOk,
    checkAfterTeach,
    problems,
  };
}
