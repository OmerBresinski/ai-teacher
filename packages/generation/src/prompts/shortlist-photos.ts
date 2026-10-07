/**
 * Caption shortlist (TEACH-227): before any thumbnail is fetched, a small-class call reads the
 * captions of up to thirty search results and names the few worth looking at. Captions are cheap
 * text and reliable for *what* a photograph is of (a llama's snout says "llama"); they say nothing
 * about what is visible or how clear it is — that is the picture judge's job (`pick-or-requery`),
 * so the shortlist tests subject identity only (TEACH-239: v1 asked for the required items and
 * emptied a pool of thirty rats). Bump `version` whenever `system` or `user` changes wording.
 */
import type { ImagePurpose } from "@tj/domain/documents";
import { shapeIssue } from "@tj/slides";
import { z } from "zod";
import { example, HOUSE_RULES } from "./shared";

export const SHORTLIST_MAX = 6;

export const ShortlistSchema = z
  .object({ ids: z.array(z.string().min(1)).max(SHORTLIST_MAX).optional() })
  .strict()
  .transform((a) => ({ ids: a.ids ?? [] }));
export type Shortlist = z.output<typeof ShortlistSchema>;

/** The schema for one pool: every id must be one of the candidates, each at most once. */
export function shortlistSchemaFor(candidateIds: readonly string[]): z.ZodType<Shortlist> {
  const allowed = new Set(candidateIds);
  return ShortlistSchema.superRefine((answer, ctx) => {
    const seen = new Set<string>();
    answer.ids.forEach((id, i) => {
      // The id is the model's text (ADR 0015): the log form leaves it out.
      if (!allowed.has(id)) {
        ctx.addIssue(
          shapeIssue(`${id} is not a candidate id`, ["ids", i], "… is not a candidate id"),
        );
      } else if (seen.has(id)) {
        ctx.addIssue(shapeIssue(`${id} is listed twice`, ["ids", i], "… is listed twice"));
      }
      seen.add(id);
    });
  });
}

export type ShortlistInput = {
  topic: string;
  subject: string;
  mustShow: string[];
  purpose: ImagePurpose;
  avoid?: string[] | undefined;
  candidates: { id: string; alt: string }[];
};

const EXAMPLE: Shortlist = { ids: ["27147699", "1043111", "5622340"] };

export const shortlistPhotosPrompt = {
  version: "shortlist-photos.v5",
  system: [
    "You read the captions of stock-photo search results for one slide of a school lesson and name the few photographs worth looking at. You see captions only; the picture judge sees the photographs.",
    "",
    "Rules:",
    HOUSE_RULES,
    `List up to ${SHORTLIST_MAX} ids, best first. A photograph is worth looking at when its caption says it is a real photograph of the wanted subject itself, the same kind of thing as the lesson means; close-ups and clear views first. Captions rarely name parts, so a caption need not mention the required items. A caption about another kind of thing, only the theme or setting, a drawing, model or logo, anything in the avoid list, or anything unsuitable for pupils is not worth looking at.`,
    "When no caption fits, answer with an empty list.",
    "",
    "Answer as JSON:",
    example(EXAMPLE),
  ].join("\n"),
  user(input: ShortlistInput): string {
    const parts = [
      `Lesson topic: ${input.topic}`,
      `Wanted: ${input.subject} (purpose: ${input.purpose})`,
      `The picture judge will check these are visible — do not reject a caption for not mentioning them: ${input.mustShow.join("; ")}`,
    ];
    if (input.avoid && input.avoid.length > 0) parts.push(`Avoid: ${input.avoid.join("; ")}`);
    parts.push(
      "",
      "Captions:",
      ...input.candidates.map((c, i) => `${i + 1}. id ${c.id} — ${c.alt || "(no caption)"}`),
    );
    return parts.join("\n");
  },
} as const;
