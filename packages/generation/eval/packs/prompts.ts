import { z } from "zod";
import type { StructuredPrompt } from "../../src/call";
import {
  type PlanFactsObjectiveInput,
  planFactsObjectivePrompt,
  QUESTION_DEMANDS,
  QUESTION_FORMS,
  SHAPE_SKETCH,
} from "../../src/prompts/plan-facts-objective";
import { RUBRIC_DIMENSIONS } from "../rubric-prompt";
import { FACT_TYPES, type FactType, type Sentence } from "./schema";

/*
 * Pack prompts. `pack-rewrite` and `pack-fill` are written (v2, 23 Sept 2026, PE Fable 5.1; np1's
 * reduced scope: authoring arms luna-rewrite and sol-rewrite, no paid judge). The rest are STUBS —
 * NOT PROMPTS: placeholders so the harness wires, type-checks and dry-runs, to be written by a
 * prompt-engineer agent against the specs in `scratchpad/quality-prd/lab/np1/harness.md`
 * ("Prompt specs"); nothing else may edit them. A version ending in `.stub` is refused by every
 * live path (`assertNoStubs`), so a stub can never spend money by accident.
 *
 * Six call types: pack-rewrite (arms 1 and 2), pack-knowledge and pack-link (arm 3), pack-check
 * (two blind checkers), pack-select (objective → section | none, full | partial, missing types
 * and concepts), pack-fill (a facts call for the missing types only), judge-addendum (the two
 * rubric items the 15 Sept rubric lacks: fidelity and wrong facts).
 */

export const STUB_SUFFIX = ".stub";
export const isStub = (prompt: { version: string }) => prompt.version.endsWith(STUB_SUFFIX);

/** Refuse a live call on a stub: the harness may dry-run and test a stub, never pay for one. */
export function assertNoStubs(prompts: readonly { version: string }[]): void {
  const stubs = prompts.filter(isStub).map((p) => p.version);
  if (stubs.length > 0)
    throw new Error(
      `live run refused: prompt stubs not yet written by prompt-engineer: ${stubs.join(", ")}`,
    );
}

const STUB_SYSTEM = (name: string) =>
  `STUB ${name}: not a prompt. To be written by prompt-engineer; spec in quality-prd/lab/np1/harness.md.`;

const sentenceLines = (sentences: readonly Sentence[]) =>
  sentences.map((s) => `${s.id}: ${s.text}`).join("\n");

/* ------------------------------- shared output pieces ------------------------------------ */

const line = z.string().trim().min(1);
/** What a writing call says supports a fact: sentence ids from the window and a ≤ 25-word verbatim snippet. */
const WrittenEvidence = z.strictObject({
  sentenceIds: z.array(z.string().regex(/^s\d+\.\d+$/)).min(1),
  snippet: line,
});
const withWritten = <T extends z.ZodRawShape>(shape: T) =>
  z.strictObject({ ...shape, evidence: z.array(WrittenEvidence).min(1) });
const MisconceptionOrdinal = z.strictObject({
  type: z.literal("misconception"),
  index: z.number().int().nonnegative(),
});
/*
 * The item shapes, less `analogy` on a key idea (the facts call keeps it optional): sources rarely
 * state one, the checker reads it as a claim ("Analogy:" in `checkFactText`), and a slot in the
 * shape gets filled whatever the prose says, so the slot goes rather than a rule about it.
 */
const bare = {
  keyIdea: { statement: line, explanation: line, example: line },
  misconception: { belief: line, correction: line },
  vocabulary: {
    term: line,
    sense: line,
    band: z.string().regex(/^Y\d{1,2}(-\d{1,2})?$/),
    definition: line,
  },
  workedExample: {
    problem: line,
    steps: z.array(line).min(1).max(6),
    answer: line,
    objectiveRefs: z
      .array(z.strictObject({ type: z.literal("objective"), index: z.literal(0) }))
      .min(1),
    misconceptionRef: MisconceptionOrdinal.optional(),
  },
  question: {
    stem: line,
    answer: line,
    reasoning: line,
    tier: z.enum(["easy", "core", "stretch"]),
    use: z.enum(["slide", "worksheet", "exit", "any"]),
    demand: z.enum(QUESTION_DEMANDS),
    forms: z.array(z.enum(QUESTION_FORMS)).min(1),
    distractors: z
      .array(z.strictObject({ text: line, misconceptionRef: MisconceptionOrdinal.optional() }))
      .max(3)
      .optional(),
  },
} as const;

/** A rewrite call's answer: the section's facts, each with the sentences it was written from. */
export const PackWriteOutputSchema = z.strictObject({
  keyIdeas: z.array(withWritten(bare.keyIdea)).min(1).max(3),
  misconceptions: z.array(withWritten(bare.misconception)).max(2),
  vocabulary: z.array(withWritten(bare.vocabulary)).max(3),
  workedExamples: z.array(withWritten(bare.workedExample)).max(1),
  questions: z.array(withWritten(bare.question)).min(3).max(4),
});
export type PackWriteOutput = z.infer<typeof PackWriteOutputSchema>;

/** A knowledge call's answer: the same facts with no evidence (the link call adds it). */
export const PackKnowledgeOutputSchema = z.strictObject({
  keyIdeas: z.array(z.strictObject(bare.keyIdea)).min(1).max(3),
  misconceptions: z.array(z.strictObject(bare.misconception)).min(1).max(2),
  vocabulary: z.array(z.strictObject(bare.vocabulary)).max(3),
  workedExamples: z.array(z.strictObject(bare.workedExample)).max(1),
  questions: z.array(z.strictObject(bare.question)).min(3).max(4),
});
export type PackKnowledgeOutput = z.infer<typeof PackKnowledgeOutputSchema>;

/** The link call: for each numbered fact, the sentences that support it, or none. */
export const PackLinkOutputSchema = z.strictObject({
  links: z.array(
    z.strictObject({
      fact: z.number().int().nonnegative(),
      supported: z.enum(["yes", "partly", "no"]),
      evidence: z.array(WrittenEvidence),
    }),
  ),
});
export type PackLinkOutput = z.infer<typeof PackLinkOutputSchema>;

/** A checker's verdicts, one per numbered fact; recorded as given, never merged by code. */
export const PackCheckOutputSchema = z.strictObject({
  verdicts: z.array(
    z.strictObject({
      fact: z.number().int().nonnegative(),
      supportedByEvidence: z.enum(["yes", "partly", "no"]),
      valuesStated: z.enum(["yes", "no", "none"]),
      correct: z.enum(["yes", "no", "unsure"]),
      pitched: z.enum(["yes", "no"]),
      note: z.string().max(200),
    }),
  ),
});
export type PackCheckOutput = z.infer<typeof PackCheckOutputSchema>;

/** The select call: which section (if any) covers an objective, how fully, and what is missing. */
export const PackSelectOutputSchema = z.strictObject({
  section: z.number().int().nonnegative().nullable(),
  coverage: z.enum(["full", "partial", "none"]),
  missingTypes: z.array(z.enum(FACT_TYPES)),
  missingConcepts: z.array(z.string().max(120)).max(6),
});
export type PackSelectOutput = z.infer<typeof PackSelectOutputSchema>;

/** The judge addendum: the two items the 15 Sept rubric lacks. */
export const JudgeAddendumOutputSchema = z.strictObject({
  fidelity: z.strictObject({
    score: z.number().int().min(1).max(5),
    addedClaims: z.array(z.string().max(200)).max(10),
    rationale: z.string().max(300),
  }),
  wrongFacts: z.strictObject({
    score: z.number().int().min(1).max(5),
    wrong: z.array(z.string().max(200)).max(10),
    rationale: z.string().max(300),
  }),
});
export type JudgeAddendumOutput = z.infer<typeof JudgeAddendumOutputSchema>;

/* ---------------------------------- inputs and stubs -------------------------------------- */

export interface PackWriteInput {
  topic: string;
  subject: string;
  yearGroup: string;
  outcome: string;
  sentences: readonly Sentence[];
}

export interface PackKnowledgeInput {
  topic: string;
  subject: string;
  yearGroup: string;
  outcome: string;
}

export interface PackLinkInput {
  outcome: string;
  /** Each fact flattened to one line, numbered from 0. */
  facts: readonly string[];
  sentences: readonly Sentence[];
}

export interface PackCheckInput {
  subject: string;
  yearGroup: string;
  outcome: string;
  /** Each fact flattened to one line, numbered from 0, followed by its evidence sentences. */
  facts: readonly { text: string; evidence: readonly string[] }[];
}

export interface PackSelectInput {
  subject: string;
  /** The lesson's year group. */
  yearGroup: string;
  /** The pack's own year group, shown so an other-band pack is not read as a match. */
  packYearGroup: string;
  objective: string;
  /** Every section of the matched pack: its outcome and which fact types it holds. */
  sections: readonly { outcome: string; types: readonly string[] }[];
}

export interface JudgeAddendumInput {
  topic: string;
  factsText: string;
  deckText: string;
}

/*
 * pack-rewrite.v1 (23 Sept 2026, PE Fable 5.1; runs on gpt-5.6-luna and gpt-6-sol, medium). Built on
 * the bake-off winner (`pe-bakeoff/prompts/fable51-rewrite.json`, 97% supported, 0 wrong of 141):
 * the checker described first, goals ranked, write-then-compare for own words. Changed on the
 * bake-off's losses (RESULTS.md, LUNA-PROMPTING-GUIDE §6–8): misconceptions "really make … omit
 * rather than invent" and zero allowed (schema min 0, the fill call writes one for a section with
 * none); multiple-choice has an open-response exit ("most questions multiple-choice" forced
 * throwaway distractors); a worked example only where the sentences give a method; pitch by the
 * three concrete bands. The copy limit is the code's own (overlap.ts flags 8) with the method,
 * since the method beat a tighter number. Counts are prose once: the gateway's non-strict route
 * ignores minItems/maxItems. Tiers: "at least one at each" is the facts call's v8 finding, and
 * a section's questions reach a lesson through `sectionToObjectiveFacts`.
 *
 * v2 (same day, minimalism rubric pass; not run live): the snippet check is stated once (the
 * Evidence line, which carries the 25-word cap no schema enforces) and the checker paragraph keeps
 * only the copying flag; the objectiveRefs sentence goes (both values are schema literals and
 * `pack-arms.ts` `retarget` overwrites the index); rule 1 no longer re-lists the schema's fields;
 * `analogy` leaves the key-idea shape (see `bare`); British English (HOUSE_RULES, harness.md
 * common ground) is in the task sentence, and the topic is named there as an input the call uses
 * (rule 3's scope, vocabulary's `sense`). The house rules' no-names line is not carried: rule 1
 * bars anything the cited sentences do not state, an invented person included.
 */
export const packRewritePrompt: StructuredPrompt<PackWriteInput> = {
  version: "pack-rewrite.v2",
  system: [
    "You write teacher-facing facts, in British English, for one section of a UK school topic pack. You are given the topic, the subject, the year group, the section's outcome and numbered source sentences; not every sentence is relevant.",
    "",
    "How the output is checked: a checker sees each item with only the sentences whose ids it cites, and judges apart whether every part of the item is stated by those sentences (a true claim from outside them fails) and whether it is correct. Code flags any run of eight or more consecutive words an item shares with a source sentence as copying.",
    "",
    "What matters, in order:",
    '1. Supported. Every part of an item, each distractor\'s wrongness included, is confirmable from its cited sentences alone: no widening ("most" does not become "all"), no hedge dropped ("thought to", "usually"). Leave out anything worth saying that no sentence supports.',
    "2. Own words. Write each item fresh from your understanding, then compare it with the sentences: restructure a sentence that shares a run of words rather than swapping one word. A name, date, figure, formula or technical term may be copied; the prose around it is yours. Never mention the sources or sentence ids inside an item.",
    "3. Useful and pitched. Only what a pupil needs to reach this outcome, not the rest of the topic. Years 1-6: short concrete sentences in everyday words; Years 7-11: GCSE precision; Years 12-13: A-level detail and terminology. Every string is slide-ready and makes sense on its own.",
    "",
    "Evidence: each item's evidence lists the ids of the sentences that support it, one entry per sentence or run of sentences, with a snippet: one unbroken run of at most 25 words copied exactly from one of those sentences.",
    "",
    "Lists:",
    "- keyIdeas, one to three, in teaching order. statement: one claim; explanation: how or why; example: a concrete case from the sentences.",
    "- misconceptions, up to two: errors pupils of this year group really make about this outcome, where the cited sentences establish the correction. Omit rather than invent; none is fine.",
    '- vocabulary, up to three: the terms this year group must learn for the outcome. sense: the meaning taught here (e.g. "in geography, not everyday use"); band: the years the definition is pitched at, as "Y5" or "Y7-9"; definition: in words the year group already has, none of them the term\'s own.',
    "- workedExamples, one only when the sentences give a method, formula or procedure to apply to a concrete problem, each step following from the cited sentences; otherwise none.",
    "- questions, three or four, at least one at each tier (easy, core, stretch), each answered by a fact in your key ideas or vocabulary. demand is what the question asks of the pupil: recall (name or state), explanation (how or why), apply (use the method) or judgement (decide, with a reason). forms lists every way the question can be set as written: multiple-choice, true-false, open-response. Multiple-choice needs three distractors: the same kind of thing as the answer, believable to this year group, never a second correct answer; when three such distractors are not available, set the question as open-response and give none. Where a distractor or worked example heads off a misconception, say so in misconceptionRef.",
  ].join("\n"),
  user: (i) =>
    [
      `Topic: ${i.topic}`,
      `Subject: ${i.subject}; Year group: ${i.yearGroup}`,
      `Outcome: ${i.outcome}`,
      "Source sentences:",
      sentenceLines(i.sentences),
    ].join("\n"),
};

/** A recall call's answer: the rewrite call's lists and counts, with no evidence (no sources). */
export const PackRecallOutputSchema = z.strictObject({
  keyIdeas: z.array(z.strictObject(bare.keyIdea)).min(1).max(3),
  misconceptions: z.array(z.strictObject(bare.misconception)).max(2),
  vocabulary: z.array(z.strictObject(bare.vocabulary)).max(3),
  workedExamples: z.array(z.strictObject(bare.workedExample)).max(1),
  questions: z.array(z.strictObject(bare.question)).min(3).max(4),
});
export type PackRecallOutput = z.infer<typeof PackRecallOutputSchema>;

export type PackRecallInput = PackKnowledgeInput;

/*
 * pack-recall.v1 (23 Sept 2026, PE; gpt-6-sol, medium; W7 arm M, "Sol from memory"). pack-rewrite.v2
 * with every source clause removed (evidence, the copying check, own words, "from the sentences"),
 * so the two arms differ only in where the facts come from. The checker described is W7's audit.
 * Goals re-ranked for writing without a source: correct first, with a certainty rule for the
 * values a writer adds most easily (dates, numbers, names; pack-check.v2 notes) and contested
 * claims named as contested (the arm's non-Oak topics are Freud and his critics, Weimar); pitched
 * second, with the key stage derived in code (`keyStageOf`, the pack-check.v2 finding that a
 * supplied key stage makes the pitch call work) and the Years 7-9 band split from GCSE, since
 * "Years 7-11: GCSE precision" is the band the np1 cells packs over-pitched. Counts in prose once
 * (the gateway's non-strict route ignores minItems/maxItems). Not in `PACK_PROMPTS`: np1 freezes
 * a hash of every entry there, and W7 is not np1.
 */
export const packRecallPrompt: StructuredPrompt<PackRecallInput> = {
  version: "pack-recall.v1",
  system: [
    "You write teacher-facing facts, in British English, from your own knowledge, for one section of a UK school topic pack. You are given the topic, the subject, the year group with its key stage in England, and the section's outcome.",
    "",
    "How the output is checked: an auditor verifies every item against reputable sources and rates it true, an acceptable simplification, misleading or false; and rates it above, at or below the key stage against the national curriculum or exam-board specification.",
    "",
    "What matters, in order:",
    "1. Correct. Every part of an item is true as written, each distractor's wrongness included; a simplification for the year group must stay true. Give a date, number, name or attribution only when you are certain of it, otherwise leave it out. Where experts disagree, say so rather than state one view as settled.",
    "2. Pitched. Only concepts and terms pupils are taught at this key stage in this subject; leave out anything first taught later. Years 1-6: short concrete sentences in everyday words; Years 7-9: Key Stage 3 depth; Years 10-11: GCSE precision; Years 12-13: A-level detail and terminology.",
    "3. Useful. Only what a pupil needs to reach this outcome, not the rest of the topic. Every string is slide-ready and makes sense on its own.",
    "",
    "Lists:",
    "- keyIdeas, one to three, in teaching order. statement: one claim; explanation: how or why; example: a concrete case.",
    "- misconceptions, up to two: errors pupils of this year group really make about this outcome. Omit rather than invent; none is fine.",
    '- vocabulary, up to three: the terms this year group must learn for the outcome. sense: the meaning taught here (e.g. "in geography, not everyday use"); band: the years the definition is pitched at, as "Y5" or "Y7-9"; definition: in words the year group already has, none of them the term\'s own.',
    "- workedExamples, one only when the outcome asks pupils to apply a method, formula or procedure to a concrete problem; otherwise none.",
    "- questions, three or four, at least one at each tier (easy, core, stretch), each answered by a fact in your key ideas or vocabulary. demand is what the question asks of the pupil: recall (name or state), explanation (how or why), apply (use the method) or judgement (decide, with a reason). forms lists every way the question can be set as written: multiple-choice, true-false, open-response. Multiple-choice needs three distractors: the same kind of thing as the answer, believable to this year group, never a second correct answer; when three such distractors are not available, set the question as open-response and give none. Where a distractor or worked example heads off a misconception, say so in misconceptionRef.",
  ].join("\n"),
  user: (i) =>
    [
      `Topic: ${i.topic}`,
      `Subject: ${i.subject}; Year group: ${i.yearGroup}${keyStageOf(i.yearGroup)}`,
      `Outcome: ${i.outcome}`,
    ].join("\n"),
};

/* ------------------------- W7b: checklist before recall (C and S arms) ------------------------ */

/**
 * A checklist call's answer. `basis` comes first so the list is written against it, and it is an
 * enum so the call cannot invent a specification code. `none` is the dynamic-knowledge-base case
 * (an outcome no curriculum covers); downstream can treat that list as judgement, not a spec.
 * The prose count is six to twelve with an escape hatch, so the schema's floor is one.
 */
export const PackChecklistOutputSchema = z.strictObject({
  basis: z.enum(["exam-specification", "programme-of-study", "none"]),
  items: z.array(line).min(1).max(12),
});
export type PackChecklistOutput = z.infer<typeof PackChecklistOutputSchema>;

export interface PackChecklistInput {
  subject: string;
  yearGroup: string;
  outcome: string;
}

/*
 * pack-checklist.v1 (24 Sept 2026, PE; gpt-6-sol, medium; W7b arm S). W7's audits found M's gaps
 * were the named specifics a teacher of the band expects (Plautius, Dreadnought, Liebknecht and
 * Luxemburg, Seeckt) and A-level depth on Weimar (10 of 21 facts below band); none were errors.
 * So the call asks for specifics, not headings (one contrastive pair, from a topic outside the
 * W7 sample), and states the depth both ways ("not shallower", "nothing first taught later").
 * `basis` is declared first and is an enum: the list is written against it, and `none` makes an
 * outcome no curriculum covers explicit instead of silently padded (Greg, 24 Sept: the dynamic
 * knowledge base will ask for outcomes with no defined curriculum). The count has an escape hatch
 * because a hard floor on a niche outcome forces invented items. Certainty rule as pack-recall.v1.
 * No topic line: the outcome carries the content and the topic id is a slug.
 */
export const packChecklistPrompt: StructuredPrompt<PackChecklistInput> = {
  version: "pack-checklist.v1",
  system: [
    "You list what a lesson on one outcome must cover, for a UK school teacher. You are given the subject, the year group with its key stage in England, and the outcome.",
    "",
    "basis: exam-specification when a GCSE, A-level or other UK exam specification in this subject covers the outcome at this year group; programme-of-study when the national curriculum for England covers it; none when neither does, and then work from what a well-read teacher of this year group would expect.",
    "",
    'items: six to twelve, most essential first (fewer only when you cannot name six you are certain of). Each is one line naming one thing the lesson must cover (a person, event, date, term, process, case or standard example) as specifically as a teacher marking against the basis expects it: "word equation for photosynthesis: carbon dioxide + water → glucose + oxygen", not "photosynthesis". Only what this outcome needs, at the depth this year group is taught: not shallower, and nothing first taught at a later key stage. Put a date, number or name in an item only when you are certain of it.',
  ].join("\n"),
  user: (i) =>
    [
      `Subject: ${i.subject}; Year group: ${i.yearGroup}${keyStageOf(i.yearGroup)}`,
      `Outcome: ${i.outcome}`,
    ].join("\n"),
};

/** pack-recall.v1's answer plus `uncovered`: the checklist items the facts leave out, verbatim. */
export const PackRecallV2OutputSchema = PackRecallOutputSchema.extend({
  uncovered: z.array(line).optional(),
});
export type PackRecallV2Output = z.infer<typeof PackRecallV2OutputSchema>;

export interface PackRecallV2Input extends PackRecallInput {
  /** What the section must cover, one line an item; absent, the call is pack-recall.v1. */
  checklist?: readonly string[];
}

/*
 * pack-recall.v2 (24 Sept 2026, PE; gpt-6-sol, medium; W7b arms C and S). pack-recall.v1 with an
 * optional checklist. The system text is v1's, byte for byte, and the checklist and its one rule
 * go on the user line only when a checklist is given, so v2 without one is v1 (the M arm stays
 * comparable) and no call names an input it does not have. The rule sits under "correct" in v1's
 * ranking: an item it is not certain of is listed in `uncovered`, verbatim so code can diff it
 * against the checklist, rather than guessed to fill coverage. Coverage is placed in key ideas,
 * misconceptions and vocabulary (questions stay answered by those), and one fact may carry
 * several items, because v1's counts (three key ideas, three terms) stay and a checklist runs to
 * twelve.
 */
export const packRecallV2Prompt: StructuredPrompt<PackRecallV2Input> = {
  version: "pack-recall.v2",
  system: packRecallPrompt.system,
  user: (i) => {
    const base = packRecallPrompt.user(i);
    if (!i.checklist?.length) return base;
    return [
      base,
      "Checklist of what this section must cover:",
      ...i.checklist.map((item) => `- ${item}`),
      "Cover every checklist item in your key ideas, misconceptions or vocabulary; one fact may cover several items, in its statement, explanation or example. In uncovered, copy exactly each item your facts do not cover. Leave an item uncovered rather than state anything in it you are not certain of.",
    ].join("\n");
  },
};

export const packKnowledgePrompt: StructuredPrompt<PackKnowledgeInput> = {
  version: `pack-knowledge.v0${STUB_SUFFIX}`,
  system: STUB_SYSTEM("pack-knowledge"),
  user: (i) =>
    [
      `Topic: ${i.topic}`,
      `Subject: ${i.subject}; Year group: ${i.yearGroup}`,
      `Outcome: ${i.outcome}`,
    ].join("\n"),
};

export const packLinkPrompt: StructuredPrompt<PackLinkInput> = {
  version: `pack-link.v0${STUB_SUFFIX}`,
  system: STUB_SYSTEM("pack-link"),
  user: (i) =>
    [
      `Outcome: ${i.outcome}`,
      "Facts:",
      ...i.facts.map((f, n) => `${n}: ${f}`),
      "Source sentences:",
      sentenceLines(i.sentences),
    ].join("\n"),
};

/**
 * A fact as the checkers read it: each field labelled, because two fields are false by design (a
 * misconception's belief, a question's wrong options) and an unlabelled run of text reads them as
 * claims. `factText` (overlap.ts) joins the same fields unlabelled for the n-gram check.
 */
export function checkFactText(type: FactType, fact: object): string {
  const f = fact as Record<string, unknown>;
  const s = (k: string) => (typeof f[k] === "string" ? (f[k] as string) : "");
  switch (type) {
    case "keyIdeas":
      return [
        `Key idea: ${s("statement")} ${s("explanation")}`,
        `Example: ${s("example")}`,
        ...(s("analogy") ? [`Analogy: ${s("analogy")}`] : []),
      ].join(" | ");
    case "misconceptions":
      return `Misconception: ${s("belief")} | Correction: ${s("correction")}`;
    case "vocabulary":
      return `Term: ${s("term")} | Definition: ${s("definition")}`;
    case "workedExamples": {
      const steps = Array.isArray(f.steps) ? (f.steps as string[]) : [];
      return `Worked example: ${s("problem")} | Steps: ${steps.map((x, i) => `${i + 1}. ${x}`).join(" ")} | Answer: ${s("answer")}`;
    }
    case "questions": {
      const wrong = Array.isArray(f.distractors)
        ? (f.distractors as { text: string }[]).map((d) => d.text)
        : [];
      return [
        `Question: ${s("stem")}`,
        `Answer: ${s("answer")}`,
        `Reasoning: ${s("reasoning")}`,
        ...(wrong.length ? [`Wrong options: ${wrong.join("; ")}`] : []),
      ].join(" | ");
    }
  }
}

/*
 * pack-check.v2 (gpt-5.6-luna and gpt-6-sol, low, the same prompt in two blind calls). Four
 * verdicts per fact, defined apart and never combined here: code records them and admission
 * (`admitPack` with the np2 gates, `experiments/pack-gates.v2.json`) applies them. Tie-breaks go to
 * the side that certifies less. Changes from v1, each from an np1 failure that passed both
 * checkers: `pitched` (a Year 7 cells section on centrosomes, microtubules and the spindle);
 * `valuesStated` (dates and numbers are the claims a writer adds most easily); `correct` told the
 * evidence can itself be wrong (two Russian Revolution facts copied from a garbled source sentence,
 * and one whose "eventually" placed a 1922 event before 1920); v1's "arithmetic on stated numbers
 * counts as stated" removed (a rubric judge failed it). The year group is shown with its key stage,
 * derived in code, so `pitched` does not have to infer it.
 */
export const packCheckPrompt: StructuredPrompt<PackCheckInput> = {
  version: "pack-check.v2",
  system: `You check the facts in one section of a lesson pack for pupils of the year group given. Each numbered fact is followed by the source sentences cited for it, one per "evidence:" line. Give every fact four verdicts, each decided on its own ground; one never changes another.

supportedByEvidence: read only the evidence lines, not your own knowledge.
- yes: they state everything the fact claims. Rewording and simplifying for the year group count as stated.
- partly: they state some of it, but the fact adds a claim, date, name, number, cause or example they do not contain.
- no: they state none of it, contradict it, or the fact has no evidence lines.

valuesStated: read only the evidence lines.
- none: the fact gives no date, number or order of events.
- yes: every date, number and order of events in the fact is stated in the evidence lines with the same value, for the same thing.
- no: any one is not, including one worked out from the evidence rather than stated there.

correct: use your own knowledge of the subject, not the evidence; the evidence can itself be wrong. Check each date, number, name and who did what.
- yes: true; a simplification for the year group that stays true counts.
- no: false, or would leave a pupil believing something false, such as an event placed in the wrong order or period.
- unsure: you would need to check a source to know.

pitched: is the fact right for the key stage given (England)?
- yes: pupils at that key stage are taught its concepts and terms and can read its wording.
- no: it needs a concept or term first taught at a later stage.

A misconception's belief and a question's wrong options are meant to be false: judge the correction, or the answer and reasoning. A wrong option that is in fact right makes the question incorrect.

When torn, choose partly over yes, no over yes for valuesStated and pitched, and unsure over yes or no for correct.

Give one verdict for every numbered fact, in order. fact is its number; note, under 200 characters, names what is unsupported, unstated, false or above the key stage, and is empty when every verdict passes.`,
  user: (i) =>
    [
      `Subject: ${i.subject}; Year group: ${i.yearGroup}${keyStageOf(i.yearGroup)}`,
      "Facts:",
      ...i.facts.flatMap((f, n) => [
        `${n}: ${f.text}`,
        ...f.evidence.map((e) => `   evidence: ${e}`),
      ]),
    ].join("\n"),
};

/** " (Key Stage 3)" for "Year 7": England's key stage, derived so the checker need not infer it. */
export function keyStageOf(yearGroup: string): string {
  const year = Number(/^Year (\d{1,2})$/.exec(yearGroup.trim())?.[1]);
  if (!(year >= 1 && year <= 13)) return "";
  const stage = year <= 2 ? 1 : year <= 6 ? 2 : year <= 9 ? 3 : year <= 11 ? 4 : 5;
  return ` (Key Stage ${stage})`;
}

/*
 * pack-select.v1 (spec 5; gpt-5.6-luna, low). Built on the bake-off select winner
 * (pe-bakeoff/prompts/opus55-select.json, 97% precision): content not wording, counter-examples not
 * exceptions, tie-breaks to the safe side. The pack's year is shown because the bake-off's
 * other-band cards read as full matches to every contestant. Absent fact types need not be listed:
 * `fillTypesFor` adds every type the section holds none of.
 */
export const packSelectPrompt: StructuredPrompt<PackSelectInput> = {
  version: "pack-select.v1",
  system: `You decide whether a section of a stored topic pack can supply the facts for one lesson objective. A wrong match puts facts about something else into the lesson and nobody sees it, so it is far worse than no match: match only when you are sure.

Each section line gives its number, its outcome (what it teaches) and, in brackets, the fact types it holds. A pack written for a different year group from the lesson's matches nothing.

Judge by content, not wording or command verbs: "describe", "explain", "outline" or "evaluate" asked of the same thing are the same claim. The same topic, event, process, period, place or skill must be the focus of both.

- full: one section's outcome teaches the whole objective.
- partial: one section's outcome squarely teaches part of the objective but not all of it, because the objective joins two aims or needs a concept the outcome does not cover. missingConcepts names each missing aim or concept in a few words (at most 6); missingTypes lists the fact types a writer must add to teach them.
- none: no section's outcome teaches the objective or a whole aim within it. A section on a neighbouring topic, the same unit, a different example, place or period, a different stage of the same process (planning a meal versus making it), or one that only shares key words is none.

section is the chosen section's number, or null for none. Both lists are empty except for partial.

If two sections fit, pick the one whose outcome matches more closely. When torn between full and partial choose partial; between partial and none choose none.`,
  user: (i) =>
    [
      `Subject: ${i.subject}; Lesson year group: ${i.yearGroup}`,
      `Objective: ${i.objective}`,
      `Sections (pack for ${i.packYearGroup}):`,
      ...i.sections.map((s, n) => `${n}: ${s.outcome} [${s.types.join(", ")}]`),
    ].join("\n"),
};

export const judgeAddendumPrompt: StructuredPrompt<JudgeAddendumInput> = {
  version: `judge-addendum.v0${STUB_SUFFIX}`,
  system: STUB_SYSTEM("judge-addendum"),
  user: (i) => [`Topic: ${i.topic}`, "Facts:", i.factsText, "Deck:", i.deckText].join("\n"),
};

/**
 * The fill call (packed arm): the per-objective facts call's input plus the fact types the matched
 * section lacks; the answer is the facts call's shape restricted to those types (`pack-arms.ts`
 * builds the schema by `.pick` on the facts call's own schema, so the item shapes cannot drift).
 */
export interface PackFillInput extends PlanFactsObjectiveInput {
  types: readonly FactType[];
  /** The select call's `missingConcepts`: what the lists written here must cover. Optional. */
  concepts?: readonly string[] | undefined;
}

/*
 * The three pieces of the facts call's system text the fill call changes, each pinned by the test
 * beside this file so a facts-prompt edit that moves one fails there, not in a live run.
 */
/** The counts line: rewritten to the lists named in the brief. */
export const FACTS_COUNTS_LINE =
  "Write one or two key ideas, one misconception, up to two vocabulary terms, and three or four questions.";
const FILL_COUNTS_LINE =
  'Write only the lists the brief\'s "Lists to write" line names (one or two key ideas, one misconception, up to two vocabulary terms, three or four questions).';
/** The misconceptionRef rule: dropped, since `packWithFill` strips the ref from every filled item. */
export const FACTS_MISCONCEPTION_REF_LINE =
  'Where a worked example or distractor heads off the misconception, say so in "misconceptionRef".';
/** The five-list sketch and its label: dropped; the user turn shows the wanted lists only. */
export const FACTS_SHAPE_LINES = `\n\nJSON, in this shape:\n${SHAPE_SKETCH}`;

/**
 * The facts sketch restricted to the lists wanted, in the schema's order, so the one shape the
 * model sees is the one `fillSchemaFor` (`pack-arms.ts`, `.pick` on the facts schema) accepts.
 */
export function fillShapeSketch(types: readonly FactType[]): string {
  const full = JSON.parse(SHAPE_SKETCH) as Record<FactType, unknown>;
  return JSON.stringify(
    Object.fromEntries(FACT_TYPES.filter((t) => types.includes(t)).map((t) => [t, full[t]])),
  );
}

/*
 * pack-fill.v2 (23 Sept 2026, PE Fable 5.1; gpt-5.6-luna, medium): plan-facts-objective v10 with
 * three edits to its system text (above) and a user turn that ends with the lists to write, the
 * select call's missing concepts when it declared any, and a sketch of those lists alone. The
 * section's KEPT lists reach the call as v10's reference input (`pack-arms.ts`), so the fill keeps
 * their terms; the smoke call showed that a reference carrying the lists being written is simply
 * copied back. The worked-example line is dropped when that list is not wanted: "required" beside
 * a schema with no `workedExamples` key would be a contradiction, and the strict outer object
 * would retry on the stray list. Everything else is the facts prompt's, so its hash moves with it.
 * v1 showed the facts call's five-list sketch while its schema was `.pick(types)`: the one shape
 * the model saw was not the one it had to return (run 2's fill retried once, reason unrecorded).
 */
/*
 * pack-fill.v3 (23 Sept 2026): no edit of its own; plan-facts-objective v11's `keyIdeaRefs` slot and
 * clause reach it through the shared system text and sketch. `packWithFill` keeps a filled
 * question's refs only when the same call wrote the key ideas they index.
 */
const fillSystem = (() => {
  const base = planFactsObjectivePrompt.system;
  const edits: [string, string][] = [
    [FACTS_COUNTS_LINE, FILL_COUNTS_LINE],
    [`${FACTS_MISCONCEPTION_REF_LINE}\n`, ""],
    [FACTS_SHAPE_LINES, ""],
  ];
  return edits.reduce((text, [from, to]) => {
    if (!text.includes(from))
      throw new Error(`pack-fill: the facts call's text moved; update the pinned piece: ${from}`);
    return text.replace(from, to);
  }, base);
})();

export const packFillPrompt: StructuredPrompt<PackFillInput> = {
  version: "pack-fill.v3",
  system: fillSystem,
  user: (i) => {
    const types = FACT_TYPES.filter((t) => i.types.includes(t));
    const lines = planFactsObjectivePrompt.user(i).split("\n");
    const kept = types.includes("workedExamples")
      ? lines
      : lines.filter((l) => !l.startsWith("Worked example:"));
    return [
      ...kept,
      "",
      `Lists to write: ${types.join(", ")}${i.concepts?.length ? `, covering: ${i.concepts.join("; ")}` : ""}.`,
      "JSON, in this shape:",
      fillShapeSketch(types),
    ].join("\n");
  },
};

/** The rubric's dimension names, so the addendum's two extra items are named beside them. */
export const JUDGE_DIMENSIONS = [...RUBRIC_DIMENSIONS, "fidelity", "wrongFacts"] as const;

export const PACK_PROMPTS = {
  "pack-rewrite": packRewritePrompt,
  "pack-knowledge": packKnowledgePrompt,
  "pack-link": packLinkPrompt,
  "pack-check": packCheckPrompt,
  "pack-select": packSelectPrompt,
  "pack-fill": packFillPrompt,
  "judge-addendum": judgeAddendumPrompt,
} as const;
export type PackPromptName = keyof typeof PACK_PROMPTS;
