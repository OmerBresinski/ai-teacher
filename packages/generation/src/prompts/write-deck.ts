import type { FigureRef, LessonFacts, OutlineEntry } from "@tj/domain/documents";
import { figureBlock, figureShownBlock } from "./figures";
import { IMAGE_TEXT_RULE, photoBlock, SHAPES, type SlidePhoto } from "./generate-slide";
import {
  type Audience,
  audienceBlock,
  factsBlock,
  HOUSE_RULES,
  verbBlock,
  type WritingShape,
} from "./shared";

/*
 * Write the deck (lab fit-single-writer, 30 Sep 2026): one streamed call writes every slide the
 * model writes, in order, as one JSON object per line, so each slide is parsed, materialised and
 * persisted as soon as its line is complete. The writer sees the whole outline (what every slide
 * is for, including the slides code builds) and the whole facts once, so it can pace the lesson
 * and knows what earlier slides have said. Slide size is described by layout in plain words, not
 * by character or word numbers (Greg, 29 Sep: no per-text-box budgets). Everything a per-slide
 * writer was told to add on the slide (term definitions, the misconception sentence, what later
 * answers rest on) goes to `notes` here: those adds were what overran the layout in the fit lab.
 *
 * v1: first version.
 */

export type DeckSlideLine = {
  /** 0-based outline index. */
  index: number;
  entry: OutlineEntry;
  /** "made": built in code (title, objectives, question sets), shown for context only. */
  mode: "write" | "made";
  /** Stems reserved for other slides or the worksheet (stem-composing kinds only). */
  reservedStems?: string[] | undefined;
  photo?: SlidePhoto | "none" | undefined;
  figure?: FigureRef | undefined;
  /** What a made slide shows, one short line (e.g. its questions' ids). */
  shows?: string | undefined;
};

export type WriteDeckInput = {
  lessonTitle: string;
  audience: Audience;
  shape: WritingShape;
  facts: LessonFacts;
  slides: DeckSlideLine[];
  vocabularySlots: number;
};

const LAYOUT_SHAPES: Record<string, string> = {
  ...SHAPES,
  content:
    '{ "slide", "kind": "content", "heading", "body", "callout"?: { "kind", "text" }, "factRefs", "notes"? }',
  "image-text":
    '{ "slide", "kind": "image-text", "heading", "body", "callout"?: { "kind", "text" }, "factRefs", "notes"? }',
  "worked-example":
    '{ "slide", "kind": "worked-example", "heading"?, "question", "steps": [1–4 strings], "factRefs", "notes"? }',
};

const STEM_KINDS: ReadonlySet<string> = new Set([
  "starter",
  "instructions",
  "discussion",
  "matching",
  "fill-gap",
  "sort",
  "exit-ticket",
  "plenary",
]);

export const writeDeckPrompt = {
  version: "write-deck.v1",
  system: [
    "You write the slides of one classroom lesson, in order, from the lesson's facts and its outline.",
    "",
    'The outline is fixed: each slide\'s kind, what it adds, the facts it uses and any callout. Slides marked "made" are built from the facts already (the title, the objectives, the question sets); they are listed so you know what the class sees there. Write every slide marked "write", in order, and no others.',
    "",
    "Each slide is projected in front of the class, and pupils read it while the teacher talks over it. Write each one to fit its layout:",
    "- content: the heading is the key idea's statement. The body gives the reason it holds, then its example: one short paragraph per key idea. A callout card sits beside the body and takes half the slide; on a slide with a callout the body is one or two short sentences.",
    "- image-text: the photograph takes half the slide; the body beside it is one or two short sentences.",
    "- worked-example: the question is the source problem as the facts give it. The steps are its working, one short line each, in order, at most four; the last reaches the answer.",
    "- every other kind: the fields its shape lists, each a line or two.",
    "What the teacher says beyond that goes in `notes`: fuller working, what a term means, the misconception to watch for, a further example.",
    "",
    "Rules:",
    HOUSE_RULES,
    "Each slide draws on the facts its line names and adds what its line says it adds. Do not repeat what an earlier slide showed; leave to a later slide what it adds.",
    "Follow the supplied objective verb. Question slides use the supplied question, answer and distractors verbatim.",
    'When an `instructions` slide\'s facts include questions, it is shared practise: `heading` "Your turn"; each step is one of those questions\' stems verbatim, in the order its line names them, with no number. `notes` gives each answer on its own line ("1. <answer>"), then the misconception to watch for.',
    "`notes`: what to say, the misconception in words rather than ids, and a question whose answer is not already on the slide.",
    "`footnote` is one short line pupils read (how long they have, where to write, what to do when finished); leave it out rather than fill it.",
    IMAGE_TEXT_RULE,
    "",
    "Answer with one JSON object per line, one line per slide you write, in slide order, and nothing else: no list brackets, no code fences. Each object begins with \"slide\": the slide's number. The shape per kind (`callout` only when the slide's line assigns one):",
    ...Object.entries(LAYOUT_SHAPES)
      .filter(([kind]) => kind !== "title" && kind !== "objectives")
      .map(([kind, shape]) => `- ${kind}: ${shape.replace(/^\{ "kind"/, '{ "slide", "kind"')}`),
  ].join("\n"),
  user(input: WriteDeckInput): string {
    const total = input.slides.length;
    const parts = [
      `Lesson: ${input.lessonTitle}`,
      audienceBlock(input.audience),
      verbBlock(input.shape),
      "",
      factsBlock(input.facts),
      "",
      `The outline (${total} slides):`,
    ];
    for (const s of input.slides) {
      const { entry } = s;
      const n = s.index + 1;
      const refs = entry.factRefs.join(", ") || "none";
      if (s.mode === "made") {
        parts.push(
          "",
          `Slide ${n} (made): ${entry.kind}${entry.phase ? `, ${entry.phase}` : ""}. ${s.shows ?? `From ${refs}.`}`,
        );
        continue;
      }
      parts.push(
        "",
        `Slide ${n} (write): ${entry.kind}${entry.phase ? `, ${entry.phase}` : ""}, facts ${refs}.`,
      );
      if (entry.brief) {
        parts.push(`Adds: ${entry.brief.adds}`);
        if (entry.brief.avoids) parts.push(`Must not: ${entry.brief.avoids}`);
      }
      if (entry.callout) {
        const { kind, factRefs } = entry.callout;
        parts.push(
          `Callout: kind "${kind}", \`text\` one line for pupils, from ${factRefs.join(", ")} only.`,
        );
      }
      if (s.photo !== undefined) parts.push(...photoBlock(s.photo));
      if (entry.kind === "diagram" && s.figure) parts.push(...figureShownBlock(s.figure));
      else if (entry.kind === "diagram" && entry.figureBrief) {
        parts.push(...figureBlock(entry.figureBrief));
      }
      if (entry.kind === "vocabulary") {
        parts.push(
          `This theme shows at most ${input.vocabularySlots} entries. With more terms, keep every term another shown definition uses, then the terms the objectives name; the rest go in \`notes\` with their definitions.`,
        );
      }
      if (s.reservedStems?.length && STEM_KINDS.has(entry.kind)) {
        parts.push(`Stems reserved elsewhere, not to use: ${s.reservedStems.join(" | ")}`);
      }
    }
    return parts.join("\n");
  },
} as const;
