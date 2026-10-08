/**
 * BAKEOFF arm T: the template catalogue and each slot's measured capacity per key stage.
 *
 * Capacities are measured, not guessed: each template is laid out by `layoutTemplate` with
 * real-looking words cut at a word boundary, and the largest length (in characters, step 2) that
 * lays out with no over-capacity mark is the slot's capacity. Every text item in a body takes the
 * same cap, so a capacity reads "a lead and 2 points, each at most N characters".
 */
import type { Theme } from "@tj/domain/documents";
import { countLines } from "../text-measure";
import {
  G,
  layoutTemplate,
  type Stage,
  type TemplateId,
  type TemplateInput,
  templateScale,
} from "./index";

export type SlotDoc = {
  name: string;
  /** What the model writes there. */
  holds: string;
  kind: "text" | "list" | "photo" | "diagram" | "photos";
  items?: [number, number];
  optional?: boolean;
};
export type TemplateDoc = {
  id: TemplateId;
  use: string;
  slots: SlotDoc[];
  /** The fills measured: item counts per list slot (others at their minimum). */
  variants: {
    label: string;
    counts: Record<string, number>;
    figure?: "photo" | "diagram";
    /** Every point carries a short label (KEY_LABEL chars), so the points are key cards. */
    keyCards?: boolean;
  }[];
};

const HEADING: SlotDoc = { name: "heading", holds: "the slide heading", kind: "text" };
const PHOTO = (optional = false): SlotDoc => ({
  name: "picture",
  holds: "a picture request: what pupils must see",
  kind: "photo",
  optional,
});
const DIAGRAM: SlotDoc = {
  name: "diagram",
  holds: "a diagram request: its kind and what it must show",
  kind: "diagram",
};

/** A key card's label as measured: a short name, one line in the column ("Freezing", "One part"). */
export const KEY_LABEL = 16;
const POINTS_HOLDS =
  "support points; one or two may each carry a short label, set as key cards (label over its line)";
const KEY_VARIANTS = (figure?: "photo" | "diagram") =>
  [1, 2].map((n) => ({
    label: `lead + ${n} key card${n > 1 ? "s" : ""}`,
    counts: { points: n },
    keyCards: true,
    ...(figure ? { figure } : {}),
  }));

export const TEMPLATE_DOCS: TemplateDoc[] = [
  {
    id: "title",
    use: "slide 1: the lesson title and a subtitle, with a picture if one helps",
    slots: [
      { name: "heading", holds: "the lesson title", kind: "text" },
      { name: "lead", holds: "the subtitle: the lesson's question or hook", kind: "text" },
      PHOTO(true),
    ],
    variants: [
      { label: "with picture", counts: {}, figure: "photo" },
      { label: "no picture", counts: {} },
    ],
  },
  {
    id: "objectives",
    use: "slide 2: the pupil objectives as numbered lines",
    slots: [HEADING, { name: "points", holds: "pupil objectives", kind: "list", items: [2, 4] }],
    variants: [2, 3, 4].map((n) => ({ label: `${n} objectives`, counts: { points: n } })),
  },
  {
    id: "explain",
    use: "teaching with words only: a lead sentence and up to 3 points",
    slots: [
      HEADING,
      { name: "lead", holds: "the one key sentence", kind: "text" },
      { name: "points", holds: POINTS_HOLDS, kind: "list", items: [0, 3] },
    ],
    variants: [
      ...[0, 2, 3].map((n) => ({ label: `lead + ${n} points`, counts: { points: n } })),
      ...KEY_VARIANTS(),
    ],
  },
  {
    id: "picture-text",
    use: "a picture beside a short lead and points",
    slots: [
      HEADING,
      { name: "lead", holds: "the one key sentence", kind: "text", optional: true },
      { name: "points", holds: POINTS_HOLDS, kind: "list", items: [0, 3] },
      PHOTO(),
    ],
    variants: [
      ...[0, 2, 3].map((n) => ({
        label: `lead + ${n} points`,
        counts: { points: n },
        figure: "photo" as const,
      })),
      ...KEY_VARIANTS("photo"),
    ],
  },
  {
    id: "diagram-text",
    use: "a diagram beside a short lead and points",
    slots: [
      HEADING,
      { name: "lead", holds: "the one key sentence", kind: "text", optional: true },
      { name: "points", holds: POINTS_HOLDS, kind: "list", items: [0, 3] },
      DIAGRAM,
    ],
    variants: [
      ...[0, 2, 3].map((n) => ({
        label: `lead + ${n} points`,
        counts: { points: n },
        figure: "diagram" as const,
      })),
      ...KEY_VARIANTS("diagram"),
    ],
  },
  {
    id: "big-picture",
    use: "one picture across the slide with a short caption: pupils look closely at it",
    slots: [HEADING, { name: "lead", holds: "the caption", kind: "text", optional: true }, PHOTO()],
    variants: [{ label: "caption", counts: {}, figure: "photo" }],
  },
  {
    id: "big-diagram",
    use: "one diagram across the slide with a short caption",
    slots: [HEADING, { name: "lead", holds: "the caption", kind: "text", optional: true }, DIAGRAM],
    variants: [{ label: "caption", counts: {}, figure: "diagram" }],
  },
  {
    id: "picture-sequence",
    use: "2-4 pictures in a row with a caption under each and arrows between: life cycles, changes over time, before and after",
    slots: [
      HEADING,
      {
        name: "sequence",
        holds: "each stage: a picture request and a short caption",
        kind: "photos",
        items: [2, 4],
      },
    ],
    variants: [2, 3, 4].map((n) => ({ label: `${n} pictures`, counts: { sequence: n } })),
  },
  {
    id: "compare",
    use: "two or three things side by side, each a label and a short text, with a picture each if it helps",
    slots: [
      HEADING,
      {
        name: "columns",
        holds: "each: a label, a short text, an optional picture",
        kind: "list",
        items: [2, 3],
      },
    ],
    variants: [
      { label: "2 columns", counts: { columns: 2 } },
      { label: "3 columns", counts: { columns: 3 } },
      { label: "2 columns with pictures", counts: { columns: 2 }, figure: "photo" },
      { label: "3 columns with pictures", counts: { columns: 3 }, figure: "photo" },
    ],
  },
  {
    id: "steps",
    use: "a process or method in order, one numbered step per line, with a picture or diagram if it helps",
    slots: [
      HEADING,
      { name: "points", holds: "the steps", kind: "list", items: [2, 5] },
      { ...DIAGRAM, holds: "an optional picture or diagram", optional: true },
    ],
    variants: [
      ...[3, 4, 5].map((n) => ({ label: `${n} steps`, counts: { points: n } })),
      ...[3, 4].map((n) => ({
        label: `${n} steps with figure`,
        counts: { points: n },
        figure: "photo" as const,
      })),
    ],
  },
  {
    id: "equation-hero",
    use: "a worked calculation: the formula as the focal line, then the substitution and answer, one line each, with a graph if it helps",
    slots: [
      HEADING,
      {
        name: "lead",
        holds: "an optional sentence on what the formula finds",
        kind: "text",
        optional: true,
      },
      { name: "formula", holds: "the formula in words or symbols", kind: "text" },
      { name: "points", holds: "the substitution and answer lines", kind: "list", items: [1, 4] },
      { ...DIAGRAM, holds: "an optional graph or diagram", optional: true },
    ],
    variants: [
      ...[2, 3, 4].map((n) => ({ label: `formula + ${n} lines`, counts: { points: n } })),
      ...[2, 3].map((n) => ({
        label: `formula + ${n} lines with figure`,
        counts: { points: n },
        figure: "photo" as const,
      })),
    ],
  },
  {
    id: "hinge",
    use: "one multiple-choice question: a stem and 2-4 options in a 2x2 grid",
    slots: [
      HEADING,
      { name: "stem", holds: "the question", kind: "text" },
      { name: "options", holds: "the options", kind: "list", items: [2, 4] },
    ],
    variants: [3, 4].map((n) => ({ label: `${n} options`, counts: { options: n } })),
  },
  ...(["question-set", "practice", "exit-ticket"] as const).map(
    (id): TemplateDoc => ({
      id,
      use:
        id === "question-set"
          ? "several questions pupils answer in turn"
          : id === "practice"
            ? "what pupils do: tasks or questions to work through, with a picture if they need one"
            : "the exit ticket: a few questions pupils answer alone at the end",
      slots: [
        HEADING,
        { name: "questions", holds: "the questions", kind: "list", items: [1, 4] },
        {
          name: "instruction",
          holds: "one quiet line of instruction",
          kind: "text",
          optional: true,
        },
        ...(id === "exit-ticket" ? [] : [PHOTO(true)]),
      ],
      variants: [
        ...[3, 4].map((n) => ({ label: `${n} questions`, counts: { questions: n } })),
        ...(id === "exit-ticket"
          ? []
          : [
              {
                label: "3 questions with picture",
                counts: { questions: 3 },
                figure: "photo" as const,
              },
            ]),
      ],
    }),
  ),
  {
    id: "discussion",
    use: "one question for pupils to talk about, large, with a picture if it helps",
    slots: [HEADING, { name: "lead", holds: "the discussion question", kind: "text" }, PHOTO(true)],
    variants: [
      { label: "prompt alone", counts: {} },
      { label: "prompt with picture", counts: {}, figure: "photo" },
    ],
  },
];

/* ------------------------------------------------------------------ */
/* Measuring                                                           */
/* ------------------------------------------------------------------ */

const WORDS =
  "Young animals grow and change as they get older and many of them look like their parents while others change shape completely before they become adults that can have young of their own again";
/** Real-looking words cut at a word boundary to at most `n` characters. */
export function sample(n: number, seed = 0): string {
  const words = WORDS.split(" ");
  const rot = [...words.slice(seed % words.length), ...words.slice(0, seed % words.length)];
  let out = "";
  for (const w of [...rot, ...rot, ...rot]) {
    const next = out ? `${out} ${w}` : w;
    if (next.length > n) break;
    out = next;
  }
  const s = out || "Word";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const PH = { photo: "x", aspect: 4 / 3 } as const;
const DIA = {
  diagram: {
    kind: "flow",
    alt: "flow",
    steps: [{ label: "Egg" }, { label: "Chick" }, { label: "Hen" }],
  },
};

function inputFor(
  doc: TemplateDoc,
  v: TemplateDoc["variants"][number],
  n: number,
  heading = "Animals and their young",
): TemplateInput {
  const fig = v.figure === "photo" ? PH : v.figure === "diagram" ? DIA : undefined;
  const items = (k: number) => Array.from({ length: k }, (_, i) => sample(n, i * 3 + 1));
  const base: TemplateInput = { template: doc.id, heading };
  switch (doc.id) {
    case "title":
      return { ...base, lead: sample(n), ...(fig ? { figure: fig } : {}) };
    case "objectives":
      return { ...base, points: items(v.counts.points ?? 3) };
    case "explain":
    case "picture-text":
    case "diagram-text":
      return {
        ...base,
        lead: sample(n),
        points: v.keyCards
          ? items(v.counts.points ?? 1).map((text, i) => ({
              label: sample(KEY_LABEL, i * 5),
              text,
            }))
          : items(v.counts.points ?? 0),
        figure: fig,
      };
    case "big-picture":
    case "big-diagram":
    case "discussion":
      return { ...base, lead: sample(n), ...(fig ? { figure: fig } : {}) };
    case "picture-sequence":
      return {
        ...base,
        sequence: items(v.counts.sequence ?? 3).map((caption) => ({ caption, figure: PH })),
      };
    case "compare":
      return {
        ...base,
        columns: items(v.counts.columns ?? 2).map((text, i) => ({
          label: sample(12, i),
          text,
          ...(fig ? { figure: PH } : {}),
        })),
      };
    case "steps":
      return { ...base, points: items(v.counts.points ?? 3), ...(fig ? { figure: fig } : {}) };
    case "equation-hero":
      return {
        ...base,
        formula: sample(FORMULA_SAMPLE),
        points: items(v.counts.points ?? 2),
        ...(fig ? { figure: fig } : {}),
      };
    case "hinge":
      return { ...base, stem: sample(Math.round(n * 1.6)), options: items(v.counts.options ?? 4) };
    default:
      return {
        ...base,
        questions: items(v.counts.questions ?? 3),
        ...(fig ? { figure: fig } : {}),
      };
  }
}

/** The largest n (2..max, step 2) for which `ok(n)` holds; 0 when none does. */
function largest(ok: (n: number) => boolean, max = 240): number {
  let best = 0;
  for (let n = 2; n <= max; n += 2) if (ok(n)) best = n;
  return best;
}

export type Capacity = {
  /** Characters per line of each text slot's column at its type size. */
  charsPerLine: Record<string, number>;
  /** Heading: at most 2 lines; one line holds `headingOneLine` characters. */
  headingMax: number;
  headingOneLine: number;
  variants: { label: string; counts: Record<string, number>; maxCharsPerItem: number }[];
};

/** Characters of real-looking words that fit one line `w` wide in `role`'s size and face. */
function perLine(
  theme: Theme,
  stage: Stage,
  role: "title" | "heading" | "lead" | "body",
  w: number,
) {
  const s = templateScale(theme, stage);
  const preset = role === "title" ? "title" : role === "heading" ? "heading" : "body";
  const weight =
    role === "lead" ? 700 : role === "body" ? theme.weights.body : theme.weights.heading;
  return largest((n) => countLines(sample(n), preset, theme, w, weight, s[role]) <= 1, 160);
}

/** The formula an equation-hero capacity is measured with ("rate = change in volume ÷ time"). */
const FORMULA_SAMPLE = 16;

export function measureTemplate(doc: TemplateDoc, theme: Theme, stage: Stage): Capacity {
  // Fit-first: measured at full size, ladder off (the ladder is a net, not capacity).
  const clean = (input: TemplateInput) =>
    layoutTemplate(input, theme, stage, { fullSize: true }).over.length === 0;
  const headingMax = largest((n) =>
    clean({ ...inputFor(doc, doc.variants[0] as never, 10), heading: sample(n) }),
  );
  const variants = doc.variants.map((v) => ({
    label: v.label,
    counts: v.counts,
    maxCharsPerItem: largest((n) => clean(inputFor(doc, v, n))),
  }));
  const col =
    doc.variants.some((v) => v.figure) && doc.id !== "big-picture" && doc.id !== "big-diagram";
  const w = col ? G.left.w : G.width;
  return {
    charsPerLine: {
      heading: perLine(
        theme,
        stage,
        doc.id === "title" ? "title" : "heading",
        doc.id === "title" ? 520 : G.width,
      ),
      body: perLine(theme, stage, "body", w),
      lead: perLine(theme, stage, "lead", w),
      // Equation hero: the formula band's line at display size (2 lines allowed).
      ...(doc.id === "equation-hero"
        ? {
            formula: perLine(theme, stage, "heading", G.width - 2 * G.inset),
            formulaBesideFigure: perLine(theme, stage, "heading", G.left.w - 2 * G.inset),
          }
        : {}),
    },
    headingMax,
    headingOneLine: perLine(theme, stage, "heading", G.width),
    variants,
  };
}
