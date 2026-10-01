import { type Audience, audienceBlock, example } from "./shared";

/*
 * Plan-write, after every slide is written and checked on its own (spike/b3-master-checker-luna):
 * one call reads the whole lesson and names the fields to write again for problems that only show
 * across slides. Each fix goes through the writer's named-field re-write and the fit
 * (`stages/plan-write.ts`, `masterCheck`). Bump the version whenever the text changes.
 */

/* v2 (round C1): the running-example check covers only slides that use the running example; a
 * practise or question slide set on a new case is not drift (B3 forced a practice ratio back to the
 * running example's), and a practise slide's notes must answer exactly its items. */
/* v3: the C1 smoke's checker deleted the practise notes' early-finisher challenge (write-slides asks
 * for it) as an unlisted item; the challenge is now named as belonging there. */
/* v4 (round R): two kinds a slide check misses, from round Q's judged faults: an answer key that
 * rejects other answers a teacher would accept, and a claim stated as always true that is only
 * generally true. */
export const MASTER_CHECK_VERSION = "master-check.v4";

export const MASTER_CHECK_KINDS = [
  "join",
  "running-example",
  "term-before-taught",
  "contradiction",
  "duplicate",
  "key",
  "overgeneralised",
] as const;

export type MasterCheckSlide = {
  number: number;
  role: string;
  form: string;
  /** The slide as written: its fields by name, the teacher notes among them. */
  written: Record<string, unknown>;
};

export type MasterCheckInput = {
  audience: Audience;
  topic: string;
  objectives: string[];
  runningExample?: string | null;
  slides: MasterCheckSlide[];
  /** Slides that may not be changed (title and objectives). */
  fixed: number[];
};

const EXAMPLE = {
  fixes: [
    {
      slide: 6,
      field: "body",
      kind: "term-before-taught",
      problem:
        'Uses "simplest form" before slide 7 explains it. Say it in words this class already has.',
    },
  ],
};

const SYSTEM = [
  "You are an experienced UK teacher reading a finished lesson from first slide to last. Each slide has already been checked on its own; you look for problems between slides, and for the last two kinds on any slide:",
  "- join: a slide does not follow from the one before, or refers to something no earlier slide gave;",
  "- running-example: a slide that uses the lesson's running example changes its numbers or details. A practise or question slide set on a new case is not a problem;",
  "- term-before-taught: a slide or its notes uses a term a later slide teaches;",
  "- contradiction: two slides, or a slide and its notes, disagree (a practise slide's notes answer a numbered item the slide does not have, or skip one it has; their challenge for early finishers belongs there);",
  "- duplicate: a slide repeats what another slide already says;",
  "- key: for every question with an answer (starter items included), list to yourself the other answers a teacher would accept for the question as asked; when any is right, widen the answer to accept them or rewrite the question so it has one defensible answer;",
  "- overgeneralised: a claim stated as true of all or always that is only generally true at this level; qualify it or name the exception.",
  "",
  "For each problem, name the slide and the one field to write again, and say in the problem what is wrong and what the field should do, quoting the other slide where it helps. The fixed slides are never changed. A fix keeps the field's length and keeps the teaching on the slide. Return an empty list when none of these problems is there.",
  "",
  "Answer as JSON in exactly this shape:",
  example(EXAMPLE),
].join("\n");

export function masterCheckPrompt(input: MasterCheckInput): { system: string; user: string } {
  return {
    system: SYSTEM,
    user: [
      audienceBlock(input.audience),
      `Topic: ${input.topic}`,
      "Objectives:",
      ...input.objectives.map((o, i) => `  ${i + 1}. ${o}`),
      ...(input.runningExample ? [`Running example: ${input.runningExample}`] : []),
      `Fixed slides: ${input.fixed.join(", ")}`,
      "",
      ...input.slides.map(
        (s) => `Slide ${s.number} (${s.role}, ${s.form}): ${JSON.stringify(s.written)}`,
      ),
    ].join("\n"),
  };
}
