import { z } from "zod";
import { DIAGRAM_KINDS } from "../plan-write/diagram-spec";

/*
 * Picture director (TEACH-84, ruling 158; PHOTO-BANK round 3, 6 Oct 2026). One `small` call
 * (gpt-6-luna, effort low) per picture slot, off the writing clock (after editable, where photos
 * already fill). The slide writer's one-sentence request used to go verbatim into a fixed image
 * template, and regexes chose the route; the writer then wrote image prompts ("a two-panel
 * photographic collage"), which is not its job. The director reads the request with the slide
 * and the lesson and decides: where the picture comes from (route), what a library search types
 * (queries), what an image model is told (imagePrompt), what the picture judge must see
 * (mustShow), and whether a comparison needs separate pictures (pictures has 2-3 entries).
 *
 * Code owns everything with a fixed meaning: the single-frame and text lines are appended to the
 * image prompt in code (`directedImagePrompt` in @tj/images), counts are checked (total = groups x
 * perGroup) and drawn in code, and lengths are clipped in code. A failed call falls back to the
 * fixed template and the regex route (stages/picture-director.ts).
 *
 * No worked examples and no example objects anywhere in the text (memory
 * image-prompts-are-prompts: a listed example object turns up in every picture). Bump the version
 * on any change.
 *
 * Clause ledger (v1; each sentence and why it is there):
 *  S1 role + input: the model must know it is choosing a source, not writing the slide.
 *  S2 "earns its place": the gate for `none` and for what the picture centres on (openai.md
 *     2026-10-03: "nothing pupils could see explains it, or it would only decorate" calibrated).
 *  R-commons: named/dated things; the Weimar smoke failed because the dated event was not searched.
 *  R-pexels: stock first only where stock can plausibly show it (Greg 6 Oct: don't waste stock
 *     searches that can't succeed; real stock looks real and costs nothing).
 *  R-generate: unusual combinations and staged comparisons (Greg 6 Oct: cow, sheep and hen
 *     together is hard for real photos).
 *  R-code: counts were wrong in every generated image (round 1: ~12 of 24; round 2 drawn exact);
 *     the kinds list is rendered from the renderer's enum, names only.
 *  R-none: the escape the gate needs, named as the excluded failure (decoration).
 *  P-split: Greg/coordinator: separate pictures when a comparison reads better apart.
 *  F-shows: the library key and the judge's "wanted" line, written once by the model.
 *  F-mustShow: the judge's gate input (PICTURE-AUDIT #1); "the thing itself first" lets the
 *     one-item real gate pass on the subject (round 2: a 3-item list refused a real Tempest photo).
 *  F-queries: year + event / name first (round 2 root cause: first-three-words queries).
 *  F-imagePrompt: one subject + suiting setting (round 2, held up 9/9); natural, unposed (Greg 6
 *     Oct: animals facing the camera read as AI); period/place only when the subject belongs to
 *     one (round 1: a blanket UK line put Big Ben and flags everywhere); "draws every object it
 *     mentions" is the reason an inclusion list fails; "describe what is there" stops negative
 *     lists priming the image model; code adds the frame/text lines.
 *  F-count/diagram: typed slots instead of prose so code can draw (CORE 2026-10-01 geometry law).
 */
export const PICTURE_DIRECTOR_VERSION = "picture-director.v1";

export const PICTURE_ROUTES = ["commons", "pexels", "library-or-generate", "code", "none"] as const;
export type PictureDirectorRoute = (typeof PICTURE_ROUTES)[number];

export type PictureDirectorInput = {
  yearGroup: string;
  subject: string;
  /** The lesson's title (its topic): the period and place a real subject is set in. */
  title: string;
  country: string;
  heading: string;
  /** The slide's on-screen words (body and list items), as written. */
  text: string;
  /** What the slide is for: the teacher's notes, clipped. */
  point: string;
  /** The writer's picture request, verbatim. */
  request: string;
  /** What code read off the request as visible items (the writer has no mustShow field). */
  mustShow: string[];
  /** The zone's width over height. */
  aspect: number;
};

const Picture = z.object({
  shows: z.string(),
  mustShow: z.array(z.string()),
  queries: z.array(z.string()),
  imagePrompt: z.string(),
});

const Count = z.object({
  total: z.number().int(),
  groups: z.number().int(),
  perGroup: z.number().int(),
  arrangement: z.enum(["groups", "rows"]),
});

/** Flat and fully required (strict json_schema); code reads only the fields the route uses. */
export const PictureDirectorSchema = z.object({
  route: z.enum(PICTURE_ROUTES),
  pictures: z.array(Picture),
  count: Count.nullable(),
  diagram: z.enum(DIAGRAM_KINDS as [string, ...string[]]).nullable(),
});
export type PictureDirection = z.infer<typeof PictureDirectorSchema>;

const SYSTEM = `You choose the picture for one slide of a school lesson. The slide's writer described the picture it wants in a sentence; you decide where the picture comes from and write what that source needs. A picture earns its place when pupils can see in it what the slide teaches.

Choose one route:
- commons: one particular real thing: a named place, building, person, artwork, document or object, or a scene tied to a date or a named event. Only a photograph or reproduction of that very thing is true to it.
- pexels: a real subject that ordinary stock photographs show: a single common subject, or a simple everyday scene, that a photo library very likely holds.
- library-or-generate: a picture no real photograph is likely to show: an unusual combination of subjects, or a staged comparison.
- code: the point is an exact number of countable things or their arrangement in equal groups or rows, or one of these drawings shows the idea better than a photo: ${DIAGRAM_KINDS.join(", ")}.
- none: nothing pupils could see explains the slide's point better than its words, so a picture would only decorate.

For commons, pexels and library-or-generate, give one picture, or two or three when the slide compares things that read better as separate photographs; then each picture shows one of them. For code and none, pictures is empty.

Each picture has:
- shows: one sentence naming the subject and what pupils must see in it.
- mustShow: one to three things pupils must be able to see, each a short label, most important first. For commons the first is the thing itself.
- queries: two or three photo-library searches, most specific first, as a person would type them: a dated event as its year and name, a named thing by its name, then words for the view the slide needs.
- imagePrompt: what an image model is told if no stored or library photo fits: one realistic photograph of one subject in a simple setting that suits it. Living subjects look natural and unposed, as in a real photograph. For commons, it shows the real thing as it truly looks or looked. Give a period or place only when the subject belongs to one, taken from the lesson, and the lesson's country only when what pupils see differs between countries; never show a place through landmarks, flags or national symbols. Name only what belongs in the picture, since the image model draws every object a prompt mentions, and describe what is there rather than what to leave out. Code adds the rules about text and a single frame. Frame it for the zone's shape.

For code, count is the total, the number of equal groups or rows, how many in each, and whether they are groups or rows (one group when none are asked for); diagram is the drawing's kind. Each is null when it does not apply.`;

function shapeOf(aspect: number): string {
  if (aspect > 1.15) return "landscape";
  if (aspect < 0.87) return "portrait";
  return "square";
}

export function pictureDirectorPrompt(input: PictureDirectorInput): {
  system: string;
  user: string;
} {
  const ratio = Math.round(input.aspect * 100) / 100;
  return {
    system: SYSTEM,
    user: [
      `Lesson: ${input.yearGroup} ${input.subject}, "${input.title}", taught in ${input.country}.`,
      `Slide heading: ${input.heading}`,
      `Slide text: ${input.text || "(none)"}`,
      `Teaching point: ${input.point || "(none)"}`,
      `Requested picture: ${input.request}`,
      `Requested to show: ${input.mustShow.length ? input.mustShow.join("; ") : "(none)"}`,
      `Picture zone: ${shapeOf(input.aspect)}, ${ratio} wide to 1 high.`,
    ].join("\n"),
  };
}
