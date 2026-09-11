import type { ImageBrief } from "@tj/domain/documents";
import { z } from "zod";
import { type Audience, audienceBlock, example, HOUSE_RULES } from "./shared";

/*
 * Pick-or-requery (Images project, TEACH-191; Generation quality §3b, TEACH-220): one `small` call
 * per image-text slide after the Pexels search. Pexels ranks by its own notion of relevance —
 * `rodent incisors` returns a hand holding human teeth first — and illustrate cannot tell. The
 * model sees what the pipeline knows about the lesson (the teacher's topic and answers, audience,
 * objectives, vocabulary, the slide's brief) and, since TEACH-220, **the candidate photographs
 * themselves** (thumbnails as image parts, numbered to match their ids) beside their captions. It
 * answers a `pick` with `visible` — which of the brief's `mustShow` items it can actually see in
 * that photo — and `count`, or a `query` (one better standalone search), or neither. A
 * deterministic gate places only when every `mustShow` item is visible; the text is then written
 * to what the photo shows. Bump `version` whenever the wording changes.
 */

export type PickOrRequeryInput = {
  topic: string;
  answers?: Record<string, string> | undefined;
  lessonTitle: string;
  audience: Audience;
  objectives: string[];
  vocabulary: string[];
  /** What the slide is meant to add (its outline brief), or its text when it already exists. */
  slideBrief: string;
  subject: string;
  /** The concrete things a pupil must be able to see for the slide's task to be possible. */
  mustShow: string[];
  purpose: ImageBrief["purpose"];
  avoid?: string[] | undefined;
  /** Every query already searched, so a requery never repeats one. */
  queries: string[];
  candidates: { id: string; alt: string; thumbnail: string }[];
};

/**
 * Flat rather than a union: small models answer with nulls far more reliably than a tagged union.
 * `pick` wins when both are set; both null means "leave the placeholder". `visible` is the gate's
 * input; `count` is a hint for the slide text's grammar. Every field the model has nothing to say
 * for may be omitted as well as null — in production Luna leaves out `query` when it picks and
 * `pick`/`count` when it requeries, and a strict schema rejected every reply (rodents lesson,
 * 2026-09-10). Omitted reads as null / empty.
 */
export const PickOrRequerySchema = z
  .object({
    pick: z.string().min(1).nullable().optional(),
    /**
     * Whether the main thing in the picked photograph is an example of the subject (TEACH-224: a
     * llama's snout was picked for "rodent incisors" — every required part was visible, on the
     * wrong animal). Omitted reads as false, so a pick that does not say so is never placed.
     */
    onSubject: z.boolean().optional(),
    /**
     * Whether the required items are large, sharp and unobstructed enough for a class to see on a
     * projector (TEACH-226: a nutria behind a wire fence passed every other test). Omitted → false.
     */
    clear: z.boolean().optional(),
    visible: z.array(z.string().trim().min(1).max(40)).max(4).optional(),
    count: z.enum(["one", "several"]).nullable().optional(),
    query: z.string().trim().min(2).max(60).nullable().optional(),
  })
  .strict()
  .transform((a) => ({
    pick: a.pick ?? null,
    onSubject: a.onSubject ?? false,
    clear: a.clear ?? false,
    visible: a.visible ?? [],
    count: a.count ?? null,
    query: a.query ?? null,
  }));
export type PickOrRequery = z.output<typeof PickOrRequerySchema>;

/** The schema for one brief: `visible` may list only the brief's own `mustShow` items. */
export function pickOrRequerySchemaFor(
  brief: Pick<ImageBrief, "mustShow">,
): z.ZodType<PickOrRequery> {
  const allowed = new Set(brief.mustShow.map(normaliseItem));
  return PickOrRequerySchema.superRefine((answer, ctx) => {
    answer.visible.forEach((item, i) => {
      if (!allowed.has(normaliseItem(item))) {
        ctx.addIssue({
          code: "custom",
          message: `visible lists only items from mustShow: ${brief.mustShow.join(", ")}`,
          path: ["visible", i],
        });
      }
    });
  });
}

export const normaliseItem = (item: string) => item.trim().toLowerCase().replace(/\s+/g, " ");

const EXAMPLE: PickOrRequery = {
  pick: "27147699",
  onSubject: true,
  clear: true,
  visible: ["open flower head", "petals", "stamens"],
  count: "one",
  query: null,
};
const EXAMPLE_REQUERY: PickOrRequery = {
  pick: null,
  onSubject: false,
  clear: false,
  visible: [],
  count: null,
  query: "buttercup flower macro",
};

export const pickOrRequeryPrompt = {
  version: "pick-or-requery-photo.v6",
  system: [
    "You choose the photograph for one slide of a school lesson from stock-photo search results. You see each candidate photograph (numbered to match its id) and its caption.",
    "",
    "Rules:",
    HOUSE_RULES,
    "Read the lesson context first: the topic decides what an ambiguous word means (a lesson on rodents wants an animal's teeth, never a person's; a lesson on rivers wants a riverbank, never a bank branch).",
    "Answer with exactly one of:",
    "- `pick`: the id of the ONE photograph that clearly shows the slide's subject as it belongs in this lesson, shows as many of the required items as any candidate does — at least one — and suits the audience. Prefer the plainest literal depiction. Reject anything off-topic, decorative, text-heavy, a person or medical scene when the subject is an animal or object, anything listed to avoid, or anything unsuitable for the year group. When two fit, pick the earlier one.",
    "- `onSubject`: true only when the main thing in the photograph you pick is an example of the wanted subject itself — the same kind of animal, plant, object or place. A different animal with similar parts is not the subject (a llama's teeth are not rodent incisors; a rabbit is not a rodent). When in doubt, false. A pick with `onSubject` false is never used.",
    "- `clear`: true only when the subject and the required items you can see are large, sharp and unobstructed enough for a whole class to see them on a projector — nothing in front of them (no fence, cage, bars, glass, hands or text), the subject filling a good part of the frame. A pick with `clear` false is never used: when the only candidate that fits is not clear, give a `query` that would find a clearer one instead.",
    "- `visible`: for the photo you pick, which of the required items you can actually see in it — only those, spelt as given. Look at the picture, not the caption. `count`: whether the photo shows one of the subject or several.",
    "- Pick nothing if no candidate is the subject showing at least one required item; then suggest a `query` that would — one that names the subject itself exactly: two to four plain words, British English, a standalone stock-photo query that carries the lesson's context and is none of the searches already tried.",
    "- `pick`, `query` both `null` (and `visible` empty): when nothing fits and you cannot think of a materially better query. A missing picture is better than a wrong one.",
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
      `This slide: ${input.slideBrief}`,
      `Wanted: ${input.subject} (purpose: ${input.purpose})`,
      `Required items, all of which must be visible: ${input.mustShow.join("; ")}`,
    );
    if (input.avoid && input.avoid.length > 0) parts.push(`Avoid: ${input.avoid.join("; ")}`);
    parts.push(
      `Searches already tried: ${input.queries.join("; ")}`,
      "",
      input.candidates.length > 0
        ? "Candidates (the photographs follow in this order):"
        : "Candidates: none.",
    );
    input.candidates.forEach((c, i) => {
      parts.push(`  photo ${i + 1} — id ${c.id}: ${c.alt || "(no caption)"}`);
    });
    parts.push("", "Answer with the JSON.");
    return parts.join("\n");
  },
} as const;
