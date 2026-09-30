import { z } from "zod";
import { PALETTE_FORM_IDS, type PaletteFormId, VOCABULARY_ENTRIES } from "./palette";
import type { SlideSpec } from "./specs";
import type { SlideStructure } from "./structure";

/*
 * Slot contracts (spike/slot-contracts): for every palette form, the slots a writer fills and the
 * shape of each, so the planner picks a layout and the writer writes to it. Nothing is cut or
 * squeezed in afterwards: the shape is known before a word is written (Chalkie's model: fixed
 * type, known component capacity, no shrinking).
 *
 * A slot is counted in structural units only: lines, sentences or items, and each item is a kind
 * of text (a label, a phrase, one sentence, one calculation). Never words or characters.
 *
 * The counts are measured, not guessed. `slot-contracts.measure.ts` fills each slot with the
 * longest plausible text of its kind (`WORST`) and finds the most of it that fits at body size
 * (stepDown 0) on all 10 themes through `fitsPlanned`; `slot-contracts.test.ts` is the drift test
 * that holds every contract to that, so no contract promises more than the slide shows.
 */

/** The kinds of text a slot's items are, with the plain words the writer reads. */
export const TEXT_KINDS = {
  heading: 'one line: one short main clause about one thing, with no "and", "but", "when" or list',
  sentence: "one sentence of one or two clauses, at most two lines",
  clause: "one sentence of a single clause, at most two lines",
  question: "one question, at most two lines",
  "short-question": "one question on one line",
  instruction: "one short instruction to pupils, at most two lines",
  "short-instruction": "one short instruction to pupils, on one line",
  phrase: "a phrase on one line, not a full sentence",
  option: "a short phrase, at most three short lines on its half-width card",
  outline:
    'one line across the slide: the idea, or the parts of an outline each named by a single term, like "Claim, reasons, rebuttal, request"',
  label: "a short label, half a line, not a sentence",
  term: "a term or a short name, half a line, as written on a card",
  card: 'a short phrase on one line across the slide: one clause, with no "and"',
  answer: "a single term or number",
  working: "one calculation or one short phrase, on one line",
  "labelled-sentence": "a short label, a colon, then one sentence, at most two lines in all",
  "gapped-sentence": "one sentence with each gap written as ___, at most two lines",
  starter: 'an unfinished sentence starter, just its opening, ending in … ("I think… because…")',
  brief: "a description for whoever draws or finds it",
  paragraph: "a paragraph",
} as const;
export type TextKind = keyof typeof TEXT_KINDS;

/** What a slot counts. */
export type SlotUnit = "line" | "sentence" | "item";

/** A list inside an item (a compare side's points). */
export type SubList = { unit: SlotUnit; min: number; max: number; each: TextKind };

/** One field of an item: a kind of text, a list, or the right-answer flag. */
export type ItemField = TextKind | SubList | "flag";

/** Where a slot's text ends up. */
export type SlotPlace = "slide" | "reveal" | "answer" | "notes" | "off-slide";

export type Slot = {
  /** The writer's field, named as the slide spec names it. */
  field: string;
  unit: SlotUnit;
  min: number;
  /** Undefined: as many as the teaching needs (off-slide text only). */
  max?: number;
  /** What each unit is: one kind of text, or an item with named fields. */
  each: TextKind | Record<string, ItemField>;
  /** Set by the recipe, so never re-measured: four options, three pairs. */
  fixed?: boolean;
  place: SlotPlace;
  /** A structural rule the count alone does not say ("the last gives the answer"). */
  rule?: string;
};

export type SlotContract = {
  form: PaletteFormId;
  /** The layout the contract is for: `default`, or a named alternative the planner may choose. */
  layout: string;
  /** When the planner picks this layout over the form's others. */
  when?: string;
  slots: readonly Slot[];
};

const heading: Slot = {
  field: "heading",
  unit: "line",
  min: 1,
  max: 1,
  fixed: true,
  each: "heading",
  place: "slide",
};
const lead: Slot = {
  field: "body",
  unit: "sentence",
  min: 1,
  max: 1,
  each: "clause",
  place: "slide",
};
const body = (max: number): Slot => ({
  field: "body",
  unit: "sentence",
  min: 1,
  max,
  each: "sentence",
  place: "slide",
});
/** A slot of exactly one unit, set by the form (one question, one statement): never re-measured. */
const one = (field: string, each: TextKind, place: SlotPlace = "slide"): Slot => ({
  field,
  unit: each === "sentence" ? "sentence" : "line",
  min: 1,
  max: 1,
  fixed: true,
  each,
  place,
});

/**
 * Every form's contract. The maxima are the measured capacities (`slot-contracts.measure.ts`);
 * the drift test fails when one promises more than fits, or when a font or layout change lets a
 * slot hold one more than it says.
 */
export const SLOT_CONTRACTS: readonly SlotContract[] = [
  { form: "explain", layout: "default", slots: [heading, body(3)] },
  {
    form: "explain-callout",
    layout: "default",
    slots: [
      heading,
      body(2),
      { field: "callout", unit: "sentence", min: 1, max: 1, each: "sentence", place: "slide" },
    ],
  },
  {
    form: "list",
    layout: "default",
    slots: [
      heading,
      // Measured: a list's lead holds two one-clause sentences over its two points.
      { ...lead, max: 2 },
      { field: "points", unit: "item", min: 2, max: 2, each: "labelled-sentence", place: "slide" },
    ],
  },
  {
    form: "compare",
    layout: "default",
    slots: [
      heading,
      lead,
      {
        field: "compare",
        unit: "item",
        min: 2,
        max: 2,
        fixed: true,
        each: { label: "label", points: { unit: "item", min: 2, max: 2, each: "phrase" } },
        place: "slide",
        rule: "two sides, left then right",
      },
    ],
  },
  {
    form: "sequence",
    layout: "default",
    slots: [
      heading,
      lead,
      {
        field: "steps",
        unit: "item",
        min: 2,
        max: 4,
        each: "phrase",
        place: "slide",
        rule: "in order",
      },
    ],
  },
  {
    form: "photo",
    layout: "default",
    slots: [
      heading,
      body(2),
      {
        field: "imageBrief",
        unit: "item",
        min: 1,
        max: 1,
        each: { subject: "brief", mustShow: { unit: "item", min: 0, max: 4, each: "label" } },
        place: "off-slide",
      },
    ],
  },
  {
    form: "figure",
    layout: "default",
    slots: [heading, body(2), one("figure", "brief", "off-slide")],
  },
  {
    form: "diagram-slot",
    layout: "default",
    slots: [heading, body(2), one("diagram", "brief")],
  },
  {
    form: "worked-example",
    layout: "default",
    slots: [
      heading,
      one("question", "question"),
      {
        field: "steps",
        unit: "line",
        // One line of working is not a procedure shown step by step, and the recipe has no strip
        // for it: the working card it keeps sets the question a stop down on three themes.
        min: 2,
        max: 4,
        each: "working",
        place: "slide",
        rule: "the last line gives the answer",
      },
    ],
  },
  {
    form: "hinge",
    layout: "default",
    when: "options are phrases; the reason why goes to the notes",
    slots: [
      one("stem", "question"),
      {
        field: "options",
        unit: "item",
        min: 4,
        max: 4,
        fixed: true,
        each: { text: "option", correct: "flag" },
        place: "slide",
        rule: "one correct; each wrong one a mistake pupils make, written like the correct one",
      },
      one("explanation", "sentence", "notes"),
    ],
  },
  {
    form: "hinge",
    layout: "stacked",
    when: "options are ideas, methods or outlines, not single terms; each option runs across the slide",
    slots: [
      one("stem", "short-question"),
      {
        field: "options",
        unit: "item",
        min: 4,
        max: 4,
        fixed: true,
        each: { text: "outline", correct: "flag" },
        place: "slide",
        rule: "one correct; each wrong one a mistake pupils make, written like the correct one",
      },
      one("explanation", "sentence", "notes"),
    ],
  },
  {
    form: "hinge",
    layout: "why",
    when: "every option is a single term or number; the reason shows on the slide after the reveal",
    slots: [
      one("stem", "question"),
      {
        field: "options",
        unit: "item",
        min: 4,
        max: 4,
        fixed: true,
        each: { text: "answer", correct: "flag" },
        place: "slide",
        rule: "one correct; each wrong one a mistake pupils make, written like the correct one",
      },
      { field: "explanation", unit: "line", min: 1, max: 1, each: "phrase", place: "reveal" },
    ],
  },
  {
    form: "true-false",
    layout: "default",
    slots: [
      one("statement", "clause"),
      {
        field: "correct",
        unit: "item",
        min: 1,
        max: 1,
        fixed: true,
        each: { correct: "flag" },
        place: "slide",
      },
      { field: "explanation", unit: "sentence", min: 1, max: 1, each: "sentence", place: "reveal" },
    ],
  },
  {
    form: "matching",
    layout: "default",
    slots: [
      one("stem", "instruction"),
      {
        field: "pairs",
        unit: "item",
        min: 3,
        max: 3,
        fixed: true,
        each: { left: "label", right: "label" },
        place: "slide",
        rule: "each pair a right match; the slide shuffles the right-hand side",
      },
    ],
  },
  {
    form: "fill-gap",
    layout: "default",
    slots: [
      one("stem", "instruction"),
      one("sentence", "gapped-sentence"),
      {
        field: "answers",
        unit: "item",
        min: 1,
        max: 2,
        fixed: true,
        each: "answer",
        place: "reveal",
        rule: "one per gap, in order",
      },
    ],
  },
  {
    form: "sort",
    layout: "default",
    slots: [
      one("stem", "short-instruction"),
      {
        field: "steps",
        unit: "item",
        min: 4,
        max: 4,
        fixed: true,
        each: "card",
        place: "slide",
        rule: "in the right order; the slide shuffles them",
      },
    ],
  },
  {
    form: "open-response",
    layout: "default",
    slots: [
      one("stem", "question"),
      {
        field: "modelAnswer",
        unit: "sentence",
        min: 1,
        max: 2,
        fixed: true,
        each: "sentence",
        place: "answer",
      },
    ],
  },
  {
    form: "discussion",
    layout: "default",
    slots: [
      one("prompt", "question"),
      { field: "footnote", unit: "item", min: 0, max: 2, each: "starter", place: "slide" },
    ],
  },
  {
    form: "vocabulary",
    layout: "default",
    slots: [
      {
        field: "entries",
        unit: "item",
        min: 2,
        max: VOCABULARY_ENTRIES,
        each: { term: "label", definition: "phrase" },
        place: "slide",
      },
    ],
  },
  {
    form: "notes",
    layout: "default",
    slots: [{ field: "notes", unit: "item", min: 1, each: "paragraph", place: "notes" }],
  },
  {
    form: "worksheet",
    layout: "default",
    slots: [{ field: "worksheet", unit: "item", min: 1, each: "paragraph", place: "off-slide" }],
  },
];

/** A form's contract: its `default` layout unless another is named. */
export function slotContract(form: PaletteFormId, layout = "default"): SlotContract {
  const found = SLOT_CONTRACTS.find((c) => c.form === form && c.layout === layout);
  if (!found) throw new Error(`no slot contract for ${form} (${layout})`);
  return found;
}

/** The layouts a form offers the planner, default first. */
export const layoutsOf = (form: PaletteFormId): SlotContract[] =>
  SLOT_CONTRACTS.filter((c) => c.form === form);

/* ------------------------------------------------------------------ writer schema */

const text = () => z.string().trim().min(1);

function kindSchema(kind: TextKind) {
  return text().describe(TEXT_KINDS[kind]);
}

function counted<T extends z.ZodTypeAny>(item: T, min: number, max: number | undefined) {
  const list = z.array(item).min(min);
  return max === undefined ? list : list.max(max);
}

function fieldSchema(f: ItemField): z.ZodTypeAny {
  if (f === "flag") return z.boolean().describe("true for the right answer");
  if (typeof f === "string") return kindSchema(f);
  return counted(kindSchema(f.each), f.min, f.max).describe(
    `${range(f.min, f.max)} ${unitName(f.unit, f.max)}, each ${TEXT_KINDS[f.each]}`,
  );
}

/**
 * The writer's output schema for a form: one field per slot. A slot that holds exactly one unit
 * is a string; any other is an array whose length is the slot's count range, so the counts are
 * enforced by the schema. The shape of each unit is in the field descriptions.
 */
export function writerSchema(form: PaletteFormId, layout = "default") {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const slot of slotContract(form, layout).slots) {
    const item =
      typeof slot.each === "string"
        ? kindSchema(slot.each)
        : z.object(
            Object.fromEntries(Object.entries(slot.each).map(([k, f]) => [k, fieldSchema(f)])),
          );
    const single = slot.min === 1 && slot.max === 1;
    const described = slotLine(slot);
    if (slot.field === "correct") {
      shape.correct = z.boolean().describe("true when the statement is true");
    } else if (slot.field === "compare") {
      const side = item.describe("one side");
      shape.compare = z.object({ left: side, right: side }).describe(described);
    } else {
      shape[slot.field] = (single ? item : counted(item, slot.min, slot.max)).describe(described);
    }
  }
  return z.object(shape);
}

export type WriterOutput = Record<string, unknown>;

/* ------------------------------------------------------------------ contract text */

function range(min: number, max: number | undefined): string {
  if (max === undefined) return `${min} or more`;
  if (min === max) return `${max}`;
  return min === 0 ? `up to ${max}` : `${min}–${max}`;
}

const UNIT_NAMES: Record<SlotUnit, [string, string]> = {
  line: ["line", "lines"],
  sentence: ["sentence", "sentences"],
  item: ["item", "items"],
};
const unitName = (unit: SlotUnit, max: number | undefined) => UNIT_NAMES[unit][max === 1 ? 0 : 1];

const PLACE: Record<SlotPlace, string> = {
  slide: "",
  reveal: ", shown after the reveal",
  answer: ", kept as the answer, not drawn on the slide",
  notes: ", goes in the teacher notes",
  "off-slide": ", not shown on the slide",
};

function itemLine(each: Slot["each"]): string {
  if (typeof each === "string") return TEXT_KINDS[each];
  return Object.entries(each)
    .filter(([, f]) => f !== "flag")
    .map(([k, f]) =>
      typeof f === "string"
        ? `${k}: ${TEXT_KINDS[f as TextKind]}`
        : `${k}: ${range((f as SubList).min, (f as SubList).max)} ${unitName((f as SubList).unit, (f as SubList).max)}, each ${TEXT_KINDS[(f as SubList).each]}`,
    )
    .join("; ");
}

/** One slot as a plain line: "steps: 1–3 lines, each one calculation or one short phrase". */
function slotLine(slot: Slot): string {
  if (slot.field === "correct") return "correct: whether the statement is true";
  const count = range(slot.min, slot.max);
  const unit = unitName(slot.unit, slot.max);
  const each = itemLine(slot.each);
  const shape =
    slot.min === 1 && slot.max === 1 && typeof slot.each === "string"
      ? each
      : `${count} ${unit}, each ${typeof slot.each === "string" ? each : `with ${each}`}`;
  return `${slot.field}: ${shape}${slot.rule ? ` (${slot.rule})` : ""}${PLACE[slot.place]}`;
}

/**
 * The contract in compact plain English for the writer's prompt, one slot a line. Structural units
 * only: no word or character counts.
 */
export function contractText(form: PaletteFormId, layout = "default"): string {
  const c = slotContract(form, layout);
  const head = `${form}${layout === "default" ? "" : ` (${layout})`}:`;
  return [head, ...c.slots.map((s) => `- ${slotLine(s)}`)].join("\n");
}

/* ------------------------------------------------------------------ writer output → spec */

const sentencesOf = (v: unknown): string =>
  Array.isArray(v) ? (v as string[]).join(" ") : String(v);

/**
 * The slide spec a writer's output makes, with the variant and structure the form renders in:
 * what the drift test measures and what the design step hands `materialiseSlide`. Undefined for an
 * off-slide form.
 */
export function specOfWriter(
  form: PaletteFormId,
  out: WriterOutput,
  layout = "default",
): { spec: SlideSpec; variant?: string; structure: SlideStructure } | undefined {
  const base = { factRefs: [] as string[] };
  const o = out as Record<string, unknown>;
  const content = (extra: Record<string, unknown>, structure: SlideStructure = {}) => ({
    spec: {
      kind: "content",
      ...base,
      heading: o.heading,
      body: sentencesOf(o.body),
      ...extra,
    } as unknown as SlideSpec,
    variant: "headed",
    structure,
  });
  switch (form) {
    case "explain":
      return content({});
    case "explain-callout":
      return {
        ...content({ callout: { kind: "watch-out", text: sentencesOf(o.callout) } }),
        variant: "callout-row",
      };
    case "list":
      return content({ points: o.points });
    case "compare":
      return content({ compare: o.compare });
    case "sequence":
      return content({ steps: o.steps });
    case "photo": {
      const brief = o.imageBrief as { subject: string; mustShow?: string[] };
      return content({}, { photo: { subject: brief.subject, mustShow: brief.mustShow ?? [] } });
    }
    case "diagram-slot":
      return content({ diagram: o.diagram });
    case "figure":
      // The figure's values come from the figure brief step (ADR 0032); the brief alone is the
      // labelled placeholder, which is the larger of the two on the slide.
      return content({ diagram: o.figure });
    case "worked-example":
      return {
        spec: {
          kind: "worked-example",
          ...base,
          heading: o.heading,
          question: o.question,
          steps: o.steps,
        } as unknown as SlideSpec,
        structure: {},
      };
    case "hinge": {
      const why = layout === "why";
      return {
        spec: {
          kind: "multiple-choice",
          ...base,
          stem: o.stem,
          options: o.options,
          ...(why
            ? { explanation: sentencesOf(o.explanation) }
            : { notes: sentencesOf(o.explanation) }),
        } as unknown as SlideSpec,
        ...(layout === "stacked" ? { variant: "stacked" } : {}),
        structure: {},
      };
    }
    case "true-false":
      return {
        spec: {
          kind: "true-false",
          ...base,
          statement: o.statement,
          correct: o.correct,
          explanation: sentencesOf(o.explanation),
        } as unknown as SlideSpec,
        structure: {},
      };
    case "matching":
      return {
        spec: { kind: "matching", ...base, stem: o.stem, pairs: o.pairs } as unknown as SlideSpec,
        structure: {},
      };
    case "fill-gap":
      return {
        spec: {
          kind: "fill-gap",
          ...base,
          stem: o.stem,
          sentence: o.sentence,
          answers: o.answers,
        } as unknown as SlideSpec,
        structure: {},
      };
    case "sort":
      return {
        spec: { kind: "sort", ...base, stem: o.stem, steps: o.steps } as unknown as SlideSpec,
        structure: {},
      };
    case "open-response":
      return {
        spec: {
          kind: "open-response",
          ...base,
          stem: o.stem,
          modelAnswer: sentencesOf(o.modelAnswer),
        } as unknown as SlideSpec,
        structure: {},
      };
    case "discussion": {
      const starters = (o.footnote ?? []) as string[];
      return {
        spec: {
          kind: "discussion",
          ...base,
          prompt: o.prompt,
          ...(starters.length ? { footnote: starters.join(" / ") } : {}),
        } as unknown as SlideSpec,
        structure: {},
      };
    }
    case "vocabulary":
      return {
        spec: { kind: "vocabulary", ...base, entries: o.entries } as unknown as SlideSpec,
        structure: {},
      };
    case "notes":
    case "worksheet":
      return undefined;
  }
}

/** Every form has a default contract (checked at load). */
for (const id of PALETTE_FORM_IDS) slotContract(id);
