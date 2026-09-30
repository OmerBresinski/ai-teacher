import { PALETTE, type PaletteFormId, paletteFor } from "@tj/slides";
import { z } from "zod";
import { houseRules } from "./shared";

/*
 * Plan, objectives + structure call, "stream-two-part" arm (Option A, lab/sol-structure).
 *
 * One small call on gpt-6.1-sol replaces plan-objectives: it returns the objectives, then the
 * lesson's slide-by-slide skeleton (role, objective served, one-line aim, palette form). Luna's
 * design cycles still write the slides.
 *
 * Streaming: `objectives` is the first key and `slides` the second, so a partial-JSON reader can
 * show the objectives on the plan screen the moment the `"slides"` key opens, while the skeleton
 * finishes behind them. Reasoning happens before any visible token, so time to objectives is
 * roughly reasoning time plus the objectives' own tokens.
 *
 * Cache layout: everything static (role, rules, the whole role/form menu, the sketch) is the
 * system text, byte-identical on every call, and every per-lesson line is in the user turn, the
 * slide count last. The menu is NOT subject-gated in the text (that would fork the prefix); the
 * one gated form, `figure`, says "maths or chemistry" in its line and is removed from the
 * schema's enum for other subjects (`planStructureSchemaFor`). The system text is under the
 * 1,024-token automatic cache minimum, so today nothing caches; it was not padded to reach it
 * (RESEARCH-model.md: the saving is at most ~$0.002 a call).
 *
 * Title slide: code builds it from the objectives. `slideCount` is the whole deck, title
 * included; the model plans `slideCount - 1` slides.
 *
 * Output fields are enums wherever they can be (role, form, objective number), so the only prose
 * the model pays output tokens for is each objective, its misconception and each slide's aim.
 * Counts (objectives, slides) are stated in prose and checked in `checkStructure`, not held by
 * `minItems`/`maxItems` (openai.md 2026-09-23: the bounds a model sees at decode time are enums,
 * required keys and key order).
 */

/** A slide's job. `open` and `close` belong to the whole lesson (objective 0). */
export const STRUCTURE_ROLES = ["teach", "show", "practise", "check", "open", "close"] as const;
export type StructureRole = (typeof STRUCTURE_ROLES)[number];

/**
 * The palette forms each role admits. `worked-example` is a `show` form here (a procedure shown
 * once), so a method or a close reading has a show slide that is not a picture; `vocabulary` is a
 * `teach` form. `notes` and `worksheet` are off the slide and never planned as slides.
 */
export const STRUCTURE_ROLE_FORMS: Record<StructureRole, readonly PaletteFormId[]> = {
  teach: ["explain", "explain-callout", "list", "compare", "sequence", "vocabulary"],
  show: ["photo", "figure", "diagram-slot", "worked-example"],
  practise: ["open-response", "discussion"],
  check: ["hinge", "true-false", "matching", "fill-gap", "sort"],
  open: ["photo", "discussion", "open-response", "hinge", "true-false"],
  close: ["discussion", "open-response", "hinge", "true-false", "sort", "matching", "fill-gap"],
};

/** Every form a slide may take, in palette order. */
export const SLIDE_FORMS = PALETTE.filter((f) => f.renderer.on === "slide").map((f) => f.id);

const MAX_OBJECTIVES = 4;
const OBJECTIVE_NUMBERS = [0, 1, 2, 3, 4] as const;

/** The forms one subject may use: the slide forms `paletteFor` offers it. */
export function structureFormsFor(subject?: string): PaletteFormId[] {
  const offered = new Set(paletteFor(subject).map((f) => f.id));
  return SLIDE_FORMS.filter((id) => offered.has(id));
}

/** The schema for one call: the form enum is gated by subject (a forked schema, not a forked prompt). */
export function planStructureSchemaFor(subject?: string) {
  const forms = structureFormsFor(subject) as [PaletteFormId, ...PaletteFormId[]];
  return z.strictObject({
    objectives: z.array(
      z.strictObject({
        text: z.string().min(8).max(160),
        misconception: z.string().min(1),
      }),
    ),
    slides: z.array(
      z.strictObject({
        role: z.enum(STRUCTURE_ROLES),
        objective: z.union(OBJECTIVE_NUMBERS.map((n) => z.literal(n)) as never),
        aim: z.string().min(1),
        form: z.enum(forms),
      }),
    ),
  });
}
export type PlanStructureOutput = {
  objectives: { text: string; misconception: string }[];
  slides: { role: StructureRole; objective: number; aim: string; form: PaletteFormId }[];
};

/** The strict JSON schema sent to OpenAI (Chat Completions `response_format`). */
export function planStructureJsonSchema(subject?: string) {
  return {
    name: "lesson_plan",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["objectives", "slides"],
      properties: {
        objectives: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["text", "misconception"],
            properties: { text: { type: "string" }, misconception: { type: "string" } },
          },
        },
        slides: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["role", "objective", "aim", "form"],
            properties: {
              role: { type: "string", enum: [...STRUCTURE_ROLES] },
              objective: { type: "integer", enum: [...OBJECTIVE_NUMBERS] },
              aim: { type: "string" },
              form: { type: "string", enum: structureFormsFor(subject) },
            },
          },
        },
      },
    },
  } as const;
}

/** One menu line per form, "  id: when to use it", under its role. Built from the palette. */
function roleMenu(): string {
  const useWhen = new Map(PALETTE.map((f) => [f.id, f.useWhen]));
  const line = (id: PaletteFormId) => `  ${id}: ${useWhen.get(id)}`;
  const block = (role: StructureRole, head: string) =>
    [`${role}: ${head}`, ...STRUCTURE_ROLE_FORMS[role].map(line)].join("\n");
  return [
    block("teach", "puts one idea of the objective on the slide"),
    block("show", "a picture, a drawn structure or a procedure worked once"),
    block("practise", "pupils use it in their own words"),
    block("check", "a quick question that tests what the objective's slides taught"),
    `open: the lesson's first slide, only where a hook suits the topic: ${STRUCTURE_ROLE_FORMS.open.join(", ")}`,
    `close: the lesson's last slide, only where the lesson ends on a question: ${STRUCTURE_ROLE_FORMS.close.join(", ")}`,
  ].join("\n");
}

const SHAPE_SKETCH =
  '{ "objectives": [{ "text": "Explain why the Romans invaded Britain", "misconception": "The Romans invaded only to take treasure" }], "slides": [{ "role": "teach", "objective": 1, "aim": "Britain\'s grain, metals and slaves, and what Rome wanted them for", "form": "list" }] }';

export type PlanStructureInput = {
  topic: string;
  subject?: string | undefined;
  yearGroup?: string | undefined;
  durationMin?: number | undefined;
  /** The teacher's class notes or prior knowledge, when given. */
  classNotes?: string | undefined;
  /** The lesson shape line (`shapeBlock`), when the plan screen has one. */
  shapeLine?: string | undefined;
  /** The whole deck, title slide included. */
  slideCount: number;
};

export const planStructurePrompt = {
  version: "plan-structure-stream-two-part.v1",
  system: [
    "You are an experienced UK teacher planning one lesson: first its learning objectives, then its slides in order. Another writer fills each slide from your plan.",
    houseRules("british", "names"),
    "",
    "Objectives. Each is one idea, starting with one observable verb, naming the actual concepts or methods it covers. No objective restates the topic. Together they cover the topic's core at this year group's level and no two share an idea.",
    "Give two or three objectives; one only when the topic is a single method or skill; four only for four distinct parts and 14 or more slides to plan.",
    "Where a lesson shape is given, the last objective sits at its verb and none above it.",
    "With each objective give the misconception pupils most often hold about it, as they would say it.",
    "",
    "Slides. The title slide is built for you from the objectives; plan exactly the number of slides the brief asks for after it.",
    "Each slide has a role, the objective it serves (0 for open and close), an aim and a form. The roles and the forms each allows:",
    roleMenu(),
    "Every objective has at least one teach, one show and one check slide. Its slides come together, objectives in order, and a check comes after what it checks.",
    "Size the scope to the slides: with fewer slides, choose fewer or narrower objectives, never thinner slides.",
    "Everything pupils learn is on a slide; the teacher's notes hold only what they say aloud. So each idea taught gets its own teach, show or practise slide.",
    "Fit the forms to the topic, subject and year group.",
    "An aim is one line naming what the slide teaches, shows or asks: its concept, example, picture or question. No two slides share an aim.",
    "",
    "JSON, in this shape:",
    SHAPE_SKETCH,
  ].join("\n"),
  user(input: PlanStructureInput): string {
    const lines = [`Topic: ${input.topic}`];
    if (input.subject) lines.push(`Subject: ${input.subject}`);
    if (input.yearGroup) lines.push(`Year group: ${input.yearGroup}`);
    if (input.durationMin) lines.push(`Lesson length: ${input.durationMin} minutes`);
    if (input.classNotes) lines.push(`Teacher's notes on the class: ${input.classNotes}`);
    if (input.shapeLine) lines.push(`Lesson shape: ${input.shapeLine}`);
    lines.push(`Slides to plan after the title slide: ${input.slideCount - 1}`);
    return lines.join("\n");
  },
} as const;

/** What code checks after the schema: each failure as one line. */
export function checkStructure(
  out: PlanStructureOutput,
  input: Pick<PlanStructureInput, "slideCount" | "subject">,
): string[] {
  const issues: string[] = [];
  const nObj = out.objectives.length;
  const want = input.slideCount - 1;
  if (nObj < 1 || nObj > MAX_OBJECTIVES)
    issues.push(`objectives: ${nObj}, want 1-${MAX_OBJECTIVES}`);
  if (out.slides.length !== want) issues.push(`slides: ${out.slides.length}, want ${want}`);
  const legal = new Set(structureFormsFor(input.subject));
  let lastObj = 0;
  out.slides.forEach((s, i) => {
    const at = `slide ${i + 2}`;
    if (!legal.has(s.form)) issues.push(`${at}: ${s.form} not offered for ${input.subject}`);
    if (!STRUCTURE_ROLE_FORMS[s.role].includes(s.form))
      issues.push(`${at}: ${s.form} is not a ${s.role} form`);
    const whole = s.role === "open" || s.role === "close";
    if (whole !== (s.objective === 0))
      issues.push(`${at}: ${s.role} serves objective ${s.objective}`);
    if (s.role === "open" && i !== 0) issues.push(`${at}: open is not first`);
    if (s.role === "close" && i !== out.slides.length - 1) issues.push(`${at}: close is not last`);
    if (!whole) {
      if (s.objective > nObj) issues.push(`${at}: objective ${s.objective} does not exist`);
      if (s.objective < lastObj) issues.push(`${at}: objective ${s.objective} after ${lastObj}`);
      lastObj = Math.max(lastObj, s.objective);
    }
  });
  for (let o = 1; o <= nObj; o++) {
    const run = out.slides.filter((s) => s.objective === o);
    const roles = new Set(run.map((s) => s.role));
    const missing = (["teach", "show", "check"] as const).filter((r) => !roles.has(r));
    if (run.length < 3 || missing.length > 0)
      issues.push(
        `objective ${o}: ${run.length} slides${missing.length ? `, no ${missing.join("/")}` : ""}`,
      );
    const firstCheck = run.findIndex((s) => s.role === "check");
    const firstTeach = run.findIndex((s) => s.role === "teach");
    if (firstCheck >= 0 && firstTeach > firstCheck)
      issues.push(`objective ${o}: checks before it teaches`);
  }
  return issues;
}
