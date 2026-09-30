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
 * v6 (30 Sept 2026, designer eval round 1: 16 decks judged blind, `quality-prd/lab/fit-lab/rounds/r1`;
 *    v5 re-run standalone on the 8 briefs as the before, `lab/designer-prompts2/v5`):
 *  - Roles. Each slot now comes with a role in the user turn (teach, show, practise, check),
 *    assigned in code from the slot count and the arc's lean (`slotRoles`), and the system text
 *    defines each role as a closed set of forms. Round 1 had 2.5 distinct forms a deck, no
 *    practice slot anywhere (ratio's practice repeated the worked example word for word; the
 *    persuasive decks never had pupils write), and one-slot objectives spent the slot on a check
 *    (rocks: metamorphic rock taught only in a question's notes). A per-slot role is the same
 *    lever as a slot in a sketch: it is filled as shown, where a global "teach first, check last"
 *    rule collapsed to one pattern (openai.md 2026-09-26, shape enum and diagram trigger).
 *  - Parts. The arc's `angle` (plan-objectives v20) now lists the parts the lesson teaches of the
 *    objective; each teach or show slot takes the next part. Round 1's judges found neighbouring
 *    slides saying the same thing (rivers 4/5, electrolysis 7/8, Weimar 4/5, persuasive 7/8,
 *    linear 5/7) and strands dropped (electrolysis concentration); the call saw the whole arc but
 *    nothing told it which slide carried which part.
 *  - The slide carries the claim with its reason and its example. v5's "the slide shows the idea;
 *    what you say around it goes in notes" gave one-sentence slides with the mechanism in the
 *    notes (Weimar's Ruhr chain, persuasive's device examples, the Y4 diagram slides), which every
 *    judge marked thin. The five nouns are the classes the judges named (generate-slide v23's
 *    tested-not-taught list).
 *  - Hinge form: a hinge asks for a thing pupils name, so its options are phrases. In the v5
 *    before, 9 of 15 hinges failed fit; every failure asked "why" or "which statement", and every
 *    hinge asking "what forms" or "what is the ratio" fit. The phrase rule alone (v3) did not
 *    reach a "why" stem: the form of the stem decides the form of the options.
 *  - Worked-example heading: "the label of its method, not an instruction", with an off-bench
 *    label. v4's "names its method" gave imperatives ("Solve an equation with variable terms on
 *    both sides") that stepped on 5-7 themes.
 *  - Check variety: the check line says what each closed form tests (round 1: hinge and
 *    true-false only; 15 of 19 checks in the before were hinges).
 *  - Accuracy: one line describing the checker (a subject specialist reads every slide) and
 *    the standard (this year group's specification), the bake-off pattern that scored 0 wrong of
 *    141 (openai.md 2026-09-23). Verify never ran on a designer lesson in round 1 (fix branch
 *    e0fa4e68), and at effort low it passed the rivers deck with the speed error in place, so
 *    the source call carries the standard too.
 *  - Gone: "The slots teach first; the last one checks" (roles say it per slot) and the visual
 *    minimum sentence (the show role and the teach choosing line carry it; the code minimum
 *    re-fills a miss).
 *
 * v7 (same day, v6 smoke on the 8 briefs, `lab/designer-prompts2/v6`): fit 74 -> 85% of
 *    slot-themes and no hinge failed, but visuals fell to 3 of 17 objectives (v5: 14 of 19) and
 *    12 of 17 checks were true-false (v5: 4 of 19). The visual-minimum sentence v6 dropped was
 *    the lever (openai.md 2026-09-27 and 2026-09-30, photo trigger): it is back, worded for the
 *    roles ("one teach or show slot"), with a calculation named in the abstract exception so a
 *    method objective's worked example is not asked to be a diagram. Every arc carries a
 *    misconception, so "one pupils must confront is a true-false check" made true-false the
 *    check everywhere; the misconception's home is now the hinge's wrong option (v5's
 *    behaviour), and the check line is keyed to what the part is, ordered from the specific
 *    forms (sort, matching, fill-gap) to the general ones, since Luna at low takes the first
 *    case that reads as true (openai.md 2026-09-26, shape enum).
 *
 * v8 (same day, v7 smoke, `lab/designer-prompts2/v7`): visuals stayed at 4 of 16 objectives with
 *    the minimum sentence folded into the choosing line after the roles, and history hinges
 *    asking "why" or "which best explains" overflowed again (options of 8-13 words), while the
 *    v6 gate had 0 hinge failures. The minimum is now its own sentence straight after the roles
 *    (a folded clause is dropped at `low`: v3, plan-objectives v16), and the teach role lists the
 *    visual forms first (the first listed case is the one taken, openai.md 2026-09-26). The hinge
 *    gate is its own sentence again, with the why/how case routed to sort or true-false rather
 *    than open (a check stays closed; practise is the open slot). Practice on new numbers is
 *    said against the teach slots ("no teach slot used"): ratio's practise reused the worked
 *    example's numbers twice in v7.
 *
 * v9 (30 Sept 2026, merge of the fix branch onto v8): the user turn is v8's (roles per slot) followed
 *    by the fix branch's re-fill block (`replacingBlock`: the slot replaced, its material, why, the
 *    form to write). System text is v8's unchanged; a cycle call without `replacing` renders
 *    exactly as v8. The figure slot's schema carries `figureBrief.values` (fix branch).
 *
 * v10 (30 Sept 2026, designer eval round 2: 16 decks judged blind against 8 baselines,
 *    `quality-prd/lab/fit-lab/rounds/r2`; designer 20.3/30 vs baseline 19.0, round 1 21.4):
 *  - Parts that outnumber the teach slots were dropped. "Each teach or show slot takes the next
 *    part" has no case for the commonest deck (3 objectives in 10 slides: one teach slot each),
 *    so a three-part objective taught its first part (plants-b: objective 3's slide said only
 *    "Seeds can grow without being planted by people"; rocks-a: one label sentence per rock) or
 *    crammed every part into one sentence (weimar-a slide 4, rivers-a slide 7). The rule now
 *    opens with the guarantee (every part reaches a slide) and gives the outnumbered case its
 *    own sentence: several parts in one slot, one sentence, step or point each ("each takes the
 *    next several": the first smoke's rocks deck put all three rock types in the first teach slot
 *    and the second restated them).
 *  - Notes were missing or empty on 9 of the 16 decks' check slides ("reveal the explanation",
 *    none given; ratio-a s9 with no 20; ratio-b s8 with no 16 pens) and absent on many teaching
 *    slides, so a judge teaching "as is" had no explanation and no key. Notes are optional in the
 *    schema (v4) and nothing asked for them per slot. One rule, own sentences: every slot has
 *    notes; teach notes explain each part aloud; check and practise notes open with the answer.
 *    `notes` is the second field, so the answer is written before the question it keys (the
 *    "say it first" pattern, openai.md 2026-09-30).
 *  - Keys that did not follow from the slides (ratio-b true-false "4:12 tells us the second
 *    quantity is 8 more", ambiguous as written; persuasive-a a distractor that did not answer its
 *    stem; ratio-b notes deriving 5 as "the difference between 10 and 5"). The check line now
 *    says a true-false statement is one whole claim, true or false as written, and a hinge option
 *    answers the stem; one new sentence ties every question's answer to a sentence, step or
 *    worked line a teach slot states, named in the notes. The two recurring knowledge errors
 *    (dilute bromide gives oxygen; the upper course is fast) are beliefs the model holds and are
 *    left to the knowledge packs (source policy), not to a prompt fact.
 *  - Callouts: 1 planned in 16 decks (round 1: 12). v8 made the hinge the misconception's first
 *    home and the visual forms the teach role's first case, and the code's visual minimum then
 *    re-fills a text teach slot into a diagram slot, so no slot was left for an explain-callout.
 *    The routing now opens with the one case the deck can place: a teach slot after the
 *    objective's visual is an explain-callout (2-objective and 1-objective decks have one);
 *    otherwise the true-false statement or a hinge option. A 2-slot cycle (visual + check) still
 *    has no room for a callout row: that needs the callout to ride on the visual slide, in code.
 *
 * Bump `version` whenever `system` or `user` changes wording.
 */

/** A slot's job in its objective's cycle (v6): assigned in code, chosen within by the model. */
export const SLOT_ROLES = ["teach", "show", "practise", "check"] as const;
export type SlotRole = (typeof SLOT_ROLES)[number];

export type DesignCycleInput = {
  topic: string;
  shape: LessonShape;
  audience: Audience;
  /** Every objective of the lesson with its arc, in order: the lesson's through-line. */
  objectives: readonly { text: string; arc?: ObjectiveArc | undefined }[];
  /** 0-based index of the objective this call designs. */
  objectiveIndex: number;
  /**
   * This objective's slots: how many, the 1-based slide number of the first, the deck's size,
   * and each slot's role (v6). `roles` left out means `slotRoles(count, arc.lean)`, so the
   * allocator can pass its own or leave the default.
   */
  slots: { count: number; first: number; slideCount: number; roles?: SlotRole[] | undefined };
  /** `paletteMenu(audience.subject)`. */
  palette: string;
  /**
   * A re-fill: the one slot being replaced, its material as written, why (fit rung 4: "it did not
   * fit its slide because the options are sentences; this form needs phrases"; a design minimum: "the
   * objective has no photo, figure or diagram"), and the form to write.
   */
  replacing?: { form: SlotForm; material: string; reason: string; into: SlotForm } | undefined;
  /**
   * This objective's facts (`DESIGNER_FACTS=1`): the objectives-first teach call's key ideas,
   * misconceptions, vocabulary and worked examples, Verify-corrected on a re-fill. Rendered as a
   * plain block after the slot list; left out, the user turn is unchanged.
   */
  facts?: DesignCycleFacts | undefined;
};

/** One objective's facts as the design cycle is handed them (`plan-teach-objective`'s lists). */
export type DesignCycleFacts = {
  keyIdeas: readonly {
    statement: string;
    explanation: string;
    example: string;
    analogy?: string | undefined;
  }[];
  misconceptions: readonly { belief: string; correction: string }[];
  vocabulary: readonly { term: string; definition: string }[];
  workedExamples: readonly { problem: string; steps: readonly string[]; answer: string }[];
};

/** The forms each role admits, as the system text lists them (v6); for code that enforces a role. */
export const ROLE_FORMS: Record<SlotRole, readonly SlotForm[]> = {
  teach: [
    "explain",
    "explain-callout",
    "list",
    "compare",
    "sequence",
    "photo",
    "figure",
    "diagram-slot",
    "worked-example",
  ],
  show: ["photo", "figure", "diagram-slot"],
  practise: ["open-response", "discussion"],
  check: ["hinge", "true-false", "matching", "fill-gap", "sort"],
};

const VISUAL_LEANS = new Set<ObjectiveArc["lean"]>(["photo", "figure", "diagram-slot"]);

/**
 * The roles of an objective's slots (v6), from their count and the arc's lean: the first teaches
 * (shows, where the arc leans to a photo, figure or diagram), the last checks, and the slots
 * between alternate teach and practise, practise first for a method (its worked example is the
 * teach slot, so pupils try one next). One slot only teaches: the exit line checks it.
 */
export function slotRoles(count: number, lean?: ObjectiveArc["lean"] | undefined): SlotRole[] {
  if (count <= 0) return [];
  const first: SlotRole = lean && VISUAL_LEANS.has(lean) ? "show" : "teach";
  if (count === 1) return [first];
  const method = lean === "worked-example";
  const middle: SlotRole[] = [];
  for (let i = 0; i < count - 2; i++) middle.push((i % 2 === 0) === method ? "practise" : "teach");
  return [first, ...middle, "check"];
}

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
/** The facts block of the user turn: the lists as plain labelled lines, nothing added. */
export function factsFeedBlock(f: DesignCycleFacts): string[] {
  const lines = ["", "Facts for this objective:"];
  f.keyIdeas.forEach((k, i) => {
    lines.push(`Key idea ${i + 1}: ${k.statement}`);
    lines.push(`  Explanation: ${k.explanation}`);
    lines.push(`  Example: ${k.example}`);
    if (k.analogy) lines.push(`  Analogy: ${k.analogy}`);
  });
  for (const m of f.misconceptions) {
    lines.push(`Misconception: ${m.belief}`);
    lines.push(`  Correction: ${m.correction}`);
  }
  for (const v of f.vocabulary) lines.push(`Vocabulary: ${v.term}: ${v.definition}`);
  for (const x of f.workedExamples) {
    lines.push(`Worked example: ${x.problem}`);
    x.steps.forEach((step, i) => {
      lines.push(`  Step ${i + 1}: ${step}`);
    });
    lines.push(`  Answer: ${x.answer}`);
  }
  return lines;
}

function replacingBlock(r: NonNullable<DesignCycleInput["replacing"]>): string[] {
  return [
    "",
    `This slot replaces ${/^[aeiou]/.test(r.form) ? "an" : "a"} ${r.form} slot: ${r.reason}.`,
    `Its material: ${r.material}`,
    `Write the same content as a ${r.into} slot.`,
  ];
}

export const designCyclePrompt = {
  version: "design-cycle.v10",
  system: [
    "You are an experienced UK teacher who designs lesson slides. You design the slides for one objective of a lesson, in the slots you are given, each with a role. For each slot you choose the palette form that shows its content best and fill it; nothing rewrites your words, so what you write is the slide.",
    "",
    houseRules("british", "names", "pitch"),
    "Roles: teach shows an idea in a teaching form (photo, figure, diagram-slot, explain, explain-callout, list, compare, sequence, or a worked example for a procedure); show teaches through a photo, figure or diagram slot; practise has pupils do it themselves on a new case (open-response, or discussion for a judgement); check is a quick closed check (hinge, true-false, matching, fill-gap or sort).",
    "Unless the objective is purely abstract (a rule, a number, a calculation), one of its teach or show slots is a photo, figure or diagram slot.",
    "The objective's Angle lists the parts this lesson teaches of it, and every part reaches a slide. The teach and show slots take the parts in order. Where the parts outnumber those slots, each takes the next several, one sentence, step or point per part, under a heading stating the idea they share; where a part has a second slot, that slot shows its example or structure in another form. Each practise or check slot tests a taught part with numbers or an example no teach slot used.",
    'Each slot is one slide with one idea. Its heading is one line stating that idea as a claim ("Plants make their own food"), not a label; a worked example\'s heading is the label of its method ("Finding a missing angle"), not an instruction. The slide carries what pupils need for the checks: the claim with its reason, and the example, quotation or numbers it rests on; what you say around it (the fuller explanation, analogies, questions to ask, answers) goes in notes.',
    "Every slot has notes. On a teach or show slot they are what you say aloud: each of its parts explained in full, with the question you ask about it. On a practise or check slot they open with the answer and why it is right, then what to do with the answers pupils give.",
    "Choose a teach slot's form by what the content is: anything a camera could show (a living thing, an object, a place, a scene) is a photo; a structure, process or layout is a figure or a diagram slot; a procedure pupils will carry out (a calculation, a prediction from a rule, a technique applied to a text) is a worked example taken to its finished answer; a definition or an argument is text (explain, list, compare, sequence). Neighbouring slots use different forms.",
    "Choose a check by what the part is: the order of a process or chain of events is a sort; terms and meanings are a matching; a key term in a sentence that uses it is a fill-gap; a claim pupils get wrong is a true-false, one whole claim, true or false as written. A hinge asks for a thing pupils name (a product, a value, a term, the next step), so each option is a phrase answering the stem and each wrong one a mistake pupils make; a why or a how is checked by a sort or a true-false.",
    "A question's answer is on a slide of this objective: it follows from a sentence, step or worked line a teach slot states, and the notes say which.",
    'Fill each form with exactly the units its Holds line gives, its count of sentences included. Options, points, pair sides and labels are phrases, not sentences: "Heavier than water", not "The stone is heavier than the water it pushes aside." A question or a step is one sentence.',
    "A subject specialist checks every slide before the lesson is taught: give each date, number, name and rule as this year group's specification states it.",
    'The objective\'s misconception reaches a slide. A teach slot that follows the objective\'s photo, figure or diagram slot is an explain-callout, its callout the misconception stated as wrong with "not" ("Evaporation is not the same as boiling."); with no such slot, it is the true-false check\'s statement or a wrong option in the hinge.',
    "A photo's imageBrief names a subject stock photography has and what the photo must show: no names of people and no local places. A figure's figureBrief gives its template and what it shows. A diagram slot's diagram says what to draw and what to label.",
    "exitQuestion: one question that checks this objective, answered in a line from what its slides state, with its answer.",
  ].join("\n"),
  user(input: DesignCycleInput): string {
    const [shapeLine] = shapeBlock(input.shape);
    const { count, first, slideCount } = input.slots;
    const last = first + count - 1;
    const where = count === 1 ? `slide ${first}` : `slides ${first} to ${last}`;
    const roles =
      input.slots.roles ?? slotRoles(count, input.objectives[input.objectiveIndex]?.arc?.lean);
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
      ...roles.map((role, k) => `  slide ${first + k}: ${role}`),
      ...(input.facts ? factsFeedBlock(input.facts) : []),
      ...(input.replacing ? replacingBlock(input.replacing) : []),
    ].join("\n");
  },
} as const;
