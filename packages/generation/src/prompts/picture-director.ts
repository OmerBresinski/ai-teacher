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
 * Ledger (evidence: PHOTO-BANK/DIRECTOR.md, DIRECTOR-PROMPTS.md, COUNT-TEST, HISTORY-TEST):
 * - routes by category, no examples: luna low agreed on 22 of 24 fixtures (v1).
 * - pexels only where stock plausibly holds it; unusual combinations straight to generation (Greg).
 * - commons for anything named or dated (v3: a Tempest staging had gone to generation).
 * - mustShow is what a camera records, each one thing in 2-4 words; who, where and when come from
 *   the source record the judge reads (v2 clauses failed the gate; v4 "German children").
 * - queries of 2-4 words (v2: long searches found nothing on Commons).
 * - image prompt: one subject, a setting that suits it, natural and unposed (Greg: posed animals
 *   read as AI); period or place only when the subject belongs to one (round 1 UK overload);
 *   "describe what is there" keeps negative lists away from the image model.
 * - count slot with empty spaces; code writes COUNT-TEST arm B's prompt (16 of 16 exact) (v6).
 * - named and period, for ruling 163's table; a historical event is a painted illustration (v7).
 * - the lesson's picture style is an input; in an illustration lesson the image prompt describes the
 *   subject without photographic words (code adds the locked style line); a fictional character
 *   or an imagined staging of a story is library-or-generate, not commons (BAKEOFF round 1: every
 *   y10 Prospero went to commons and came back empty) (v8).
 * - a young one with its adult must look related, so mustShow carries "same kind and colouring"
 *   for the judge; pupils up to Year 6 get one frame-filling subject on a plain background
 *   (BAKEOFF round 2 y1: a ginger kitten beside a black cat, a heap of kittens in leaves, a hen's
 *   head cut off at the edge) (v9).
 * - stages of one thing: each says what is visibly true at its stage and what is not there yet
 *   (round 3: a bean "seed" panel came back already sprouting) (v10).
 */
export const PICTURE_DIRECTOR_VERSION = "picture-director.v10";

/** What a commons subject is: code decides per kind whether a Commons miss may be generated. */
export const NAMED_KINDS = ["event", "person", "work", "place", "object"] as const;
export type NamedKind = (typeof NAMED_KINDS)[number];

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
  /** The lesson's picture style (design.picture_style); photo when the lesson has none. */
  style?: "photo" | "illustration";
};

const Picture = z.object({
  shows: z.string(),
  mustShow: z.array(z.string()),
  queries: z.array(z.string()),
  imagePrompt: z.string(),
});

const Count = z.object({
  things: z.string(),
  total: z.number().int(),
  empty: z.number().int(),
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
  named: z.enum(NAMED_KINDS).nullable(),
  period: z.string().nullable(),
});
export type PictureDirection = z.infer<typeof PictureDirectorSchema>;

const SYSTEM = `You choose the picture for one slide of a school lesson. The slide's writer described the picture it wants in a sentence; you decide where the picture comes from and write what that source needs. A picture earns its place when pupils can see in it what the slide teaches.

Choose one route:
- commons: anything real and named or dated: a named work or a recorded production of it, an artwork, a person, a place, a building, a document, an object, or an event or scene tied to a date. Always commons, even when the request describes a particular moment of it: a real photograph or reproduction is searched first, and a generated one is only the fallback.
- pexels: a real subject that ordinary stock photographs show: a single common subject, or a simple everyday scene, that a photo library very likely holds.
- library-or-generate: an unnamed picture no real photograph is likely to show: an unusual combination of subjects, a staged comparison, or a fictional character or scene from a story, play or novel as it might be imagined or staged.
- code: a drawing shows the idea better than a photograph, including an array of plain identical marks, or one of these: ${DIAGRAM_KINDS.join(", ")}.
- none: nothing pupils could see explains the slide's point better than its words, so a picture would only decorate.

For commons, pexels and library-or-generate, give one picture, or two or three when the slide compares things that read better as separate photographs; then each picture shows one of them. When they show stages of one thing, each describes what is visibly true at its stage and what is not there yet that the next stage brings. For code and none, pictures is empty.

Each picture has:
- shows: one sentence naming the subject and what pupils must see in it.
- mustShow: one to three things a camera records, each one visible thing in two to four words, most important first. Who or what it is, where and when cannot be seen, so leave them out: the judge reads them from the source's own record. When a picture shows a young one with its adult, or one of a set showing one subject growing, one item is "same kind and colouring", so the judge checks that they look related.
- queries: two to four photo-library searches of two to four words each, most specific first: a dated event as its year and name, a named thing by its name, then words for the view the slide needs.
- imagePrompt: what an image model is told if no stored or library photo fits: one subject in a simple setting that suits it. In a photo lesson it is one realistic photograph, and living subjects look natural and unposed, as in a real photograph. In an illustration lesson it describes only what is in the picture, since code adds the lesson's illustration style. A young one with its adult are the same breed or variety with the same colouring, both whole and neither crowding the other out. For commons, it shows the real thing as it truly looks or looked. Give a period or place only when the subject belongs to one, taken from the lesson, and the lesson's country only when what pupils see differs between countries; never show a place through landmarks, flags or national symbols. Name only what belongs in the picture, since the image model draws every object a prompt mentions, and describe what is there rather than what to leave out. Code adds the rules about text and a single frame. Frame it for the zone's shape.

For pupils up to Year 6, choose a picture a young pupil takes in at a glance: one subject, or the few the slide needs, filling the frame on a plain, uncluttered background rather than a busy scene; the queries ask for that view and the imagePrompt describes it.

When the point is an exact number of real things, give count and route library-or-generate: code writes the image prompt from it. Choose code with count only when a drawn array teaches it better. count is what is counted (plural), how many there are, the number of equal groups or rows, how many spaces each holds, whether they are groups or rows (one group when none are asked for), and how many of those spaces are empty. For code, diagram is the drawing's kind. For commons, named is what the subject is: an event, a person, a work, a place or a particular object or artefact. period is the time and place a historical subject belongs to, written as a phrase; null for anything present-day. For a historical event, imagePrompt describes a painted educational illustration of the scene, never a photograph. Each is null when it does not apply.`;

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
      `Picture style for this lesson: ${input.style ?? "photo"}`,
    ].join("\n"),
  };
}
