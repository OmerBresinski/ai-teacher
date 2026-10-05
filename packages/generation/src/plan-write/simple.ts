import { readFileSync } from "node:fs";
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
  withoutPicture,
} from "@tj/slides";
import { z } from "zod";
import { callStructured } from "../call";
import { CODE_MODEL, withAnswersReveal } from "../planner/coded-slides";
import { withUsage } from "../stages/generate";
import { pickPhoto, plainSubject, withPhoto } from "../stages/illustrate";
import { planClassFor } from "../stages/shared";
import type { PipelineDeps, PipelineState } from "../types";
import { renderWritten, type Written, withSetTag } from "./fit";
import { isSetForm } from "./menu";
import { broadenedBrief } from "./slide-check";

/*
 * Lab arm ABLATE S/O (lab/ablate, 5 Oct 2026): one plain call for the whole lesson in a light schema,
 * mapped onto the candidate's palette by a thin adapter and drawn. No gates, no re-asks, no fit
 * ladder. SIMPLE_ORACLE_FILE skips the call and draws a lesson written in session (arm O).
 */

export const SIMPLE_LESSON_VERSION = "simple-lesson.v1";

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
export type SimpleLesson = z.infer<typeof simpleLessonSchema>;
type LightSlide = z.infer<typeof lightSlide>;

export function simpleLessonPrompt(i: {
  slideCount: number;
  yearGroup: string;
  subject: string;
  topic: string;
}): { system: string; user: string } {
  const menu = Object.entries(FORMS)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");
  return {
    system: "You are an expert UK teacher.",
    user: `Write a ${i.slideCount}-slide lesson for ${i.yearGroup} ${i.subject}: ${i.topic}.
First write the lesson's objectives (2 or 3). Slide 1 (the title) and slide 2 (the objectives) are made from them, so write slides 3 to ${i.slideCount}: ${i.slideCount - 2} slides.

The slide forms available:
${menu}

Per slide: form, heading, body (sentences shown on the slide), items, questions (question and answer, when the form asks one), picture (what a photo should show, and its proper name if it must be one named thing; null for none), notes (what the teacher says and does). Leave fields a form does not use empty. Also give a picture for the title slide.`,
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
          .replace(/^[a-d][).:]\s*/, "");
      return {
        form: "hinge",
        layout: "default",
        out: {
          stem: q.question || s.heading,
          options: s.items.map((t) => ({ text: t, correct: norm(t) === norm(q.answer) })),
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
  const meta = (): MaterialiseMeta => ({
    promptVersion: SIMPLE_LESSON_VERSION,
    model: CODE_MODEL,
    at: deps.now().toISOString(),
  });
  const t0 = Date.now();
  const oracle = process.env.SIMPLE_ORACLE_FILE;
  let w: SimpleLesson;
  if (oracle) {
    w = simpleLessonSchema.parse(JSON.parse(readFileSync(oracle, "utf8")));
  } else {
    const input = {
      slideCount,
      yearGroup: base.yearGroup ?? "",
      subject: base.subject ?? "",
      topic: brief.topic,
    };
    const built = simpleLessonPrompt(input);
    const call = await callStructured({
      deps,
      stage: "generate",
      cls: planClassFor(base, deps),
      effort: "low",
      prompt: { version: SIMPLE_LESSON_VERSION, system: built.system, user: () => built.user },
      input,
      schema: simpleLessonSchema,
      maxOutputTokens: 16000,
    });
    w = call.output as SimpleLesson;
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
            outline: outline.map((e, i) => (i === index ? { ...e, imageBrief: x } : e)),
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
      });
      return { slide, form, out, placed, pic };
    }),
  );
  drawnAll.forEach((d, k) => {
    const index = k + 2;
    const r = renderWritten(d.form === "photo" && !d.placed ? "explain" : d.form, "default", d.out);
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
          planned: SIMPLE_LESSON_VERSION,
          generated: SIMPLE_LESSON_VERSION,
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
