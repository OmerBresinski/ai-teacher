import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import {
  DEFAULT_SLIDE_COUNT,
  type FigureTemplateName,
  type ImageBrief,
  type Lesson,
  type LessonFacts,
  type OutlineEntry,
  type Slide,
} from "@tj/domain/documents";
import {
  drawFigure,
  FIGURE_TEMPLATES,
  figureTemplatesFor,
  fitsPlanned,
  getTheme,
  type MaterialiseMeta,
  materialiseSlide,
  PLACEHOLDER_IMAGE,
  slideFits,
  withoutPicture,
} from "@tj/slides";
import { diagramElement, parseDiagram, settleDiagram } from "@tj/slides/diagrams";
import { z } from "zod";
import { callStructured } from "../call";
import { CODE_MODEL, withAnswersReveal } from "../planner/coded-slides";
import { audienceBlock } from "../prompts/shared";
import { withUsage } from "../stages/generate";
import { pickPhoto, plainSubject, withPhoto } from "../stages/illustrate";
import { audienceOf, planClassFor } from "../stages/shared";
import type { PipelineDeps, PipelineState } from "../types";
import { DiagramSpecSchema } from "./diagram-spec";
import { renderWritten, type Written, withSetTag } from "./fit";
import { isSetForm } from "./menu";
import { broadenedBrief } from "./slide-check";

/*
 * Lab arm ABLATE S/O (lab/ablate, 5 Oct 2026): one plain call for the whole lesson in a light schema,
 * mapped onto the candidate's palette by a thin adapter and drawn. No gates, no re-asks, no fit
 * ladder. SIMPLE_ORACLE_FILE skips the call and draws a lesson written in session (arm O).
 */

export const SIMPLE_LESSON_VERSION = "simple-lesson.v2";

const FORMS: Record<string, string> = {
  explain: "a heading and a few sentences explaining one idea",
  "explain-callout": "an explanation with one key point highlighted (the key point is items[0])",
  list: "a heading, a lead sentence and a few short points (items)",
  compare: "two things side by side (items: two entries, each 'Label: text')",
  sequence: "a short process in order (items are the steps)",
  photo: "a few lines beside a photo (the only form that shows a picture)",
  "worked-example": "a problem worked step by step (question is the problem, items are the steps)",
  hinge: "a multiple-choice question (items are the options, answer is the correct option)",
  "true-false": "a statement pupils judge true or false (answer starts True or False, then why)",
  matching: "pupils match pairs (items: 'left = right', in the matching order)",
  "fill-gap": "a sentence with ___ gaps (question is the sentence, answer is the gap words)",
  sort: "pupils put items in order (items in the correct order)",
  "open-response": "a question pupils answer in writing (answer is a model answer)",
  discussion: "a prompt for pair or class talk (question is the prompt)",
  vocabulary: "key terms with definitions (items: 'term: definition')",
  starter: "1-3 retrieval questions to open the lesson, with answers",
  check: "1-3 quick questions on what was just taught, with answers",
  "exit-ticket": "1-3 closing questions, with answers",
};

const lightSlide = z.object({
  form: z.enum(Object.keys(FORMS) as [string, ...string[]]),
  heading: z.string(),
  body: z.array(z.string()),
  items: z.array(z.string()),
  questions: z.array(z.object({ question: z.string(), answer: z.string() })),
  picture: z.object({ subject: z.string(), named: z.string().nullable() }).nullable(),
  notes: z.string(),
});
export const simpleLessonSchema = z.object({
  objectives: z.array(z.string()),
  titlePicture: z.object({ subject: z.string(), named: z.string().nullable() }).nullable(),
  slides: z.array(lightSlide),
});
/** A light slide; arm T2's diagram form carries the drawing's spec. */
/** A picture: a photo request, or (arm T2) a drawing code makes, a diagram spec or a figure. */
type Pic =
  | { kind?: "photo"; subject: string; named: string | null }
  | { kind: "diagram"; spec: unknown }
  | { kind: "figure"; template: string; values: unknown };
type LightSlide = Omit<z.infer<typeof lightSlide>, "picture"> & { picture: Pic | null };
export type SimpleLesson = {
  objectives: string[];
  titlePicture: Pic | null;
  slides: LightSlide[];
};

export function simpleLessonPrompt(i: {
  slideCount: number;
  topic: string;
  /** The lesson context the stream gets, as the stream renders it (topic, audience, answers). */
  context: string;
}): { system: string; user: string } {
  const menu = Object.entries(FORMS)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");
  return {
    system: "You are an expert UK teacher.",
    user: `${i.context}

Write a ${i.slideCount}-slide lesson on this. First write the lesson's objectives. Slide 1 (the title) and slide 2 (the objectives) are made from them, so write slides 3 to ${i.slideCount}: ${i.slideCount - 2} slides.

The slide forms we can draw:
${menu}

Per slide: form, heading, body (sentences shown on the slide), items, questions (question and answer, when the form asks one), picture (what a photo should show, and its proper name if it must be one named thing; null for none), notes (what the teacher says and does). Leave fields a form does not use empty. Also give a picture for the title slide.`,
  };
}

/* Arm T (Greg's design): an expert teacher given only constraints and context, nothing forced. */
export const TEACHER_LESSON_VERSION = "simple-lesson.t1";
const T_FORMS: Record<string, string> = {
  ...FORMS,
  "explain-callout": "an explanation with one common mistake called out (the last line of content)",
  list: "a lead sentence then a few short points (one per line of content)",
  compare: "two things side by side (two lines of content, each 'Label: text')",
  hinge:
    "a multiple-choice question with 4 options (the options are the content; answer is the correct option)",
  matching: "pupils match up to 3 pairs (content lines 'left = right')",
};
const ITEM_FORMS = new Set([
  "sequence",
  "hinge",
  "matching",
  "vocabulary",
  "sort",
  "compare",
  "worked-example",
]);
const PICTURE_SHARE: Record<string, [number, number]> = {
  ks1: [0.55, 0.75],
  ks2: [0.55, 0.75],
  ks3: [0.35, 0.5],
  ks4: [0.3, 0.45],
  ks5: [0.3, 0.45],
};
const teacherSlide = z.object({
  form: z.enum(Object.keys(FORMS) as [string, ...string[]]),
  heading: z.string(),
  content: z.array(z.string()),
  questions: z.array(z.object({ question: z.string(), answer: z.string() })),
  picture: z.object({ subject: z.string(), named: z.string().nullable() }).nullable(),
  notes: z.string(),
});
export const teacherLessonSchema = z.object({
  objectives: z.array(z.string()),
  titlePicture: z.object({ subject: z.string(), named: z.string().nullable() }).nullable(),
  slides: z.array(teacherSlide),
});
type TeacherLesson = z.infer<typeof teacherLessonSchema>;

export function teacherPrompt(i: {
  slideCount: number;
  topic: string;
  context: string;
  yearGroup: string;
  subject: string;
  ageBand?: string | undefined;
}): { system: string; user: string } {
  const [lo, hi] = PICTURE_SHARE[(i.ageBand ?? "ks3").toLowerCase()] ?? [0.35, 0.5];
  const menu = Object.entries(T_FORMS)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");
  return {
    system: `You're an expert teacher in England, teaching ${i.yearGroup} ${i.subject}: ${i.topic}, at the right reading age for that year. Write the lesson as you'd teach it.`,
    user: `${i.context}

Exactly ${i.slideCount} slides. Slide 1 (the title) and slide 2 (the objectives) are made from your objectives, so write slides 3 to ${i.slideCount}.
About ${Math.round(i.slideCount * lo)}–${Math.round(i.slideCount * hi)} of your ${i.slideCount} slides show a picture (a photo form).

The slide types we can draw:
${menu}

Per slide: form, heading, content (the lines on the slide), questions (question and answer, if any), picture request (if any), notes.`,
  };
}

/*
 * Arm T2 (5 Oct 2026): T plus only the lines its content panel losses asked for (an objective with
 * no check, a thin slide on a harder idea, a wrong picture, drift off the objective), a drawn diagram
 * form, and T's menu made true to its own schema (content, not items; questions only where drawn).
 */
export const TEACHER2_LESSON_VERSION = "simple-lesson.t2";
/** The forms whose questions are drawn; on any other form a question would never reach the class. */
const QUESTION_FORMS = [
  "worked-example",
  "hinge",
  "true-false",
  "fill-gap",
  "open-response",
  "discussion",
  "starter",
  "check",
  "exit-ticket",
];
const T2_FORMS: Record<string, string> = {
  explain: "a heading and 2–3 lines explaining one idea",
  "explain-callout":
    "an explanation, then one common mistake pupils make as the last line (the slide labels it)",
  list: "a lead sentence then a few short points (one per line of content)",
  compare: "two things side by side (two lines of content, each 'Label: text')",
  sequence: "a short process in order (the steps are the content)",
  picture: "2–3 lines beside a picture",
  "worked-example":
    "a problem worked step by step (question is the problem, the steps are the content)",
  hinge:
    "a multiple-choice question with 4 options (the options are the content; answer is the correct option)",
  "true-false": "a statement pupils judge true or false (answer starts True or False, then why)",
  matching: "pupils match up to 3 pairs (content lines 'left = right')",
  "fill-gap": "a sentence with ___ gaps (question is the sentence, answer is the gap words)",
  sort: "pupils put items in order (the content, in the correct order)",
  "open-response": "a question pupils answer in writing (answer is a model answer)",
  discussion: "a prompt for pair or class talk (question is the prompt)",
  vocabulary: "key terms with definitions (content lines 'term: definition')",
  starter: "1-3 retrieval questions to open the lesson, with answers",
  check: "1-3 quick questions on what was just taught, with answers",
  "exit-ticket": "1-3 closing questions, with answers",
};
/** What each drawing draws, one line each (the diagram spec's kinds, then the figure templates). */
const DRAWN: Record<string, string> = {
  particles: "particles in solids, liquids and gases, or diffusion or dissolving",
  hydrograph: "a storm hydrograph",
  timeline: "dated events in order",
  layers: "a layered structure or cross-section",
  cycle: "a cycle of 3 to 5 steps",
  river: "a V-shaped valley, or a meander across or from above",
  "bar-model": "amounts as bars split into equal or labelled parts",
  "number-line": "a number line with marked points, jumps or a range",
  "line-graph": "a line or bar graph on labelled axes",
  flow: "steps in a chain or a loop, joined by arrows",
  "labelled-diagram": "simple shapes with labels, drawn on a grid",
  table: "a small table of short entries",
};
const FIGURE_DRAWS: Record<string, string> = {
  "right-triangle": "a right-angled triangle with its sides and angles",
  triangle: "a triangle with its sides and angles",
  "energy-profile": "a reaction's energy profile",
};
/** The picture field: a photo found by search, a diagram spec, or a figure the subject offers. */
function t2Picture(subject?: string) {
  const figures = figureTemplatesFor(subject).map((t) =>
    z.object({
      kind: z.literal("figure"),
      template: z.literal(t),
      values: FIGURE_TEMPLATES[t].shape,
    }),
  );
  return z.union([
    z.object({ kind: z.literal("photo"), subject: z.string(), named: z.string().nullable() }),
    z.object({ kind: z.literal("diagram"), spec: DiagramSpecSchema }),
    ...figures,
  ]);
}
export function teacher2LessonSchema(subject?: string) {
  const picture = t2Picture(subject).nullable();
  // The title's picture is a photo: a second copy of the drawing union would double the schema.
  return teacherLessonSchema.extend({
    titlePicture: z
      .object({ kind: z.literal("photo"), subject: z.string(), named: z.string().nullable() })
      .nullable(),
    slides: z.array(
      teacherSlide.extend({
        form: z.enum(Object.keys(T2_FORMS) as [string, ...string[]]),
        picture,
      }),
    ),
  });
}

export function teacher2Prompt(i: Parameters<typeof teacherPrompt>[0]): {
  system: string;
  user: string;
} {
  const [lo, hi] = PICTURE_SHARE[(i.ageBand ?? "ks3").toLowerCase()] ?? [0.35, 0.5];
  const menu = Object.entries(T2_FORMS)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");
  const drawn = [
    ...Object.entries(DRAWN).map(([k, v]) => `- diagram ${k}: ${v}`),
    ...figureTemplatesFor(i.subject).map((t) => `- figure ${t}: ${FIGURE_DRAWS[t] ?? t}`),
  ].join("\n");
  return {
    system: `You're an expert teacher in England, teaching ${i.yearGroup} ${i.subject}: ${i.topic}, at the right reading age for that year. Write the lesson as you'd teach it.`,
    user: `${i.context}

Exactly ${i.slideCount} slides. Slide 1 (the title) and slide 2 (the objectives) are made from your objectives, so write slides 3 to ${i.slideCount}.
Teach each objective, then check it with a real question pupils answer. Share the slides by need: a harder objective gets more of them. Stay within the objectives.
About ${Math.round(i.slideCount * lo)}–${Math.round(i.slideCount * hi)} of your ${i.slideCount} slides show a picture, counting the title. Pictures go on teaching slides, and every check stays. A picture shows exactly what its slide says.

The slide types we can draw:
${menu}

A picture is a photo (a real photograph found by search) or a drawing we make from your spec:
${drawn}

Per slide: form, heading, content (the lines on the slide), questions (question and answer; only ${QUESTION_FORMS.join(", ")} show them), picture (picture slides only), notes. Also give a photo for the title slide.`,
  };
}

/*
 * Arm T3 (5 Oct 2026): T2 with the lesson's objectives given (R3's, so the panel is like for like),
 * an `objectives` index list per slide that code checks for coverage (one targeted re-ask on a gap),
 * every prompt clause tied to a measured failure (ABLATE/T3-LEDGER.md), and a lean drawing schema:
 * each kind's wire shape holds only the fields T2 used or the renderer needs, `alt` is composed in
 * code, and code expands the wire shape into the renderer's spec and validates it with its parse.
 */
export const TEACHER3_LESSON_VERSION = "simple-lesson.t3";
/** Forms that teach (credit every objective they name). */
const T3_TEACH = new Set([
  "explain",
  "explain-callout",
  "list",
  "compare",
  "sequence",
  "picture",
  "worked-example",
  "vocabulary",
  "discussion",
]);
/** Forms pupils answer: a set credits as many objectives as it has questions, any other one. */
const T3_CHECK = new Set([
  "hinge",
  "true-false",
  "matching",
  "fill-gap",
  "sort",
  "open-response",
  "check",
  "exit-ticket",
]);
const T3_FORMS: Record<string, string> = {
  ...T2_FORMS,
  // The drawn COMMON MISTAKE label is code's (bareCallout strips a written one), so the prompt no longer says it.
  "explain-callout": "an explanation, then one common mistake pupils make as the last line",
};
const phrase = (what: string) => z.string().describe(what);
/** The lean wire shape of each drawing kind (no alt: code writes it from the title and labels). */
const T3_DRAW = {
  timeline: z.object({
    kind: z.literal("timeline"),
    title: phrase("one short line"),
    events: z
      .array(z.object({ date: phrase("a date"), text: phrase("a short phrase") }))
      .min(3)
      .max(7),
  }),
  table: z.object({
    kind: z.literal("table"),
    title: phrase("one short line"),
    header: z.array(phrase("1–3 words")).min(1).max(5),
    rows: z
      .array(z.array(phrase("a short phrase")).min(1).max(5))
      .min(1)
      .max(8),
  }),
  flow: z.object({
    kind: z.literal("flow"),
    title: phrase("one short line"),
    steps: z
      .array(
        z.object({
          label: phrase("a short phrase"),
          arrow: phrase("1–2 words on the arrow to the next step").optional(),
        }),
      )
      .min(2)
      .max(6),
  }),
  cycle: z.object({
    kind: z.literal("cycle"),
    title: phrase("one short line"),
    steps: z.array(phrase("a short phrase")).min(3).max(5),
  }),
  "bar-model": z.object({
    kind: z.literal("bar-model"),
    title: phrase("one short line"),
    bars: z
      .array(
        z.object({
          label: phrase("1–2 words"),
          parts: z
            .array(
              z.object({
                value: z.number().optional(),
                label: phrase("1–2 words").optional(),
                shaded: z.boolean().optional(),
              }),
            )
            .min(1)
            .max(12),
          total: phrase("1–2 words").optional(),
        }),
      )
      .min(1)
      .max(4),
  }),
  "number-line": z.object({
    kind: z.literal("number-line"),
    title: phrase("one short line"),
    min: z.number(),
    max: z.number(),
    step: z.number(),
    points: z
      .array(z.object({ value: z.number(), label: phrase("1–2 words").optional() }))
      .max(6)
      .optional(),
    jumps: z
      .array(z.object({ from: z.number(), to: z.number(), label: phrase("1–2 words").optional() }))
      .max(6)
      .optional(),
  }),
  "line-graph": z.object({
    kind: z.literal("line-graph"),
    title: phrase("one short line"),
    x: z.object({ label: phrase("a few words with the unit"), min: z.number(), max: z.number() }),
    y: z.object({ label: phrase("a few words with the unit"), min: z.number(), max: z.number() }),
    series: z
      .array(
        z.object({
          label: phrase("1–3 words"),
          points: z.array(z.array(z.number()).length(2)).min(2).max(40),
          style: z.enum(["line", "bars"]),
        }),
      )
      .min(1)
      .max(3),
  }),
  particles: z.object({
    kind: z.literal("particles"),
    title: phrase("one short line"),
    show: z.enum(["states", "diffusion", "dissolving"]),
    states: z
      .array(z.enum(["solid", "liquid", "gas"]))
      .min(1)
      .max(3),
    notes: z.array(phrase("a short phrase under each panel")).max(3).optional(),
    arrows: z.array(phrase("1–2 words on the arrow between panels")).max(2).optional(),
  }),
} as const;
type T3Kind = keyof typeof T3_DRAW;
const T3_DRAWS: Record<T3Kind, string> = {
  timeline: "dated events in order",
  table: "a small table of short entries",
  flow: "steps in a chain, joined by arrows",
  cycle: "a cycle of 3 to 5 steps",
  "bar-model": "amounts as bars split into equal or labelled parts",
  "number-line": "a number line with marked points or jumps",
  "line-graph": "a line or bar graph on labelled axes",
  particles: "particles in solids, liquids and gases, or diffusion or dissolving",
};
/** Drop the empty strings, nulls and empty lists a writer leaves in optional fields. */
function pruned(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(pruned);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      const p = pruned(x);
      if (p === null || p === undefined || (typeof p === "string" && !p.trim())) continue;
      if (Array.isArray(p) && p.length === 0) continue;
      out[k] = p;
    }
    return out;
  }
  return v;
}
/** The wire shape as the renderer's spec: alt composed, layout fixed, empties dropped. */
export function expandDrawing(p: Record<string, unknown>): Record<string, unknown> {
  const w = pruned(p) as Record<string, unknown> & { kind: string; title?: string };
  const words: string[] = [];
  const collect = (v: unknown) => {
    if (typeof v === "string") words.push(v);
    else if (Array.isArray(v)) v.forEach(collect);
    else if (v && typeof v === "object") Object.values(v).forEach(collect);
  };
  const { kind, title, ...rest } = w;
  collect(rest);
  const said = words.filter(
    (t) => !["states", "diffusion", "dissolving", "line", "bars"].includes(t),
  );
  let alt = `${title ?? kind}: ${said.join(", ")}`;
  if (alt.length > 200) alt = alt.slice(0, alt.lastIndexOf(", ", 199));
  const spec: Record<string, unknown> = { ...rest, kind, alt };
  if (title && title.length <= 40) spec.title = title;
  if (kind === "flow") spec.layout = "chain";
  return spec;
}
/** The picture field: a photo, a drawing of one kind, or a figure the subject offers. */
function t3Picture(subject?: string) {
  const figures = figureTemplatesFor(subject).map((t) =>
    z.object({
      kind: z.literal("figure"),
      template: z.literal(t),
      values: FIGURE_TEMPLATES[t].shape,
    }),
  );
  return z.union([
    z.object({ kind: z.literal("photo"), subject: z.string(), named: z.string().nullable() }),
    ...Object.values(T3_DRAW),
    ...figures,
  ]);
}
const t3Slide = (subject?: string) =>
  z.object({
    objectives: z.array(z.number().int()),
    ...teacherSlide.shape,
    form: z.enum(Object.keys(T3_FORMS) as [string, ...string[]]),
    picture: t3Picture(subject).nullable(),
  });
export function teacher3LessonSchema(subject?: string) {
  return z.object({
    titlePicture: z
      .object({ kind: z.literal("photo"), subject: z.string(), named: z.string().nullable() })
      .nullable(),
    slides: z.array(t3Slide(subject)),
  });
}
type T3Slide = z.infer<ReturnType<typeof t3Slide>>;
const numbered = (objectives: string[]) => objectives.map((o, i) => `${i + 1}. ${o}`).join("\n");
const t3FieldsLine = `Per slide: objectives (the numbers of the objectives it teaches or checks), form, heading, content (the lines on the slide), questions (question and answer; only ${QUESTION_FORMS.join(", ")} show them), picture (picture slides only), notes.`;

export function teacher3Prompt(i: Parameters<typeof teacherPrompt>[0] & { objectives: string[] }): {
  system: string;
  user: string;
} {
  const [lo, hi] = PICTURE_SHARE[(i.ageBand ?? "ks3").toLowerCase()] ?? [0.35, 0.5];
  const menu = Object.entries(T3_FORMS)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");
  const drawn = [
    ...Object.entries(T3_DRAWS).map(([k, v]) => `- ${k}: ${v}`),
    ...figureTemplatesFor(i.subject).map((t) => `- figure ${t}: ${FIGURE_DRAWS[t] ?? t}`),
  ].join("\n");
  return {
    system: "You're an expert teacher in England.",
    user: `${i.context}

These are the lesson's objectives, and the lesson teaches each one:
${numbered(i.objectives)}

Exactly ${i.slideCount} slides. Slide 1 (the title) and slide 2 (the objectives) are made from the objectives, so write slides 3 to ${i.slideCount}.
Teach each objective, then check it with a real question pupils answer. Share the slides by need: a harder objective gets more of them. Stay within the objectives.
About ${Math.round(i.slideCount * lo)}–${Math.round(i.slideCount * hi)} of your ${i.slideCount} slides show a picture, counting the title. Pictures go on teaching slides, and every check stays. A picture shows exactly what its slide says.

The slide types we can draw:
${menu}

A picture is a photo (a real photograph found by search) or a drawing we make from your spec:
${drawn}

${t3FieldsLine} Also give a photo for the title slide.`,
  };
}

/** What each objective lacks: a teaching slide, a slide with a question that checks it, or both. */
export function coverageGaps(
  slides: Pick<T3Slide, "objectives" | "form" | "questions">[],
  n: number,
): { objective: number; teach: boolean; check: boolean }[] {
  const taught = new Set<number>();
  const checked = new Set<number>();
  for (const s of slides) {
    const own = [...new Set(s.objectives)].filter((o) => o >= 1 && o <= n);
    if (T3_TEACH.has(s.form)) for (const o of own) taught.add(o);
    if (T3_CHECK.has(s.form)) {
      const room = SET_OF[s.form] ? Math.max(1, s.questions.length) : 1;
      for (const o of own.slice(0, room)) checked.add(o);
    }
  }
  return Array.from({ length: n }, (_, k) => k + 1)
    .map((o) => ({ objective: o, teach: !taught.has(o), check: !checked.has(o) }))
    .filter((g) => g.teach || g.check);
}
/** Slides (1-based deck numbers) whose loss would open no new gap: the ones a re-ask may replace. */
export function spareSlides(slides: Parameters<typeof coverageGaps>[0], n: number): number[] {
  const missing = (g: ReturnType<typeof coverageGaps>) =>
    g.reduce((a, x) => a + Number(x.teach) + Number(x.check), 0);
  const base = missing(coverageGaps(slides, n));
  return slides
    .map((_, k) => k)
    .filter((k) => {
      const without = coverageGaps(
        slides.filter((_, j) => j !== k),
        n,
      );
      return missing(without) <= base;
    })
    .map((k) => k + 3);
}
export function teacher3GapPrompt(i: {
  context: string;
  objectives: string[];
  slides: T3Slide[];
  gaps: ReturnType<typeof coverageGaps>;
  spares: number[];
  slideCount: number;
}): { user: string; count: number } {
  const list = i.slides
    .map(
      (s, k) =>
        `${k + 3}. ${s.form}: ${s.heading} (objectives ${s.objectives.join(", ") || "none"})`,
    )
    .join("\n");
  const lacks = i.gaps
    .map(
      (g) =>
        `Objective ${g.objective} has no ${[g.teach ? "slide that teaches it" : "", g.check ? "slide with a question that checks it" : ""].filter(Boolean).join(" and no ")}.`,
    )
    .join(" ");
  const count = Math.min(
    i.spares.length,
    i.gaps.reduce((a, g) => a + Number(g.teach) + Number(g.check), 0),
  );
  return {
    count,
    user: `${i.context}

These are the lesson's objectives, and the lesson teaches each one:
${numbered(i.objectives)}

Your slides 3 to ${i.slideCount}:
${list}

${lacks} Write ${count} slide${count === 1 ? "" : "s"} that fill${count === 1 ? "s" : ""} this, each replacing one of slides ${i.spares.join(", ")} (replaces: its number), so the lesson keeps ${i.slideCount} slides.

The slide types we can draw:
${Object.entries(T3_FORMS)
  .map(([k, v]) => `- ${k}: ${v}`)
  .join("\n")}

${t3FieldsLine}`,
  };
}
export function teacher3GapSchema(subject: string | undefined, spares: number[]) {
  return z.object({
    slides: z.array(
      t3Slide(subject).extend({
        replaces: z.enum(spares.map(String) as [string, ...string[]]),
      }),
    ),
  });
}
/** T3's slides in T2's shape: a drawing's wire shape becomes the renderer's spec. */
function fromTeacher3(objectives: string[], t: { titlePicture: unknown; slides: T3Slide[] }) {
  return fromTeacher({
    objectives,
    titlePicture: t.titlePicture as TeacherLesson["titlePicture"],
    slides: t.slides.map(({ objectives: _o, ...s }) => {
      const p = s.picture as Record<string, unknown> | null;
      const picture =
        p && p.kind !== "photo" && p.kind !== "figure"
          ? { kind: "diagram", spec: expandDrawing(p) }
          : p;
      return { ...s, picture } as unknown as TeacherLesson["slides"][number];
    }),
  });
}

/** A heading as the slide draws it: the slide's number is never part of it. */
const bareHeading = (h: string) => h.replace(/^\s*(?:slide\s*)?\d+\s*[.):]\s*/i, "");
/** A callout's text: the slide draws its COMMON MISTAKE label itself. */
const bareCallout = (t: string) => {
  const s = t.replace(/^\s*(?:a\s+)?(?:common\s+)?(?:mistake|misconception)\s*:\s*/i, "");
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/** Arm T's (and T2's) slides in the shared light shape, so the same adapter draws them. */
function fromTeacher(t: TeacherLesson): SimpleLesson {
  return {
    objectives: t.objectives,
    titlePicture: t.titlePicture as Pic | null,
    slides: (
      t.slides as (Omit<TeacherLesson["slides"][number], "picture"> & { picture: Pic | null })[]
    ).map((s) => {
      const c = s.content;
      const split =
        s.form === "list"
          ? { body: c.slice(0, 1), items: c.slice(1) }
          : s.form === "explain-callout"
            ? { body: c.slice(0, -1), items: c.slice(-1).map(bareCallout) }
            : ITEM_FORMS.has(s.form)
              ? { body: [], items: c }
              : { body: c, items: [] };
      return {
        form: s.form === "picture" ? "photo" : s.form,
        heading: bareHeading(s.heading),
        ...split,
        questions: s.questions,
        picture: s.picture,
        notes: s.notes,
      };
    }),
  };
}

const PICTURE_ORDER = ["split", "photo-band", "photo-band-long"] as const;
const SET_OF: Record<string, string> = {
  starter: "starter-set",
  check: "check-set",
  "exit-ticket": "exit-ticket",
};

const labelled = (s: string, sep: string) => {
  const at = s.indexOf(sep);
  return at < 0 ? [s.trim(), ""] : [s.slice(0, at).trim(), s.slice(at + sep.length).trim()];
};

/**
 * Arm T2: a teaching slide given a picture is drawn as the photo form, the only one with a picture
 * zone, when its words fit that form's slots (explain; explain-callout with its mistake as a line).
 */
export function withPictureZone(s: LightSlide): LightSlide {
  if (!s.picture || (s.form !== "explain" && s.form !== "explain-callout")) return s;
  const body =
    s.form === "explain" ? s.body : [...s.body, ...s.items.map((t) => `Common mistake: ${t}`)];
  return { ...s, form: "photo", body, items: [] };
}

/** The thin adapter: a light slide as the candidate's form, layout and writer fields. */
export function adapt(s: LightSlide): { form: string; layout: string; out: Written } {
  const q = s.questions[0] ?? { question: "", answer: "" };
  const notes = s.notes;
  const set = SET_OF[s.form];
  if (set) return { form: set, layout: "default", out: { questions: s.questions, notes } };
  switch (s.form) {
    case "explain":
      return {
        form: "explain",
        layout: "default",
        out: { heading: s.heading, body: s.body, notes },
      };
    case "explain-callout":
      return {
        form: "explain-callout",
        layout: "default",
        out: { heading: s.heading, body: s.body, callout: s.items[0] ?? "", notes },
      };
    case "list":
      return {
        form: "list",
        layout: "default",
        out: { heading: s.heading, body: s.body, points: s.items, notes },
      };
    case "compare": {
      const side = (t = "") => {
        const [label, text] = labelled(t, ":");
        return { label, points: text ? [text] : [] };
      };
      return {
        form: "compare",
        layout: "default",
        out: {
          heading: s.heading,
          body: s.body,
          compare: { left: side(s.items[0]), right: side(s.items[1]) },
          notes,
        },
      };
    }
    case "sequence":
      return {
        form: "sequence",
        layout: "default",
        out: { heading: s.heading, body: s.body, steps: s.items, notes },
      };
    case "photo":
      return {
        form: "photo",
        layout: "default",
        out: {
          heading: s.heading,
          body: s.body,
          imageBrief: {
            subject: (s.picture && "subject" in s.picture && s.picture.subject) || s.heading,
            named: (s.picture && "named" in s.picture && s.picture.named) || null,
            mustShow: [],
          },
          notes,
        },
      };
    case "worked-example":
      return {
        form: "worked-example",
        layout: "default",
        out: { heading: s.heading, question: q.question, steps: s.items, notes },
      };
    case "hinge": {
      const letter = /^\s*[A-Da-d]\s*[).:]\s*/;
      const norm = (t: string) =>
        t
          .trim()
          .toLowerCase()
          .replace(letter, "")
          .replace(/[.\s]+$/, "");
      // The palette's hinge draws four option cards: fewer would show an empty "Option D".
      if (s.items.length < 4)
        return { form: "check-set", layout: "default", out: { questions: [q], notes } };
      // The key: the option the answer names, by its letter, else by its text (the longest that fits).
      const a = norm(q.answer);
      const named = /^\s*([A-Da-d])\s*(?:[).:]|$)/.exec(q.answer)?.[1];
      const fits = s.items
        .map((t, i) => ({ i, n: norm(t) }))
        .filter((o) => o.n === a || a.startsWith(o.n) || o.n.startsWith(a))
        .sort((x, y) => (x.n === a ? -1 : y.n === a ? 1 : y.n.length - x.n.length));
      const key = named ? "abcd".indexOf(named.toLowerCase()) : (fits[0]?.i ?? -1);
      return {
        form: "hinge",
        layout: "default",
        out: {
          stem: q.question || s.heading,
          // The option letters are drawn by the slide, never written in the text.
          options: s.items.map((t, i) => ({ text: t.replace(letter, ""), correct: i === key })),
          explanation: q.answer,
          notes,
        },
      };
    }

    case "true-false":
      return {
        form: "true-false",
        layout: "default",
        out: {
          statement: q.question || s.heading,
          correct: /^\s*true/i.test(q.answer),
          explanation: q.answer.replace(/^\s*(true|false)[.,:!\s-]*/i, "") || q.answer,
          notes,
        },
      };
    case "matching":
      return {
        form: "matching",
        layout: "default",
        out: {
          stem: s.heading,
          pairs: s.items.map((t) => {
            const [left, right] = labelled(t, "=");
            return { left, right };
          }),
          notes,
        },
      };
    case "fill-gap":
      return {
        form: "fill-gap",
        layout: "default",
        out: {
          stem: s.heading,
          sentence: q.question,
          answers: q.answer
            .split(/[;,]/)
            .map((a) => a.trim())
            .filter(Boolean),
          notes,
        },
      };
    case "sort":
      return { form: "sort", layout: "default", out: { stem: s.heading, steps: s.items, notes } };
    case "open-response":
      return {
        form: "open-response",
        layout: "default",
        out: { stem: q.question || s.heading, modelAnswer: q.answer ? [q.answer] : [], notes },
      };
    case "discussion":
      return {
        form: "discussion",
        layout: "default",
        out: { prompt: q.question || s.heading, footnote: s.body, notes },
      };
    case "vocabulary":
      return {
        form: "vocabulary",
        layout: "default",
        out: {
          entries: s.items.map((t) => {
            const [term, definition] = labelled(t, ":");
            return { term, definition };
          }),
          notes,
        },
      };
  }
  return { form: "explain", layout: "default", out: { heading: s.heading, body: s.body, notes } };
}

export async function simpleLessonSlides(
  state: PipelineState,
  deps: PipelineDeps,
): Promise<PipelineState> {
  const base = state.lesson;
  const brief = base.brief;
  if (!brief) throw new Error("simple: the lesson has no brief");
  const slideCount = brief.slideCount ?? DEFAULT_SLIDE_COUNT;
  const themeId = base.themeId;
  const theme = getTheme(themeId);
  const armVersion =
    process.env.SIMPLE_ARM === "T3"
      ? TEACHER3_LESSON_VERSION
      : process.env.SIMPLE_ARM === "T2"
        ? TEACHER2_LESSON_VERSION
        : process.env.SIMPLE_ARM === "T"
          ? TEACHER_LESSON_VERSION
          : SIMPLE_LESSON_VERSION;
  const meta = (): MaterialiseMeta => ({
    promptVersion: armVersion,
    model: CODE_MODEL,
    at: deps.now().toISOString(),
  });
  const t0 = Date.now();
  const oracle = process.env.SIMPLE_ORACLE_FILE;
  let w: SimpleLesson;
  if (oracle) {
    w = simpleLessonSchema.parse(JSON.parse(readFileSync(oracle, "utf8")));
  } else {
    const answers = brief.answers
      ? Object.entries(brief.answers).map(([k, v]) => `${k}: ${v}`)
      : [];
    const context = [
      `Topic: ${brief.topic}`,
      audienceBlock(audienceOf(base)),
      ...(answers.length > 0 ? ["The teacher's answers:", ...answers] : []),
      // Lab ABLATE arm K: reference text (Oak lessons) as plain context after the brief.
      ...(process.env.SIMPLE_CONTEXT_FILE
        ? ["", readFileSync(process.env.SIMPLE_CONTEXT_FILE, "utf8").trim()]
        : []),
    ].join("\n");
    const input = { slideCount, topic: brief.topic, context };
    const arm = process.env.SIMPLE_ARM;
    const armT = arm === "T" || arm === "T2" || arm === "T3";
    // Lab ABLATE T3: the lesson's objectives are given (R3's, one JSON list per brief).
    const givenObjectives: string[] =
      arm === "T3"
        ? JSON.parse(readFileSync(process.env.SIMPLE_OBJECTIVES_FILE ?? "", "utf8"))
        : [];
    const teacherInput = {
      ...input,
      yearGroup: base.yearGroup ?? "",
      subject: base.subject ?? "",
      ageBand: audienceOf(base).ageBand,
    };
    const built =
      arm === "T3"
        ? teacher3Prompt({ ...teacherInput, objectives: givenObjectives })
        : arm === "T2"
          ? teacher2Prompt(teacherInput)
          : armT
            ? teacherPrompt(teacherInput)
            : simpleLessonPrompt(input);
    const version =
      arm === "T3"
        ? TEACHER3_LESSON_VERSION
        : arm === "T2"
          ? TEACHER2_LESSON_VERSION
          : armT
            ? TEACHER_LESSON_VERSION
            : SIMPLE_LESSON_VERSION;
    const schema = (
      arm === "T3"
        ? teacher3LessonSchema(base.subject)
        : arm === "T2"
          ? teacher2LessonSchema(base.subject)
          : armT
            ? teacherLessonSchema
            : simpleLessonSchema
    ) as z.ZodType<unknown>;
    // Lab ABLATE T2: SIMPLE_REPLAY_FILE redraws a logged call's output (no writing call, no new log line).
    const replay =
      process.env.SIMPLE_REPLAY_FILE ||
      (process.env.SIMPLE_REPLAY_DIR
        ? `${process.env.SIMPLE_REPLAY_DIR}/${deps.context.jobId}.calls.jsonl`
        : undefined);
    const call = replay
      ? (JSON.parse(readFileSync(replay, "utf8").split("\n")[0] ?? "{}") as Awaited<
          ReturnType<typeof callStructured>
        >)
      : await callStructured({
          deps,
          stage: "generate",
          cls: planClassFor(base, deps),
          effort: "low",
          prompt: { version, system: built.system, user: () => built.user },
          input,
          schema,
          maxOutputTokens: 16000,
        });
    // Lab ABLATE: the full request and the response, one line per call.
    const dir = process.env.SIMPLE_CALLS_DIR;
    const log = (row: Record<string, unknown>) => {
      if (!dir || replay) return;
      mkdirSync(dir, { recursive: true });
      appendFileSync(`${dir}/${deps.context.jobId}.calls.jsonl`, `${JSON.stringify(row)}\n`);
    };
    log({
      version,
      modelId: call.modelId,
      effort: "low",
      ms: Date.now() - t0,
      usage: call.usage,
      attempts: call.attempts,
      context,
      system: built.system,
      user: built.user,
      schema: z.toJSONSchema(schema),
      output: call.output,
    });
    if (arm === "T3") {
      // Coverage in code: every objective has a teaching slide and a slide whose question checks it.
      const t3 = structuredClone(call.output) as { titlePicture: unknown; slides: T3Slide[] };
      const n = givenObjectives.length;
      const writable = Math.max(0, slideCount - 2);
      t3.slides = t3.slides.slice(0, writable);
      const gaps = coverageGaps(t3.slides, n);
      const spares = spareSlides(t3.slides, n);
      const gap: Record<string, unknown> = { gaps, spares };
      if (gaps.length > 0 && spares.length > 0) {
        const ask = teacher3GapPrompt({
          context,
          objectives: givenObjectives,
          slides: t3.slides,
          gaps,
          spares,
          slideCount,
        });
        const gapSchema = teacher3GapSchema(base.subject, spares) as z.ZodType<unknown>;
        const t1 = Date.now();
        const re = replay
          ? (JSON.parse(readFileSync(replay, "utf8").split("\n")[1] ?? "{}") as Awaited<
              ReturnType<typeof callStructured>
            >)
          : await callStructured({
              deps,
              stage: "generate",
              cls: planClassFor(base, deps),
              effort: "low",
              prompt: { version: `${version}-gap`, system: built.system, user: () => ask.user },
              input: { ...input, gaps },
              schema: gapSchema,
              maxOutputTokens: 8000,
            });
        const used = new Set<number>();
        for (const r of (
          (re.output as { slides?: (T3Slide & { replaces: string })[] })?.slides ?? []
        ).slice(0, ask.count)) {
          const at = Number(r.replaces);
          if (used.has(at) || !spares.includes(at)) continue;
          used.add(at);
          const { replaces: _r, ...slide } = r;
          t3.slides[at - 3] = slide;
        }
        const after = coverageGaps(t3.slides, n);
        Object.assign(gap, { reasked: true, replaced: [...used], after });
        log({
          version: `${version}-gap`,
          modelId: re.modelId,
          effort: "low",
          ms: Date.now() - t1,
          usage: re.usage,
          attempts: re.attempts,
          gaps,
          spares,
          system: built.system,
          user: ask.user,
          schema: z.toJSONSchema(gapSchema),
          output: re.output,
          replaced: [...used],
          after,
        });
      }
      deps.logger.info({ stage: "generate", coverage: gap }, "t3 coverage");
      w = fromTeacher3(givenObjectives, t3);
    } else {
      w = armT ? fromTeacher(call.output as TeacherLesson) : (call.output as SimpleLesson);
    }
  }
  const writeMs = Date.now() - t0;
  const objectives = w.objectives.map((text, i) => ({ id: `o${i + 1}`, text }));
  const refs = objectives.map((o) => o.id);
  const [title0] = base.slides;
  if (!title0) throw new Error("simple: the plan step has not run");

  // Title as the candidate draws it: the picture beside or under it when a photo is found.
  const titleSpec = {
    kind: "title" as const,
    title: base.title,
    subtitle: [base.yearGroup, base.subject].filter(Boolean).join(" · ") || "Lesson",
    factRefs: refs,
  };
  const bareTitle = (): Slide => {
    const variant = withoutPicture(titleSpec, "split").variant;
    return variant && fitsPlanned(titleSpec, { variant, stepDown: 0 }).ok
      ? materialiseSlide(titleSpec, themeId, meta(), deps.ids, variant)
      : materialiseSlide(titleSpec, themeId, meta(), deps.ids);
  };
  const outline: OutlineEntry[] = [
    { id: "s1", kind: "title", factRefs: refs },
    { id: "s2", kind: "objectives", factRefs: refs },
  ] as OutlineEntry[];
  const briefOf = (p: { subject: string; named: string | null }): ImageBrief => ({
    subject: plainSubject(p.subject).slice(0, 60),
    mustShow: [],
    purpose: "context",
    ...(p.named ? { named: p.named, specific: true } : { specific: false }),
  });
  const facts: LessonFacts = {
    objectives,
    vocabulary: [],
    workedExamples: [],
    questions: [],
    misconceptions: [],
    outline,
    durationMin: brief.durationMin ?? 60,
  } as LessonFacts;
  let lesson: Lesson = { ...base, facts };
  const find = async (index: number, b: ImageBrief) => {
    const at = (x: ImageBrief) =>
      pickPhoto(
        {
          ...lesson,
          facts: {
            ...facts,
            // The slide's entry is not saved yet while the slides draw: one is made for the pick.
            outline: Array.from({ length: Math.max(outline.length, index + 1) }, (_, i) =>
              i === index
                ? ({
                    ...(outline[i] ?? { id: `s${i + 1}`, kind: "image-text", factRefs: refs }),
                    imageBrief: x,
                  } as OutlineEntry)
                : (outline[i] ??
                  ({ id: `s${i + 1}`, kind: "content", factRefs: refs } as OutlineEntry)),
            ),
          },
        },
        index,
        deps,
      ).catch(() => ({ outcome: "empty" as const }));
    let r = await at(b);
    const wider = r.outcome === "placed" || r.outcome === "busy" ? undefined : broadenedBrief(b);
    if (wider) r = await at(wider);
    return r.outcome === "placed" && "photo" in r ? r.photo : undefined;
  };
  const placeIn = (slide: Slide, photo: Parameters<typeof withPhoto>[1]): Slide =>
    ({
      ...slide,
      elements: slide.elements.map((e) =>
        e.type === "image" && e.src === PLACEHOLDER_IMAGE ? withPhoto(e, photo) : e,
      ),
    }) as Slide;

  /**
   * Arm T2: a drawn picture checked against the renderer's own schemas; one that does not parse
   * becomes a photo request on the same subject (logged in the report as invalidDrawing).
   */
  type Drawing =
    | { kind: "diagram"; spec: unknown }
    | { kind: "figure"; template: FigureTemplateName; values: unknown };
  const resolvePic = (
    p: Pic,
    heading: string,
  ): { drawing?: Drawing; photo?: { subject: string; named: string | null }; invalid?: string } => {
    if (p.kind === "diagram") {
      const spec = parseDiagram(p.spec);
      if (spec) return { drawing: { kind: "diagram", spec } };
      const o = (p.spec ?? {}) as { kind?: string; title?: string };
      return {
        photo: { subject: o.title || heading, named: null },
        invalid: `diagram ${o.kind ?? "?"}`,
      };
    }
    if (p.kind === "figure") {
      const name = p.template as FigureTemplateName;
      if (FIGURE_TEMPLATES[name]?.values.safeParse(p.values).success)
        return { drawing: { kind: "figure", template: name, values: p.values } };
      return { photo: { subject: heading, named: null }, invalid: `figure ${p.template}` };
    }
    return { photo: { subject: p.subject, named: p.named } };
  };
  /** A drawing in the slide's picture zone, where a photo would go (the drawing code R3 uses). */
  const placeDrawing = (slide: Slide, d: Drawing): Slide | undefined => {
    const at = slide.elements.findIndex((e) => e.type === "image" && e.src === PLACEHOLDER_IMAGE);
    const e = slide.elements[at];
    if (!e) return undefined;
    const rect = { x: e.x, y: e.y, w: e.w, h: e.h };
    const el =
      d.kind === "diagram"
        ? diagramElement(settleDiagram(d.spec, { w: rect.w, h: rect.h }).spec, theme, rect)
        : drawFigure(d.template, d.values, theme, rect);
    if (!el) return undefined;
    return { ...slide, elements: slide.elements.map((x, i) => (i === at ? el : x)) } as Slide;
  };

  const slides: Slide[] = [];
  const pv = w.titlePicture
    ? PICTURE_ORDER.find((v) => fitsPlanned(titleSpec, { variant: v, stepDown: 0 }).ok)
    : undefined;
  let title = pv ? materialiseSlide(titleSpec, themeId, meta(), deps.ids, pv) : bareTitle();
  const tp = w.titlePicture ? resolvePic(w.titlePicture, base.title) : undefined;
  const titleDrawn = pv && tp?.drawing ? placeDrawing(title, tp.drawing) : undefined;
  if (titleDrawn) title = titleDrawn;
  else if (pv && tp?.photo && deps.images) {
    const photo = await find(0, briefOf(tp.photo));
    title = photo ? placeIn(title, photo) : bareTitle();
  }
  slides.push({ ...title, id: title0.id });
  slides.push(
    materialiseSlide(
      { kind: "objectives", items: objectives.slice(0, 4).map((o) => o.text), factRefs: refs },
      themeId,
      meta(),
      deps.ids,
    ),
  );

  const report: Record<string, unknown>[] = [];
  const written = w.slides.slice(0, Math.max(0, slideCount - 2));
  const drawnAll = await Promise.all(
    written.map(async (s0, k) => {
      const index = k + 2;
      const s =
        armVersion === TEACHER2_LESSON_VERSION || armVersion === TEACHER3_LESSON_VERSION
          ? withPictureZone(s0)
          : s0;
      const { form, layout, out } = adapt(s);
      const drawOne = (f: string, o: Written): Slide => {
        const r = renderWritten(f, layout, o);
        const slide = materialiseSlide(r.spec, themeId, meta(), deps.ids, r.variant, r.structure);
        return isSetForm(f) ? withSetTag(withAnswersReveal(slide, themeId), f) : slide;
      };
      let slide: Slide;
      try {
        slide = drawOne(form, out);
      } catch (e) {
        report.push({ slide: index + 1, form, drawError: String(e).slice(0, 200) });
        slide = drawOne("explain", {
          heading: s.heading,
          body: [...s.body, ...s.items],
          notes: s.notes,
        });
      }
      const r = form === "photo" && s.picture ? resolvePic(s.picture, s.heading) : undefined;
      let placed = false;
      let drawn: string | undefined;
      if (r?.drawing) {
        const d = placeDrawing(slide, r.drawing);
        if (d) {
          slide = d;
          placed = true;
          drawn = r.drawing.kind;
        }
      }
      const pic = !placed && r?.photo ? briefOf(r.photo) : undefined;
      if (pic && deps.images) {
        const photo = await find(index, pic);
        if (photo) {
          slide = placeIn(slide, photo);
          placed = true;
        } else {
          const { imageBrief: _i, ...rest } = out;
          slide = drawOne("explain", rest);
        }
      }
      const fits = slideFits(slide, theme, 0).ok;
      report.push({
        slide: index + 1,
        form,
        fits,
        picture: placed,
        pictureDropped: !!s.picture && form !== "photo",
        ...(drawn ? { drawn } : {}),
        ...(r?.invalid ? { invalidDrawing: r.invalid } : {}),
      });
      return { slide, form, out, placed, pic };
    }),
  );
  drawnAll.forEach((d, k) => {
    const index = k + 2;
    const r = renderWritten(d.form === "photo" && !d.placed ? "explain" : d.form, "default", d.out);
    outline[index] = {
      id: `s${index + 1}`,
      // A drawn picture has no photo brief: its entry is the slide's own kind.
      kind: (d.placed && d.pic ? "image-text" : r.spec.kind) as OutlineEntry["kind"],
      factRefs: refs,
      ...(d.placed && d.pic ? { imageBrief: d.pic } : {}),
    } as OutlineEntry;
    slides.push(d.slide);
  });
  const generation = base.generation ?? {
    jobId: deps.context.jobId,
    stage: "planned" as const,
    startedAt: new Date(t0).toISOString(),
    promptVersions: {},
    usage: deps.budget.totals(),
    findings: [],
  };
  lesson = withUsage(
    {
      ...base,
      slides,
      facts: { ...facts, outline },
      generation: {
        ...generation,
        stage: "generated",
        promptVersions: {
          ...generation.promptVersions,
          planned: armVersion,
          generated: armVersion,
        },
        findings: [],
      },
    },
    deps,
  );
  await deps.persist(lesson);
  deps.logger.info(
    {
      stage: "generate",
      simple: { oracle: !!oracle, writeMs, totalMs: Date.now() - t0, slides: report },
    },
    "simple report",
  );
  return { ...state, lesson, checkedPerSlide: true };
}
