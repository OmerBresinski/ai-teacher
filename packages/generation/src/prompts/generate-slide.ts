import type {
  FigureRef,
  ImagePurpose,
  LessonFacts,
  LessonPhase,
  OutlineEntry,
} from "@tj/domain/documents";
import { SPEC_LIMITS } from "@tj/slides";
import { figureBlock, figureShownBlock } from "./figures";
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
 * open-response or exit-ticket slide is *for* under Recall, Explain, Apply or Evaluate. UX ruling
 * 82: an outline entry has no minutes, so the slide line gives kind, phase and facts only. UX
 * ruling 81: an `instructions` slide whose facts are questions is the shared practise slide; its
 * steps are those stems verbatim and its answers go in `notes`. Quality PRD G3: when the outline
 * assigns the entry a callout, the slide line names its kind and fact ids and the writer fills
 * `callout` from them; `withAssignedCallout` (specs.ts) checks presence and kind.
 *
 * v20 (23 Sep 2026, minimalism rubric): dropped the geometry sentence (a per-kind schema admits no
 * such field), the `factRefs` echo (HOUSE_RULES says it), two "never a reserved stem" (the user turn
 * lists them), the forty-words line (the limits block) and "answers correct, distractors plausible"
 * (questions are copied verbatim; no bench failure it fixed).
 *
 * v22 (23 Sep 2026, np1 root cause RC1 follow-up): `outline-from-facts` now puts up to two key
 * ideas on one content slide, and v21's content rule spoke of "the key idea" only. A content slide
 * whose facts include two key ideas teaches both: the heading says what joins them, the body is
 * two short paragraphs, one per idea, in up to 60 words (the one-idea body stays 40). The number
 * lives in the content shape only; `SPEC_LIMITS.body` (400 characters) already holds 60 words, so
 * no schema change. Renderer: a body over forty words is laid out `two-column` (`chooseVariant`);
 * `splitAtFullStop` (`@tj/slides`) now splits at the first line break when there is one, so each
 * column carries one idea (a first draft asked for "the first in one sentence": Luna wrote the
 * first idea across two sentences on 3 of 3 long bodies, so a full-stop split cut it in half).
 *
 * v23 (24 Sep 2026, lab r3, checks.md §3 / judge B testedNotTaught): the questions that later
 * test a teaching slide's key ideas reach its writer (`laterQuestions`, read-only, lab only).
 * Round-1/2 exit and check items asked for a quotation, a name, a reason, an example or a step
 * the facts held and the slide compressed away ("I'll break my staff", Duke of Milan, why not
 * every child was evacuated, a named defence mechanism, PED from percentage changes). The user
 * turn lists them with their answers and one instruction: teach here what each answer rests on,
 * within the slide's limits. System text unchanged; the production render (no field) is
 * byte-identical, so the pinned hash did not move.
 *
 * v24 (24 Sept 2026 audit, FIX-PLAN B4): a slide whose facts include vocabulary is told, in the
 * user turn, to define each term where it is first used or in `notes` (the outline puts terms on
 * content slides and no rule said to define them). The later-questions line no longer says "or
 * repeating their answer text": the question writer answers from the taught text, so no slide
 * could teach what an answer rests on without repeating it. Reserved stems go only to the kinds
 * that compose a stem or task (`STEM_KINDS`); a content, worked-example or copied-question slide
 * writes none, and the list was up to 700 characters of noise on each. Not done: a per-kind system
 * text. The system text is the same on every call, so the provider caches it; moving the shapes and
 * examples into the user turn would shrink the call but lose that cache, costing more per slide.
 *
 * v25 (25 Sept 2026, luna-direct DIAGNOSIS FM3): "asserted, not explained" was the commonest
 * explanation fault (29 whys in 57 decks, every cell), and no deck reached the 5 anchor ("an
 * example, and the misconception it heads off is named"). The content rule now orders the body as
 * a build-up: the claim in the heading, the reason it holds, then the example showing that reason.
 * The outline often puts the WATCH OUT callout on another slide (02f34f: the groyne watch-out on
 * the erosion slide), so a teaching slide without its own watch-out is told, by a code-built line
 * (`ownMisconceptions`), to name its objective's misconception in one closing sentence.
 *
 * v26 (TEACH-89, ADR 0032): `diagram` is generatable. A diagram slide's call carries a figure block
 * in the user turn (`figureBlock`, `./figures`): the template its `figureBrief` names, its values in
 * words, what the figure is for, and that the labels carry the numbers of the worked example or
 * question the slide covers. The system text is unchanged (it is at its word budget and cached),
 * so the pinned hash of the non-diagram sample did not move.
 *
 * v27 (TEACH-94): the figure block describes the `energy-profile` template's values, and its
 * numbers line is per template (`FIGURE_NUMBERS`): an energy profile's numbers are its two
 * energies, and its labels name the substances. The right-triangle block reads as before, and the
 * system text and the pinned hash are unchanged again.
 *
 * v29 (TEACH-253, ADR 0034 decision 5): a diagram slide whose fact carries the figure gets the
 * "shows" block instead (`figureShownBlock`): the figure's template and values, the unknown's value
 * left out, and a text-only answer shape. Diagram calls only, so the pinned hash is unchanged.
 *
 * v30 (TEACH-11 port, lab pe-it5): `IMAGE_TEXT_RULE` no longer tells the writer to put what the
 * picture cannot show in `notes`. On a context slide, outside that clause's identify-parts scope,
 * the writer wrote "the photograph does not show wall ruins"; the judge scored notes 1 and Evaluate
 * raised `image-fit` on that sentence. The notes now give the teacher a move instead. Shared with
 * Repair (v17).
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
  /**
   * Lab only (r3, `laterQuestionsFor`): on a teaching slide, the questions later in the lesson that
   * test its key ideas, stem and answer, read-only; at most 4, shortest first. Absent in
   * production and when no later slide asks about this slide's key ideas.
   */
  laterQuestions?: { stem: string; answer: string }[] | undefined;
  /**
   * For a `diagram` entry whose fact carries the figure (TEACH-253, `figureOfEntry`): the figure
   * the slide shows, so the call writes the text around it and not the values.
   */
  figure?: FigureRef | undefined;
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
  "An `image-text` slide is written to its photograph. Say 'the photograph' (singular when there is one). A task — spot, find, count, point to, look for, identify, circle, label — may name only items listed as visible. Describe only what the caption and the visible list say is there; never name a kind of animal, plant, object or place the caption does not name. If a required item is not visible, `notes` tell the teacher to say or show it another way; never say what the photograph does not show. If there is no photograph, do not mention a picture at all.";

const SHAPES = {
  title: '{ "kind": "title", "title", "subtitle", "factRefs", "notes"? }',
  objectives: '{ "kind": "objectives", "items": [1–4 strings], "factRefs", "notes"? }',
  starter:
    '{ "kind": "starter", "heading"?, "items": [1–3 strings], "footnote"?, "factRefs", "notes"? }',
  vocabulary:
    '{ "kind": "vocabulary", "entries": [{ "term", "definition" }] (1–slots), "factRefs", "notes"? }',
  content:
    '{ "kind": "content", "heading", "body" (≤ 40 words; ≤ 60 with two key ideas), "callout"?: { "kind", "text" }, "factRefs", "notes"? }',
  "image-text":
    '{ "kind": "image-text", "heading", "body" (≤ 40 words), "callout"?: { "kind", "text" }, "factRefs", "notes"? }',
  "worked-example":
    '{ "kind": "worked-example", "heading"?, "question" (one or two lines), "steps": [1–4 strings, each one short line of about 56 characters], "callout"?: { "kind", "text" }, "factRefs", "notes"? }',
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

/** The kinds that compose a stem, prompt or task of their own, so the reserved stems apply. */
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

/**
 * v25: the misconceptions a teaching slide names itself. A `content` or `image-text` slide whose
 * key ideas share an objective with a misconception names it in the body, unless this slide's own
 * watch-out callout carries it. Code decides, so the line is bare (CORE 2026-09-22: an exception
 * on a packet line is decided in code). Empty for every other slide, which keeps their text as v24.
 */
export function ownMisconceptions(input: GenerateSlideInput): string[] {
  if (input.entry.kind !== "content" && input.entry.kind !== "image-text") return [];
  if (input.entry.callout?.kind === "watch-out") return [];
  const objectives = new Set(
    (input.referenced.keyIdeas ?? [])
      .filter((k) => input.entry.factRefs.includes(k.id))
      .flatMap((k) => k.objectiveRefs ?? []),
  );
  return input.referenced.misconceptions
    .filter((m) => (m.objectiveRefs ?? []).some((o) => objectives.has(o)))
    .map((m) => m.id);
}

export const generateSlidePrompt = {
  version: "generate-slide.v31",
  system: [
    "You write one slide of a classroom lesson from the lesson's facts.",
    "",
    "Rules:",
    HOUSE_RULES,
    "Write what the slide line says this slide adds, from the facts it names; do not repeat its neighbours.",
    "Follow the supplied objective verb. On content slides the heading is the key idea's statement and the body is its explanation, then its example, as the facts give them. With two key ideas, the heading says what joins them and the body is one paragraph per idea. Question slides use the supplied question, answer and distractors verbatim.",
    'When an `instructions` slide\'s facts include questions, it is shared practise: `heading` "Your turn"; each step is one of those questions\' stems verbatim, in the order this slide\'s facts name them, with no number (the layout numbers them). `notes` gives each answer on its own line ("1. <answer>"), then the misconception to watch for. `footnote` may say how pupils answer (mini-whiteboards or books).',
    "For a `worked-example`, the question is the source problem, each step of the source working is one line, word for word and in order; add the answer as a last line only when the last step does not give it. Put fuller working in `notes`.",
    '`notes`: what to say (a key idea\'s "Teacher says", where the facts give one), the misconception in words rather than ids, and a question whose answer is not already on the slide.',
    "`footnote` is one short line pupils read — how long they have, where to write, what to do when finished. Anything addressed to the teacher goes in `notes`; leave `footnote` out rather than fill it.",
    IMAGE_TEXT_RULE,
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
      "callout text": SPEC_LIMITS.callout,
      notes: SPEC_LIMITS.notes,
    }),
    "",
    "The JSON shape per kind (`callout`, where shown, only when the slide line assigns one):",
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
    "Example for a worked-example slide: one line per source step.",
    "Source working: 84 = 80 + 4. | 80 ÷ 4 = 20; 4 ÷ 4 = 1. | 20 + 1 = 21. | So 84 ÷ 4 = 21.",
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
      `Slide ${input.position.index} of ${input.position.total}: kind "${input.entry.kind}"${input.phase ? `, ${input.phase} phase` : ""}, covering facts ${input.entry.factRefs.join(", ") || "(none named)"}.`,
    ];
    if (input.entry.brief) {
      parts.push(`This slide adds: ${input.entry.brief.adds}`);
      if (input.entry.brief.avoids) parts.push(`It must not: ${input.entry.brief.avoids}`);
    }
    if (input.neighbours.previous)
      parts.push(`The slide before adds: ${input.neighbours.previous}`);
    if (input.neighbours.next) parts.push(`The slide after adds: ${input.neighbours.next}`);
    if (input.entry.callout) {
      const { kind, factRefs } = input.entry.callout;
      parts.push(
        `This slide carries a "${kind}" callout: set \`callout\` to kind "${kind}" with \`text\` one line for pupils, from ${factRefs.join(", ")} only.`,
      );
    }
    const misconceptions = ownMisconceptions(input);
    if (misconceptions.length > 0) {
      parts.push(
        `Its misconception (${misconceptions.join(", ")}): say in \`notes\` what some pupils think and why it is wrong.`,
      );
    }
    if (input.photo !== undefined) parts.push(...photoBlock(input.photo));
    if (input.entry.kind === "diagram" && input.figure) {
      parts.push(...figureShownBlock(input.figure));
    } else if (input.entry.kind === "diagram" && input.entry.figureBrief) {
      parts.push(...figureBlock(input.entry.figureBrief));
    }
    if (input.entry.kind === "vocabulary") {
      parts.push(
        `This theme shows at most ${input.vocabularySlots} vocabulary entries. When there are more terms than that, keep every term another shown definition uses, then the terms the objectives name; put the rest in \`notes\` with their definitions.`,
      );
    }
    if (input.entry.kind !== "vocabulary" && input.referenced.vocabulary.length > 0) {
      parts.push(
        "Define each vocabulary term in a few words where the slide first uses it, or in `notes` if that will not fit.",
      );
    }
    if (input.reservedStems.length > 0 && STEM_KINDS.has(input.entry.kind)) {
      parts.push("", "Reserved for other slides or the worksheet — do not use these stems:");
      for (const stem of input.reservedStems) parts.push(`  - ${stem}`);
    }
    if (input.laterQuestions?.length) {
      parts.push("", "Asked of pupils later in the lesson, on later slides (shown for reference):");
      for (const q of input.laterQuestions) parts.push(`  - ${q.stem} — answer: ${q.answer}`);
      parts.push(
        "Teach here, within this slide's limits, what each answer rests on — the name, quotation, reason, example or step a pupil needs — without naming these questions.",
      );
    }
    parts.push("", `Answer with the JSON for a "${input.entry.kind}" slide.`);
    return parts.join("\n");
  },
} as const;
