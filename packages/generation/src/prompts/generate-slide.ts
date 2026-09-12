import type { ImagePurpose, LessonFacts, LessonPhase, OutlineEntry } from "@tj/domain/documents";
import { SPEC_LIMITS } from "@tj/slides";
import {
  type Audience,
  audienceBlock,
  example,
  factsBlock,
  HOUSE_RULES,
  limitsBlock,
  verbBlock,
  type WritingShape,
} from "./shared";

/*
 * Generate — one slide (ADR 0025 §8; Generation quality §3, TEACH-213): the outline entry becomes
 * a per-kind spec; geometry is the recipe's business. Coherence comes from the plan, not from the
 * previous slide's text: the slide is given its own brief (what it adds, what it must not repeat),
 * its neighbours' briefs, the facts it references in full, every misconception, and the stems
 * reserved for other slides and the worksheet — so slides can be written in parallel. Since
 * TEACH-230 it is also told the lesson's objective verb (`verbBlock`): what a content, worked-example,
 * open-response or exit-ticket slide is *for* under Recall, Explain, Apply or Evaluate.
 */

export type GenerateSlideInput = {
  /**
   * The facts this slide draws on: only those its entry's `factRefs` name, plus every
   * misconception and the pitch (`factsBlock` renders it). Never the whole lesson.
   */
  referenced: LessonFacts;
  entry: OutlineEntry;
  /** The lesson's objective verb and the class's prior confidence (`lessonShapeOf`, TEACH-230). */
  shape: WritingShape;
  /** 1-based position and the total, for the model's sense of pacing. */
  position: { index: number; total: number };
  /** The `adds` line of the neighbouring entries, so this slide does not repeat them. */
  neighbours: { previous?: string | undefined; next?: string | undefined };
  /** Stems assigned to other slides or to the worksheet; never used here. */
  reservedStems: string[];
  phase?: LessonPhase | undefined;
  /**
   * For an `image-text` entry (TEACH-220): what the chosen photograph shows, so the text is written
   * to it — or `"none"` when no photograph passed the gate, so the text mentions no picture.
   */
  photo?: SlidePhoto | "none" | undefined;
  audience: Audience;
  /** How many vocabulary entries the theme's grid shows (`vocabularySlots`). */
  vocabularySlots: number;
  lessonTitle: string;
};

export type SlidePhoto = {
  alt: string;
  /** The brief's `mustShow` items the judge could see in the photo. */
  visible: string[];
  /** The brief's `mustShow` items it could not. */
  notVisible: string[];
  count: "one" | "several";
  purpose: ImagePurpose;
};

/** The evidence block an `image-text` slide's writer (Generate or Repair) is given. */
export function photoBlock(photo: SlidePhoto | "none"): string[] {
  if (photo === "none") {
    return ["There is no photograph on this slide: write it as plain content."];
  }
  return [
    `The photograph on this slide shows: ${photo.alt || "(no caption)"} (${photo.count === "one" ? "one" : "several"}).`,
    `Visible: ${photo.visible.length > 0 ? photo.visible.join("; ") : "(none of the required items)"}`,
    `Not visible: ${photo.notVisible.length > 0 ? photo.notVisible.join("; ") : "(nothing missing)"}`,
    `Purpose: ${photo.purpose}`,
  ];
}

/** The rule the writer follows for an `image-text` slide; shared with Repair. */
export const IMAGE_TEXT_RULE =
  "An `image-text` slide is written to its photograph. Say 'the photograph' (singular when there is one). A task — spot, find, count, point to, look for, identify, circle, label — may name only items listed as visible. Describe only what the caption and the visible list say is there; never name a kind of animal, plant, object or place the caption does not name. If the purpose is identify-parts and something required is not visible, describe what is there and tell the teacher in `notes` what the picture cannot show. If there is no photograph, do not mention a picture at all.";

const SHAPES = {
  title: '{ "kind": "title", "title", "subtitle", "factRefs", "notes"? }',
  objectives: '{ "kind": "objectives", "items": [1–4 strings], "factRefs", "notes"? }',
  starter:
    '{ "kind": "starter", "heading"?, "items": [1–3 strings], "footnote"?, "factRefs", "notes"? }',
  vocabulary:
    '{ "kind": "vocabulary", "entries": [{ "term", "definition" }] (1–slots), "factRefs", "notes"? }',
  content: '{ "kind": "content", "heading", "body" (≤ 40 words), "factRefs", "notes"? }',
  "image-text": '{ "kind": "image-text", "heading", "body" (≤ 40 words), "factRefs", "notes"? }',
  "worked-example":
    '{ "kind": "worked-example", "heading"?, "question" (one or two lines), "steps": [1–4 strings, each one short line of about 56 characters], "factRefs", "notes"? }',
  instructions:
    '{ "kind": "instructions", "heading"?, "steps": [1–4 strings], "footnote"?, "factRefs", "notes"? }',
  discussion: '{ "kind": "discussion", "prompt", "footnote"?, "factRefs", "notes"? }',
  "true-false":
    '{ "kind": "true-false", "statement", "correct": boolean, "explanation"?, "factRefs", "notes"? }',
  "multiple-choice":
    '{ "kind": "multiple-choice", "stem", "options": [exactly 4 { "text", "correct" }, exactly one correct], "explanation"?, "factRefs", "notes"? }',
  matching:
    '{ "kind": "matching", "stem", "pairs": [exactly 3 { "left", "right" }], "factRefs", "notes"? }',
  "fill-gap":
    '{ "kind": "fill-gap", "stem", "sentence" (with one ___ per answer), "answers": [1–3 strings], "factRefs", "notes"? }',
  sort: '{ "kind": "sort", "stem", "steps": [exactly 4 strings in the correct order], "factRefs", "notes"? }',
  "open-response": '{ "kind": "open-response", "stem", "modelAnswer"?, "factRefs", "notes"? }',
  "exit-ticket":
    '{ "kind": "exit-ticket", "heading"?, "items": [exactly 3 strings], "footnote"?, "factRefs", "notes"? }',
  plenary: '{ "kind": "plenary", "heading"?, "items": [1–3 strings], "factRefs", "notes"? }',
} as const;

export const generateSlidePrompt = {
  version: "generate-slide.v17",
  system: [
    "You write one slide of a classroom lesson from the lesson's facts.",
    "The slide's kind is fixed; you supply its text and answers only. A layout recipe places them, so give no positions, sizes or formatting.",
    "",
    "Rules:",
    HOUSE_RULES,
    "Follow this slide's brief and the supplied facts; do not repeat its neighbours. Include the outline entry's fact ids in `factRefs`.",
    "Follow the supplied objective verb. On content slides put the key idea's statement in the heading, its explanation, example and any useful analogy in the body. Question slides use the supplied question, answer and distractors verbatim; never a reserved stem.",
    "For a `worked-example`, merge neighbouring steps into at most four short lines; keep the conclusion, never drop it. Put fuller working in `notes`.",
    "`notes`: what to say, the misconception in words rather than ids, and a question whose answer is not already on the slide.",
    "`footnote` is one short line pupils read — how long they have, where to write, what to do when finished. Anything addressed to the teacher goes in `notes`; leave `footnote` out rather than fill it.",
    IMAGE_TEXT_RULE,
    "Keep text short enough to read from the back of a classroom: one idea per slide, no paragraph over forty words.",
    "Answers must be correct and unambiguous; distractors plausible.",
    limitsBlock({
      title: SPEC_LIMITS.title,
      "heading/subtitle": SPEC_LIMITS.heading,
      "each item": SPEC_LIMITS.item,
      "worked-example question": SPEC_LIMITS.question,
      "each worked-example step": SPEC_LIMITS.step,
      body: SPEC_LIMITS.body,
      stem: SPEC_LIMITS.stem,
      option: SPEC_LIMITS.option,
      term: SPEC_LIMITS.term,
      definition: SPEC_LIMITS.definition,
      footnote: SPEC_LIMITS.footnote,
      answer: SPEC_LIMITS.answer,
      notes: SPEC_LIMITS.notes,
    }),
    "",
    "The JSON shape per kind:",
    ...Object.entries(SHAPES).map(([kind, shape]) => `- ${kind}: ${shape}`),
    "",
    "Example for a true-false slide:",
    example({
      kind: "true-false",
      statement: "Particles in a gas are close together.",
      correct: false,
      explanation: "Gas particles are far apart and move freely.",
      factRefs: ["q1", "o1"],
      notes:
        "Ask for a show of hands before revealing. Watch for pupils who imagine a gas as a crowd of particles pressed together. Ask: What would happen to the balloon if the particles inside were as close as in a liquid?",
    }),
    "",
    "Example for a worked-example slide: five source steps compressed into four short lines, retaining the conclusion.",
    "Source working: Split 84 into 80 and 4. Divide 80 by 4 to get 20. Divide 4 by 4 to get 1. Add 20 and 1 to get 21. Conclude that 84 divided by 4 is 21.",
    example({
      kind: "worked-example",
      heading: "Divide by partitioning",
      question: "What is 84 ÷ 4?",
      steps: ["84 = 80 + 4.", "80 ÷ 4 = 20; 4 ÷ 4 = 1.", "20 + 1 = 21.", "So 84 ÷ 4 = 21."],
      factRefs: ["x1", "o2"],
      notes:
        "Reveal each line after pupils predict it. Check they divide both parts, not just 80. Ask: How could you check using multiplication?",
    }),
    "",
    "Example for a fill-gap slide (one three-underscore marker, even inside a word):",
    example({
      kind: "fill-gap",
      stem: "Complete the word shell.",
      sentence: "___ell",
      answers: ["sh"],
      factRefs: ["q1", "o1"],
    }),
  ].join("\n"),
  user(input: GenerateSlideInput): string {
    const parts = [
      `Lesson: ${input.lessonTitle}`,
      audienceBlock(input.audience),
      verbBlock(input.shape),
      "",
      factsBlock(input.referenced),
      "",
      `Slide ${input.position.index} of ${input.position.total}: kind "${input.entry.kind}", ${input.entry.minutes} minutes${input.phase ? `, ${input.phase} phase` : ""}, covering facts ${input.entry.factRefs.join(", ") || "(none named)"}.`,
    ];
    if (input.entry.brief) {
      parts.push(`This slide adds: ${input.entry.brief.adds}`);
      if (input.entry.brief.avoids) parts.push(`It must not: ${input.entry.brief.avoids}`);
    }
    if (input.neighbours.previous)
      parts.push(`The slide before adds: ${input.neighbours.previous}`);
    if (input.neighbours.next) parts.push(`The slide after adds: ${input.neighbours.next}`);
    if (input.photo !== undefined) parts.push(...photoBlock(input.photo));
    if (input.entry.kind === "vocabulary") {
      parts.push(
        `This theme shows at most ${input.vocabularySlots} vocabulary entries. When there are more terms than that, keep every term another shown definition uses, then the terms the objectives name; put the rest in \`notes\` with their definitions.`,
      );
    }
    if (input.reservedStems.length > 0) {
      parts.push("", "Reserved for other slides or the worksheet — do not use these stems:");
      for (const stem of input.reservedStems) parts.push(`  - ${stem}`);
    }
    parts.push("", `Answer with the JSON for a "${input.entry.kind}" slide.`);
    return parts.join("\n");
  },
} as const;
