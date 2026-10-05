import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import {
  DEFAULT_SLIDE_COUNT,
  type FigureTemplateName,
  type ImageBrief,
  type Lesson,
  type LessonFacts,
  type OutlineEntry,
  type Slide,
  type Theme,
} from "@tj/domain/documents";
import {
  asFigureFull,
  bodyLineChars,
  boxH,
  drawFigure,
  EXTRA_FIGURES,
  FIGURE_FULL_CAPTION_LINES,
  FIGURE_TEMPLATES,
  figureFullCaptionChars,
  figureTemplatesFor,
  fitSlide,
  fitsPlanned,
  getTheme,
  isBackdrop,
  KIND_TAG_NAME,
  layoutsOf,
  type MaterialiseMeta,
  materialiseSlide,
  measureHeadless,
  type PaletteFormId,
  PLACEHOLDER_IMAGE,
  paletteSubjects,
  renderedHeights,
  SAFE,
  SAFE_BOTTOM,
  slideFits,
  withoutPicture,
} from "@tj/slides";
import {
  capacityLine,
  type DiagramZones,
  diagramCapacities,
  diagramElement,
  energyProfileOf,
  fittedDiagramElement,
  itemCount,
  parseDiagram,
  settleDiagram,
  tableDrawnHeight,
  tableDrawsWhole,
  withLongLabels,
  zoneShape,
} from "@tj/slides/diagrams";
import { z } from "zod";
import { callStructured } from "../call";
import { CODE_MODEL, withAnswersReveal } from "../planner/coded-slides";
import { audienceBlock } from "../prompts/shared";
import { withUsage } from "../stages/generate";
import { pickPhoto, plainSubject, withPhoto } from "../stages/illustrate";
import { audienceOf, planClassFor } from "../stages/shared";
import type { PipelineDeps, PipelineState, T3Report } from "../types";
import { DiagramSpecSchema } from "./diagram-spec";
import { ASKED_FORMS, fitLadder, fitWritten, renderWritten, type Written, withSetTag } from "./fit";
import { isSetForm } from "./menu";
import { broadenedBrief, NO_PICTURE_ROW, noPictureOf } from "./slide-check";

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
type LightSlide = Omit<z.infer<typeof lightSlide>, "picture"> & {
  picture: Pic | null;
  /** The big-diagram composition (DIAGRAM-AUDIT item 5): the drawing fills the slide. */
  full?: boolean;
};
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
/**
 * LAYOUT-TEST: T3's figures are the registered templates plus the lab's extra figures, and a
 * figure's scenes get menu lines of their own (the scene is a field on the figure's values).
 */
const T3_FIGURES: Record<string, (typeof FIGURE_TEMPLATES)[FigureTemplateName]> = {
  ...FIGURE_TEMPLATES,
  ...(EXTRA_FIGURES as unknown as Record<string, (typeof FIGURE_TEMPLATES)[FigureTemplateName]>),
};
const T3_EXTRA_FIGURE_DRAWS: Record<string, { subject: string; line: string }> = {
  "coordinate-distance": {
    subject: "maths",
    line: "two points on a squared grid with the run, the rise and the straight-line distance between them (Pythagoras on coordinates; whole-number coordinates from -12 to 12)",
  },
};
const T3_SCENE_LINES: Record<string, string[]> = {
  "right-triangle": [
    'figure right-triangle with scene "ladder": the triangle drawn as a ladder leaning against a wall',
    'figure right-triangle with scene "route": the triangle drawn as a route across a field, with the direct path',
  ],
};
/** The figures T3 offers a subject: the registered ones, then the lab's extras. */
function t3FiguresFor(subject?: string): string[] {
  const extras = Object.entries(T3_EXTRA_FIGURE_DRAWS)
    .filter(
      ([, e]) => subject === undefined || paletteSubjects(subject).includes(e.subject as never),
    )
    .map(([k]) => k);
  return [...figureTemplatesFor(subject), ...extras];
}
/** The figure menu lines: one per figure, then one per scene. */
function t3FigureLines(subject?: string): string[] {
  return t3FiguresFor(subject).flatMap((t) => [
    `- figure ${t}: ${FIGURE_DRAWS[t] ?? T3_EXTRA_FIGURE_DRAWS[t]?.line ?? t}`,
    ...(T3_SCENE_LINES[t] ?? []).map((l) => `- ${l}`),
  ]);
}
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
// t4 (5 Oct): + closing independent practice before the exit ticket (T3-LEDGER U4b).
export const TEACHER3_LESSON_VERSION = "simple-lesson.t7";
/**
 * lab/t3 (Greg, 5 Oct 2026: T3 is the candidate): the plan-write planner writes with T3 by default.
 * `PLAN_WRITE_MODE=stream` or `plan-write` runs R3 instead.
 */
export function t3Writer(): boolean {
  const m = process.env.PLAN_WRITE_MODE;
  return m !== "stream" && m !== "plan-write";
}
/** The simple writer's arm: T3 unless a lab run names another (S, T, T2). */
export function simpleArm(): string {
  return process.env.SIMPLE_ARM || "T3";
}

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
  "big-diagram": "a heading and one diagram filling the slide, with an optional one-line caption",
};
/*
 * Option capacity (lab/t3 round 2): the longest option, in characters, that a question form's
 * layouts hold on every theme at body size. Measured through the slide's own path (`adapt`, then
 * `fitWritten` on each of the form's layouts), so the menu line moves with the layout code. A hinge
 * gets 4 options (the palette's four cards); matching up to 3 pairs, each side measured alike.
 */
const CAPACITY_FORMS: Record<string, { count: number; line: (n: number) => string }> = {
  hinge: {
    count: 4,
    line: (n) =>
      `a multiple-choice question with 4 options, each up to ${n} characters (the options are the content; answer is the correct option)`,
  },
  matching: {
    count: 3,
    line: (n) =>
      `pupils match up to 3 pairs (content lines 'left = right', each side up to ${n} characters)`,
  },
};
const CAPACITY_STEM = "Which statement best explains why prices rose so quickly?";
const FILLER =
  "tax income fell but the government still paid striking workers so it printed money and prices rose every week".split(
    " ",
  );
function filler(n: number, k: number): string {
  let t = "";
  for (let i = k; t.length < n; i++) t += (t ? " " : "") + FILLER[i % FILLER.length];
  return t.slice(0, n).trimEnd();
}
function holdsOptions(form: string, count: number, n: number): boolean {
  const items = Array.from({ length: count }, (_, k) =>
    form === "matching" ? `${filler(n, k * 4)} = ${filler(n, k * 4 + 2)}` : filler(n, k * 3),
  );
  const { form: f, out } = adapt({
    form,
    heading: "Check your understanding",
    body: [],
    items,
    questions: [{ question: CAPACITY_STEM, answer: items[1] ?? "" }],
    picture: null,
    notes: "",
  });
  return layoutsOf(f as PaletteFormId).some((c) => {
    try {
      return fitWritten(f, c.layout, out).ok;
    } catch {
      return false;
    }
  });
}
const capacities = new Map<string, number>();
/** The form's option capacity in characters (binary search; memoised per process). */
export function optionCapacity(form: string): number | undefined {
  const spec = CAPACITY_FORMS[form];
  if (!spec) return undefined;
  const known = capacities.get(form);
  if (known !== undefined) return known;
  let lo = 8;
  let hi = 160;
  if (!holdsOptions(form, spec.count, lo)) return undefined;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (holdsOptions(form, spec.count, mid)) lo = mid;
    else hi = mid;
  }
  capacities.set(form, lo);
  return lo;
}
/** T3's menu lines: the form list, with each option capacity read from the layout code. */
export function t3Menu(themeId = T3_DEFAULT_THEME): string {
  const zones = t3ZoneLines(themeId);
  // big-diagram is read as a kind of picture slide, so it follows picture (LAYOUT-FIX ledger B1).
  const entries = Object.entries(T3_FORMS).filter(([k]) => k !== "big-diagram");
  const at = entries.findIndex(([k]) => k === "picture") + 1;
  entries.splice(at, 0, ["big-diagram", T3_FORMS["big-diagram"] as string]);
  return entries
    .map(([k, v]) => {
      const n = optionCapacity(k);
      const c = CAPACITY_FORMS[k];
      return `- ${k}: ${n !== undefined && c ? c.line(n) : (zones[k] ?? v)}`;
    })
    .join("\n");
}
/**
 * DIAGRAM-AUDIT item 6, LAYOUT-TEST: the picture forms' menu lines carry their zone's position,
 * shape and capacity, read from the slide's own layout (adapt, renderWritten, materialiseSlide,
 * and asFigureFull for the big diagram, on the default theme), so the line moves with the layout
 * code. Memoised per process.
 */
type Rect = { x: number; y: number; w: number; h: number };
/** The theme the menu is measured on when the deck's own is not given. */
const T3_DEFAULT_THEME = "chalk";
/**
 * The big diagram's zone as the menu states it: with three lines under the drawing, which every
 * LAYOUT-TEST drawing slide carried, so the stated shape and capacity hold for what is written.
 */
const BIG_SAMPLE_LINES = [
  "Solid: closely packed in a regular arrangement. Particles vibrate about fixed positions.",
  "Liquid: close together in an irregular arrangement. Particles move past each other.",
  "Gas: far apart with no regular arrangement. Particles move freely in all directions.",
];
const zoneGeometries = new Map<string, { picture: Rect; text: Rect; big: Rect }>();
export function t3ZoneGeometry(themeId = T3_DEFAULT_THEME): {
  picture: Rect;
  text: Rect;
  big: Rect;
} {
  const known = zoneGeometries.get(themeId);
  if (known) return known;
  const meta = { promptVersion: "zones", model: "code", at: "1970-01-01T00:00:00.000Z" };
  let n = 0;
  const ids = () => `z${n++}`;
  const a = adapt(
    withPictureZone({
      form: "photo",
      heading: "A slide heading",
      body: ["A line of slide text about this long"],
      items: [],
      questions: [],
      picture: { kind: "photo", subject: "x", named: null },
      notes: "",
    }),
  );
  const r = renderWritten(a.form, a.layout, a.out);
  const slide = materialiseSlide(r.spec, themeId, meta, ids, r.variant, r.structure);
  const a3 = adapt(
    withPictureZone({
      form: "photo",
      heading: "A slide heading",
      body: BIG_SAMPLE_LINES,
      items: [],
      questions: [],
      picture: { kind: "photo", subject: "x", named: null },
      notes: "",
    }),
  );
  const r3 = renderWritten(a3.form, a3.layout, a3.out);
  const three = materialiseSlide(r3.spec, themeId, meta, ids, r3.variant, r3.structure);
  const rect = (e: { x: number; y: number; w: number; h: number }) => ({
    x: e.x,
    y: e.y,
    w: e.w,
    h: e.h,
  });
  const img = (sl: Slide) =>
    sl.elements.find((e) => e.type === "image" && e.src === PLACEHOLDER_IMAGE);
  const pic = img(slide);
  const body = slide.elements.find(
    (e) => e.type === "text" && (e as { style?: { preset?: string } }).style?.preset === "body",
  );
  const big = img(asFigureFull(three, getTheme(themeId)) ?? slide);
  if (!pic || !body || !big) throw new Error("t3ZoneGeometry: no picture zone on the photo layout");
  const geometry = {
    picture: rect(pic),
    text: { ...rect(body), h: SAFE_BOTTOM - body.y },
    big: rect(big),
  };
  zoneGeometries.set(themeId, geometry);
  return geometry;
}
/** The drawing zones a capacity is measured in, from the layout on `themeId`. */
export function t3DrawingZones(themeId = T3_DEFAULT_THEME): DiagramZones {
  const g = t3ZoneGeometry(themeId);
  return { half: { w: g.picture.w, h: g.picture.h }, full: { w: g.big.w, h: g.big.h } };
}
/**
 * LAYOUT-TEST fix 4: every number on these lines is measured on the deck's theme with the ruler
 * (characters and lines of body text, the zones' shapes), not estimated from a font size.
 */
function t3ZoneLines(themeId = T3_DEFAULT_THEME): Record<string, string> {
  const t = getTheme(themeId);
  const g = t3ZoneGeometry(themeId);
  let lines = 1;
  while (boxH(t, "body", lines + 1) <= g.text.h) lines++;
  const chars = bodyLineChars(t, g.text.w);
  return {
    picture: `2–3 lines in a column on the right (about ${chars} characters wide, room for ${lines} lines), the picture on the left (${zoneShape(g.picture.w, g.picture.h)})`,
    // LAYOUT-FIX ledger B1: named as the picture form at full width, its lines kept, beside it.
    "big-diagram": `the picture form with the picture across the slide under the heading (${zoneShape(g.big.w, g.big.h)}) and its 2–3 lines below it (room for ${FIGURE_FULL_CAPTION_LINES} lines of about ${figureFullCaptionChars(t)} characters), for a drawing of a sequence, a process or panels side by side`,
  };
}

export { t3ZoneLines };

const phrase = (what: string) => z.string().describe(what);
/** The lean wire shape of each drawing kind (no alt: code writes it from the title and labels). */
const T3_DRAW = {
  timeline: z.object({
    kind: z.literal("timeline"),
    title: phrase("one short line"),
    events: z
      .array(z.object({ date: phrase("a date"), text: phrase("a short phrase") }))
      .min(2)
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
          style: z.enum(["line", "bars", "tangent"]),
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
  "bar-chart": z.object({
    kind: z.literal("bar-chart"),
    title: phrase("one short line"),
    style: z.enum(["bars", "pictogram", "tally"]),
    bars: z
      .array(z.object({ label: phrase("1–2 words"), value: z.number() }))
      .min(1)
      .max(8),
    per: z.number().optional(),
  }),
  pie: z.object({
    kind: z.literal("pie"),
    title: phrase("one short line"),
    slices: z
      .array(z.object({ label: phrase("1–2 words"), value: z.number() }))
      .max(6)
      .optional(),
    parts: z.number().optional(),
    shaded: z.number().optional(),
  }),
  venn: z.object({
    kind: z.literal("venn"),
    title: phrase("one short line"),
    sets: z.array(phrase("1–3 words")).min(2).max(3),
    items: z.array(z.object({ text: phrase("1–2 words"), in: z.array(z.number()) })).max(12),
  }),
  carroll: z.object({
    kind: z.literal("carroll"),
    title: phrase("one short line"),
    rows: z.array(phrase("1–3 words")).length(2),
    cols: z.array(phrase("1–3 words")).length(2),
    cells: z.array(z.array(z.array(phrase("1–2 words")))),
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
  "bar-chart": "a bar chart, pictogram or tally chart of counts in named categories",
  pie: "a pie chart of shares, or a circle in equal parts with some shaded",
  venn: "a Venn diagram sorting items into 2 or 3 overlapping sets",
  carroll: "a Carroll diagram sorting items by two yes/no properties",
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
    (t) =>
      ![
        "states",
        "diffusion",
        "dissolving",
        "line",
        "bars",
        "tangent",
        "pictogram",
        "tally",
      ].includes(t),
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
  const figures = t3FiguresFor(subject).map((t) =>
    z.object({
      kind: z.literal("figure"),
      template: z.literal(t),
      values: (T3_FIGURES[t] as (typeof FIGURE_TEMPLATES)[FigureTemplateName]).shape,
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

export function teacher3Prompt(
  i: Parameters<typeof teacherPrompt>[0] & { objectives: string[]; themeId?: string },
): {
  system: string;
  user: string;
} {
  const theme = i.themeId ?? T3_DEFAULT_THEME;
  const [lo, hi] = PICTURE_SHARE[(i.ageBand ?? "ks3").toLowerCase()] ?? [0.35, 0.5];
  const menu = t3Menu(theme);
  const drawn = [
    ...Object.entries(T3_DRAWS).map(([k, v]) => {
      const cap = capacityLine(k, t3DrawingZones(theme), [getTheme(theme)]);
      return `- ${k}: ${v}${cap ? ` (${cap})` : ""}`;
    }),
    ...t3FigureLines(i.subject),
  ].join("\n");
  return {
    system: "You're an expert teacher in England.",
    user: `${i.context}

These are the lesson's objectives, and the lesson teaches each one:
${numbered(i.objectives)}

Exactly ${i.slideCount} slides. Slide 1 (the title) and slide 2 (the objectives) are made from the objectives, so write slides 3 to ${i.slideCount}.
Teach each objective, then check it with a real question pupils answer. Share the slides by need: a harder objective gets more of them. Stay within the objectives. Where the slide count allows, the lesson ends with practice pupils do on their own, before the exit ticket.
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
  whole?: boolean;
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
  const count = i.whole
    ? i.spares.length
    : Math.min(
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
${t3Menu()}

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
export function fromTeacher3(
  objectives: string[],
  t: { titlePicture: unknown; slides: T3Slide[] },
) {
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

/**
 * lab/t3: a T3 slide through lab/cand-fix's fit ladder before it is drawn, so none is saved
 * overflowing: as written when it fits; else another layout of the form; else the picture form's
 * no-picture sibling (full width); else whole units (lines, steps, questions with their answers)
 * moved to the notes word for word. Never summarised or split. A form the ladder cannot judge, or
 * one no rung fits, falls to the explain form with every line it had, laddered the same way.
 */
export function t3Fit(
  form: string,
  layout: string,
  out: Written,
  /** The slide's questions as written: an open response that fits no layout is set as a check. */
  questions: { question: string; answer: string }[] = [],
): ReturnType<typeof fitLadder> & { fits: boolean } {
  const judged = (f: string, l: string, o: Written) => {
    try {
      return fitWritten(f, l, o).ok;
    } catch {
      return false;
    }
  };
  let ladder: ReturnType<typeof fitLadder> | undefined;
  try {
    ladder = fitLadder(
      form,
      layout,
      out,
      form === "photo" ? { ...NO_PICTURE_ROW, of: noPictureOf } : undefined,
    );
  } catch {
    ladder = undefined;
  }
  if (ladder && ladder.rung !== "unfit")
    return {
      ...ladder,
      fits: ladder.rung === "compact" || judged(ladder.form, ladder.layout, ladder.out),
    };
  // lab/t3 fit-fix: a question never falls to explain (its options and answer would be flattened
  // into the teaching text). An open response that fits no layout is set as a check of every
  // question it was written with (a layout change; no word leaves the slide); else it stays as it
  // is, unfit, for the hard-failure log.
  if (ASKED_FORMS.has(form)) {
    if (form === "open-response" && questions.length > 0) {
      const l2 = fitLadder("check-set", "default", { questions, notes: out.notes ?? "" });
      if (l2.rung !== "unfit") return { ...l2, rung: "layout", fits: true };
    }
    return { form, layout, out, rung: "unfit", moved: [], fits: false };
  }
  const lines = (v: unknown): string[] =>
    Array.isArray(v)
      ? v.flatMap((x) =>
          typeof x === "string"
            ? [x]
            : x && typeof x === "object"
              ? [
                  Object.values(x as Record<string, unknown>)
                    .filter((y) => typeof y === "string")
                    .join(": "),
                ]
              : [],
        )
      : typeof v === "string" && v.trim()
        ? [v]
        : [];
  if (form !== NO_PICTURE_ROW.form && typeof out.heading === "string") {
    const { notes, heading, imageBrief: _i, ...rest } = out;
    const body = Object.values(rest).flatMap(lines).filter(Boolean);
    const plain: Written = { heading, body, notes: notes ?? "" };
    try {
      const l2 = fitLadder(NO_PICTURE_ROW.form, NO_PICTURE_ROW.layout, plain);
      if (l2.rung !== "unfit")
        return { ...l2, rung: "sibling", fits: judged(l2.form, l2.layout, l2.out) };
    } catch {}
  }
  return {
    form,
    layout,
    out,
    rung: "unfit",
    moved: [],
    fits: judged(form, layout, out),
  };
}

/**
 * lab/t3: a diagram in the slide's picture zone, long labels fitted (wrapped or a step smaller)
 * before it is given up; `reasons` say why one could not be drawn, for the log.
 */
export function placeT3Diagram(
  slide: Slide,
  spec: unknown,
  theme: ReturnType<typeof getTheme>,
  ids?: () => string,
): { slide?: Slide; stretched: boolean; reasons: string[] } {
  const at = slide.elements.findIndex((e) => e.type === "image" && e.src === PLACEHOLDER_IMAGE);
  const e = slide.elements[at];
  if (!e) return { stretched: false, reasons: ["the slide has no picture zone"] };
  // lab/t3 fit-fix: a table cut at its smallest size is not drawn (the slide loses the picture).
  if (!tableDrawsWhole(spec, theme, e.w, e.h))
    return { stretched: false, reasons: ["the table is cut at its smallest size"] };
  const r = fittedDiagramElement(spec, theme, { x: e.x, y: e.y, w: e.w, h: e.h }, ids);
  if (!r.ok) return { stretched: false, reasons: r.reasons };
  return {
    slide: {
      ...slide,
      elements: slide.elements.map((x, i) => (i === at ? r.element : x)),
    } as Slide,
    stretched: r.stretched,
    reasons: [],
  };
}

/**
 * lab/t3 fit-fix: a table too wide for the picture zone steps up to the full width: the words as
 * one column of points, full width, and the table whole under them, on the lesson's theme.
 * When the words leave it no room, whole lines of the body move to the notes word for word, from the
 * end (the ladder's own rung for teaching text), never the first. Undefined when it still does not
 * fit (the caller logs a hard failure).
 */
export function t3TableBelow(
  out: Written,
  spec: unknown,
  theme: ReturnType<typeof getTheme>,
  ids: () => string = () => Math.random().toString(36).slice(2),
  meta: MaterialiseMeta = { promptVersion: "fit", model: "code", at: "1970-01-01T00:00:00.000Z" },
): { slide: Slide; out: Written; moved: string[] } | undefined {
  const body = Array.isArray(out.body) ? (out.body as string[]) : [];
  for (let k = 0; k < Math.max(1, body.length); k++) {
    const moved = body.slice(body.length - k);
    const notes = [typeof out.notes === "string" ? out.notes.trim() : "", ...moved]
      .filter(Boolean)
      .join("\n");
    const o: Written = { ...out, body: body.slice(0, body.length - k), notes };
    // The words as one column of points (explain's look sets a line in a side panel to the foot).
    const { body: lines, ...rest } = o;
    const r = renderWritten("list", "default", { ...rest, body: [], points: lines });
    const plain = materialiseSlide(r.spec, theme.id, meta, ids, r.variant, r.structure);
    const fitted = fitSlide(plain, theme).slide;
    // Each box at the height its words take (a body box may run to the foot of the slide).
    const drawn = renderedHeights(fitted, measureHeadless(theme));
    // Everything drawn on the slide's face (words and the cards they sit on), not its chrome.
    const words = drawn.elements.filter(
      (e) =>
        e.name !== KIND_TAG_NAME &&
        e.name !== "Accent bar" &&
        !isBackdrop(e) &&
        !(e.revealStep ?? 0) &&
        e.y < SAFE_BOTTOM,
    );
    const top = Math.ceil(Math.max(0, ...words.map((e) => e.y + e.h))) + 16;
    const h = tableDrawnHeight(spec, theme, SAFE.w, SAFE_BOTTOM - top);
    if (h === undefined) continue;
    const el = diagramElement(spec, theme, { x: SAFE.x, y: top, w: SAFE.w, h }, ids);
    if (!el) continue;
    const slide = { ...fitted, elements: [...fitted.elements, el] } as Slide;
    if (slideFits(slide, theme, 0).ok) return { slide, out: o, moved };
  }
  return undefined;
}

/**
 * DIAGRAM-AUDIT item 5: the slide a T3 drawing is placed on. A big-diagram slide takes the
 * figure-full composition; a picture slide whose drawing does not draw cleanly in the half zone
 * (on every theme) steps up to it when its words allow (a one-line caption), before any label
 * shrinks. Otherwise the slide as it is.
 */
export function t3DiagramBase(slide: Slide, spec: unknown, theme: Theme, full: boolean): Slide {
  const zone = (sl: Slide) =>
    sl.elements.find((e) => e.type === "image" && e.src === PLACEHOLDER_IMAGE);
  const clean = (sl: Slide) => {
    const e = zone(sl);
    return !!e && withLongLabels(() => settleDiagram(spec, { w: e.w, h: e.h }).clean);
  };
  // The renderer-derived capacity routes an over-full spec straight to the big diagram.
  const kind = (spec as { kind?: string } | null)?.kind ?? "";
  const at = zone(slide);
  const zones = at
    ? { half: { w: at.w, h: at.h }, full: t3DrawingZones(theme.id).full }
    : t3DrawingZones(theme.id);
  const over =
    (itemCount(spec) ?? 0) >
    (diagramCapacities(zones, [theme])[kind]?.half ?? Number.POSITIVE_INFINITY);
  if (!full && !over && clean(slide)) return slide;
  // The drawing needs the full zone here: lines past the caption's cap go to the notes.
  const big = asFigureFull(slide, theme, { spill: true });
  if (!big) return slide;
  return full || clean(big) ? big : slide;
}

/**
 * lab/t3: whether the slides after the title and objectives can hold a teaching slide and a check
 * for every objective (two per objective); the line for the generation summary when they cannot.
 */
export function t3Room(objectives: number, writable: number): string | undefined {
  return writable < 2 * objectives ? `slide count too low for ${objectives} objectives` : undefined;
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
  if (!s.picture) return s.form === "big-diagram" ? { ...s, form: "explain" } : s;
  if (s.form === "big-diagram")
    return { ...s, form: "photo", body: [...s.body, ...s.items], items: [], full: true };
  if (s.form === "explain" || s.form === "explain-callout") {
    const body =
      s.form === "explain" ? s.body : [...s.body, ...s.items.map((t) => `Common mistake: ${t}`)];
    return { ...s, form: "photo", body, items: [] };
  }
  // DIAGRAM-AUDIT #1: a drawing on a form with no picture zone (a worked example's steps, a
  // sequence, a comparison) was dropped silently (12 of 42 T drawings). It goes to the picture
  // form with its lines beside the drawing, in order; the fit ladder moves whole lines to the
  // notes when they do not fit. A photo stays dropped here: the words are the point there.
  const drawing = s.picture.kind === "diagram" || s.picture.kind === "figure";
  if (drawing && DRAWING_TAKES_ZONE.has(s.form))
    return { ...s, form: "photo", body: [...s.body, ...s.items], items: [] };
  return s;
}
/** Forms whose drawing moves to the picture form rather than being dropped. */
const DRAWING_TAKES_ZONE = new Set(["worked-example", "sequence", "compare"]);

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
      // lab/t3 fit-fix: an open response written with several questions is set as a check of them
      // all (the form holds one stem); no question is dropped.
      if (s.questions.length > 1)
        return { form: "check-set", layout: "default", out: { questions: s.questions, notes } };
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

/**
 * T3's coverage gate: every objective has a teaching slide and a slide whose question checks it.
 * On a gap, one re-ask writes just the missing slides, each replacing a slide code found can go.
 */
async function t3Gate(i: {
  deps: PipelineDeps;
  base: Lesson;
  system: string;
  context: string;
  input: Record<string, unknown>;
  objectives: string[];
  slides: T3Slide[];
  slideCount: number;
  log: (row: Record<string, unknown>) => void;
  replay?: string | undefined;
}): Promise<{
  slides: T3Slide[];
  replaced: number[];
  before: ReturnType<typeof coverageGaps>;
  after: ReturnType<typeof coverageGaps>;
  room?: string;
}> {
  const slides = [...i.slides];
  const n = i.objectives.length;
  const gaps = coverageGaps(slides, n);
  // No slide can go without opening a new gap (a short deck): the re-ask may rewrite every slide.
  const free = spareSlides(slides, n);
  const whole = free.length === 0;
  const spares = whole ? slides.map((_, k) => k + 3) : free;
  const gap: Record<string, unknown> = { gaps, spares, whole };
  const used = new Set<number>();
  if (gaps.length > 0 && spares.length > 0) {
    const ask = teacher3GapPrompt({
      context: i.context,
      objectives: i.objectives,
      slides,
      gaps,
      spares,
      slideCount: i.slideCount,
      whole,
    });
    const gapSchema = teacher3GapSchema(i.base.subject, spares) as z.ZodType<unknown>;
    const t1 = Date.now();
    const version = `${TEACHER3_LESSON_VERSION}-gap`;
    const re = i.replay
      ? (JSON.parse(readFileSync(i.replay, "utf8").split("\n")[1] ?? "{}") as Awaited<
          ReturnType<typeof callStructured>
        >)
      : await callStructured({
          deps: i.deps,
          stage: "generate",
          cls: planClassFor(i.base, i.deps),
          effort: "low",
          prompt: { version, system: i.system, user: () => ask.user },
          input: { ...i.input, gaps },
          schema: gapSchema,
          maxOutputTokens: 8000,
        });
    for (const r of (
      (re.output as { slides?: (T3Slide & { replaces: string })[] })?.slides ?? []
    ).slice(0, ask.count)) {
      const at = Number(r.replaces);
      if (used.has(at) || !spares.includes(at)) continue;
      used.add(at);
      const { replaces: _r, ...slide } = r;
      slides[at - 3] = slide;
    }
    const after = coverageGaps(slides, n);
    Object.assign(gap, { reasked: true, replaced: [...used], after });
    i.log({
      version,
      modelId: re.modelId,
      effort: "low",
      ms: Date.now() - t1,
      usage: re.usage,
      attempts: re.attempts,
      gaps,
      spares,
      system: i.system,
      user: ask.user,
      schema: z.toJSONSchema(gapSchema),
      output: re.output,
      replaced: [...used],
      after,
    });
  }
  // lab/t3: teach + check for every objective needs two slides each; when the count cannot hold
  // them the summary says so (the brief's slide count, not the writing, is the limit).
  const room = t3Room(n, i.slideCount - 2);
  const after = coverageGaps(slides, n);
  gap.room = room ?? "ok";
  gap.after = after;
  i.deps.logger.info({ stage: "generate", coverage: gap }, "t3 coverage");
  return { slides, replaced: [...used], before: gaps, after, ...(room ? { room } : {}) };
}

export async function simpleLessonSlides(
  state: PipelineState,
  deps: PipelineDeps,
): Promise<PipelineState> {
  // Lab ABLATE T3S: the same T3 call streamed; slides saved as they close, photos off the writing path.
  // lab/t3: T3 streams by default; SIMPLE_STREAM=0 runs the one-shot lab arm.
  if (simpleArm() === "T3" && process.env.SIMPLE_STREAM !== "0") return t3Streamed(state, deps);
  const base = state.lesson;
  const brief = base.brief;
  if (!brief) throw new Error("simple: the lesson has no brief");
  const slideCount = brief.slideCount ?? DEFAULT_SLIDE_COUNT;
  const themeId = base.themeId;
  const theme = getTheme(themeId);
  const armVersion =
    simpleArm() === "T3"
      ? TEACHER3_LESSON_VERSION
      : simpleArm() === "T2"
        ? TEACHER2_LESSON_VERSION
        : simpleArm() === "T"
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
    const arm = simpleArm();
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
        ? teacher3Prompt({ ...teacherInput, objectives: givenObjectives, themeId: base.themeId })
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
      const t3 = structuredClone(call.output) as { titlePicture: unknown; slides: T3Slide[] };
      t3.slides = t3.slides.slice(0, Math.max(0, slideCount - 2));
      const gate = await t3Gate({
        deps,
        base,
        system: built.system,
        context,
        input,
        objectives: givenObjectives,
        slides: t3.slides,
        slideCount,
        log,
        replay,
      });
      t3.slides = gate.slides;
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
      if (T3_FIGURES[name]?.values.safeParse(p.values).success)
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

/**
 * Arm T3S (5 Oct 2026): T3's one call streamed. A slide is drawn and saved the moment the next one
 * starts; a drawing renders in code at once; a photo search starts the moment its request has
 * streamed and fills the pending zone when it lands (an empty search redraws the slide as explain).
 * The lesson is editable once every text slide is saved and the coverage gate has run, never
 * waiting on a photo. Times (ms from start) are logged as "t3 times".
 */
async function t3Streamed(state: PipelineState, deps: PipelineDeps): Promise<PipelineState> {
  const base = state.lesson;
  const brief = base.brief;
  if (!brief) throw new Error("simple: the lesson has no brief");
  const [title0] = base.slides;
  if (!title0) throw new Error("simple: the plan step has not run");
  const slideCount = brief.slideCount ?? DEFAULT_SLIDE_COUNT;
  const writable = Math.max(0, slideCount - 2);
  const themeId = base.themeId;
  const theme = getTheme(themeId);
  const version = TEACHER3_LESSON_VERSION;
  const meta = (): MaterialiseMeta => ({
    promptVersion: version,
    model: CODE_MODEL,
    at: deps.now().toISOString(),
  });
  const t0 = Date.now();
  const times: Record<string, number> = {};
  const mark = (k: string) => {
    times[k] ??= Date.now() - t0;
  };
  // The lesson's objectives: the plan step's (lab/t3 default), or a lab file (ABLATE: R3's).
  const file = process.env.SIMPLE_OBJECTIVES_FILE;
  const saved = base.facts?.objectives ?? [];
  const given: string[] = file ? JSON.parse(readFileSync(file, "utf8")) : saved.map((o) => o.text);
  if (given.length === 0) throw new Error("t3: the lesson has no objectives");
  const objectives = file ? given.map((text, i) => ({ id: `o${i + 1}`, text })) : saved;
  const refs = objectives.map((o) => o.id);
  const titleSpec = {
    kind: "title" as const,
    title: base.title,
    subtitle: [base.yearGroup, base.subject].filter(Boolean).join(" · ") || "Lesson",
    factRefs: refs,
  };
  const outline: OutlineEntry[] = [
    { id: "s1", kind: "title", factRefs: refs },
    { id: "s2", kind: "objectives", factRefs: refs },
  ] as OutlineEntry[];
  const facts = {
    objectives,
    vocabulary: [],
    workedExamples: [],
    questions: [],
    misconceptions: [],
    outline,
    durationMin: brief.durationMin ?? 60,
  } as LessonFacts;
  const generation = base.generation ?? {
    jobId: deps.context.jobId,
    stage: "planned" as const,
    startedAt: new Date(t0).toISOString(),
    promptVersions: {},
    usage: deps.budget.totals(),
    findings: [],
  };
  const deck: (Slide | undefined)[] = [];
  let stage: "planned" | "generated" = "planned";
  let lesson: Lesson = { ...base, facts };
  let chain: Promise<unknown> = Promise.resolve();
  /** Save the contiguous run of drawn slides (they arrive in order; a photo replaces in place). */
  const save = (after?: () => void) => {
    chain = chain.then(async () => {
      const upTo = deck.findIndex((x) => !x);
      const slides = (upTo < 0 ? deck : deck.slice(0, upTo)) as Slide[];
      lesson = withUsage(
        {
          ...base,
          slides,
          facts: { ...facts, outline },
          generation: {
            ...generation,
            stage,
            promptVersions: { ...generation.promptVersions, planned: version, generated: version },
            findings: [],
          },
        },
        deps,
      );
      await deps.persist(lesson);
      after?.();
    });
    return chain;
  };
  const briefOf = (p: { subject: string; named: string | null }): ImageBrief => ({
    subject: plainSubject(p.subject).slice(0, 60),
    mustShow: [],
    purpose: "context",
    ...(p.named ? { named: p.named, specific: true } : { specific: false }),
  });
  const find = async (index: number, b: ImageBrief) => {
    const at = (x: ImageBrief) =>
      pickPhoto(
        {
          ...lesson,
          facts: {
            ...facts,
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
  const photos: Promise<unknown>[] = [];
  const report: Record<string, unknown>[] = [];
  const round: number[] = [];

  // Title and objectives are known before the call: saved at once (bare title; its photo fills later).
  const bareTitle = (): Slide => {
    const variant = withoutPicture(titleSpec, "split").variant;
    return variant && fitsPlanned(titleSpec, { variant, stepDown: 0 }).ok
      ? materialiseSlide(titleSpec, themeId, meta(), deps.ids, variant)
      : materialiseSlide(titleSpec, themeId, meta(), deps.ids);
  };
  deck[0] = { ...bareTitle(), id: title0.id };
  const objectivesSlide = materialiseSlide(
    { kind: "objectives", items: objectives.slice(0, 4).map((o) => o.text), factRefs: refs },
    themeId,
    meta(),
    deps.ids,
  );
  // The plan step's objectives slide keeps its id, so the editor keeps it.
  const shown = base.slides[1];
  deck[1] = shown?.kind === "objectives" ? { ...objectivesSlide, id: shown.id } : objectivesSlide;
  void save(() => mark("title"));
  let titleAsked = false;
  const startTitle = (p: { subject?: string; named?: string | null } | null | undefined) => {
    titleAsked = true;
    const pv = PICTURE_ORDER.find((v) => fitsPlanned(titleSpec, { variant: v, stepDown: 0 }).ok);
    if (!p?.subject || !pv || !deps.images) return;
    const pic = briefOf({ subject: p.subject, named: p.named ?? null });
    photos.push(
      find(0, pic).then((photo) => {
        if (!photo) return;
        deck[0] = {
          ...placeIn(materialiseSlide(titleSpec, themeId, meta(), deps.ids, pv), photo),
          id: title0.id,
        };
        mark("lastPicture");
        return save();
      }),
    );
  };

  /** Draw slide k (0-based among slides 3..N) and save it; a photo request starts its search now. */
  const drawSlide = (k: number, raw: T3Slide) => {
    const index = k + 2;
    round[index] = (round[index] ?? 0) + 1;
    const gen = round[index];
    const t: T3Slide = {
      objectives: raw.objectives ?? [],
      form: raw.form ?? "explain",
      heading: raw.heading ?? "",
      content: raw.content ?? [],
      questions: (raw.questions ?? []).map((q) => ({
        question: q?.question ?? "",
        answer: q?.answer ?? "",
      })),
      picture: raw.picture ?? null,
      notes: raw.notes ?? "",
    };
    const [light] = fromTeacher3(given, { titlePicture: null, slides: [t] }).slides;
    if (!light) return;
    const s = withPictureZone(light);
    const adapted = adapt(s);
    // lab/t3: no slide saved overflowing (cand-fix's fit ladder; units move to the notes whole).
    const fitted = t3Fit(adapted.form, adapted.layout, adapted.out, s.questions);
    const { form, layout, out } = fitted;
    const drawOne = (f: string, o: Written, l: string = layout): Slide => {
      const r = renderWritten(f, l, o);
      const slide = materialiseSlide(r.spec, themeId, meta(), deps.ids, r.variant, r.structure);
      return isSetForm(f) ? withSetTag(withAnswersReveal(slide, themeId), f) : slide;
    };
    /** The no-picture explain form, laddered the same way. */
    const drawPlain = (o: Written): Slide => {
      const q = t3Fit("explain", "default", o);
      if (!q.fits) report.push({ slide: index + 1, form: "explain", fits: false, ladder: q.rung });
      return drawOne(q.form, q.out, q.layout);
    };
    const { imageBrief: _i, ...plain } = out;
    let slide: Slide;
    try {
      slide = drawOne(form, out);
    } catch (e) {
      report.push({ slide: index + 1, form, drawError: String(e).slice(0, 200) });
      slide = drawPlain({
        heading: s.heading,
        body: [...s.body, ...s.items],
        notes: s.notes,
      });
    }
    if (fitted.rung !== "none" || !fitted.fits)
      deps.logger.info(
        {
          stage: "generate",
          call: "fit-ladder",
          slide: index + 1,
          rung: fitted.rung,
          fits: fitted.fits,
          moved: fitted.moved.length,
          from: [adapted.form, adapted.layout],
          to: [form, layout],
        },
        "t3 fit ladder",
      );
    if (!fitted.fits && ASKED_FORMS.has(adapted.form))
      deps.logger.warn(
        { stage: "generate", slide: index + 1, form: adapted.form, hardFailure: true },
        "t3 question does not fit",
      );
    const p0 = form === "photo" ? s.picture : null;
    // DIAGRAM-AUDIT #4: an energy profile written as a line graph is drawn as the energy-profile
    // figure (a smooth curve with Ea and ΔH), not a jagged polyline with labels across it.
    const ep = p0?.kind === "diagram" ? energyProfileOf(p0.spec) : undefined;
    const p: Pic | null =
      ep && FIGURE_TEMPLATES["energy-profile"].values.safeParse(ep).success
        ? { kind: "figure", template: "energy-profile", values: ep }
        : p0;
    let drawn: string | undefined;
    let invalid: string | undefined;
    let photoAsk: { subject: string; named: string | null } | undefined;
    let longLabels = false;
    if (p && p.kind === "diagram") {
      // lab/t3: long labels are wrapped or set a step smaller before the drawing is given up.
      const d = placeT3Diagram(
        t3DiagramBase(slide, p.spec, theme, !!s.full),
        p.spec,
        theme,
        deps.ids,
      );
      if (d.slide) {
        slide = d.slide;
        drawn = "diagram";
        longLabels = d.stretched;
      } else {
        const o = (p.spec ?? {}) as { kind?: string; title?: string };
        invalid = `diagram ${o.kind ?? "?"}`;
        // A table that will not draw whole is words, not a scene: the slide loses the picture
        // (drawn full width) rather than asking for a photo of a table's title.
        if (o.kind === "table") {
          // lab/t3 fit-fix: a table never vanishes: full width under the words, else logged.
          const below = t3TableBelow(plain, p.spec, theme, deps.ids, meta());
          slide = below?.slide ?? drawPlain(plain);
          if (below) {
            drawn = "diagram";
            invalid = undefined;
          } else
            deps.logger.warn(
              { stage: "generate", slide: index + 1, kind: "table", hardFailure: true },
              "t3 table does not fit",
            );
        } else photoAsk = { subject: o.title || s.heading, named: null };
        deps.logger.warn(
          { stage: "generate", slide: index + 1, kind: o.kind, reasons: d.reasons.slice(0, 6) },
          "t3 drawing not drawn",
        );
      }
    } else if (p && p.kind === "figure") {
      const name = p.template as FigureTemplateName;
      const el = T3_FIGURES[name]?.values.safeParse(p.values).success
        ? (() => {
            const at = slide.elements.findIndex(
              (e) => e.type === "image" && e.src === PLACEHOLDER_IMAGE,
            );
            const e = slide.elements[at];
            const f = e
              ? drawFigure(name, p.values, theme, { x: e.x, y: e.y, w: e.w, h: e.h })
              : undefined;
            return f
              ? ({ ...slide, elements: slide.elements.map((x, i) => (i === at ? f : x)) } as Slide)
              : undefined;
          })()
        : undefined;
      if (el) {
        slide = el;
        drawn = "figure";
      } else {
        invalid = `figure ${p.template}`;
        photoAsk = { subject: s.heading, named: null };
      }
    } else if (p)
      photoAsk = {
        subject: (p as { subject: string }).subject,
        named: (p as { named: string | null }).named,
      };
    if (photoAsk && !deps.images) {
      slide = drawPlain(plain);
      photoAsk = undefined;
    }
    const zoneEl = slide.elements.find((e) => e.type === "image" && e.src === PLACEHOLDER_IMAGE);
    const pic = photoAsk
      ? {
          ...briefOf(photoAsk),
          ...(zoneEl ? { aspect: Math.round((zoneEl.w / zoneEl.h) * 100) / 100 } : {}),
        }
      : undefined;
    outline[index] = {
      id: `s${index + 1}`,
      kind: (pic
        ? "image-text"
        : renderWritten(form === "photo" && !drawn ? "explain" : form, "default", out).spec
            .kind) as OutlineEntry["kind"],
      factRefs: refs,
      ...(pic ? { imageBrief: pic } : {}),
    } as OutlineEntry;
    deck[index] = slide;
    void save(() => {
      if (index === 2) mark("firstContent");
    });
    report.push({
      slide: index + 1,
      form,
      picture: !!drawn || !!pic,
      pictureDropped: !!s.picture && form !== "photo",
      fits: fitted.fits,
      ...(fitted.rung !== "none" ? { ladder: fitted.rung, moved: fitted.moved.length } : {}),
      ...(drawn ? { drawn } : {}),
      ...(longLabels ? { longLabels } : {}),
      ...(invalid ? { invalidDrawing: invalid } : {}),
    });
    if (pic)
      photos.push(
        find(index, pic).then((photo) => {
          if (round[index] !== gen) return; // a re-ask replaced this slide meanwhile
          deck[index] = photo ? placeIn(slide, photo) : drawPlain(plain);
          if (!photo)
            outline[index] = {
              id: `s${index + 1}`,
              kind: "content",
              factRefs: refs,
            } as OutlineEntry;
          report.push({ slide: index + 1, photo: !!photo, at: Date.now() - t0 });
          mark("lastPicture");
          times.lastPicture = Date.now() - t0;
          return save();
        }),
      );
  };

  const context = [
    `Topic: ${brief.topic}`,
    audienceBlock(audienceOf(base)),
    ...(brief.answers
      ? ["The teacher's answers:", ...Object.entries(brief.answers).map(([k, v]) => `${k}: ${v}`)]
      : []),
  ].join("\n");
  const input = { slideCount, topic: brief.topic, context };
  const built = teacher3Prompt({
    ...input,
    yearGroup: base.yearGroup ?? "",
    subject: base.subject ?? "",
    ageBand: audienceOf(base).ageBand,
    objectives: given,
    themeId: base.themeId,
  });
  const schema = teacher3LessonSchema(base.subject) as z.ZodType<unknown>;
  // LAYOUT-TEST arm ZV: a contact sheet of every slide type's layout, zones outlined and labelled,
  // sent before the text (same bytes every call, so the prefix is cacheable).
  const sheetPath = process.env.T3_LAYOUT_SHEET;
  const sheet = sheetPath
    ? [
        {
          id: "layout-sheet",
          url: `data:image/png;base64,${readFileSync(sheetPath).toString("base64")}`,
        },
      ]
    : undefined;
  if (sheet)
    built.user = built.user.replace(
      "The slide types we can draw:",
      "The slide types we can draw (the image shows each one's layout, its zones outlined and labelled):",
    );
  let done = 0;
  const onPartial = (partial: unknown) => {
    const o = (partial ?? {}) as {
      titlePicture?: { subject?: string; named?: string | null } | null;
      slides?: T3Slide[];
    };
    const slides = o.slides ?? [];
    if (!titleAsked && slides.length > 0) startTitle(o.titlePicture);
    while (done < Math.min(slides.length - 1, writable)) {
      const s = slides[done];
      if (s) drawSlide(done, s);
      done++;
    }
  };
  const call = await callStructured({
    deps,
    stage: "generate",
    cls: planClassFor(base, deps),
    effort: "low",
    prompt: { version, system: built.system, user: () => built.user },
    input,
    schema,
    maxOutputTokens: 16000,
    onPartial,
    images: sheet,
    imagesFirst: !!sheet,
  });
  mark("streamEnd");
  const dir = process.env.SIMPLE_CALLS_DIR;
  const log = (row: Record<string, unknown>) => {
    if (!dir) return;
    mkdirSync(dir, { recursive: true });
    appendFileSync(`${dir}/${deps.context.jobId}.calls.jsonl`, `${JSON.stringify(row)}\n`);
  };
  log({
    version,
    streamed: true,
    modelId: call.modelId,
    effort: "low",
    ms: Date.now() - t0,
    usage: call.usage,
    attempts: call.attempts,
    context,
    system: built.system,
    user: built.user,
    sheet: sheetPath ?? null,
    schema: z.toJSONSchema(schema),
    output: call.output,
  });
  const final = structuredClone(call.output) as {
    titlePicture: { subject?: string; named?: string | null } | null;
    slides: T3Slide[];
  };
  final.slides = final.slides.slice(0, writable);
  if (!titleAsked) startTitle(final.titlePicture);
  // The last slide closes with the stream; a retried call's slides replace what streamed.
  for (let k = 0; k < final.slides.length; k++) {
    const s = final.slides[k];
    if (s && (k >= done || call.attempts > 1)) drawSlide(k, s);
  }
  const gate = await t3Gate({
    deps,
    base,
    system: built.system,
    context,
    input,
    objectives: given,
    slides: final.slides,
    slideCount,
    log,
  });
  for (const at of gate.replaced) {
    const s = gate.slides[at - 3];
    if (s) drawSlide(at - 3, s);
  }
  stage = "generated";
  await save(() => mark("editable"));
  await Promise.all(photos);
  await chain;
  mark("photosDone");
  deps.logger.info({ stage: "generate", t3times: times, simple: { slides: report } }, "t3 times");
  const t3Report = summariseT3(report, {
    objectives: given.length,
    writable,
    gate,
  });
  if (t3Report.room) deps.logger.warn({ stage: "generate", coverage: t3Report }, t3Report.room);
  return { ...state, lesson, checkedPerSlide: true, t3Report };
}

/** lab/t3: the summary's counts from the per-slide report (the last row per slide wins). */
export function summariseT3(
  report: Record<string, unknown>[],
  i: {
    objectives: number;
    writable: number;
    gate: { before: unknown[]; after: unknown[]; replaced: number[]; room?: string };
  },
): T3Report {
  const last = new Map<number, Record<string, unknown>>();
  for (const r of report) if ("form" in r && typeof r.slide === "number") last.set(r.slide, r);
  const rows = [...last.values()];
  const ladder: Record<string, number> = {};
  for (const r of rows)
    if (typeof r.ladder === "string") ladder[r.ladder] = (ladder[r.ladder] ?? 0) + 1;
  const drawn = rows.filter((r) => r.drawn).length;
  const failed = rows.filter((r) => r.invalidDrawing).length;
  return {
    objectives: i.objectives,
    writable: i.writable,
    ...(i.gate.room ? { room: i.gate.room } : {}),
    gapsBefore: i.gate.before.length,
    gapsAfter: i.gate.after.length,
    reasked: i.gate.replaced.length > 0,
    ladder,
    unfit: rows.filter((r) => r.fits === false).length,
    drawings: {
      asked: drawn + failed,
      drawn,
      longLabels: rows.filter((r) => r.longLabels).length,
      failed,
    },
  };
}
