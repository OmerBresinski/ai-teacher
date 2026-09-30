import { FigureTemplateNameSchema } from "@tj/domain/documents";
import { figureTemplatesFor, type PaletteFormId, paletteFor, VOCABULARY_ENTRIES } from "@tj/slides";
import { z } from "zod";
import type { LessonShape } from "../shapes";
import type { ObjectiveArc } from "./plan-objectives";
import { shapeBlock } from "./shape";
import { type Audience, audienceBlock, houseRules } from "./shared";

/*
 * Design cycle (lesson designer plan, pipeline step 4; TEACH-199 slot schema, TEACH-201 prompt;
 * UX rulings 129, 131, 132, 133). One call per objective, run in parallel and streamed: the model
 * is a UK teacher-designer who chooses, for each piece of the objective's content, the palette
 * form that shows it best (`paletteMenu(subject)` from `@tj/slides`), and fills that form. No
 * second writer runs after it, so the material it writes is the text on the slide.
 *
 * v1 (30 Sept 2026):
 *  - Size is set by structure, never by counting (ruling 132): the prompt has no word or character
 *    number and never asks to shorten. The palette gives each form its units ("Holds") and one
 *    filled example; the slot schema below pins every count the renderer lays out (points,
 *    steps, pairs, options, sides, gaps, terms) with fixed lengths or `max`, and the text fields
 *    carry no `maxLength`, since the JSON schema reaches the model and a length there is a
 *    character budget. The palette's drift test holds the units to what fits on all 10 themes.
 *  - The material fields are named exactly as the palette examples name them (`heading`, `body`,
 *    `points`, `compare`, `steps`, `stem`, `options`…): an example calibrates only the fields it
 *    is written in (CORE 2026-09-30), so the model sizes the fields it fills against the example
 *    it was shown.
 *  - `notes` comes second, before the material: a field for the teacher's talk written first keeps
 *    the board text short without a length rule (openai.md 2026-09-30, "say it aloud first").
 *  - `form` is an enum of the palette's slide forms offered for the subject (a figure only where
 *    a template exists): a closed list cannot name a form the renderer lacks (CORE 2026-07-29).
 *    `notes` and `worksheet` are palette destinations, not slots.
 *  - The choosing line mirrors plan-objectives v19's lean clause, so the arc and the design read
 *    content the same way. The misconception routing is one sentence (ruling 131; the callout's
 *    "stated as wrong with not" wording is measured in openai.md 2026-09-27).
 *  - The photo brief follows the stock-photo findings (openai.md 2026-09-27): a findable subject,
 *    no people's names and no local places.
 *  - Palette first in the user turn: it is the same for every objective of a lesson, so the
 *    system text plus the palette is one cached prefix across the parallel calls.
 *
 * v2 (30 Sept 2026, smoke r1 on the 4 fit-lab briefs, `quality-prd/lab/designer-prompts`):
 *  - No photo in 24 slots, a Year 4 plants lesson included, and one objective with no visual at
 *    all. The trigger "a concrete thing pupils can picture" under-fills (openai.md 2026-09-27, the
 *    stock-photo rows): it is now "anything a camera could show", with its kinds named, and the
 *    visual minimum's exception is the narrow case, named ("purely abstract: a rule, a number, an
 *    argument"), not "where the objective has anything concrete".
 *  - 8 of 24 slots missed the fit on some theme, nearly all from units written as sentences where
 *    the example has phrases (hinge options of 15-20 words against the example's 3; compare points
 *    and sequence steps past the palette maxima). "The size of its example" did not hold. The line
 *    now names the kind of text each unit is (phrase or one sentence), which is structure, not a
 *    count of words (ruling 132).
 *
 * v3 (same day, smoke r2): the phrase rule, folded into the long fill sentence, did not hold (hinge
 *    options still full sentences, 9-15 words, against the example's 3); at effort low a trailing
 *    clause in a long sentence is dropped (plan-objectives v17). It is now its own sentence with
 *    one off-bench contrast pair. Headings (compare and worked-example headings of 9-10 words
 *    stepped on 3-9 themes) are "one line", the palette's own unit for the compare heading.
 *
 * v4 (same day, smoke r3; 18 of 21 slots fit on every theme): the misses were worked-example
 *    claim headings of 8-9 words (stepped on 4-7 themes). A worked example's heading names its
 *    method, as the palette's example does, with an off-bench example. `notes` is optional in the
 *    schema (see `notes` below).
 *
 * v5 (same day, smoke r4/r5): 3 of 5 explain-callout bodies had two sentences where the form holds
 *    one, and on the three big-type themes the callout row then did not fit. The fill line now
 *    says "exactly", "its count of sentences included": sentences are units the palette already
 *    counts, so this is structure, not a length (ruling 132).
 *
 * Bump `version` whenever `system` or `user` changes wording.
 */

export type DesignCycleInput = {
  topic: string;
  shape: LessonShape;
  audience: Audience;
  /** Every objective of the lesson with its arc, in order: the lesson's through-line. */
  objectives: readonly { text: string; arc?: ObjectiveArc | undefined }[];
  /** 0-based index of the objective this call designs. */
  objectiveIndex: number;
  /** This objective's slots: how many, the 1-based slide number of the first, the deck's size. */
  slots: { count: number; first: number; slideCount: number };
  /** `paletteMenu(audience.subject)`. */
  palette: string;
  /**
   * A re-fill: the one slot being replaced, its material as written, why (fit rung 4: "it did not
   * fit its slide because the options are sentences; this form needs phrases"; a design minimum: "the
   * objective has no photo, figure or diagram"), and the form to write.
   */
  replacing?: { form: SlotForm; material: string; reason: string; into: SlotForm } | undefined;
};

/* ------------------------------------------------------------------ slot schema */

const text = z.string().trim().min(1);
/**
 * Optional in the schema, asked for on every slot: in smoke r3 one call wrote `notes` last and left
 * it off two slots, and a required field failed the whole streamed call into a retry. A slot
 * without notes is a gap code can report; a lost call is a lost objective.
 */
const notes = text.optional();
const heading = text;

/** A photo slot's search brief: a subject stock photography has, and what it must show. */
export const ImageBriefSchema = z.object({
  subject: text,
  mustShow: z.array(text).max(3).optional(),
});

const option = z.object({ text, correct: z.boolean() });
const side = z.object({ label: text, points: z.array(text).length(2) });

/** One schema per slide form; counts are the palette's `holds` (see `palette.ts`). */
function formSchemas(templates: readonly string[]) {
  const figureTemplate =
    templates.length > 0
      ? FigureTemplateNameSchema.refine((t) => templates.includes(t))
      : FigureTemplateNameSchema;
  return {
    explain: z.object({ form: z.literal("explain"), notes, heading, body: text }),
    "explain-callout": z.object({
      form: z.literal("explain-callout"),
      notes,
      heading,
      body: text,
      callout: z.object({ text }),
    }),
    list: z.object({
      form: z.literal("list"),
      notes,
      heading,
      body: text,
      points: z.array(text).length(2),
    }),
    compare: z.object({
      form: z.literal("compare"),
      notes,
      heading,
      body: text,
      compare: z.object({ left: side, right: side }),
    }),
    sequence: z.object({
      form: z.literal("sequence"),
      notes,
      heading,
      body: text,
      steps: z.array(text).min(2).max(3),
    }),
    photo: z.object({
      form: z.literal("photo"),
      notes,
      heading,
      body: text,
      imageBrief: ImageBriefSchema,
    }),
    figure: z.object({
      form: z.literal("figure"),
      notes,
      heading,
      body: text,
      figureBrief: z.object({
        template: figureTemplate,
        purpose: text,
        // The template's values (the palette example's `figure.values`), checked against the
        // template's rules in code: a slot without valid ones is drawn as the labelled placeholder.
        values: z.record(z.string(), z.unknown()).optional(),
      }),
    }),
    "diagram-slot": z.object({
      form: z.literal("diagram-slot"),
      notes,
      heading,
      body: text,
      diagram: text,
    }),
    "worked-example": z.object({
      form: z.literal("worked-example"),
      notes,
      heading,
      question: text,
      steps: z.array(text).min(1).max(3),
    }),
    hinge: z.object({
      form: z.literal("hinge"),
      notes,
      stem: text,
      options: z.array(option).length(4),
      explanation: text,
    }),
    "true-false": z.object({
      form: z.literal("true-false"),
      notes,
      statement: text,
      correct: z.boolean(),
      explanation: text,
    }),
    matching: z.object({
      form: z.literal("matching"),
      notes,
      stem: text,
      pairs: z.array(z.object({ left: text, right: text })).length(3),
    }),
    "fill-gap": z.object({
      form: z.literal("fill-gap"),
      notes,
      stem: text,
      sentence: text,
      answers: z.array(text).min(1).max(2),
    }),
    sort: z.object({
      form: z.literal("sort"),
      notes,
      stem: text,
      steps: z.array(text).length(4),
    }),
    "open-response": z.object({
      form: z.literal("open-response"),
      notes,
      stem: text,
      modelAnswer: text,
    }),
    discussion: z.object({
      form: z.literal("discussion"),
      notes,
      prompt: text,
      footnote: text.optional(),
    }),
    vocabulary: z.object({
      form: z.literal("vocabulary"),
      notes,
      entries: z
        .array(z.object({ term: text, definition: text }))
        .min(2)
        .max(VOCABULARY_ENTRIES),
    }),
  } satisfies Partial<Record<PaletteFormId, z.ZodObject>>;
}

type FormSchemas = ReturnType<typeof formSchemas>;
export type SlotForm = keyof FormSchemas;
export type DesignSlot = z.output<FormSchemas[SlotForm]>;

/** The slide forms offered for a subject, in palette order (a figure only with a template). */
export function slotFormsFor(subject?: string): SlotForm[] {
  return paletteFor(subject)
    .filter((f) => f.renderer.on === "slide")
    .map((f) => f.id as SlotForm);
}

export const ExitQuestionSchema = z.object({ question: text, answer: text });

/**
 * The slot contract for one call: exactly `slotCount` slots, each one of the subject's slide
 * forms with its material at the palette's units, then the objective's one exit question.
 */
export function designCycleSchemaFor(subject: string | undefined, slotCount: number) {
  const all = formSchemas(figureTemplatesFor(subject));
  const offered = slotFormsFor(subject).map((id) => all[id]);
  const slot = z.discriminatedUnion(
    "form",
    offered as [FormSchemas[SlotForm], ...FormSchemas[SlotForm][]],
  );
  return z.object({
    slots: z.array(slot).length(slotCount),
    exitQuestion: ExitQuestionSchema,
  });
}
export type DesignCycleOutput = {
  slots: DesignSlot[];
  exitQuestion: z.output<typeof ExitQuestionSchema>;
};

/* ------------------------------------------------------------------ prompt */

function arcLine(o: DesignCycleInput["objectives"][number], i: number, self: boolean): string {
  const head = `${i + 1}. ${o.text}${self ? "  <- this call" : ""}`;
  if (!o.arc) return head;
  return `${head}\n   Angle: ${o.arc.angle}. Leans to: ${o.arc.lean}. Misconception: ${o.arc.misconception}`;
}

/**
 * The re-fill's block (fit rung 4): the slot it replaces, as written, and why it did not fit.
 * Absent on a cycle call, whose text is unchanged. Wording pending the prompt-engineer.
 */
function replacingBlock(r: NonNullable<DesignCycleInput["replacing"]>): string[] {
  return [
    "",
    `This slot replaces ${/^[aeiou]/.test(r.form) ? "an" : "a"} ${r.form} slot: ${r.reason}.`,
    `Its material: ${r.material}`,
    `Write the same content as a ${r.into} slot.`,
  ];
}

export const designCyclePrompt = {
  version: "design-cycle.v5",
  system: [
    "You are an experienced UK teacher who designs lesson slides. You design the slides for one objective of a lesson, in the slots you are given: for each piece of its content you choose the palette form that shows it best, then fill it.",
    "",
    houseRules("british", "names", "pitch"),
    'Each slot is one slide with one idea. Its heading is one line stating that idea as a claim ("Plants make their own food"), not a label; a worked example\'s heading names its method ("Finding the area of a triangle").',
    "Choose by what the content is: anything a camera could show (a living thing, an object, a place, a scene) is a photo; a structure, process or layout is a figure or a diagram slot; a method is a worked example; a definition or an argument is text (explain, list, compare, sequence). Unless the objective is purely abstract (a rule, a number, an argument), at least one of its slots is a photo, figure or diagram slot.",
    'Fill each form with exactly the units its Holds line gives, its count of sentences included. Options, points, pair sides and labels are phrases, not sentences: "Heavier than water", not "The stone is heavier than the water it pushes aside." A question or a step is one sentence.',
    "The slide shows the idea; what you say around it (the full explanation, analogies, questions to ask, answers) goes in notes.",
    "The slots teach first; the last one checks the objective with a question form. Neighbouring slots use different forms.",
    'The objective\'s misconception: a short one is the callout of an explain-callout slot, stated as wrong with "not" ("Evaporation is not the same as boiling."); one pupils must confront is a true-false slot; one that needs explaining gets a slot of its own. In a hinge it is also a wrong option.',
    "A photo's imageBrief names a subject stock photography has and what the photo must show: no names of people and no local places. A figure's figureBrief gives its template and what it shows. A diagram slot's diagram says what to draw and what to label.",
    "exitQuestion: one question that checks this objective, answered in a line, with its answer.",
  ].join("\n"),
  user(input: DesignCycleInput): string {
    const [shapeLine] = shapeBlock(input.shape);
    const { count, first, slideCount } = input.slots;
    const last = first + count - 1;
    const where = count === 1 ? `slide ${first}` : `slides ${first} to ${last}`;
    return [
      "Palette (form id, when to use it, what it holds, one filled example):",
      input.palette,
      "",
      `Topic: ${input.topic}`,
      audienceBlock(input.audience),
      `Lesson shape: ${shapeLine}`,
      "",
      "The lesson's objectives, each with its arc (a starter comes before the first and an exit ticket after the last):",
      ...input.objectives.map((o, i) => arcLine(o, i, i === input.objectiveIndex)),
      "",
      `Design objective ${input.objectiveIndex + 1}: ${count} ${count === 1 ? "slot" : "slots"}, ${where} of ${slideCount}.`,
      ...(input.replacing ? replacingBlock(input.replacing) : []),
    ].join("\n");
  },
} as const;
