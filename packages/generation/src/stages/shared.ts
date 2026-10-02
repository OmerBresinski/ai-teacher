import {
  type FigureRef,
  type Finding,
  type ImagePurpose,
  isTrustedThumbnail,
  type Lesson,
  type LessonFacts,
  type OutlineEntry,
  type RichDoc,
  richDocToPlainText,
  type Slide,
  walkElements,
  yearNumberOf,
} from "@tj/domain/documents";
import {
  COMPARE_NAME,
  type DiagramTextSpec,
  diagramSpecSchemaFor,
  diagramTextSpecSchemaFor,
  figureGroupOf,
  type ImageTextPhoto,
  KIND_TAG_NAME,
  PLACEHOLDER_IMAGE,
  type SlideSpec,
  type SpecSchemaOptions,
} from "@tj/slides";
import type { z } from "zod";
import type { Audience, SlidePhoto } from "../prompts";
import { type LessonShape, lessonShapeOf } from "../shapes";
import type { PipelineDeps } from "../types";

// The plain-text projections moved to `@tj/domain/documents/text` so `checkLesson` can measure the
// same text Evaluate reads (TEACH-210); re-exported so the stages' import paths stand.
export { blockText, slideText } from "@tj/domain/documents";

import { slideText } from "@tj/domain/documents";

/*
 * Small pure helpers the stages share: the audience block from a lesson, the plain-text
 * projection of slides and blocks (what Evaluate and Repair read, ADR 0025 §11 — now in
 * `@tj/domain`), the generation-state accessor, and the finding a budget stop records (§15).
 */

/** The residual a stage records when the per-lesson budget stops it between calls (ADR 0025 §15). */
export const BUDGET_FINDING = (by: "usd" | "tokens", where: string): Finding => ({
  check: "budget",
  severity: "error",
  target: {},
  message: `Generation stopped at ${where}: the lesson's ${by === "usd" ? "cost" : "token"} cap was reached. What was written is kept.`,
});

/**
 * What an existing `image-text` slide's text may rely on (TEACH-220): the evidence the photo judge
 * left on its image element, or `"none"` when the slot is still the placeholder or was placed
 * before the judge recorded evidence (then the text may set no picture task at all).
 */
/**
 * The small label over a picture slide's heading, by what the picture is for (TEACH-243): a slide
 * that asks pupils to look says so; only a `context` picture is a "KEY IDEA", the recipe's default.
 */
export function imageTextCaption(purpose: ImagePurpose | undefined): string {
  switch (purpose) {
    case "identify-parts":
    case "observe":
      return "LOOK CLOSELY";
    case "compare":
      return "COMPARE";
    default:
      return "KEY IDEA";
  }
}

/** A model's slide spec with the picture caption set from its outline entry (`image-text` only). */
export function withImageCaption<S extends { kind: string }>(
  spec: S,
  entry: OutlineEntry | undefined,
): S {
  if (spec.kind !== "image-text") return spec;
  return { ...spec, caption: imageTextCaption(entry?.imageBrief?.purpose) };
}

export function imageTextPhotoOf(
  slide: Slide,
  entry: OutlineEntry | undefined,
): ImageTextPhoto | "none" {
  const image = slide.elements.find((e) => e.type === "image");
  if (image?.type !== "image" || image.src === PLACEHOLDER_IMAGE) return "none";
  const evidence = image.source?.evidence;
  if (!evidence) return "none";
  return {
    visible: evidence.visible,
    count: evidence.count,
    mustShow: entry?.imageBrief?.mustShow ?? [],
  };
}

/**
 * The photographs a reviewer may be shown (TEACH-220): each placed `image-text` slide's thumbnail
 * — the picture the pick judge looked at — keyed by slide id, in slide order. Only a trusted
 * thumbnail (the provider's CDN or an inline data URL) is handed on: the model SDK fetches it from
 * the worker, so the check is repeated here for documents written before the schema had it.
 */
export function photoThumbnails(lesson: Lesson): { id: string; url: string }[] {
  const out: { id: string; url: string }[] = [];
  for (const slide of lesson.slides) {
    if (slide.kind !== "image-text") continue;
    const image = slide.elements.find((e) => e.type === "image");
    const url = image?.type === "image" ? image.source?.evidence?.thumbnail : undefined;
    if (url && isTrustedThumbnail(url)) out.push({ id: slide.id, url });
  }
  return out;
}

/** The same evidence in the prompt's shape (what the photograph shows and does not). */
export function slidePhotoOf(slide: Slide, entry: OutlineEntry | undefined): SlidePhoto | "none" {
  const photo = imageTextPhotoOf(slide, entry);
  if (photo === "none") return "none";
  const image = slide.elements.find((e) => e.type === "image");
  const evidence = image?.type === "image" ? image.source?.evidence : undefined;
  const seen = new Set(photo.visible.map((v) => v.trim().toLowerCase()));
  return {
    alt: evidence?.alt ?? "",
    visible: photo.visible,
    notVisible: photo.mustShow.filter((m) => !seen.has(m.trim().toLowerCase())),
    count: photo.count,
    purpose: entry?.imageBrief?.purpose ?? "context",
  };
}

/**
 * The figure a diagram slide draws from its fact (ADR 0034 decision 5, TEACH-253): the figure on
 * the first worked example or question in `entry.factRefs` that has one. `undefined` for a lesson
 * planned before figures lived on facts, or a facts call that missed it: that slide's own call
 * writes the values, as before.
 */
export function figureOfEntry(
  facts: LessonFacts | undefined,
  entry: Pick<OutlineEntry, "factRefs"> | undefined,
): FigureRef | undefined {
  if (!facts || !entry) return undefined;
  for (const id of entry.factRefs) {
    const fact =
      facts.workedExamples.find((x) => x.id === id) ?? facts.questions.find((q) => q.id === id);
    if (fact?.figure) return fact.figure;
  }
  return undefined;
}

/**
 * The spec a diagram answer is materialised from: with its fact's figure put back when the slide
 * draws one (the answer was written with `diagramTextSpecSchemaFor` and has no figure), otherwise
 * the answer as it is. The figure is the fact's current one, so a corrected fact redraws the slide.
 */
export function withFactFigure(
  answer: SlideSpec | DiagramTextSpec,
  figure: FigureRef | undefined,
): SlideSpec {
  if (figure && answer.kind === "diagram") return { ...answer, figure } as SlideSpec;
  return answer as SlideSpec;
}

/**
 * The spec schema an existing diagram slide is rewritten with (Repair, cascade, regenerate;
 * TEACH-89): the template stored on its figure group, so the rewrite keeps the template and is
 * redrawn from the values it returns. A figure the teacher ungrouped has no group, so its outline
 * entry's `figureBrief` names the template instead. When the entry's fact carries the figure
 * (TEACH-253) the rewrite is text only and the caller puts the fact's figure back
 * (`withFactFigure`), so the slide always shows the fact's current figure.
 */
export function storedDiagramSchema(
  slide: Slide,
  entry: OutlineEntry | undefined,
  facts: LessonFacts | undefined,
  options: SpecSchemaOptions = {},
): z.ZodType<SlideSpec | DiagramTextSpec> | undefined {
  if (figureOfEntry(facts, entry)) return diagramTextSpecSchemaFor(options);
  const template = figureGroupOf(slide)?.figure.template ?? entry?.figureBrief?.template;
  return template && diagramSpecSchemaFor(template, options);
}

/** Text compared case- and whitespace-insensitively, as Evaluate quotes it. */
export const normaliseText = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();

/** What a slide finding may quote: the slide's text and its notes. */
export const slideHaystack = (slide: Slide) =>
  normaliseText(`${slideText(slide)}\n${slide.notes ?? ""}`);

/**
 * The slide's text as labelled spec fields (TEACH-222): `heading`, `body`, `option A (correct)`,
 * `notes` — never the recipe's fixed captions (`KEY IDEA`, `QUESTION`, `WORKING`), which the model
 * would otherwise copy into `heading`. The label is the element's text preset, which is what the
 * generate prompt's shape names; `small` is the pupils' instruction line. A diagram (TEACH-89) also
 * gives its `caption`, which its spec writes, and its `figure`: the template and values stored on
 * the figure group, as JSON, so Repair keeps the values rather than reading them off the labels.
 */
export function specFieldsOf(slide: Slide): { field: string; text: string }[] {
  return withSpecNames(slide.kind, presetFieldsOf(slide));
}

/** Kinds whose `heading` element holds the spec's `stem` (`materialise.ts` fills it so). */
const STEM_KINDS = new Set(["multiple-choice", "matching", "fill-gap", "sort", "open-response"]);
/** Kinds that can carry a callout card, whose text is laid in `small` (`callout.ts`). */
const CALLOUT_HOSTS = new Set(["content", "image-text", "worked-example"]);

/**
 * Audit A3 / C5: the preset labels renamed to the spec's own field names where they differ, so a
 * rewrite of "steps[2]" lands on the step and not on the question (coasts W6NG-18). A
 * worked-example's first body is its `question` and the second its numbered `steps`, one field per
 * step, 0-based; a question kind's heading is its `stem` (`statement` on true-false); a callout
 * host's `small` text is its `callout`; a discussion's subtitle is its `prompt`.
 */
function withSpecNames(
  kind: string,
  fields: { field: string; text: string }[],
): { field: string; text: string }[] {
  let bodies = 0;
  return fields.flatMap((f) => {
    if (kind === "worked-example" && f.field === "body") {
      bodies += 1;
      if (bodies === 1) return [{ field: "question", text: f.text }];
      return f.text.split("\n").map((text, i) => ({ field: `steps[${i}]`, text }));
    }
    if (f.field === "heading" && STEM_KINDS.has(kind)) return [{ ...f, field: "stem" }];
    if (f.field === "heading" && kind === "true-false") return [{ ...f, field: "statement" }];
    if (f.field === "subtitle" && kind === "discussion") return [{ ...f, field: "prompt" }];
    if (f.field === "instruction" && CALLOUT_HOSTS.has(kind)) return [{ ...f, field: "callout" }];
    return [f];
  });
}

function presetFieldsOf(slide: Slide): { field: string; text: string }[] {
  const out: { field: string; text: string }[] = [];
  const figure = figureGroupOf(slide);
  const correct = new Set(
    slide.question?.type === "multiple-choice"
      ? slide.question.options.filter((o) => o.correct).map((o) => o.id)
      : [],
  );
  // A content slide's compare cards (`@tj/slides` compareCards): each card, then its label
  // (caption) and its points (body), reach Repair as `compare.left.*` / `compare.right.*`.
  let side: "left" | "right" | undefined;
  let sideLabelled = false;
  for (const element of slide.elements) {
    if (figure && element === figure) {
      out.push({ field: "figure", text: JSON.stringify(figure.figure) });
      continue;
    }
    if (slide.kind === "content" && element.name === COMPARE_NAME) {
      side = side === undefined ? "left" : "right";
      sideLabelled = false;
      continue;
    }
    if (element.type === "text" && side !== undefined) {
      const text = richDocToPlainText(element.doc).trim();
      if (!sideLabelled && element.style?.preset === "caption") {
        sideLabelled = true;
        if (text) out.push({ field: `compare.${side}.label`, text });
        continue;
      }
      if (sideLabelled && element.style?.preset === "body") {
        const lines = text
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean);
        if (lines.length > 0) out.push({ field: `compare.${side}.points`, text: lines.join("\n") });
        if (side === "right") side = undefined;
        continue;
      }
    }
    if (element.type === "text") {
      const preset = element.style?.preset;
      if (preset === "caption" && slide.kind !== "diagram") continue;
      // The look's kind tag (`@tj/slides` look.ts) is chrome, not a spec field.
      if (element.name === KIND_TAG_NAME) continue;
      const text = richDocToPlainText(element.doc).trim();
      // A worked example's working laid as a steps strip (`@tj/slides` structure.ts): one card
      // per step, named "Step n", and a continuation slide numbers on.
      const step = element.name?.match(/^Step (\d+)$/);
      if (step && text) {
        out.push({ field: `steps[${Number(step[1]) - 1}]`, text });
        continue;
      }
      // The two-column teaching slide (`@tj/slides` splitContent): each point is its own "Point"
      // text.
      if (slide.kind === "content" && element.name === "Point" && text) {
        const last = out.find((f) => f.field === "points");
        if (last) last.text = `${last.text}\n${text}`;
        else out.push({ field: "points", text });
        continue;
      }
      // A panel's key idea or key card is the slide's own words; a definition from the lesson's
      // glossary is shown as its own field.
      if (element.name === "Side panel text") {
        if (text) out.push({ field: "body", text });
        continue;
      }
      if (element.name === "Side panel definition") {
        if (text) out.push({ field: "definition", text });
        continue;
      }
      // A content slide's `points` sit as a bullet list under its body (`@tj/slides` bodyWithPoints).
      const list = (element.doc.content ?? []).findIndex((n) => n.type === "bulletList");
      if (slide.kind === "content" && preset === "body" && list >= 0) {
        const before = richDocToPlainText({
          type: "doc",
          content: element.doc.content?.slice(0, list),
        }).trim();
        const points = richDocToPlainText({
          type: "doc",
          content: element.doc.content?.slice(list),
        })
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .join("\n");
        if (before) out.push({ field: "body", text: before });
        if (points) out.push({ field: "points", text: points });
        continue;
      }
      if (text) out.push({ field: preset === "small" ? "instruction" : (preset ?? "text"), text });
    } else if (element.type === "option") {
      const text = richDocToPlainText(element.doc).trim();
      out.push({
        field: `option ${element.label}${correct.has(element.id) ? " (correct)" : ""}`,
        text,
      });
    } else if (element.type === "gap-text") {
      const text = richDocToPlainText(element.doc).trim();
      if (text) out.push({ field: "sentence", text });
    } else if (element.type === "table") {
      out.push({ field: "table", text: element.rows.map((r) => r.join(" | ")).join("\n") });
    }
  }
  const q = slide.question;
  if ((q?.type === "true-false" || q?.type === "multiple-choice") && q.explanation) {
    out.push({ field: "explanation", text: q.explanation });
  }
  if (q?.type === "true-false") out.push({ field: "correct", text: q.correct ? "True" : "False" });
  if (q?.type === "open-response" && q.modelAnswer) {
    out.push({ field: "modelAnswer", text: q.modelAnswer });
  }
  if (q?.type === "fill-gap")
    out.push({ field: "answers", text: q.gaps.map((g) => g.answer).join(", ") });
  if (slide.notes) out.push({ field: "notes", text: slide.notes });
  return out;
}

/**
 * True when every line `slideText` would show is also in `specFieldsOf`'s projection — the
 * guarantee Repair relies on to prefer the labelled fields. A kind the projection does not cover
 * (a teacher-added element type, a future kind) fails it, and Repair falls back to the flat text.
 * A figure's labels (and its "Not drawn to scale" caption) are covered by its `figure` field: the
 * group is redrawn from the values, never edited label by label.
 */
export function specFieldsCover(slide: Slide): boolean {
  // Whole lines, not substrings: a one-letter line must not count as covered by a longer field.
  const shown = new Set(specFieldsOf(slide).flatMap((f) => f.text.split("\n").map(normaliseText)));
  // The recipe's fixed captions are excluded from the fields on purpose; a figure's text stands in
  // its `figure` field.
  const covered = new Set(
    slide.elements
      .filter((e) => e.type === "text" && e.style?.preset === "caption")
      .map((e) => normaliseText(richDocToPlainText((e as { doc: RichDoc }).doc))),
  );
  const figure = figureGroupOf(slide);
  if (figure) {
    walkElements(figure.children, (e) => {
      if ("doc" in e && e.doc) covered.add(normaliseText(richDocToPlainText(e.doc as RichDoc)));
    });
  }
  return slideText(slide)
    .split("\n")
    .map(normaliseText)
    .filter(
      (line) =>
        line.length > 0 &&
        !covered.has(line) &&
        // A step card's number disc (`@tj/slides` structure.ts) is chrome, not a spec field.
        !/^\d{1,2}$/.test(line) &&
        // …nor is a matching row's letter chip ("A", "B"), drawn once rows have room for it.
        !/^[a-z]$/i.test(line) &&
        !/^(answer|answers|correct|model answer):/.test(line),
    )
    .every((line) => shown.has(line));
}

/**
 * The model class Plan's three calls run on (TEACH-259): `frontier` when the host set
 * `planFrontierFromYear` and the lesson's year group reads as that number or above; `standard`
 * otherwise — including EYFS, Reception and any label without a year number, whatever the
 * setting, and always when it is unset.
 */
export function planClassFor(
  lesson: Pick<Lesson, "yearGroup">,
  deps: Pick<PipelineDeps, "planFrontierFromYear">,
): "frontier" | "standard" {
  const from = deps.planFrontierFromYear;
  if (from === undefined) return "standard";
  const year = yearNumberOf(lesson.yearGroup);
  return year !== undefined && year >= from ? "frontier" : "standard";
}

export function audienceOf(lesson: Lesson): Audience {
  return {
    subject: lesson.subject,
    yearGroup: lesson.yearGroup,
    ageBand: lesson.ageBand,
    readingLevel: lesson.readingLevel,
    language: lesson.language,
    classContext: lesson.brief?.classContext,
  };
}

/**
 * The lesson's shape from its brief's answers and its class (TEACH-229, TEACH-230): Plan renders
 * and enforces all of it; Generate, Evaluate and Repair are told its verb and confidence.
 */
export function shapeOf(lesson: Lesson): LessonShape {
  return lessonShapeOf(lesson.brief?.answers, {
    yearGroup: lesson.yearGroup,
    ageBand: lesson.ageBand,
  });
}

/** The generation record a later stage extends; Plan writes it, so it is present from then on. */
export function generationOf(lesson: Lesson): NonNullable<Lesson["generation"]> {
  if (!lesson.generation) throw new Error("lesson has no generation state; Plan has not run");
  return lesson.generation;
}

/**
 * Run `items` through `fn` with at most `limit` in flight; rejects on the first thrown error.
 * Shared by the proposal jobs and Generate (TEACH-213).
 */
export async function runBounded<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++] as T;
      await fn(item);
    }
  });
  // Every worker settles before the first error propagates, so a caller never sees a rejection
  // while other items are still in flight.
  const settled = await Promise.allSettled(workers);
  const rejected = settled.find((r) => r.status === "rejected");
  if (rejected) throw rejected.reason;
}

/** Contract C1: the starter's retrieval questions as an optional prompt input (absent when none). */
export function retrievalInput(facts: {
  retrieval?: { question: string; answer: string }[] | undefined;
}): { retrieval?: { question: string; answer: string }[] } {
  const r = facts.retrieval?.map(({ question, answer }) => ({ question, answer }));
  return r && r.length > 0 ? { retrieval: r } : {};
}
