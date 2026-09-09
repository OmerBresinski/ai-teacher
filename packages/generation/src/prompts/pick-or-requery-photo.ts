import { z } from "zod";
import { type Audience, audienceBlock, example, HOUSE_RULES } from "./shared";

/*
 * Pick-or-requery (Images project, TEACH-191): one `small` call per image-text slide after the
 * Pexels search. Pexels ranks by its own notion of relevance — `rodent incisors` returns a hand
 * holding human teeth first — and illustrate cannot tell. The model sees what the pipeline knows
 * about the lesson (the teacher's topic and answers, audience, objectives, vocabulary, the slide's
 * text, the brief) and the candidates' alt texts only, never the pictures, and answers with one of
 * three outcomes: a `pick` (a candidate id), a `query` (one better standalone search when nothing
 * fits but a better search plausibly would), or neither (the placeholder stays). Alt text is the
 * whole evidence, so a mis-described photo can pass — strictly better than no check, and
 * fail-closed. Bump `version` whenever the wording changes.
 */

export type PickOrRequeryInput = {
  topic: string;
  answers?: Record<string, string> | undefined;
  lessonTitle: string;
  audience: Audience;
  objectives: string[];
  vocabulary: string[];
  slideText: string;
  subject: string;
  mustShow?: string | undefined;
  /** Every query already searched, so a requery never repeats one. */
  queries: string[];
  candidates: { id: string; alt: string }[];
};

/**
 * Flat rather than a union: small models answer `{ pick, query }` with nulls far more reliably
 * than a tagged union. `pick` wins when both are set; both null means "leave the placeholder".
 */
export const PickOrRequerySchema = z.strictObject({
  pick: z.string().min(1).nullable(),
  query: z.string().trim().min(2).max(60).nullable(),
});
export type PickOrRequery = z.infer<typeof PickOrRequerySchema>;

const EXAMPLE: PickOrRequery = { pick: "27147699", query: null };
const EXAMPLE_REQUERY: PickOrRequery = { pick: null, query: "beaver gnawing wood" };

export const pickOrRequeryPrompt = {
  version: "pick-or-requery-photo.v1",
  system: [
    "You choose the photograph for one slide of a school lesson from a list of stock-photo search results. You see each result's caption, never the picture.",
    "",
    "Rules:",
    HOUSE_RULES,
    "Read the lesson context first: the topic decides what an ambiguous word means (a lesson on rodents wants an animal's teeth, never a person's; a lesson on rivers wants a riverbank, never a bank branch).",
    "Answer with exactly one of:",
    "- `pick`: the id of the ONE caption that clearly depicts the slide's subject as it belongs in this lesson and suits the audience. Prefer the plainest literal depiction of the subject. Reject anything off-topic, decorative, text-heavy, a person or medical scene when the subject is an animal or object, or unsuitable for the year group. When two fit, pick the earlier one.",
    "- `query`: when no caption fits but a better search plausibly would — two to four plain words, British English, a standalone stock-photo query that carries the lesson's context and is none of the searches already tried.",
    "- both `null`: when no caption fits and you cannot think of a materially better query. A missing picture is better than a wrong one.",
    "",
    "Answer as JSON in one of these shapes:",
    example(EXAMPLE),
    example(EXAMPLE_REQUERY),
  ].join("\n"),
  user(input: PickOrRequeryInput): string {
    const parts = [`Lesson: ${input.lessonTitle}`, `Topic the teacher asked for: ${input.topic}`];
    if (input.answers && Object.keys(input.answers).length > 0) {
      parts.push("The teacher also said:");
      for (const [q, a] of Object.entries(input.answers)) parts.push(`  ${q}: ${a}`);
    }
    parts.push(audienceBlock(input.audience));
    if (input.objectives.length > 0) parts.push(`Objectives: ${input.objectives.join(" | ")}`);
    if (input.vocabulary.length > 0) parts.push(`Vocabulary: ${input.vocabulary.join(", ")}`);
    parts.push(
      "",
      `This slide says: ${input.slideText}`,
      `Wanted: ${input.subject}${input.mustShow ? ` (must show: ${input.mustShow})` : ""}`,
      `Searches already tried: ${input.queries.join("; ")}`,
      "",
      input.candidates.length > 0 ? "Results:" : "Results: none.",
    );
    for (const c of input.candidates) parts.push(`  ${c.id}: ${c.alt || "(no caption)"}`);
    parts.push("", "Answer with the JSON.");
    return parts.join("\n");
  },
} as const;
