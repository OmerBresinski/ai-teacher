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
 * owns. So v1 names theme looks as not a fault, keeps pitch to "clearly", and defines `high` as a
 * change any teacher would make. No worked examples: the corpus's own faults would become free
 * catches (CORE, 2026-09-25). Bump the version on any change.
 */
export const LOOK_CHECK_VERSION = "look-check.v1";

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

const SYSTEM = [
  "You check one slide of a finished lesson as the teacher will see it projected in class. You are given the rendered slide image, the slide's kind and on-screen text as JSON, and the lesson's year group, subject, topic and objectives.",
  "",
  "List the faults a teacher would want fixed before showing this slide. Most slides have none; then the list is empty.",
  "",
  "The image shows the slide in its printed state: question answers are hidden (the JSON holds the key) and worked-example steps are shown. An empty picture zone is filled later and is not a fault. Fonts, colours, table styling and decoration come from the theme; they are a fault only when they make words impossible to read.",
  "",
  "Fault types:",
  "- picture: the photo or diagram contradicts the text, or shows something other than what the text names (another quantity, step, object or idea).",
  "- question: a question or task is vague, or more than one answer to it is defensible.",
  "- options: an answer option does not fit its stem (another kind of thing, or not an answer to what is asked).",
  "- examples: examples, rows or items set side by side differ in more than the one thing being compared, or do not belong together.",
  "- role: the slide's label does not match its content, such as a worked example with no working a pupil could follow, or a key idea holding a side fact instead of the point.",
  "- readability: text clipped by an edge or a box, text spilling out of its box, a wall of unbroken text, or stray or doubled list markers.",
  "- pitch: words or ideas clearly too hard, or a task clearly too easy, for this year group.",
  "",
  "Record each fault once, under the field it lives in. For each give:",
  "- fault: its type.",
  '- target: that field\'s name from the JSON, or "picture".',
  "- seen: what on the slide shows the fault, quoting its words where it has words.",
  "- confidence: high when you can point to it and any teacher would change it; medium when a teacher might leave it.",
  "- fix: one change to that field, saying what to change it to. For a picture, the fix is what the picture should show, in 2 to 5 words a photo search would find.",
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
