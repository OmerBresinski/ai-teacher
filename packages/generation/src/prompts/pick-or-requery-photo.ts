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
 * deterministic gate places only when the subject is clear and at least one `mustShow` item is
 * visible (TEACH-241; TEACH-220 required every item); the text is then written
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
  /** The gate needs every item (a generic request); otherwise one (a real thing, a parts list). */
  needAll?: boolean;
  /** The time and place a historical subject belongs to: nothing visible may be from another. */
  period?: string;
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
     * BAKEOFF 6 Oct: a cockerel passed as "hen". When the wanted subject or an item names a sex,
     * age or kind (hen/cockerel, ewe/ram, calf/cow), whether the picked subject is that one, judged
     * by the features that tell them apart; null when nothing of the kind is named. Omitted reads
     * as null, so older replies and fixtures still parse; false never places.
     */
    kindMatches: z.boolean().nullable().optional(),
    /**
     * Whether the required items are large, sharp and unobstructed enough for a class to see on a
     * projector (TEACH-226: a nutria behind a wire fence passed every other test). Omitted → false.
     */
    clear: z.boolean().optional(),
    /**
     * Whether the picture is what the slide wants as a whole: every required item as worded and the
     * relation the wanted description states between them (round 3: an adult dog with an unrelated
     * puppy, one cat for "a cat beside a kitten", ice in the glass for "beside" all passed on the
     * gist). Omitted → false.
     */
    fits: z.boolean().optional(),
    /** One sentence on what decided the answer: logged, never used by the gate. */
    why: z.string().max(400).nullable().optional(),
    visible: z.array(z.string().trim().min(1).max(40)).max(4).optional(),
    count: z.enum(["one", "several"]).nullable().optional(),
    /**
     * BAKEOFF 6 Oct: where each visible item sits in the picked photo, as fractions of its width and
     * height (0 = left/top edge, 1 = right/bottom), so code can crop around the subjects. Unmeasured.
     */
    boxes: z
      .array(
        z
          .object({
            item: z.string().trim().min(1).max(40),
            left: z.number().min(0).max(1),
            top: z.number().min(0).max(1),
            right: z.number().min(0).max(1),
            bottom: z.number().min(0).max(1),
          })
          .strict(),
      )
      .max(4)
      .optional(),
    query: z.string().trim().min(2).max(60).nullable().optional(),
  })
  .strict()
  .transform((a) => ({
    pick: a.pick ?? null,
    onSubject: a.onSubject ?? false,
    kindMatches: a.kindMatches ?? null,
    clear: a.clear ?? false,
    fits: a.fits ?? false,
    why: a.why ?? null,
    visible: a.visible ?? [],
    count: a.count ?? null,
    boxes: a.boxes ?? [],
    query: a.query ?? null,
  }));
export type PickOrRequery = z.output<typeof PickOrRequerySchema>;

/**
 * The schema for one brief: `visible` keeps only the brief's own `mustShow` items. An item the
 * judge saw that the brief did not ask for is dropped in code, never a validation failure
 * (PICTURE-AUDIT #4: with `mustShow: []` every listed item failed the call and emptied the slot).
 */
export function pickOrRequerySchemaFor(
  brief: Pick<ImageBrief, "mustShow">,
): z.ZodType<PickOrRequery> {
  const allowed = new Set(brief.mustShow.map(normaliseItem));
  return PickOrRequerySchema.transform((answer) => ({
    ...answer,
    visible: answer.visible.filter((item) => allowed.has(normaliseItem(item))),
    boxes: answer.boxes.filter(
      (b) => allowed.has(normaliseItem(b.item)) && b.right > b.left && b.bottom > b.top,
    ),
  }));
}

export const normaliseItem = (item: string) => item.trim().toLowerCase().replace(/\s+/g, " ");

const EXAMPLE: PickOrRequery = {
  pick: "27147699",
  onSubject: true,
  kindMatches: null,
  clear: true,
  fits: true,
  why: "Photo 1 is a whole buttercup head with its petals and stamens in sharp view.",
  visible: ["open flower head", "petals", "stamens"],
  count: "one",
  boxes: [
    { item: "open flower head", left: 0.22, top: 0.18, right: 0.78, bottom: 0.8 },
    { item: "petals", left: 0.22, top: 0.18, right: 0.78, bottom: 0.8 },
    { item: "stamens", left: 0.42, top: 0.4, right: 0.58, bottom: 0.56 },
  ],
  query: null,
};
const EXAMPLE_REQUERY: PickOrRequery = {
  pick: null,
  onSubject: false,
  kindMatches: null,
  clear: false,
  fits: false,
  why: "No candidate shows a buttercup; they are other yellow flowers.",
  visible: [],
  count: null,
  boxes: [],
  query: "buttercup flower macro",
};

export const pickOrRequeryPrompt = {
  version: "pick-or-requery-photo.v15",
  system: [
    "You choose the photograph for one slide of a school lesson from stock-photo search results. You see each candidate photograph (numbered to match its id) and its caption.",
    "",
    "Rules:",
    HOUSE_RULES,
    "Read the lesson context first: the topic decides what an ambiguous word means (a lesson on rodents wants an animal's teeth, never a person's; a lesson on rivers wants a riverbank, never a bank branch).",
    "Answer with exactly one of:",
    "- `pick`: the id of the ONE photograph that clearly shows the slide's subject as it belongs in this lesson, shows as many of the required items as any candidate does — at least one — and suits the audience. Prefer the plainest literal depiction. Reject anything off-topic, decorative, text-heavy, a person or medical scene when the subject is an animal or object, anything listed to avoid, or anything unsuitable for the year group. When two fit, pick the earlier one.",
    "- `onSubject`: true only when the main thing in the photograph you pick is an example of the wanted subject itself — the same kind of animal, plant, object or place — seen whole, near the centre, as the lesson uses it. A different animal with similar parts is not the subject (a llama's teeth are not rodent incisors; a rabbit is not a rodent). A photograph that only shares the theme is not the subject either: a scene, a related object, the same object in another setting (syringes in a clinic for a lesson on gases), a statue or reconstruction for an artefact. It shows the subject as this slide teaches it: a slide about the past wants what survives from that time, so the same place as it looks today, with nothing of that time in view, is not the subject (a modern street on the site of a medieval market is not the market). When in doubt, false. A pick with `onSubject` false is never used.",
    "- `kindMatches`: when the wanted subject or a required item names a sex, an age or a kind of its animal, plant or thing (a hen or a cockerel, a ewe or a ram, a calf or a cow), true only when the subject you pick is that one, judged on the features that tell them apart, and say which feature in `why`; `null` when nothing of the kind is named. A pick with `kindMatches` false is never used.",
    "- `clear`: true only when the subject and the required items you can see are large, sharp and unobstructed enough for a whole class to see them on a projector — nothing in front of them (no fence, cage, bars, glass, hands or text), the subject filling a good part of the frame. A pick with `clear` false is never used: when the only candidate that fits is not clear, give a `query` that would find a clearer one instead.",
    "- `fits`: true when the photograph you pick is what the slide wants: the required items it must show, as worded (its kind, age and number): every one when the list says so, otherwise at least one, so a missing extra item is not a reason to refuse; and only those relations the wanted description states in words (where things are relative to each other, that one is the other's own young, so the same kind of animal, what they are doing); a relation it does not state is not required. When a period and place are given, nothing visible may belong to another time or place. A pick with `fits` false is never used.",
    "- `why`: one sentence on what decided your answer, naming what you saw.",
    "- `visible`: for the photo you pick, which of the required items you can actually see in it — only those, spelt as given. Look at the picture for these. Who or what it is, where and when it was taken cannot be seen: read them from the candidate's caption, which is its source's own record (title, description, date), and decide whether the picture and its record together are what the slide wants. `count`: whether the photo shows one of the subject or several. `boxes`: for each item in `visible`, where it sits in that photo, as fractions of its width and height from its left and top edges (0 to 1).",
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
      ...(input.period ? [`Period and place: ${input.period}`] : []),
      input.needAll
        ? `Required items — every one must be visible, each exactly as worded: ${input.mustShow.join("; ")}`
        : `Required items — prefer the photograph that shows the most of them; at least one must be visible: ${input.mustShow.join("; ")}`,
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
