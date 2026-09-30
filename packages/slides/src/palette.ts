import type { FigureTemplateName, SlideKind } from "@tj/domain/documents";
import type { ContentVariant } from "./layouts";
import { vocabularySlots } from "./materialise";
import { sentences } from "./sentences";
import type { SlideSpec } from "./specs";
import type { SlideStructure } from "./structure";
import { THEMES } from "./themes";

/*
 * The lesson designer's palette (plan "teacher-designer", PR 5): every form a slot can take, what
 * it is for, what it holds and how it renders. The design-cycle prompt is given `paletteMenu()`;
 * the slot schema and the fallback order read the same records, so the menu the model chooses
 * from and the forms code renders are one list.
 *
 * What a form holds is counted in structural units (a heading, sentences, items, steps, pairs),
 * never in words or characters. `palette.test.ts` is the drift test: every slide form filled to its
 * maximum with realistic long text fits at body size, with no step-down, on all 10 themes. A form
 * whose maximum stops fitting has its units lowered there, so the menu never promises more than a
 * slide can show.
 */

/** Every form in the palette. */
export const PALETTE_FORM_IDS = [
  "explain",
  "explain-callout",
  "list",
  "compare",
  "sequence",
  "photo",
  "figure",
  "diagram-slot",
  "worked-example",
  "hinge",
  "true-false",
  "matching",
  "fill-gap",
  "sort",
  "open-response",
  "discussion",
  "vocabulary",
  "notes",
  "worksheet",
] as const;
export type PaletteFormId = (typeof PALETTE_FORM_IDS)[number];

/** A structural unit a form holds: `max` undefined means as many as the teaching needs. */
export type PaletteUnit = {
  /** What is counted, singular: "sentence", "point", "step", "pair". */
  unit: string;
  /** The plural for the menu, when adding "s" to `unit` reads wrong. */
  plural?: string;
  /** The slot the unit fills, as the slot schema names it. */
  slot: string;
  min: number;
  max?: number;
};

/** Where a form lands: a slide recipe, or off the slide. */
export type PaletteRenderer =
  | {
      on: "slide";
      kind: SlideKind;
      /** The recipe variant `materialiseSlide` is called with; the kind's default when absent. */
      variant?: ContentVariant | string;
      /** The structure hint the form is materialised with (a photo slot). */
      structure?: keyof SlideStructure;
      /** The named element that shows the form was placed, not fallen back from. */
      placed?: string;
    }
  | { on: "notes" }
  | { on: "worksheet" };

/** Subjects a form or figure template is offered for; absent means every subject. */
export type PaletteSubject = "maths" | "chemistry";

export type PaletteForm = {
  id: PaletteFormId;
  /** A short name for the menu. */
  name: string;
  /** When to choose it, one plain line. */
  useWhen: string;
  /** What it holds, in structural units. */
  holds: readonly PaletteUnit[];
  renderer: PaletteRenderer;
  /** One filled example: a slide spec for a slide form, the text itself for an off-slide one. */
  example: SlideSpec | string;
  /** The subjects it is offered for; every subject when absent. */
  subjects?: readonly PaletteSubject[];
};

/**
 * The figure templates and the subjects each serves (ADR 0032; `FIGURE_FIT` in
 * `@tj/generation` prompts/figures.ts says when each fits).
 */
export const FIGURE_SUBJECTS: Record<FigureTemplateName, readonly PaletteSubject[]> = {
  "right-triangle": ["maths"],
  triangle: ["maths"],
  "energy-profile": ["chemistry"],
};

/**
 * The fewest term slots any theme's vocabulary grid lays (`vocabularySlots`): the recipe drops
 * entries past its slots, so the palette promises the smallest.
 */
export const VOCABULARY_ENTRIES = Math.min(...THEMES.map((t) => vocabularySlots(t.id)));

// "on one line" is the heading's unit on every form (design-cycle v14): a heading that runs to a
// second line was the fit ladder's commonest re-fill reason in the r6 smokes.
const heading: PaletteUnit = { unit: "heading on one line", slot: "heading", min: 1, max: 1 };

export const PALETTE: readonly PaletteForm[] = [
  {
    id: "explain",
    name: "explain",
    useWhen: "one claim or definition, said plainly",
    holds: [heading, { unit: "sentence", slot: "body", min: 1, max: 2 }],
    renderer: { on: "slide", kind: "content", variant: "headed" },
    example: {
      kind: "content",
      factRefs: [],
      heading: "Plants make their own food",
      body: "A plant uses light, water and carbon dioxide to make sugar in its leaves. This process is called photosynthesis.",
    },
  },
  {
    id: "explain-callout",
    name: "explain + callout row",
    useWhen: "a claim pupils commonly get wrong, with the mistake named beside it",
    holds: [
      heading,
      { unit: "sentence", slot: "body", min: 1, max: 1 },
      { unit: "callout", slot: "callout", min: 1, max: 1 },
      {
        unit: "sentence in the callout",
        plural: "sentences in the callout",
        slot: "callout.text",
        min: 1,
        max: 2,
      },
    ],
    renderer: { on: "slide", kind: "content", variant: "callout-row", placed: "Callout card" },
    example: {
      kind: "content",
      factRefs: [],
      heading: "Plants make their own food",
      body: "A plant uses light, water and carbon dioxide to make sugar in its leaves.",
      callout: {
        kind: "watch-out",
        text: "Plants do not take food in from the soil. The roots take in water and minerals; the food is made in the leaves.",
      },
    },
  },
  {
    id: "list",
    name: "list",
    useWhen: "a set of parallel things: parts, types, causes or factors",
    holds: [
      heading,
      { unit: "sentence", slot: "body", min: 1, max: 1 },
      { unit: "point", slot: "points", min: 2, max: 2 },
    ],
    renderer: { on: "slide", kind: "content", variant: "headed" },
    example: {
      kind: "content",
      factRefs: [],
      heading: "Roots and leaves do different jobs",
      body: "Each part of a plant has its own job.",
      points: [
        "Roots: hold the plant in the ground and take in water.",
        "Leaves: make food using light.",
      ],
    },
  },
  {
    id: "compare",
    name: "compare",
    useWhen: "two things set side by side to show how they differ",
    holds: [
      heading,
      { unit: "sentence", slot: "body", min: 1, max: 1 },
      { unit: "side", slot: "compare", min: 2, max: 2 },
      {
        unit: "phrase per side",
        plural: "phrases per side",
        slot: "compare.*.points",
        min: 2,
        max: 2,
      },
    ],
    renderer: { on: "slide", kind: "content", variant: "headed", placed: "Compare card" },
    example: {
      kind: "content",
      factRefs: [],
      heading: "Weather and climate are different",
      body: "Both describe the air around us, over very different times.",
      compare: {
        left: {
          label: "Weather",
          points: ["The conditions this week", "Changes from day to day"],
        },
        right: {
          label: "Climate",
          points: ["The usual pattern over 30 years", "Changes slowly, over decades"],
        },
      },
    },
  },
  {
    id: "sequence",
    name: "sequence",
    useWhen: "a process or method whose order matters",
    holds: [
      heading,
      { unit: "sentence", slot: "body", min: 1, max: 1 },
      { unit: "step", slot: "steps", min: 2, max: 3 },
    ],
    renderer: { on: "slide", kind: "content", variant: "headed", placed: "Step card" },
    example: {
      kind: "content",
      factRefs: [],
      heading: "Water moves round in a cycle",
      body: "The same water is used again and again.",
      steps: [
        "The sun heats water in seas and it evaporates.",
        "The vapour cools and condenses into clouds.",
        "The water falls back to the ground as rain.",
      ],
    },
  },
  {
    id: "photo",
    name: "photo + caption",
    useWhen: "a real, concrete thing pupils may never have seen",
    holds: [
      heading,
      { unit: "sentence", slot: "body", min: 1, max: 2 },
      { unit: "photo brief", slot: "structure.photo", min: 1, max: 1 },
    ],
    renderer: {
      on: "slide",
      kind: "content",
      variant: "headed",
      structure: "photo",
      placed: "Photo slot",
    },
    example: {
      kind: "content",
      factRefs: [],
      heading: "Root hairs take in water",
      body: "Look at the fine hairs along each root. They give the root a huge surface to soak up water.",
    },
  },
  {
    id: "figure",
    name: "figure",
    useWhen: "a maths or chemistry structure one of the figure templates draws",
    holds: [
      heading,
      { unit: "template", slot: "figure", min: 1, max: 1 },
      { unit: "sentence", slot: "body", min: 1, max: 2 },
    ],
    renderer: { on: "slide", kind: "diagram" },
    subjects: ["maths", "chemistry"],
    example: {
      kind: "diagram",
      factRefs: [],
      heading: "Find the missing side",
      body: "Use Pythagoras' theorem to find the length of the hypotenuse x.",
      figure: {
        template: "right-triangle",
        values: {
          base: { length: 6, label: "6 cm" },
          height: { length: 8, label: "8 cm" },
          hypotenuse: { label: "x" },
        },
      },
    },
  },
  {
    id: "diagram-slot",
    name: "diagram slot",
    useWhen: "a structure worth drawing that no figure template covers",
    holds: [
      heading,
      { unit: "sentence", slot: "body", min: 1, max: 2 },
      { unit: "labelled instruction", slot: "diagram", min: 1, max: 1 },
    ],
    renderer: { on: "slide", kind: "content", variant: "headed", placed: "Diagram placeholder" },
    example: {
      kind: "content",
      factRefs: [],
      heading: "A flower has male and female parts",
      body: "The stamen makes pollen. The carpel holds the ovules that become seeds.",
      diagram: "A flower cut in half, labelled petal, stamen, anther, carpel, stigma and ovary.",
    },
  },
  {
    id: "worked-example",
    name: "worked example",
    useWhen: "a procedure shown once, step by step, before pupils try it",
    holds: [
      heading,
      // Counted in sentences (`unitsOf`): the question box is two lines over the working (r6 smoke,
      // y9-weimar: a three-sentence question pushed the working off the slide on every theme). The
      // unit names the sentence and the kind of line, never a length (r6 fix smoke: a one-sentence
      // question over calculation or phrase lines fits every theme; sentence-long lines do not).
      { unit: "question in one sentence", slot: "question", min: 1, max: 1 },
      {
        unit: "line of working",
        plural: "lines of working, each one calculation or one phrase, the last giving the answer",
        slot: "steps",
        min: 1,
        max: 3,
      },
    ],
    renderer: { on: "slide", kind: "worked-example" },
    example: {
      kind: "worked-example",
      factRefs: [],
      heading: "Sharing in a ratio",
      question: "Share £30 in the ratio 2 : 3.",
      steps: ["2 + 3 = 5 parts", "£30 ÷ 5 = £6 per part", "2 × £6 = £12 and 3 × £6 = £18"],
    },
  },
  {
    id: "hinge",
    name: "hinge multiple choice",
    useWhen: "a quick check where each wrong option reveals a known misconception",
    holds: [
      { unit: "question", slot: "stem", min: 1, max: 1 },
      { unit: "option", slot: "options", min: 4, max: 4 },
      { unit: "sentence of explanation, shown after", slot: "explanation", min: 1, max: 1 },
    ],
    renderer: { on: "slide", kind: "multiple-choice" },
    example: {
      kind: "multiple-choice",
      factRefs: [],
      stem: "Where does a plant make its food?",
      options: [
        { text: "In its leaves", correct: true },
        { text: "In the soil", correct: false },
        { text: "In its roots", correct: false },
        { text: "In its flowers", correct: false },
      ],
      explanation: "Leaves hold the chlorophyll that captures light to make sugar.",
    },
  },
  {
    id: "true-false",
    name: "true or false",
    useWhen: "confronting one misconception head on",
    holds: [
      { unit: "statement", slot: "statement", min: 1, max: 1 },
      { unit: "sentence of explanation, shown after", slot: "explanation", min: 1, max: 1 },
    ],
    renderer: { on: "slide", kind: "true-false" },
    example: {
      kind: "true-false",
      factRefs: [],
      statement: "Plants get their food from the soil.",
      correct: false,
      explanation: "Plants make their own food in their leaves; the soil gives water and minerals.",
    },
  },
  {
    id: "matching",
    name: "matching",
    useWhen: "checking that pupils can link terms to their meanings",
    holds: [
      { unit: "instruction", slot: "stem", min: 1, max: 1 },
      {
        unit: "pair",
        plural: "pairs, each a term and a short phrase",
        slot: "pairs",
        min: 3,
        max: 3,
      },
    ],
    renderer: { on: "slide", kind: "matching" },
    example: {
      kind: "matching",
      factRefs: [],
      stem: "Match each part to its job.",
      pairs: [
        { left: "Root", right: "Takes in water" },
        { left: "Stem", right: "Carries water up" },
        { left: "Leaf", right: "Makes food" },
      ],
    },
  },
  {
    id: "fill-gap",
    name: "fill the gap",
    useWhen: "recalling a key term inside a sentence that uses it",
    holds: [
      { unit: "instruction", slot: "stem", min: 1, max: 1 },
      { unit: "sentence", slot: "sentence", min: 1, max: 1 },
      { unit: "gap", slot: "answers", min: 1, max: 2 },
    ],
    renderer: { on: "slide", kind: "fill-gap" },
    example: {
      kind: "fill-gap",
      factRefs: [],
      stem: "Fill in the gaps.",
      sentence: "Plants make food by ___ using energy from ___.",
      answers: ["photosynthesis", "light"],
    },
  },
  {
    id: "sort",
    name: "sort into order",
    useWhen: "checking that pupils know the order of a genuine sequence",
    holds: [
      { unit: "instruction", slot: "stem", min: 1, max: 1 },
      {
        unit: "step",
        plural: "steps, each a short label",
        slot: "steps",
        min: 4,
        max: 4,
      },
    ],
    renderer: { on: "slide", kind: "sort" },
    example: {
      kind: "sort",
      factRefs: [],
      stem: "Put the stages of the water cycle in order.",
      steps: ["Evaporation", "Condensation", "Precipitation", "Collection"],
    },
  },
  {
    id: "open-response",
    name: "open response",
    useWhen: "a question pupils answer in their own sentences",
    holds: [
      { unit: "question", slot: "stem", min: 1, max: 1 },
      {
        unit: "sentence of model answer",
        plural: "sentences of model answer",
        slot: "modelAnswer",
        min: 1,
        max: 2,
      },
    ],
    renderer: { on: "slide", kind: "open-response" },
    example: {
      kind: "open-response",
      factRefs: [],
      stem: "Why does a plant kept in a dark cupboard die?",
      modelAnswer: "Without light it cannot photosynthesise, so it cannot make the food it needs.",
    },
  },
  {
    id: "discussion",
    name: "discussion",
    useWhen: "an evaluative question with more than one defensible answer",
    holds: [
      { unit: "question", slot: "prompt", min: 1, max: 1 },
      {
        unit: "sentence starter",
        plural: "sentence starters, on one line",
        slot: "footnote",
        min: 0,
        max: 2,
      },
    ],
    renderer: { on: "slide", kind: "discussion" },
    example: {
      kind: "discussion",
      factRefs: [],
      prompt: "Should towns plant more trees, even if it costs money?",
      footnote: "I think… because… / I disagree with… because…",
    },
  },
  {
    id: "vocabulary",
    name: "vocabulary",
    useWhen: "introducing the key terms a lesson depends on",
    holds: [
      { unit: "term", slot: "entries", min: 2, max: VOCABULARY_ENTRIES },
      {
        unit: "sentence per term",
        plural: "sentences per term",
        slot: "entries.*.definition",
        min: 1,
        max: 1,
      },
    ],
    renderer: { on: "slide", kind: "vocabulary" },
    example: {
      kind: "vocabulary",
      factRefs: [],
      entries: [
        { term: "photosynthesis", definition: "How a plant makes sugar using light." },
        { term: "chlorophyll", definition: "The green substance that captures light." },
      ],
    },
  },
  {
    id: "notes",
    name: "teacher notes",
    useWhen: "what you say aloud: the explanation in full, analogies, answers and timings",
    holds: [{ unit: "paragraph", slot: "notes", min: 1 }],
    renderer: { on: "notes" },
    example:
      "Ask who has grown a plant on a windowsill. Point out that it leans towards the light: the leaves are where it makes its food. Answer: in the leaves.",
  },
  {
    id: "worksheet",
    name: "worksheet",
    useWhen: "longer practice, sources or extended writing that would crowd a slide",
    holds: [{ unit: "section", slot: "worksheet", min: 1 }],
    renderer: { on: "worksheet" },
    example:
      "A source extract with three questions on it, from recall to explanation, answered in full sentences.",
  },
];

/** The palette record for a form id. */
export function paletteForm(id: PaletteFormId): PaletteForm {
  const form = PALETTE.find((f) => f.id === id);
  if (!form) throw new Error(`no palette form ${id}`);
  return form;
}

/**
 * The subject a free-text subject name belongs to, for gating: "Mathematics", "Maths" and "Math"
 * are maths; "Chemistry" and a combined or triple "Science" are chemistry (the energy profile is
 * taught in both). Anything else gates nothing in.
 */
export function paletteSubjects(subject: string | undefined): PaletteSubject[] {
  const s = (subject ?? "").toLowerCase();
  const out: PaletteSubject[] = [];
  if (/\bmath/.test(s)) out.push("maths");
  if (/chemi|science/.test(s)) out.push("chemistry");
  return out;
}

/** The figure templates offered for a subject; every template when no subject is given. */
export function figureTemplatesFor(subject?: string): FigureTemplateName[] {
  const names = Object.keys(FIGURE_SUBJECTS) as FigureTemplateName[];
  if (subject === undefined) return names;
  const subjects = paletteSubjects(subject);
  return names.filter((name) => FIGURE_SUBJECTS[name].some((s) => subjects.includes(s)));
}

/**
 * The forms offered for a subject: a gated form only where the subject has one (the figure only
 * where a template exists for it). With no subject, the whole palette.
 */
export function paletteFor(subject?: string): PaletteForm[] {
  if (subject === undefined) return [...PALETTE];
  const subjects = paletteSubjects(subject);
  return PALETTE.filter((form) => {
    if (form.id === "figure") return figureTemplatesFor(subject).length > 0;
    return !form.subjects || form.subjects.some((s) => subjects.includes(s));
  });
}

/** "1", "1–2", "3", "2 or more". */
function range(unit: PaletteUnit): string {
  if (unit.max === undefined) return `${unit.min} or more`;
  return unit.min === unit.max ? `${unit.max}` : `${unit.min}–${unit.max}`;
}

const plural = (unit: PaletteUnit): string =>
  unit.max === 1 && unit.min === 1 ? unit.unit : (unit.plural ?? `${unit.unit}s`);

/** What a form holds as one plain line: "a heading, 1–2 sentences". */
export function holdsLine(form: PaletteForm): string {
  return form.holds
    .map((unit) =>
      unit.min === 0 ? `up to ${unit.max} ${plural(unit)}` : `${range(unit)} ${plural(unit)}`,
    )
    .join(", ");
}

/** A filled example as plain lines, field by field. */
function exampleLines(example: SlideSpec | string): string[] {
  if (typeof example === "string") return [`    ${example}`];
  const { kind: _kind, factRefs: _refs, notes: _notes, ...fields } = example;
  return Object.entries(fields).map(([key, value]) => `    ${key}: ${JSON.stringify(value)}`);
}

/**
 * The palette as plain text for the design-cycle prompt: per form its id, when to use it, what
 * it holds in units, and one filled example. Gated by `subject` (see `paletteFor`). No word or
 * character counts appear anywhere in it; the drift test holds the units to what fits.
 */
export function paletteMenu(subject?: string): string {
  const templates = figureTemplatesFor(subject);
  return paletteFor(subject)
    .map((form) => {
      const lines = [
        `${form.id} (${form.name})${form.renderer.on === "slide" ? "" : `, off the slide`}`,
        `  Use when: ${form.useWhen}.`,
        `  Holds: ${holdsLine(form)}.`,
      ];
      if (form.id === "figure") lines.push(`  Templates: ${templates.join(", ")}.`);
      lines.push("  Example:", ...exampleLines(form.example));
      return lines.join("\n");
    })
    .join("\n\n");
}

/* ------------------------------------------------------------------ units */

const countSentences = (text: string | undefined): number => (text ? sentences(text).length : 0);

/**
 * The units a filled slide spec carries, keyed by the `slot` names in the form's `holds`, so a
 * slot schema or a test checks a fill against the form. Off-slide forms carry none.
 */
export function unitsOf(form: PaletteForm, spec: SlideSpec): Record<string, number> {
  const out: Record<string, number> = {};
  for (const unit of form.holds) out[unit.slot] = 0;
  const s = spec as Record<string, unknown> & SlideSpec;
  const set = (slot: string, n: number) => {
    if (slot in out) out[slot] = n;
  };
  if ("heading" in s && s.heading) set("heading", 1);
  if ("body" in s) set("body", countSentences(s.body as string));
  if ("question" in s) set("question", countSentences(s.question as string));
  if ("stem" in s) set("stem", s.stem ? 1 : 0);
  if ("prompt" in s) set("prompt", s.prompt ? 1 : 0);
  if ("statement" in s) set("statement", s.statement ? 1 : 0);
  if ("sentence" in s) set("sentence", countSentences(s.sentence as string));
  if ("explanation" in s) set("explanation", countSentences(s.explanation as string));
  if ("modelAnswer" in s) set("modelAnswer", countSentences(s.modelAnswer as string));
  if ("footnote" in s && typeof s.footnote === "string")
    set("footnote", s.footnote.split(" / ").length);
  if ("diagram" in s && s.diagram) set("diagram", 1);
  if ("figure" in s && s.figure) set("figure", 1);
  if ("points" in s && Array.isArray(s.points)) set("points", s.points.length);
  if ("steps" in s && Array.isArray(s.steps)) set("steps", s.steps.length);
  if ("options" in s && Array.isArray(s.options)) set("options", s.options.length);
  if ("pairs" in s && Array.isArray(s.pairs)) set("pairs", s.pairs.length);
  if ("answers" in s && Array.isArray(s.answers)) set("answers", s.answers.length);
  if (s.kind === "content" && s.callout) {
    set("callout", 1);
    set("callout.text", countSentences(s.callout.text));
  }
  if (s.kind === "content" && s.compare) {
    set("compare", 2);
    set("compare.*.points", Math.max(s.compare.left.points.length, s.compare.right.points.length));
  }
  if (s.kind === "vocabulary") {
    set("entries", s.entries.length);
    set("entries.*.definition", Math.max(...s.entries.map((e) => countSentences(e.definition))));
  }
  return out;
}
