import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import {
  DEFAULT_SLIDE_COUNT,
  type ImageBrief,
  type Lesson,
  type LessonFacts,
  type OutlineEntry,
  type Slide,
} from "@tj/domain/documents";
import {
  fitsPlanned,
  getTheme,
  type MaterialiseMeta,
  materialiseSlide,
  PLACEHOLDER_IMAGE,
  slideFits,
  withDiagramDrawn,
  withoutPicture,
} from "@tj/slides";
import { DIAGRAM_DRAWN_NAME, settleDiagram } from "@tj/slides/diagrams";
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
type LightSlide = z.infer<typeof lightSlide> & { diagram?: unknown };
export type SimpleLesson = Omit<z.infer<typeof simpleLessonSchema>, "slides"> & {
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
  photo: "2–3 lines beside a real photograph found by search (the picture request)",
  diagram: "2–3 lines beside a drawn diagram (the diagram field)",
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
const teacher2Slide = teacherSlide.extend({
  form: z.enum(Object.keys(T2_FORMS) as [string, ...string[]]),
  diagram: DiagramSpecSchema.nullable(),
});
export const teacher2LessonSchema = teacherLessonSchema.extend({
  slides: z.array(teacher2Slide),
});

export function teacher2Prompt(i: Parameters<typeof teacherPrompt>[0]): {
  system: string;
  user: string;
} {
  const [lo, hi] = PICTURE_SHARE[(i.ageBand ?? "ks3").toLowerCase()] ?? [0.35, 0.5];
  const menu = Object.entries(T2_FORMS)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");
  return {
    system: `You're an expert teacher in England, teaching ${i.yearGroup} ${i.subject}: ${i.topic}, at the right reading age for that year. Write the lesson as you'd teach it.`,
    user: `${i.context}

Exactly ${i.slideCount} slides. Slide 1 (the title) and slide 2 (the objectives) are made from your objectives, so write slides 3 to ${i.slideCount}.
Teach each objective, then check it with a real question pupils answer. Share the slides by need: a harder objective gets more of them. Stay within the objectives.
About ${Math.round(i.slideCount * lo)}–${Math.round(i.slideCount * hi)} of your ${i.slideCount} slides show a picture, counting the title. Pictures go on teaching slides (a photo or a diagram), and every check stays. A picture shows exactly what its slide says.

The slide types we can draw:
${menu}

Per slide: form, heading, content (the lines on the slide), questions (question and answer; only ${QUESTION_FORMS.join(", ")} show them), picture request (photo only), diagram (diagram only), notes.`,
  };
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
    titlePicture: t.titlePicture,
    slides: (t.slides as (TeacherLesson["slides"][number] & { diagram?: unknown })[]).map((s) => {
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
        form: s.form,
        heading: bareHeading(s.heading),
        ...split,
        questions: s.questions,
        picture: s.picture,
        ...(s.diagram ? { diagram: s.diagram } : {}),
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
            subject: s.picture?.subject ?? s.heading,
            named: s.picture?.named ?? null,
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
      const norm = (t: string) =>
        t
          .trim()
          .toLowerCase()
          .replace(/^[a-d][).:]\s*/, "")
          .replace(/[.\s]+$/, "");
      // The palette's hinge draws four option cards: fewer would show an empty "Option D".
      if (s.items.length < 4)
        return { form: "check-set", layout: "default", out: { questions: [q], notes } };
      const a = norm(q.answer);
      const exact = s.items.findIndex((t) => norm(t) === a);
      const key =
        exact >= 0
          ? exact
          : s.items.findIndex((t) => a.startsWith(norm(t)) || norm(t).startsWith(a));
      return {
        form: "hinge",
        layout: "default",
        out: {
          stem: q.question || s.heading,
          options: s.items.map((t, i) => ({ text: t, correct: i === key })),
          explanation: q.answer,
          notes,
        },
      };
    }
    case "diagram":
      return {
        form: "diagram-slot",
        layout: "default",
        out: { heading: s.heading, body: s.body, diagram: s.diagram, notes },
      };
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
    process.env.SIMPLE_ARM === "T2"
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
    const armT = arm === "T" || arm === "T2";
    const teacherInput = {
      ...input,
      yearGroup: base.yearGroup ?? "",
      subject: base.subject ?? "",
      ageBand: audienceOf(base).ageBand,
    };
    const built =
      arm === "T2"
        ? teacher2Prompt(teacherInput)
        : armT
          ? teacherPrompt(teacherInput)
          : simpleLessonPrompt(input);
    const version =
      arm === "T2"
        ? TEACHER2_LESSON_VERSION
        : armT
          ? TEACHER_LESSON_VERSION
          : SIMPLE_LESSON_VERSION;
    const schema = (
      arm === "T2" ? teacher2LessonSchema : armT ? teacherLessonSchema : simpleLessonSchema
    ) as z.ZodType<unknown>;
    const call = await callStructured({
      deps,
      stage: "generate",
      cls: planClassFor(base, deps),
      effort: "low",
      prompt: { version, system: built.system, user: () => built.user },
      input,
      schema,
      maxOutputTokens: 16000,
    });
    w = armT ? fromTeacher(call.output as TeacherLesson) : (call.output as SimpleLesson);
    // Lab ABLATE: the full request and the response, one line per call.
    const dir = process.env.SIMPLE_CALLS_DIR;
    if (dir) {
      mkdirSync(dir, { recursive: true });
      appendFileSync(
        `${dir}/${deps.context.jobId}.calls.jsonl`,
        `${JSON.stringify({
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
        })}\n`,
      );
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

  const slides: Slide[] = [];
  const pv = w.titlePicture
    ? PICTURE_ORDER.find((v) => fitsPlanned(titleSpec, { variant: v, stepDown: 0 }).ok)
    : undefined;
  let title = pv ? materialiseSlide(titleSpec, themeId, meta(), deps.ids, pv) : bareTitle();
  if (pv && w.titlePicture && deps.images) {
    const photo = await find(0, briefOf(w.titlePicture));
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
    written.map(async (s, k) => {
      const index = k + 2;
      const { form, layout, out } = adapt(s);
      const drawOne = (f: string, o: Written): Slide => {
        const r = renderWritten(f, layout, o);
        const slide = materialiseSlide(r.spec, themeId, meta(), deps.ids, r.variant, r.structure);
        if (isSetForm(f)) return withSetTag(withAnswersReveal(slide, themeId), f);
        if (f !== "diagram-slot") return slide;
        // Arm T2: the diagram drawn by code as the stream draws it (settled to its box), or no slot.
        const spec = o.diagram;
        const made =
          spec && typeof spec === "object" ? withDiagramDrawn(slide, theme, spec) : slide;
        const el = made.elements.find((e) => e.name === DIAGRAM_DRAWN_NAME);
        if (made === slide || !el) throw new Error("the diagram does not draw");
        return withDiagramDrawn(slide, theme, settleDiagram(spec, { w: el.w, h: el.h }).spec);
      };
      let slide: Slide;
      let diagramDrawn: boolean | undefined;
      try {
        slide = drawOne(form, out);
        if (form === "diagram-slot") diagramDrawn = true;
      } catch (e) {
        report.push({ slide: index + 1, form, drawError: String(e).slice(0, 200) });
        if (form === "diagram-slot") diagramDrawn = false;
        slide = drawOne("explain", {
          heading: s.heading,
          body: [...s.body, ...s.items],
          notes: s.notes,
        });
      }
      const pic = form === "photo" && s.picture ? briefOf(s.picture) : undefined;
      let placed = false;
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
        ...(diagramDrawn !== undefined ? { diagram: diagramDrawn } : {}),
      });
      return { slide, form, out, placed, pic, diagramDrawn };
    }),
  );
  drawnAll.forEach((d, k) => {
    const index = k + 2;
    const plain = (d.form === "photo" && !d.placed) || d.diagramDrawn === false;
    const r = plain
      ? renderWritten("explain", "default", { heading: "x", body: ["x"] })
      : renderWritten(d.form, "default", d.out);
    outline[index] = {
      id: `s${index + 1}`,
      kind: (d.placed ? "image-text" : r.spec.kind) as OutlineEntry["kind"],
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
