import { z } from "zod";

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
 * - apparatus, equipment or an object alone, no people or hands, unless the slide is about using it
 *   (round 3 y11 s9: the apparatus photos had people in frame) (v11).
 * - BAKEOFF round 8 (v12, prompt-engineer): one picture per slot; the writer's shows/mustShow are
 *   kept (code ignores the director's); the director adds route, queries and imagePrompt. The
 *   lesson's picture style holds (no "always commons" for a story in an illustration lesson).
 *   `veto` carries the director's reason to show nothing (a schematic, a made portrait of a
 *   real-seeming private person), replacing the round 6-7 SCHEMATIC/PORTRAIT keyword rules.
 *   The imagePrompt paragraph is cut to what the image model needs; no diagram-kind list.
 */
export const PICTURE_DIRECTOR_VERSION = "picture-director.v12";

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
  /** Round 8: the writer's subject field: one particular real thing (named) or any good example. */
  writerSubject?: "named" | "generic";
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
  // Round 8 (dataflow audit B): one picture per slot (the slide's own request), and no unused
  // `diagram` field; the slot's diagram is the writer's, never the director's.
  pictures: z.array(Picture).max(1),
  count: Count.nullable(),
  named: z.enum(NAMED_KINDS).nullable(),
  period: z.string().nullable(),
  /** Round 8: the director's reason to show no picture here (code enforces, never decides). */
  veto: z.string().nullable(),
});
export type PictureDirection = z.infer<typeof PictureDirectorSchema>;

const SYSTEM = `You find the picture for one slide of a school lesson. The slide's writer has said what the picture shows and what pupils must see in it, and that stays as written. You decide where the picture comes from and write what that source needs: the route, the library searches and the image prompt.

A good picture shows the slide's teaching point so that pupils can see it: the subject the writer asked for, plainly and truly, in the lesson's picture style, framed for its zone.

Choose one route:
- commons: a particular real thing that is named or dated: an artwork or a recorded production of a named work, a person, a place, a building, a document, an object, or an event tied to a date. The real photograph or reproduction is searched first, and a made picture is the fallback.
- pexels: a real subject that ordinary stock photographs show, alone or in a simple everyday scene.
- library-or-generate: a picture no real photograph is likely to show: an unusual combination, a staged comparison, or a scene, character or setting from a story as it might be imagined.
- code: a number of identical things that a drawn array counts better than a photograph.
- none: nothing pupils could see explains the point better than the slide's words.

The writer's subject is named when it wants one particular real thing and generic when any good example will do. The lesson's picture style holds for every picture: in an illustration lesson a story's characters, scenes and stagings are imagined (library-or-generate), and only a real historical person, document or artefact is shown as it truly looks.

veto is a short reason when no picture should be shown here, else null. A picture is vetoed when the request is a schematic, such as particles, a model or shapes cut into parts, which a diagram teaches and a picture would only decorate; or when the only picture possible is a made, realistic image of a particular person who seems real but is not a public figure. With a veto, route is none.

pictures holds one picture, or none for code, none or a veto:
- shows and mustShow: the writer's, copied.
- queries: two to four library searches of two to four words each, most specific first: a named thing by its name, a dated event by its year and name, then words for the view the slide needs.
- imagePrompt: what an image model is told if no library picture fits: the subject in a setting that suits it, framed for the zone's shape. In a photo lesson it is one realistic, natural, unposed photograph; in an illustration lesson it describes only what is in the picture, since code adds the style. A historical event is a painted illustration of the scene. For primary-age pupils, one subject fills the frame on a plain background. Equipment or an object stands alone unless the slide is about using it. It names a period, place or country only when what pupils see depends on it, and describes only what is in the picture.

count, when the point is an exact number of real things: what is counted (plural), the total, the number of equal groups or rows, how many spaces each holds, groups or rows, and how many spaces are empty; route library-or-generate, or code when a drawn array teaches it better. named, for commons: event, person, work, place or object. period: the time and place a historical subject belongs to, as a phrase; null for anything present-day. Each is null when it does not apply.`;

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
      ...(input.writerSubject ? [`Writer's subject: ${input.writerSubject}`] : []),
    ].join("\n"),
  };
}
