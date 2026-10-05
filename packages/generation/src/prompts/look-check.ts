/*
 * Plan-write look check (lab/cand-fix, 5 Oct 2026): a vision model looks at ONE rendered slide
 * (the presenter's printed state, 1440x810) beside its on-screen text, and lists the faults a
 * teacher would fix before showing it. One call per slide, in parallel, on the checker's model.
 * Code stamps the slide id and number (they are not asked for), keeps only targets the slide has,
 * and lets only `high` flags act (stages/plan-write.ts, plan-write/look-check.ts).
 *
 * Calibrated on the owner's 24 blind-rated slides with the v0 draft (LOOK-CHECK/vs-greg): it caught
 * every weak slide and every picture/text mismatch; its false alarms were a pitch call and a
 * contrast call on strong slides, and its misses were theme looks (font, table style), which code
 * owns. So the prompt names theme looks as not a fault, keeps pitch to "clearly", and defines
 * `high` as a change any teacher would make. No worked examples: the corpus's own faults would
 * become free catches (CORE, 2026-09-25). Bump the version on any change.
 *
 * v2 (same day): v1 asked for an open fault list ("most slides have none"), and gpt-6-luna at low
 * and at medium answered it empty on 7 of 7 of the owner's weak slides in 80-550 output tokens,
 * though it reads the image exactly. v2 is a checklist: every fault type gets a verdict, after a
 * line on what was looked at, so an empty answer is no longer the cheapest one.
 */
export const LOOK_CHECK_VERSION = "look-check.v2";

export type LookCheckInput = {
  yearGroup: string;
  subject: string;
  topic: string;
  objectives: string[];
  /** 1-based position and the deck's length. */
  slide: number;
  of: number;
  /** The slide's kind as the writer named it (worked-example, hinge, check-set, ...). */
  kind: string;
  /** The slide's on-screen fields, as written (no notes, no picture brief). */
  fields: Record<string, unknown>;
};

export const LOOK_QUESTIONS = {
  picture:
    "Does the photo or diagram show something other than what the text names or asks about: another quantity, step, object, place, text or idea? (n/a when the slide has no picture)",
  question:
    "Is a question or task worded so a pupil would be unsure what to do, or could defend more than one answer? (n/a when the slide asks nothing)",
  options:
    "Does an answer option fail to fit its stem, or do the stem, options or layout give the answer away? (n/a without options)",
  examples:
    "Do examples, rows or items set side by side differ in more than the one thing being compared, or mix kinds that do not belong together? (n/a without such a set)",
  role: "Does the content fail to do what its label or heading says? A worked example with no working a pupil could follow (steps that only restate or gloss words) and a key idea holding a side fact instead of the point both count.",
  readability:
    "Is any text clipped by an edge or a box, spilling out of its box, set as a wall of unbroken text, or carrying stray or doubled list markers?",
  pitch:
    "Are the words or ideas clearly beyond this year group, or the task clearly too easy for it?",
} as const;

const SYSTEM = [
  "You check one slide of a finished lesson as the teacher will see it projected in class. You are given the rendered slide image, the slide's kind and on-screen text as JSON, and the lesson's year group, subject, topic and objectives.",
  "",
  "The image shows the slide in its printed state: question answers are hidden (the JSON holds the key) and worked-example steps are shown. An empty picture zone is filled later and is not a fault. Fonts, colours, table styling and decoration come from the theme; they are a fault only when they make words impossible to read.",
  "",
  "First write `looked`: what the picture shows (or that there is none) and what the text says or asks, in one or two sentences. Then answer each check below for this slide.",
  "",
  ...Object.entries(LOOK_QUESTIONS).map(([k, q]) => `- ${k}: ${q}`),
  "",
  "For each check give:",
  "- seen: what on the slide you judged it by, quoting its words where it has words.",
  '- answer: "yes" when the fault is there, "no" when it is not, "n/a" when the check does not apply.',
  '- target: the JSON field the fault lives in, or "picture".',
  "- confidence: high when you can point to it and any teacher would change it before showing the slide; medium when a teacher might leave it.",
  "- fix: for a yes, one change to that field, saying what to change it to (for a picture, what it should show, in 2 to 5 words a photo search would find); otherwise empty.",
].join("\n");

export function lookCheckPrompt(input: LookCheckInput): { system: string; user: string } {
  return {
    system: SYSTEM,
    user: [
      `${input.yearGroup} ${input.subject}. Topic: ${input.topic}`,
      "Lesson objectives:",
      ...input.objectives.map((o) => `- ${o}`),
      "",
      `This slide: slide ${input.slide} of ${input.of}, kind ${input.kind}`,
      `On-screen text: ${JSON.stringify(input.fields)}`,
      "The rendered slide is the attached image.",
    ].join("\n"),
  };
}
