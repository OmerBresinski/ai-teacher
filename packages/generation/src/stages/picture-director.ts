/**
 * The picture director (; prompt in prompts/picture-director.ts): one `small`
 * call per picture slot, off the writing clock, decides the route, the searches, mustShow, the
 * image prompt, a count and a period. Code checks the answer and runs the library ladder. A slot
 * whose call fails (after callStructured's one retry) or whose answer is unusable gets no picture.
 */

import { safeError } from "@tj/domain";
import type { ImageBrief, Lesson, PhotoSource } from "@tj/domain/documents";
import { anchorQueries, type CountArray, joinPanels, pngSize } from "@tj/images";
import { z } from "zod";
import { type CallStructuredOptions, callStructured } from "../call";
import { recordDebug } from "../debug";
import { isHistoricalLesson, type PeriodFields } from "../period";
import {
  DIRECTOR_FRAMES_WHOLE,
  lessonLine,
  PICTURE_DIRECTOR_VERSION,
  type PictureDirection,
  type PictureDirectorInput,
  PictureDirectorSchema,
  pictureDirectorPrompt,
} from "../prompts/picture-director";
import {
  BATCH_DIRECTOR_FRAMES_WHOLE,
  PICTURE_DIRECTOR_BATCH_VERSION,
} from "../prompts/picture-director-batch";
import type { PictureMaker, PipelineDeps } from "../types";
import { compoundSubjects, libraryKind } from "../writer/lost-picture";
import { namedUnmatched, seenOf, unmatchedItems } from "../writer/picture-checks";
import {
  isFatal,
  isReservationRefusal,
  nonFatal,
  nonFatalSync,
  whenNonFatal,
} from "../writer/services";
import {
  type DirectedPlacer,
  failedChecks,
  judgeMadeDirected,
  type PlacedPhoto,
  pickDirectedPhoto,
  plainSubject,
} from "./illustrate";
import {
  type BankRequest,
  findPicture,
  historyPolicy,
  type JudgeCheck,
  type MadePicture,
  mustShowOf,
  type PictureBank,
  realFallbackFor,
  sharedVerdictCache,
} from "./photo-bank";
import {
  directedSetJudges,
  isHistoricalSet,
  isSameSubjectSet,
  makePictureSet,
  type SetAsk,
  type SetPicture,
  setIsGenerated,
  setLookFor,
} from "./picture-set";
import {
  keyStageOf,
  lessonSubjectOf,
  type PictureKind,
  pictureKindOf,
  sourceKindOf,
  traceProps,
} from "./picture-trace";

export type DirectorDeps = CallStructuredOptions<PictureDirectorInput, PictureDirection>["deps"];

/** The director's answer, or undefined when the call fails (an abort still throws). */
export async function directPicture(
  input: PictureDirectorInput,
  deps: DirectorDeps,
): Promise<PictureDirection | undefined> {
  const built = pictureDirectorPrompt(input);
  return nonFatal(
    async () => {
      const call = await callStructured({
        deps,
        stage: "illustrate",
        cls: "small",
        effort: "low",
        prompt: { version: PICTURE_DIRECTOR_VERSION, system: built.system, user: () => built.user },
        input,
        schema: PictureDirectorSchema,
        maxOutputTokens: 3000,
      });
      return call.output;
    },
    () => {
      if (deps.signal.aborted) throw deps.signal.reason;
      return undefined;
    },
  );
}

/** The batched answer: one direction per slot, by the slot's id. */
export const PictureDirectorBatchSchema = z.object({
  slots: z.array(PictureDirectorSchema.extend({ id: z.string() })),
});

/** The batched user turn: the lesson once, then each slot's slide and request under its id. */
export function pictureDirectorBatchUser(
  slots: { id: string; input: PictureDirectorInput }[],
): string {
  const first = slots[0]?.input;
  if (!first) return "";
  const head = [lessonLine(first), `Picture style for this lesson: ${first.style ?? "photo"}`];
  const blocks = slots.map(({ id, input }) => {
    // The per-slot lines are the single prompt's, minus the lesson and style lines given once.
    const lines = pictureDirectorPrompt(input)
      .user.split("\n")
      .filter((l) => !l.startsWith("Lesson: ") && !l.startsWith("Picture style for this lesson:"));
    return [`Slot ${id}`, ...lines].join("\n");
  });
  return [head.join("\n"), ...blocks].join("\n\n");
}

/**
 * Every slot's direction in one call, with the batched system prompt the
 * caller supplies. A missing slot, or a failed call, is undefined for that slot; an abort throws.
 */
export async function directPictures(
  slots: { id: string; input: PictureDirectorInput }[],
  deps: DirectorDeps,
  system: string,
): Promise<Map<string, PictureDirection>> {
  const out = new Map<string, PictureDirection>();
  if (slots.length === 0) return out;
  const user = pictureDirectorBatchUser(slots);
  // A failed batch leaves every slot to its own call; a stop is rethrown.
  await nonFatal(
    async () => {
      const call = await callStructured({
        deps,
        stage: "illustrate",
        cls: "small",
        effort: "low",
        prompt: { version: PICTURE_DIRECTOR_BATCH_VERSION, system, user: () => user },
        input: slots,
        schema: PictureDirectorBatchSchema,
        maxOutputTokens: 3000 * Math.min(slots.length, 6),
      });
      for (const { id, ...direction } of call.output.slots) out.set(id, direction);
    },
    () => {
      if (deps.signal.aborted) throw deps.signal.reason;
    },
  );
  return out;
}

/**
 * Slots asked within `windowMs` of the first share one batched call; a slot the batch missed falls
 * back to its own call. With the window as long as the plan's stream, a lesson makes one call.
 */
export function createDirectorBatcher(
  deps: DirectorDeps,
  system: string,
  windowMs = 400,
): (input: PictureDirectorInput) => Promise<PictureDirection | undefined> {
  let queue: {
    id: string;
    input: PictureDirectorInput;
    done: (d: Promise<PictureDirection | undefined>) => void;
  }[] = [];
  let n = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // A cancelled job stops the pending batch: the timer is cleared and every queued slot is told.
  deps.signal.addEventListener(
    "abort",
    () => {
      if (timer) clearTimeout(timer);
      timer = undefined;
      const batch = queue;
      queue = [];
      const stop = Object.assign(new Error("The picture director was stopped."), {
        name: "AbortError",
      });
      for (const slot of batch) slot.done(Promise.reject(stop));
    },
    { once: true },
  );
  const flush = () => {
    timer = undefined;
    const batch = queue;
    queue = [];
    const answers = directPictures(batch, deps, system);
    for (const slot of batch)
      slot.done(answers.then((m) => m.get(slot.id) ?? directPicture(slot.input, deps)));
  };
  return (input) =>
    new Promise((resolve) => {
      if (queue.length === 0) timer = setTimeout(flush, windowMs);
      queue.push({ id: `p${++n}`, input, done: resolve });
    });
}

export interface DirectedPicture {
  shows: string;
  mustShow: string[];
  queries: string[];
  imagePrompt: string;
}

export type PicturePlan =
  | { kind: "none" }
  | { kind: "draw"; request: BankRequest }
  /** The director chose a drawing (route `code`) of a kind the caller's drawer draws. */
  | { kind: "drawing"; diagram: string }
  | {
      kind: "photo";
      request: BankRequest;
      /** Brief fields for the stock search and the judge. */
      brief: Pick<ImageBrief, "request" | "mustShow" | "queries" | "specific" | "period">;
      /** Every picture the director asked for; the zone shows the first (layout is later work). */
      pictures: DirectedPicture[];
    };

const clip = (s: string, n: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= n ? t : t.slice(0, n).replace(/\s+\S*$/, "");
};
const uniq = (xs: string[]) =>
  xs.filter((x, i) => x && xs.findIndex((y) => y.toLowerCase() === x.toLowerCase()) === i);

const WORDS =
  "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty".split(
    " ",
  );
const inWords = (n: number) => (WORDS[n] ? `${WORDS[n]} (${n})` : String(n));

/** The fewest things a photo is framed as a count for (`countImagePrompt`). */
const COUNT_PHOTO_MIN = 3;

/** A count slot code can use: whole, at most 120, spaces = total + empty. */
function countOk(c: PictureDirection["count"]): c is NonNullable<PictureDirection["count"]> {
  if (!c || !c.things.trim()) return false;
  const empty = Math.max(0, c.empty);
  return (
    c.total >= 1 &&
    c.total <= 120 &&
    c.groups >= 1 &&
    c.perGroup >= 1 &&
    c.groups * c.perGroup === c.total + empty
  );
}

/**
 * COUNT-TEST arm B (16 of 16 exact): the count in words and digits, the layout from the slot,
 * empty spaces kept, a view from directly above on a plain surface, nothing else in frame.
 */
export function countImagePrompt(c: NonNullable<PictureDirection["count"]>): string | undefined {
  if (!countOk(c)) return undefined;
  const empty = Math.max(0, c.empty);
  const layout =
    empty > 0
      ? `They fill ${inWords(c.total)} of ${inWords(c.groups * c.perGroup)} spaces set out in ${c.groups} ${c.arrangement === "rows" || c.groups === 1 ? "rows" : "groups"} of ${c.perGroup}; exactly ${inWords(empty)} spaces are empty and clearly visible.`
      : c.groups === 1
        ? `They are in one ${c.total <= 10 ? "straight row" : "neat grid"}.`
        : c.arrangement === "rows"
          ? `They are in ${inWords(c.groups)} rows of ${inWords(c.perGroup)}, the rows evenly spaced.`
          : `They are in ${inWords(c.groups)} separate groups of ${inWords(c.perGroup)}, with wide gaps between the groups, each group a neat block.`;
  return [
    `One realistic photograph, seen from directly above: exactly ${inWords(c.total)} ${c.things.trim()}, on a plain surface.`,
    layout,
    "Every object is whole and clearly separate, with a visible gap around it: none overlap, touch, stack or are cut off by the edge of the frame.",
    "Nothing else is in the picture.",
  ].join("\n");
}

/**
 * Code's period line for a painting (TEACH-251 part af): no famous landmark unless the picture is
 * about it, and then as it stood. The generator draws a place's best-known landmark in its
 * present form (verify6 Great Fire: 6 of 8 first paintings refused for the wrong period, most for
 * a later domed cathedral in a 1666 skyline).
 */
export const PERIOD_LANDMARK_LINE =
  "Show no famous landmark, monument or city skyline unless the picture is about it: any buildings in the background are ordinary buildings of that time and place. A landmark the picture is about is shown as it stood then, not as it looks today.";

/** A historical subject Commons missed (ruling 163): an obvious painted illustration in its period. */
export function illustrationPrompt(prompt: string, period: string): string {
  return [
    "A hand-painted educational illustration, clearly a painting and not a photograph.",
    prompt,
    `Everything in it belongs to ${period}.`,
    PERIOD_LANDMARK_LINE,
  ].join("\n");
}

/**
 * The lesson's one picture look (design.picture_style, Greg 6 Oct), passed on every picture call.
 * `illustration`: every generic picture is generated in one locked style and palette; named real
 * things still come from Commons and Pexels, and history keeps ruling 163.
 */
export interface LessonLook {
  style: "photo" | "illustration";
  /**
   * How generic pictures are found in a photo lesson: `stock-first` (default, the director's
   * route) or `generate` (every generic picture made in the one house photo look).
   */
  generic?: "stock-first" | "generate";
  /** The house photo line (prompt agent's `house-photo.txt` when it exists). */
  houseLine?: string;
  /** The theme's colours, in order (accent, accent2, background, ink). */
  palette?: string[];
  /** The style line (prompt agent's `illustration-style.txt`, `{{palette}}` filled by code). */
  line?: string;
}

/**
 * The look a lesson's picture sets are made in, from the writer's `design.picture_style` (C5,
 * TEACH-110 part h): an illustration lesson's locked style, else the house photo look, so every
 * panel of a set shares one look. The lines are code's defaults above; no prompt text changes.
 */
export function setLookOf(design?: { picture_style?: "photo" | "illustration" }): LessonLook {
  return design?.picture_style === "illustration"
    ? { style: "illustration" }
    : { style: "photo", generic: "generate" };
}

/**
 * C7 (TEACH-167 part b): a stock-first search still running after this long starts its generation
 * beside it. On the two recorded lessons every stock picture that landed did so within 13.0 s of
 * the director's answer, and the misses ran 18.7-20.0 s before generating: 13.5 s adds no
 * generation to either and starts each miss's generation 5-6 s sooner.
 */
export const WRITER_STOCK_RACE_MS = 13_500;

/** The default style line until the prompt agent's file lands: the ruling 163 painted look. */
export const ILLUSTRATION_LINE =
  "A hand-painted educational illustration, clearly a painting and not a photograph.";

/**
 * The house photo look (code's default until the prompt agent's file lands). TEACH-251 part f: the
 * subject large and whole within the frame, not frame-filling (heart R3 s8: an arm ran off the edge).
 */
export const HOUSE_PHOTO_LINE =
  "A natural-light photograph taken at eye level: the subject sharp, large and whole within the frame, in a simple, slightly soft setting that suits it; a plain background only when the subject is a small object. Uncluttered.";

/** True when generic pictures of this look are generated in the house photo look. */
export function housePhoto(look?: LessonLook): boolean {
  return look?.style === "photo" && look.generic === "generate";
}

/** A generic picture in the house photo look: the same line first on every call. */
export function housePhotoPrompt(prompt: string, look?: LessonLook): string {
  return [look?.houseLine ?? HOUSE_PHOTO_LINE, prompt].join("\n");
}

/** The palette key a look's pictures are stored and reused under. */
export function paletteKey(look?: LessonLook): string | undefined {
  return look?.style === "illustration" && look.palette?.length
    ? look.palette.map((c) => c.trim().toLowerCase()).join(" ")
    : undefined;
}

/** A generic picture in the lesson's locked illustration style: the same line on every call. */
export function lessonIllustrationPrompt(prompt: string, look: LessonLook): string {
  const palette = (look.palette ?? []).join(", ");
  const line = (look.line ?? ILLUSTRATION_LINE).replace("{{palette}}", palette);
  const withPalette =
    look.line?.includes("{{palette}}") || !palette ? line : `${line}\nColour palette: ${palette}.`;
  return [withPalette, prompt].join("\n");
}

interface Ask {
  text: string;
  named: string | null;
  aspect?: number;
  look?: LessonLook;
  /** What the writer's picture must show (its `must_see`), for a picture planned from the ask. */
  mustShow?: string[];
  /**
   * The ask is historical by its own words or a history lesson's event or people (ruling 163):
   * kept as a picture, it takes the real ladder and is never generated.
   */
  historical?: boolean;
  /** The lesson's title: a monument it names stays real-only in a past scene (ruling 296). */
  lessonTitle?: string;
}

/**
 * Greg, 10 Oct: "a visual should never be lost." The director's answer when code keeps the
 * writer's own picture: its words as the picture, a named thing on the real ladder (Commons, never
 * generated, ruling 163), anything else stock first, then generated.
 */
function askDirection(ask: Ask, d: PictureDirection | undefined): PictureDirection {
  const text = ask.text.replace(/\s+/g, " ").trim();
  // Ruling 163 before any spend: a historical ask with no director answer is a past event, so the
  // real ladder (Commons, then stock) and REAL_FALLBACK decide; nothing is generated for it.
  const past = !ask.named && !d?.period && ask.historical === true;
  return {
    route: ask.named || past ? "commons" : "library-or-generate",
    pictures: [
      {
        shows: text,
        mustShow: ask.mustShow ?? [],
        queries: uniq([plainSubject(text), ...anchorQueries(text)]),
        imagePrompt: text,
      },
    ],
    count: null,
    diagram: null,
    named: ask.named ? (d?.named ?? "object") : past ? "event" : null,
    period: d?.period ?? null,
  };
}

/** An imagined scene: a story, play or novel, or a character in one. No photograph shows it. */
const IMAGINED =
  /\b(fictional|fictitious|imagined|imaginary|make-believe|fairy[- ]?tales?|fables?|myths?|mythical|legends?|legendary|stories|story|novels?|poems?|plays?|characters?|cartoons?|dragons?|unicorns?|monsters?|wizards?|witch(es)?|fair(y|ies))\b/i;

/**
 * TEACH-167 part b: whether a director route searches stock before it generates. pexels always
 * does. library-or-generate does too, unless the request is an imagined scene: a real subject the
 * director read as "an unusual combination" or "a staged comparison" (finches with big and small
 * beaks, light and dark moths, lesson 01a12146) may well have a real photograph, and the photo
 * judge gates every stock candidate, so generation stays the fallback, never the first step.
 */
export function stockFirstRoute(route: PictureDirection["route"], text: string): boolean {
  if (route === "pexels") return true;
  return route === "library-or-generate" && !IMAGINED.test(text);
}

/**
 * The slot's plan from the director's answer (Greg, 10 Oct: a visual is never lost). A writer ask
 * is a picture the slide needs, so code never plans none for one that has words: the director's
 * own `none`, a failed call or an answer with no usable picture keeps the writer's ask as the
 * picture, and a drawing the bank cannot draw goes to the caller's drawer (`draws`) or, with none,
 * keeps the ask's picture too. `real` (a history card, ruling 163) puts the picture on the real
 * ladder: Commons, then stock, never generated.
 */
export function planPicture(
  d: PictureDirection | undefined,
  ask: Ask,
  opts: { draws?: boolean; real?: boolean } = {},
): PicturePlan {
  // An ask with no words has nothing to keep (and askDirection would plan it again forever).
  const keep = (): PicturePlan =>
    ask.text.trim()
      ? planPicture(askDirection(ask, d), ask, opts.real ? { real: true } : {})
      : { kind: "none" };
  if (d?.route === "none") return keep();
  if (!d) return keep();
  const base = { named: ask.named, ...(ask.aspect !== undefined ? { aspect: ask.aspect } : {}) };
  const counted = countOk(d.count) ? d.count : undefined;
  // FIX1: a photo framed as a count only when there is something to count. A pair (an adult and
  // its young) is a picture of what it shows; framed as "exactly two animals" it lost the cow.
  const countedPhoto = counted && counted.total >= COUNT_PHOTO_MIN ? counted : undefined;
  if (d.route === "code") {
    // Only a plain array is drawn by the bank; any other drawing is the drawer's, else a picture.
    if (!counted || counted.empty > 0)
      return opts.draws ? { kind: "drawing", diagram: d.diagram ?? "labelled-diagram" } : keep();
    const { total, groups, perGroup, arrangement } = counted;
    const draw: CountArray = { total, groups, perGroup, arrangement };
    return { kind: "draw", request: { ...base, text: ask.text, route: "generic", draw } };
  }
  const period = d.period?.trim() || undefined;
  // Ruling 163: a period makes the subject historical on any route, so it takes the
  // real ladder (Commons first) and the history table's fallback, never a stock-photo generation.
  // a lesson trial: a period makes a picture historical only when it depicts a past event or
  // person (r6 y4: wheat and ore with a period were refused generation and the deck had no
  // pictures). A generic thing (a wheat field, a lump of ore) stays generic, period or not.
  const depicts =
    !!period &&
    (d.named === "event" ||
      d.named === "person" ||
      (!d.named && DEPICTS.test(`${ask.text} ${d.pictures[0]?.shows ?? ""}`)));
  const ruled = opts.real === true || d.route === "commons" || depicts;
  // The request's year-plus-event anchor leads a Commons search ("hyperinflation 1923" ranks the
  // real 1923 Weimar photo first; the director's own wording did not).
  const dated = ruled ? anchorQueries(ask.text).filter((q) => /\d{4}/.test(q)) : [];
  const pictures: DirectedPicture[] = d.pictures
    .map((p) => ({
      shows: clip(p.shows, 400),
      mustShow: uniq(p.mustShow.map((m) => clip(m, 40))).slice(0, 3),
      queries: uniq([...dated, ...p.queries.map((q) => clip(q, 80))]).slice(0, 4),
      imagePrompt: p.imagePrompt.replace(/\s+/g, " ").trim(),
    }))
    .filter((p) => p.shows && p.imagePrompt);
  const first = pictures[0];
  if (!first) return keep();
  // Only the director's own kind counts. An unclassified ask stays null, which is real-only, even
  // a depicting past scene: it could be a portrait, a place or a monument (rulings 163, 296). Only
  // an explicit `event` is painted, whether or not the writer named it (rulings 163, 210).
  // TEACH-251 part r (ruling 210): people doing something at a real place in its own time (Roman
  // soldiers patrolling Hadrian's Wall, a traveller approaching its gateway) is a past scene, not
  // the place: when the search misses it is painted, as an event is. The director files these
  // under `place` (romans verify3 s6 and s8 went bare as real-only). Only the director's own
  // `shows` is read, it needs people and what they are doing, and a writer-named subject is
  // never reclassified: the place or monument itself, with people in it or not, a reconstruction
  // or its building included, stays real-only (rulings 210 and 296).
  // TEACH-251 part ai (ruling 296, romans rompic s8): a scene at a real named monument, site or
  // building (a gateway through Hadrian's Wall) is a picture of the monument, so it stays
  // real-only; only a scene with no named monument in view ("a traveller near Hadrian's Wall") is
  // painted.
  const pastScene =
    !!period &&
    d.named === "place" &&
    !ask.named &&
    isPastScene(first.shows) &&
    !monumentInView(`${first.shows} ${ask.text}`, ask.lessonTitle);
  const kind = pastScene ? "event" : (d.named ?? null);
  // A forced-real slot (a named set's panel, a named history card) is real-only, an event too:
  // ruling 209 never puts a generated panel beside real ones.
  const ruledFallback = !ruled
    ? undefined
    : opts.real === true
      ? "none"
      : realFallbackFor(kind, period ? historyPolicy() : "present", !!ask.named);
  // Ruling 296: a present-day generic object the director sent to Commons is searched like a real
  // thing (Commons, then stock), then made as any generic picture is: the generic route, the
  // lesson's look. A past one stays on the real route with the painted illustration (ruling 163).
  const genericObject = ruledFallback === "illustration" && !period && kind === "object";
  const real = ruled && !genericObject;
  const fallback = real ? ruledFallback : undefined;
  const mustShow = countedPhoto
    ? uniq([
        `exactly ${countedPhoto.total} ${countedPhoto.things.trim()}`,
        ...first.mustShow,
      ]).slice(0, 3)
    : first.mustShow;
  const counting = countedPhoto && countImagePrompt(countedPhoto);
  const illustrated = !counting && fallback === "illustration" && !!period;
  // The lesson's locked look: a generic picture (not a real thing, not a count) is generated in it.
  const looked = !counting && !real && ask.look?.style === "illustration";
  const palette = looked ? paletteKey(ask.look) : undefined;
  const housed = !counting && !real && !looked && housePhoto(ask.look);
  const imagePrompt =
    counting ||
    (illustrated && period
      ? illustrationPrompt(first.imagePrompt, period)
      : looked && ask.look
        ? lessonIllustrationPrompt(first.imagePrompt, ask.look)
        : housed
          ? housePhotoPrompt(first.imagePrompt, ask.look)
          : first.imagePrompt);
  return {
    kind: "photo",
    request: {
      ...base,
      text: first.shows,
      route: real ? "real" : "generic",
      imagePrompt,
      draw: null,
      stockFirst:
        (genericObject || stockFirstRoute(d.route, `${ask.text} ${first.shows}`)) &&
        !countedPhoto &&
        !looked &&
        !housed,
      ...(fallback ? { realFallback: fallback } : {}),
      ...(period ? { period } : {}),
      ...(depicts ? { depicts: true } : {}),
      ...(illustrated || looked ? { style: "illustration" as const } : {}),
      ...(housed ? { style: "house" as const } : {}),
      ...(palette ? { palette } : {}),
    },
    brief: {
      request: first.shows,
      mustShow,
      queries: first.queries,
      specific: ruled,
      ...(period ? { period } : {}),
    },
    pictures,
  };
}

/** The slide a picture is for, as the director reads it. */
export interface SlideForPicture {
  heading: string;
  text?: string;
  point?: string;
  /**
   * TEACH-251 part v: the slide teaches where a real place is (a "locate" or "where" objective):
   * a locator map from Commons is tried before a photograph of the place.
   */
  locate?: boolean;
}

/**
 * One picture slot: the director, then the ladder. `stock` searches and judges with a brief;
 * `judgeMade` shows a generated picture to the same judge with that brief.
 */
export async function findDirected(args: {
  bank: PictureBank;
  ask: { subject: string; named?: string | null };
  brief: ImageBrief;
  slide: SlideForPicture;
  lesson: { title: string; yearGroup?: string } & PeriodFields;
  country: string;
  index: number;
  /** `signal` cancels this one search (a race it lost) without stopping the slot. */
  stock: (brief: ImageBrief, signal?: AbortSignal) => Promise<PlacedPhoto | undefined>;
  judgeMade: (
    brief: ImageBrief,
    picture: MadePicture,
    reuse?: boolean,
    onWhy?: (why: string, failed?: readonly JudgeCheck[]) => void,
  ) => Promise<boolean>;
  deps: DirectorDeps;
  /** C7: race stock against generation after this long (`findPicture`); absent, one then the other. */
  raceMs?: number;
  /** How long a locator map may search (TEACH-251 part v); absent, LOCATOR_MAP_MS. */
  mapMs?: number;
  /** The lesson's picture look, the same on every call of the lesson. */
  look?: LessonLook;
  /** How the director is asked (a batcher); absent, one call for this slot. */
  direct?: (input: PictureDirectorInput) => Promise<PictureDirection | undefined>;
  /** How the slot ended: the director's route, the ladder's step, and why it is empty when it is. */
  onOutcome?: (o: PictureOutcome) => void;
  /**
   * The caller draws a drawing the director chooses (the writer stage's drawer): a `code` route
   * the bank cannot draw ends here as `director-code` with its kind. Absent, it is kept as a picture.
   */
  draws?: boolean;
  /** Ruling 163 for this slot (a history card): the real ladder only, never generated. */
  realOnly?: boolean;
}): Promise<DirectedPhoto | undefined> {
  const { ask, brief: b, lesson, deps } = args;
  const direction = await (args.direct ?? ((i: PictureDirectorInput) => directPicture(i, deps)))({
    yearGroup: lesson.yearGroup ?? "",
    subject: lesson.subject ?? "",
    title: lesson.title,
    country: args.country,
    heading: args.slide.heading,
    text: args.slide.text ?? "",
    point: (args.slide.point ?? "").slice(0, 400),
    request: ask.subject,
    mustShow: b.mustShow ?? [],
    aspect: b.aspect ?? 1.6,
    ...(args.look ? { style: args.look.style } : {}),
  });
  const plan = planPicture(
    direction,
    {
      text: ask.subject,
      named: ask.named ?? null,
      ...(b.aspect !== undefined ? { aspect: b.aspect } : {}),
      ...(args.look ? { look: args.look } : {}),
      ...(b.mustShow?.length ? { mustShow: b.mustShow } : {}),
      historical:
        isHistoricalSet([ask.subject]) || (isHistoricalLesson(lesson) && DEPICTS.test(ask.subject)),

      lessonTitle: lesson.title,
    },
    { draws: args.draws === true, ...(args.realOnly ? { real: true } : {}) },
  );
  const log = (extra: Record<string, unknown>) =>
    deps.logger.info(
      {
        stage: "illustrate",
        slideIndex: args.index,
        director: direction?.route ?? "failed",
        ...extra,
      },
      "picture director",
    );
  // The debug record (Greg, 20 Oct 2026): the director's answer, the plan and the outcome.
  const debugPicture = (extra: Record<string, unknown>) =>
    recordDebug(
      deps.debug,
      "picture",
      { ask: ask.subject, mustShow: b.mustShow ?? [], direction: direction ?? null, ...extra },
      args.index,
    );
  /** A slot the director routed away from the ladder still has its outcome line (it was silent). */
  const emptyOutcome = (reason: string, via = "none") =>
    deps.logger.info(
      {
        stage: "illustrate",
        ev: "picture-outcome",
        kind: "single",
        slideIndex: args.index,
        // `none`: the director wanted no picture (or failed); `drawer`: handed to the code drawer.
        outcome: via === "drawer" ? "drawer" : "none",
        via,
        attempts: 0,
        reason,
        director: direction?.route ?? "failed",
        sourceKind: via === "drawer" ? "drawn" : "none",
        lessonSubject: lessonSubjectOf(lesson.subject),
        keyStage: keyStageOf(lesson.yearGroup),
        promptVersion: args.direct ? PICTURE_DIRECTOR_BATCH_VERSION : PICTURE_DIRECTOR_VERSION,
      },
      "picture outcome",
    );
  if (plan.kind === "none") {
    debugPicture({ plan: "none", outcome: "none" });
    log({ plan: "none" });
    emptyOutcome(direction ? "director-none" : "director-failed");
    args.onOutcome?.({
      director: direction?.route ?? "failed",
      via: "none",
      reason: direction ? "director-none" : "director-failed",
    });
    return undefined;
  }
  // The caller's drawer draws it (with the ask's words); nothing is searched or generated here.
  if (plan.kind === "drawing") {
    debugPicture({ plan: "drawing", diagram: plan.diagram, outcome: "drawer" });
    log({ plan: "drawing", diagram: plan.diagram });
    emptyOutcome("director-code", "drawer");
    args.onOutcome?.({
      director: "code",
      via: "drawer",
      reason: "director-code",
      diagram: plan.diagram,
    });
    return undefined;
  }
  const req = plan.request;
  const brief: ImageBrief =
    plan.kind === "photo"
      ? { ...b, ...plan.brief, specific: plan.brief.specific || b.specific === true }
      : b;
  // TEACH-251 part v: a "where" slide about a real place shows a map of where it is. A Commons
  // locator map is searched beside the place's own ladder (never before it, so the slot is no
  // slower), capped at LOCATOR_MAP_MS, and stored in the library like any picture; when one is
  // found it is placed, else the ladder's picture is.
  const place =
    args.slide.locate && direction?.named === "place"
      ? placeNameOf(req.text, brief.queries ?? [])
      : null;
  const mapCtl = new AbortController();
  const stopMap = () => mapCtl.abort(deps.signal.reason);
  deps.signal.addEventListener("abort", stopMap, { once: true });
  const capMap = place
    ? setTimeout(() => mapCtl.abort(new Error("map-cap")), args.mapMs ?? LOCATOR_MAP_MS)
    : 0;
  const mapBrief = place ? locatorBrief(brief, place) : brief;
  const mapP: Promise<PlacedPhoto | undefined> = place
    ? findPicture(
        locatorRequest(req, mapBrief),
        args.bank,
        // A real request's search gets no signal from the ladder: the map's own one is passed.
        () => args.stock(mapBrief, mapCtl.signal),
        mapCtl.signal,
      ).then(
        (o) => o.photo,
        // The cap's own abort is a miss; the slot's abort and a budget refusal are rethrown.
        (e: unknown) => {
          if (!deps.signal.aborted && mapCtl.signal.aborted) return undefined;
          return whenNonFatal(() => undefined)(e);
        },
      )
    : Promise.resolve(undefined);
  const ladder = findPicture(
    req,
    args.bank,
    (signal) => args.stock(brief, signal),
    deps.signal,
    (made, reuse, onWhy) => args.judgeMade(brief, made, reuse, onWhy),
    Date.now,
    sharedVerdictCache,
    args.raceMs,
  );
  // A photo placed first leaves the map a short grace, never the whole cap: the slot is not slower.
  let graceMap: ReturnType<typeof setTimeout> | 0 = 0;
  if (place)
    void ladder.then(
      (o) => {
        if (o.photo && !mapCtl.signal.aborted)
          graceMap = setTimeout(() => mapCtl.abort(new Error("map-grace")), LOCATOR_MAP_GRACE_MS);
      },
      () => undefined,
    );
  // The cap holds even for a search that does not listen to its signal.
  const mapCapped = Promise.race([
    mapP,
    new Promise<undefined>((resolve) =>
      mapCtl.signal.addEventListener("abort", () => resolve(undefined), { once: true }),
    ),
  ]);
  const [map, found] = await Promise.all([mapCapped, ladder]).finally(() => {
    clearTimeout(capMap);
    clearTimeout(graceMap);
    deps.signal.removeEventListener("abort", stopMap);
  });
  if (place) log({ map: map ? "placed" : "missed", place });
  let out = map ? { ...found, photo: map, via: "fetched" as const, attempts: 0 } : found;
  // a lesson trial, ruling 163: a past event or person that the scene search missed is shown by a
  // real artefact, coin, map, site or museum object (a Claudius bust), before nothing.
  if (!out.photo && req.depicts && plan.kind === "photo") {
    const t0 = Date.now();
    const artefact: ImageBrief = {
      ...brief,
      request: artefactRequest(req.text, req.period),
      mustShow: [],
      queries: artefactQueries(req.text, req.period),
      specific: true,
    };
    const got = await args.stock(artefact).catch(
      whenNonFatal(() => {
        if (deps.signal.aborted) throw deps.signal.reason;
        return undefined;
      }),
    );
    if (got) out = { ...out, photo: got, via: "fetched", ms: out.ms + Date.now() - t0 };
  }
  log({
    via: out.via,
    ms: out.ms,
    attempts: out.attempts,
    ...(out.reason ? { reason: out.reason } : {}),
  });
  const emptyReason =
    req.route === "real" && (req.realFallback ?? "none") === "none"
      ? "real-miss-no-fallback"
      : "generation-refused-or-failed";
  // One line per picture (codes and counts only, ADR 0015), the same shape as a set frame's, so a
  // paid eval can count empty photos and why. `reason` is the last failure, also on a placed
  // picture that needed a retry.
  // Tracing never touches the picture: a throw here records no kind and no trace, nothing else.
  const traced = nonFatalSync(
    () => {
      const kind: PictureKind = pictureKindOf({
        text: req.imagePrompt ?? req.text,
        named: direction?.named,
        draw: Boolean(req.draw),
      });
      return { kind, props: traceProps(out.trace, out.photo?.src, kind) };
    },
    () => undefined,
  );
  const pictureKind = traced?.kind;
  const trace = traced?.props;
  deps.logger.info(
    {
      stage: "illustrate",
      ev: "picture-outcome",
      kind: "single",
      slideIndex: args.index,
      outcome: out.photo ? "placed" : "empty",
      via: out.via,
      attempts: out.attempts,
      reason: out.reason ?? (out.photo ? undefined : emptyReason),
      // Picture tracing (21 Oct 2026, `docs/observability.md` "Lesson pictures"): codes and numbers.
      director: direction?.route ?? "failed",
      route: req.route,
      sourceKind: sourceKindOf(out.via, out.photo as MadePicture | undefined),
      pictureKind,
      lessonSubject: lessonSubjectOf(lesson.subject),
      keyStage: keyStageOf(lesson.yearGroup),
      promptVersion: args.direct ? PICTURE_DIRECTOR_BATCH_VERSION : PICTURE_DIRECTOR_VERSION,
      framingClause: args.direct ? BATCH_DIRECTOR_FRAMES_WHOLE : DIRECTOR_FRAMES_WHOLE,
      library: out.trace.library,
      stock: out.trace.stock,
      latencyMs: out.ms,
      ...(trace ?? {}),
    },
    "picture outcome",
  );
  debugPicture({
    plan: plan.kind,
    request: req,
    queries: brief.queries ?? [],
    outcome: out.photo ? "placed" : "empty",
    via: out.via,
    attempts: out.attempts,
    ms: out.ms,
    ...(out.reason ? { failure: out.reason } : out.photo ? {} : { reason: emptyReason }),
    ...(out.photo ? { chosen: out.photo.source, src: out.photo.src } : {}),
    // Every try in full (ids, judge reasons, costs, frame measure): the debug record only.
    pictureKind,
    tries: out.trace.attempts,
    library: out.trace.library ?? null,
    stock: out.trace.stock ?? null,
    ...(out.trace.stockFailure ? { stockFailure: out.trace.stockFailure } : {}),
    costUsd: trace?.pictureCostUsd,
  });
  const style = (out.photo as MadePicture | undefined)?.style;
  args.onOutcome?.({
    director: direction?.route ?? "failed",
    via: out.via,
    route: req.route,
    ...(req.period ? { period: req.period } : {}),
    attempts: out.attempts,
    ...(out.reason ? { failure: out.reason } : {}),
    ...(out.photo ? {} : { reason: emptyReason }),
  });
  if (!out.photo) return undefined;
  // What the slot shows, for the ruling 163 gate: how a generated picture looks (stock is a photo),
  // and the period the request belongs to.
  return {
    ...out.photo,
    look:
      out.photo.source.provider === "generated"
        ? style === "drawn"
          ? "drawn"
          : (style ?? "photo")
        : "photo",
    ...(req.period && req.depicts ? { period: req.period } : {}),
  };
}

/** Round 7: words that make a historical picture show people or an event (not wheat or ore). */
const DEPICTS =
  /\b(people|person|man|men|woman|women|child|children|crowd|soldiers?|army|armies|legion(ary|aries)?|troops|king|queen|emperor|ruler|leader|workers?|shoppers?|families|family|villagers|battle|landing|invasion|invad\w*|march\w*|riot|protest|meeting|ceremony|siege|fight\w*|attack\w*|parade|queue)\b/i;

/** How long a locator map search may run beside the place's own ladder (TEACH-251 part v). */
export const LOCATOR_MAP_MS = 12_000;
/** How long the map may still run once the place's photograph is placed (TEACH-251 part v). */
export const LOCATOR_MAP_GRACE_MS = 1_500;

const LEAD_WORD = /^(A|An|The|This|That|These|Those)$/;
const JOIN_WORD = new Set(["of", "the", "upon", "de", "la", "le"]);

/**
 * The real place a picture shows, from the director's `shows`: of its proper-name runs ("Roman",
 * "Hadrian's Wall"), the one the director's own searches name ("Hadrian's Wall locator"), else the
 * longest; null with none. A lone adjective ("Roman soldiers") is never chosen over a place.
 */
export function placeNameOf(shows: string, queries: readonly string[] = []): string | null {
  const words = shows
    .replace(/[.,;:()]/g, " ")
    .replace(/’/g, "'")
    .split(/\s+/)
    .filter(Boolean);
  const proper = (w: string | undefined) => !!w && /^[A-Z][\p{L}'-]*$/u.test(w);
  const runs: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i] as string;
    if (!proper(w) || LEAD_WORD.test(w)) continue;
    const run = [w];
    let j = i + 1;
    for (; j < words.length; j++) {
      const n = words[j] as string;
      if (proper(n)) run.push(n);
      else if (JOIN_WORD.has(n.toLowerCase()) && proper(words[j + 1])) run.push(n);
      else break;
    }
    runs.push(run.join(" "));
    i = j - 1;
  }
  const asked = queries.map((q) => q.replace(/’/g, "'").toLowerCase());
  const named = runs.filter((r) => asked.some((q) => q.includes(r.toLowerCase())));
  const pool = named.length ? named : runs;
  const best = pool.reduce<string | null>(
    (a, r) => (!a || r.split(" ").length > a.split(" ").length ? r : a),
    null,
  );
  return best && best.length >= 3 ? best : null;
}

/** The bank request for a locator map: real only, keyed by its own request (TEACH-251 part v). */
export function locatorRequest(req: BankRequest, brief: ImageBrief): BankRequest {
  return {
    text: brief.request ?? req.text,
    named: req.named,
    ...(req.aspect === undefined ? {} : { aspect: req.aspect }),
    route: "real",
    realFallback: "none",
  };
}

/** The brief for a Commons locator map of `place` (TEACH-251 part v). */
export function locatorBrief(brief: ImageBrief, place: string): ImageBrief {
  return {
    ...brief,
    request: `A locator map showing where ${place} is`,
    mustShow: [`${place} marked on a map`],
    queries: [`${place} locator map`, `${place} location map`],
    specific: true,
  };
}

/** People in a past scene (who), for `isPastScene`. */
const SCENE_PEOPLE =
  /\b(soldiers?|guards?|sentr(y|ies)|legionar(y|ies)|troops|travell?ers?|traders?|merchants?|visitors?)\b/i;
/**
 * What they are doing: movement, watch and trade, active or passive ("soldiers checking a
 * trader", "a trader being checked by soldiers", TEACH-251 part u, romans verify4 s7), never
 * building or simply being there ("the Great Wall built by workers", "the Colosseum with crowds"
 * stay pictures of the monument).
 */
const SCENE_DOING =
  /\b(patroll?(ing|ed)|patrols?|walking|marching|guarding|keeping watch|standing guard|approaching|crossing|carrying|trading|waiting|(check|stopp|search|question|inspect)(ing|ed))\b/i;

/** A picture of people doing something at a past place: a scene there (ruling 210). */
export function isPastScene(shows: string): boolean {
  return SCENE_PEOPLE.test(shows) && SCENE_DOING.test(shows);
}

/**
 * Kinds of built thing: a proper name that holds one names a real monument, site or building
 * ("Hadrian's Wall", "Housesteads Roman Fort", "Old St Paul's Cathedral"). Kinds, never names.
 */
const STRUCTURE =
  /\b(walls?|forts?|fortress|castles?|cathedral|church|abbey|priory|chapel|minster|mosque|temple|palace|towers?|bridge|gates?|gateway|villa|amphitheatre|colosseum|forum|baths|pyramids?|henge|monument|hall|house|museum|theatre|stadium|lighthouse|barracks|milecastles?)\b/i;
/** Proper-name phrases: capitalised words, joined by "of"/"the", a saint's prefix included. */
const PROPER = /\b(?:St\.?\s+|Saint\s+)?[A-Z][\w'’-]*(?:\s+(?:of\s+|the\s+)?[A-Z][\w'’-]*)*/g;
/** Words before a name that put the monument out of view ("near Hadrian's Wall"). */
const AWAY =
  /\b(near|beyond|outside|away from|far from|towards?|(?:north|south|east|west) of|without showing[^.]*)\s*(?:the\s+)?$/i;

/** The monument names in `text`, each with the words before its kind ("Housesteads") too. */
function monumentNames(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(PROPER)) {
    const name = m[0].replace(/’/g, "'");
    // TEACH-251 part aj: one kind word opening a sentence is capitalised by grammar, not a name
    // ("Castle servants carrying water", "Church bells ringing").
    const opening = /(^|[.!?:;]\s*)$/.test(text.slice(0, m.index));
    if (opening && !/\s/.test(name) && STRUCTURE.test(name)) continue;
    const saint = /^(St\.?|Saint)\s/.test(name) && name.split(/\s+/).length > 1;
    const kind = STRUCTURE.exec(name);
    if (!kind && !saint) continue;
    out.push(name);
    const head = kind
      ? name
          .slice(0, kind.index)
          .replace(/\b(Roman|Old|New)\s*$/, "")
          .trim()
      : "";
    if (head && /^[A-Z]/.test(head) && !head.includes(" ") && head.length > 3) out.push(head);
  }
  return out;
}

/**
 * Whether a past scene shows a real named monument, site or building (ruling 296): a monument the
 * scene's words or the lesson's title name (its kind word too, "the wall", for the lesson's own)
 * is mentioned and not as somewhere away ("near", "beyond", "without showing").
 */
export function monumentInView(text: string, lessonTitle = ""): boolean {
  const plain = text.replace(/’/g, "'");
  const own = monumentNames(lessonTitle);
  const kinds = own.map((n) => STRUCTURE.exec(n)?.[0]).filter((k): k is string => !!k);
  const names = [...new Set([...monumentNames(plain), ...own, ...kinds])];
  // Longest first, and each name read is blanked, so "Wall" is never read again inside "near
  // Hadrian's Wall".
  let rest = plain;
  for (const name of names.sort((a, b) => b.length - a.length)) {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`\\b${esc}\\b`, "gi");
    for (const m of rest.matchAll(re)) {
      if (!AWAY.test(rest.slice(Math.max(0, (m.index ?? 0) - 60), m.index))) return true;
    }
    rest = rest.replace(re, "\u00a7");
  }
  return false;
}

/** Round 7: the artefact request for a past event or person whose scene has no real picture. */
export function artefactRequest(shows: string, period?: string): string {
  return `A real surviving artefact, coin, map, site or museum object connected with: ${shows}${period ? ` (${period})` : ""}`;
}

/**
 * Round 7: Commons queries for artefacts of a past event or person: its proper names (and the
 * period's) with coin, map, museum object and site.
 */
export function artefactQueries(shows: string, period?: string): string[] {
  const words = `${period ?? ""} ${shows}`.match(/\b[A-Z][a-z]+(?:\s[A-Z][a-z]+)*/g) ?? [];
  const STOP = new Set(["A", "An", "The", "Two", "Three", "One", "Some", "This", "That"]);
  const names = [...new Set(words.filter((w) => !STOP.has(w)))].slice(0, 2);
  const subject = names.join(" ") || shows.split(/\s+/).slice(0, 3).join(" ");
  return [
    `${subject} coin`,
    `${subject} map`,
    `${subject} museum`,
    `${subject} archaeological site`,
  ];
}

/** A placed picture with how it looks and the period it belongs to. */
export type DirectedPhoto = PlacedPhoto & {
  look: "photo" | "illustration" | "drawn" | "house";
  period?: string;
};

export interface PictureOutcome {
  director: string;
  via: string;
  route?: string;
  period?: string;
  /** The drawing's kind when the director chose one for the caller's drawer (`director-code`). */
  diagram?: string;
  /** Why the slot is empty: the director gave nothing, a real thing missed with no fallback, or generation was refused (cap, judge, or error). */
  reason?:
    | "director-code"
    | "director-none"
    | "director-failed"
    | "real-miss-no-fallback"
    | "generation-refused-or-failed";
  /** Generations the ladder asked for (0: none ran). */
  attempts?: number;
  /** The last generation failure's code (`judge`, `refused-safety`, `server-error`...). */
  failure?: string;
}

// ---------------------------------------------------------------------------------------------
// Placement for the writer planner (TEACH-251): one writer picture ask, through the director and
// the ladder, to a placed photo or nothing (the slot keeps its placeholder).
// ---------------------------------------------------------------------------------------------

/** One picture the writer asked for: its `shows`, `must_see` and `subject`, on its slide. */
export interface WriterPictureAsk {
  /** Where the picture goes (`<slide>:<slot>`), for logs. */
  key: string;
  shows: string;
  mustSee: string[];
  /** The writer's `subject: "named"`. */
  named: boolean;
  /** The slot's width over height. */
  aspect?: number;
  slide: SlideForPicture;
  /** The slide's index in the lesson. */
  index: number;
  /** The writer's `picture_style`: illustration lessons generate generic pictures (P5). */
  style?: "photo" | "illustration";
}

/**
 * The bank before the library and the generator land (TEACH-237, TEACH-84 part b): no stored
 * pictures, nothing generated or drawn. Real and stock-first routes still search; a generate or
 * draw route keeps its placeholder.
 */
export const STOCK_ONLY_BANK: PictureBank = {
  lookup: async () => undefined,
  remember: async () => undefined,
  generate: async () => undefined,
};

/** A map is a real source, never a made picture: it is searched as a named thing first. */
export const isMapRequest = (shows: string) => /\bmaps?\b/i.test(shows);

/** Opening words of a drawing intent and dating words, never a place's name. */
const NOT_A_PLACE = new Set([
  "why",
  "how",
  "what",
  "where",
  "when",
  "who",
  "which",
  "show",
  "draw",
  "highlight",
  "label",
  "mark",
  "use",
  "do",
  "make",
  "ad",
  "bc",
  "a",
  "the",
]);

/**
 * The Commons searches of a map ask (TEACH-251 part ah, romans verify7 s4): "<name> map" for the
 * places its words name, longest names first, then the lesson title's. The ask had no searches of
 * its own, so map-first searched "show north up" and "why romans built" among photographs.
 */
export function mapQueriesOf(shows: string, title = ""): string[] {
  const names = (text: string) =>
    [...text.matchAll(/\b[A-Z][\w’'-]*(?:\s+(?:of\s+)?[A-Z][\w’'-]*)*/g)]
      .map((m) => m[0].replace(/’/g, "'").trim())
      .map((n) =>
        n
          .split(/\s+/)
          .filter((w, k) => k > 0 || !NOT_A_PLACE.has(w.toLowerCase()))
          .join(" "),
      )
      .filter((n) => n && !NOT_A_PLACE.has(n.toLowerCase()) && !/^[A-Z]+$/.test(n));
  const fromShows = names(shows).sort((a, b) => b.split(" ").length - a.split(" ").length);
  const all = [...fromShows, ...names(title)].filter(
    (n, k, list) => list.findIndex((x) => x.toLowerCase() === n.toLowerCase()) === k,
  );
  return all.slice(0, 3).map((n) => `${n} map`);
}

/** An ask's `shows`, or "" when the slide sent none (asks are read off model JSON). */
const showsOf = (ask: { shows?: unknown }): string =>
  typeof ask.shows === "string" ? ask.shows : "";

/** The brief a writer ask is searched and judged with, as base4 built it. */
export function writerAskBrief(ask: WriterPictureAsk): ImageBrief {
  const shows = showsOf(ask);
  const request = [shows, ...(ask.mustSee ?? [])].join(". ");
  return {
    subject: plainSubject(shows).slice(0, 60),
    request: request.slice(0, 400),
    mustShow: ask.mustSee.length ? ask.mustSee : mustShowOf(request),
    purpose: "context",
    specific: ask.named,
    ...(ask.aspect ? { aspect: Math.round(ask.aspect * 100) / 100 } : {}),
  };
}

/**
 * One writer picture: a map searched as a named thing first, else the director (batched when
 * `direct` is a batcher) and the ladder with `pickDirectedPhoto` as the stock path. A provider
 * error or a refusal is no picture (undefined); a budget stop or a cancel (`isFatal`) is rethrown,
 * so the writer stage fails or cancels instead of saving a deck without its pictures.
 */
export async function placeWriterPicture(args: {
  ask: WriterPictureAsk;
  lesson: Lesson;
  country: string;
  images: DirectedPlacer;
  deps: PipelineDeps;
  /** The batched director (`createDirectorBatcher`); absent, one call for this slot. */
  direct?: (input: PictureDirectorInput) => Promise<PictureDirection | undefined>;
  /** The library and generator; absent, `STOCK_ONLY_BANK`. */
  bank?: PictureBank;
  look?: LessonLook;
  /** Pages already placed in this lesson. */
  taken?: Set<string>;
  /** C7 race threshold; absent, `WRITER_STOCK_RACE_MS`. */
  raceMs?: number;
  onOutcome?: (o: PictureOutcome) => void;
  /** The stage draws a drawing the director chooses (`findDirected`'s `draws`). */
  draws?: boolean;
  /** Ruling 163 for this slot (`findDirected`'s `realOnly`). */
  realOnly?: boolean;
}): Promise<DirectedPhoto | undefined> {
  const { ask, lesson, deps } = args;
  const b = writerAskBrief(ask);
  const taken = args.taken ?? new Set<string>();
  const illustrated = ask.style === "illustration";
  const stock = async (
    brief: ImageBrief,
    signal?: AbortSignal,
  ): Promise<PlacedPhoto | undefined> => {
    // Illustration lessons: generic pictures are generated in the lesson's style (no stock);
    // named real things still come from Commons and Pexels (ruling 163).
    if (illustrated && !brief.specific) return undefined;
    const r = await pickDirectedPhoto({
      lesson,
      index: ask.index,
      brief,
      images: args.images,
      // A race this search lost aborts its searches and its judge calls.
      deps: signal ? { ...deps, signal: AbortSignal.any([deps.signal, signal]) } : deps,
      taken,
      // A budget stop or a cancel is never a missing picture: it stops the lesson.
    }).catch(
      whenNonFatal((error: unknown) => {
        if (deps.signal.aborted) throw deps.signal.reason;
        deps.logger.info(
          {
            stage: "illustrate",
            ev: "stock-failed",
            slideIndex: ask.index,
            errorType: safeError(error).type,
            err: error,
          },
          "stock failed",
        );
        return { outcome: "empty" as const };
      }),
    );
    return r.outcome === "placed" ? r.photo : undefined;
  };
  return nonFatal(
    async (): Promise<DirectedPhoto | undefined> => {
      if (isMapRequest(ask.shows)) {
        const map = await stock({
          ...b,
          specific: true,
          queries: mapQueriesOf(ask.shows, lesson.title),
        });
        if (map) {
          args.onOutcome?.({ director: "map-first", via: "fetched", route: "real" });
          deps.logger.info(
            {
              stage: "illustrate",
              ev: "picture-outcome",
              kind: "single",
              slideIndex: ask.index,
              outcome: "placed",
              via: "fetched",
              attempts: 0,
              director: "map-first",
              route: "real",
              sourceKind: sourceKindOf("fetched", map),
              lessonSubject: lessonSubjectOf(lesson.subject),
              keyStage: keyStageOf(lesson.yearGroup),
            },
            "picture outcome",
          );
          return { ...map, alt: map.alt ?? ask.shows, look: "photo" };
        }
      }
      return await findDirected({
        bank: args.bank ?? STOCK_ONLY_BANK,
        ask: { subject: b.request ?? ask.shows, named: ask.named ? b.subject : null },
        brief: b,
        slide: ask.slide,
        lesson: {
          title: lesson.title,
          yearGroup: lesson.yearGroup,
          subject: lesson.subject,
          historicalPeriod: lesson.historicalPeriod,
          fictionInPeriod: lesson.fictionInPeriod,
        },
        country: args.country,
        index: ask.index,
        stock,
        // A made picture is shown to judge v17 with the slot's brief (TEACH-237): the same bytes
        // the slide shows. One with no bytes to show (a code-drawn count) is never judged here.
        judgeMade: (brief, made, reuse, onWhy) =>
          made.dataUrl
            ? judgeMadeDirected({
                lesson,
                index: ask.index,
                brief,
                deps,
                dataUrl: made.dataUrl,
                ...(reuse !== undefined ? { reuse } : {}),
                ...(onWhy ? { onVerdict: (v) => onWhy(v.why ?? "", failedChecks(brief, v)) } : {}),
              })
            : Promise.resolve(false),
        deps,
        raceMs: args.raceMs ?? WRITER_STOCK_RACE_MS,
        ...(args.look ? { look: args.look } : {}),
        ...(args.direct ? { direct: args.direct } : {}),
        ...(args.onOutcome ? { onOutcome: args.onOutcome } : {}),
        ...(args.draws ? { draws: true } : {}),
        ...(args.realOnly ? { realOnly: true } : {}),
      });
    },
    (error) => {
      if (deps.signal.aborted) throw deps.signal.reason;
      // The slot ends with no outcome line of its own: say so, with the error's type only.
      deps.logger.info(
        {
          stage: "illustrate",
          ev: "picture-outcome",
          kind: "single",
          slideIndex: ask.index,
          outcome: "failed",
          via: "none",
          reason: "error",
          errorType: safeError(error).type,
          sourceKind: "none",
          lessonSubject: lessonSubjectOf(lesson.subject),
          keyStage: keyStageOf(lesson.yearGroup),
          err: error,
        },
        "picture failed",
      );
      return undefined;
    },
  );
}

// ---------------------------------------------------------------------------------------------
// The writer stage's pictures (TEACH-251 part b): every photo ask placed off the writing clock,
// read by the stage as a visual state. A teacher never sees a placeholder: once `settle` returns
// (all placements done, or the deadline passed) no ask is pending, and an ask with no picture is
// `failed`, so the stage lays the slide out text-only (or keeps its code-drawn figure).
// ---------------------------------------------------------------------------------------------

/** A photo ask as the writer stage reads it off a slide (`materialise.ts` `VisualAsk`). */
export interface WriterPhotoAsk {
  key: string;
  type: "photo";
  shows: string;
  mustSee: string[];
  named: boolean;
  aspect?: number;
  fixedShape?: boolean;
  /** A same-subject set's panel: made together by the generator (TEACH-237), not searched. */
  set?: string;
}

/** What the stage lays a picture slot out with (`materialise.ts` `VisualState`, photo part). */
export type WriterPictureState =
  | { status: "pending" }
  | { status: "failed" }
  | {
      status: "photo";
      photo: {
        src: string;
        alt: string;
        aspect: number;
        request?: string;
        subjects?: { name: string; x: number; y: number; w: number; h: number }[];
        about?: string;
      };
    };

/** Why a slot has no picture, for the stage's reroute call and the run log. */
export type WriterPictureMiss =
  | PictureOutcome["reason"]
  | "set-not-searched"
  | "deadline"
  | "error"
  /** The budget refused the picture's call before it ran (a reservation, not spend over the cap). */
  | "budget"
  | "match6"
  /** Ruling 163: a history activity card's picture was generated; the card shows its word. */
  | "history-card-generated"
  /** Rulings 163 and 209: a named set missed a real picture; it is never part real, part generated. */
  | "set-real-incomplete"
  /** An ask with no words to search for (no `shows`): nothing is searched. */
  | "malformed-ask";

export interface WriterPictures {
  /** Start placing one ask (idempotent per slide and key). */
  start(index: number, ask: WriterPhotoAsk, slide: SlideForPicture): void;
  /** The ask's state now. After `settle`, never `pending`. */
  state(index: number, key: string): WriterPictureState;
  /** Wait for every started ask, at most `deadlineMs`; an ask still running counts as failed. */
  settle(deadlineMs?: number): Promise<void>;
  /**
   * Wait for one slide's started asks only, at most `deadlineMs`; an ask of that slide still
   * running stops and counts as failed. Other slides' placements are left running, so two slides'
   * later rounds (lostPic, a diagram's picture fallback) never wait on or cancel each other.
   */
  settleSlide(index: number, deadlineMs?: number): Promise<void>;
  /**
   * Resolves once every placement slide `index` has started is over (placed or failed), without
   * failing what is still pending or ending the round: the stage's early lost-picture retry waits
   * on it while other slides' pictures are still coming.
   */
  whenSlideDone(index: number, deadlineMs?: number): Promise<void>;
  /** Why the ask has no picture (the stage's `vetoed`); undefined when it has one or is running. */
  vetoed(index: number, key: string): string | undefined;
  /**
   * The diagram kind the director chose to draw this ask as (`draws`), for the stage's drawer;
   * undefined otherwise. Asked again (`start`), the ask keeps the picture route instead.
   */
  drawAs(index: number, key: string): string | undefined;
  /** The ask failed for a reason a second placement can fix (the deadline or an error). */
  retryable(index: number, key: string): boolean;
  /** True while `start` would place this key again (once per round after settle). */
  canReask(index: number, key: string): boolean;
  /** Each placed picture's source by its stored `src`, for `withPhotoSources`. */
  sources(): ReadonlyMap<string, PhotoSource>;
  /**
   * keepPic (BAKEOFF base4f): the photo match6 dropped from a slide that asks pupils to look,
   * point, match or find; the stage uses it only when the slide ends with no visual.
   */
  held(index: number, key: string): WriterPictureState | undefined;
  /**
   * C5 (TEACH-110 part h): the lesson's one look for its picture sets, once the writer's `design`
   * is known (before any slide's asks). Every panel of a set is made in it; single pictures keep
   * `opts.look`.
   */
  lookForSets(look: LessonLook): void;
  /**
   * Cancels every slot of a slide (TEACH-110 part h): the final parse opened the slide again with
   * other words, so its asks start afresh. A placement still running stops; a placed photo is
   * uncredited; a key not asked again ends failed after `settle`, never a placeholder.
   */
  forget(index: number): void;
}

/** The longest the stage waits for pictures before laying the deck out without them. */
export const WRITER_PICTURE_DEADLINE_MS = 45_000;

/**
 * picq (greatfire 26 Oct): past the deadline, a slot whose picture is already generated (paid
 * for) and is only waiting on its judge gets this much longer before it is stopped. The run lost
 * two generated pictures at editable and two more in the retry round, each 1-2 s from its verdict.
 */
export const WRITER_MADE_GRACE_MS = 15_000;

/**
 * Paintings of one slide the judge may refuse before a later round stops painting that slide
 * (TEACH-202 part x). A round that starts after the slide has had this many refused (the
 * lost-picture round after editable, the picture fallback after a reroute diagram) still searches
 * for a real picture but generates nothing. A round's own retries (`MADE_ATTEMPTS`) are untouched.
 * Greatfire verify5 and verify6: no painting started after a slide's second refusal was ever placed
 * (5 started, 1 paid); those rounds held the job open to its end.
 */
export const SLIDE_REFUSALS_MAX = 2;

/**
 * Split at ask (TEACH-167 part b): the subjects of a lone generic picture that names three or four
 * things after a colon ("Three golden retrievers: a small puppy, an older puppy and an adult dog"),
 * or undefined. One image of several subjects is the picture the generator and the judge fail
 * most; asked as one panel per subject from the start, it is never generated whole first.
 * A set panel, a named thing, a fixed-shape slot, a map or a library shape is never split.
 */
export function splitSubjects(ask: WriterPhotoAsk): string[] | undefined {
  if (ask.set || ask.named || ask.fixedShape || !showsOf(ask)) return undefined;
  const colon = ask.shows.indexOf(":");
  if (colon <= 0 || !ask.shows.slice(0, colon).trim()) return undefined;
  if (libraryKind(ask.shows) || isMapRequest(ask.shows)) return undefined;
  // A capitalised name in the list, or in the head after its first word, is a named real thing
  // (Henry VIII, the Golden Hind): never made.
  if (/\b[A-Z][a-z]*\b/.test(ask.shows.slice(colon + 1))) return undefined;
  if (/\b[A-Z][a-z]*\b/.test(ask.shows.slice(0, colon).trim().replace(/^\S+/, "")))
    return undefined;
  const subjects = compoundSubjects(ask.shows);
  return subjects.length >= 3 && subjects.length <= 4 ? subjects : undefined;
}

const MISS_LINE: Record<NonNullable<WriterPictureMiss>, string> = {
  "director-code": "The picture director chose a drawing for this slide.",
  "director-none": "The picture director chose no picture for this slide.",
  "director-failed": "The picture director could not be reached.",
  "real-miss-no-fallback": "No real photograph of this was found, and none is generated for it.",
  "generation-refused-or-failed": "No suitable picture was found.",
  "set-not-searched": "Picture sets are made by the generator, which is not on.",
  deadline: "The picture search ran out of time.",
  error: "The picture search failed.",
  budget: "The picture search stopped at this lesson's spending limit.",
  match6: "",
  // Ruling 163: the same line as a real thing missed (a history card is never generated).
  "history-card-generated": "No real photograph of this was found, and none is generated for it.",
  "set-real-incomplete": "No real photograph was found for every picture in this set.",
  "malformed-ask": "The slide did not say what the picture shows.",
};

export function createWriterPictures(opts: {
  lesson: Lesson;
  country: string;
  images: DirectedPlacer;
  deps: PipelineDeps;
  direct?: (input: PictureDirectorInput) => Promise<PictureDirection | undefined>;
  /** The batched director's system prompt: the batcher is made here, on the placements' signal. */
  batchSystem?: string;
  bank?: PictureBank;
  /**
   * The generator (TEACH-237): a set's panels are made together, and a generic single picture can
   * be generated through `maker.bank`. Absent: a set keeps no picture (`set-not-searched`).
   */
  maker?: PictureMaker;
  look?: LessonLook;
  style?: "photo" | "illustration";
  onOutcome?: (key: string, o: PictureOutcome) => void;
  /** A single ask's picture is placed and kept (live writing P2, TEACH-202 part e). */
  onPlaced?: (index: number, key: string) => void;
  /**
   * The stage draws what the director chooses to draw (its drawer and lostPic's library step):
   * such an ask ends failed with `drawAs` set. Absent, or for a slot the stage never redraws (a
   * set panel, a fixed shape, an activity card, the title and objectives slides, or an ask asked
   * again), the director's drawing is kept as a picture of the ask: stock, then generation.
   */
  draws?: boolean;
}): WriterPictures {
  type Slot = {
    state: WriterPictureState;
    miss?: WriterPictureMiss;
    /** The director's drawing kind, when the stage is to draw this ask (`drawAs`). */
    draw?: string;
    done: Promise<void>;
    /** Cancels this slot's own placement (`forget`: its slide was opened again). */
    stop: AbortController;
    /**
     * An early re-ask (the stage's lost picture, asked again before the round settles): it runs
     * on the job's own signal, not the round's, so `settle` neither waits for it nor stops it.
     * The slide's tail (`settleSlide`) waits for it after editable, as for any later round.
     */
    own?: boolean;
    /** A generated picture landed for this slot (paid); its judge may still be running. */
    made?: boolean;
    /** Started after its slide had `SLIDE_REFUSALS_MAX` refusals: searched, never generated. */
    noPaint?: boolean;
    /** Its picture was placed: a painting it discards later is a lost race, not a refusal. */
    won?: boolean;
  };
  /**
   * The bank as one slot sees it: a generated picture marks the slot `made`, so a deadline that
   * passes while its judge runs waits `WRITER_MADE_GRACE_MS` more instead of throwing it away.
   */
  const watched = (slot: Slot, b: PictureBank, index: number): PictureBank => ({
    lookup: (req, signal) => b.lookup(req, signal),
    remember: (req, photo) => b.remember(req, photo),
    // Only a picture that is made and waiting on its judge earns the grace: a new generation in
    // flight (a retry after a refusal) or a refused picture does not.
    generate: (req, faithful, signal, retry) => {
      slot.made = false;
      // A later round for a slide the judge kept refusing: the bank declines (the ladder's
      // `declined`), so the slot ends on its real search alone.
      if (slot.noPaint && !req.draw) {
        opts.deps.logger.info(
          { stage: "illustrate", slideIndex: index, refused: refused.get(index) },
          "slide painting stopped after refusals: no generation",
        );
        return Promise.resolve(undefined);
      }
      return b.generate(req, faithful, signal, retry).then((made) => {
        if (made) {
          slot.made = true;
          fresh.add(made.src);
        }
        return made;
      });
    },
    ...(b.reject
      ? {
          reject: (photo: PlacedPhoto) => {
            slot.made = false;
            // Only this lesson's own paintings count, never a library row the judge turned down,
            // nor the losing side of a race a real picture won (its slot has a picture).
            if (fresh.has(photo.src) && slot.state.status === "pending" && !slot.won)
              refused.set(index, (refused.get(index) ?? 0) + 1);
            return b.reject?.(photo) ?? Promise.resolve();
          },
          // A race a real picture won: taken out, never counted as a refusal.
          discard: (photo: PlacedPhoto) => {
            slot.made = false;
            return (b.discard ?? b.reject)?.call(b, photo) ?? Promise.resolve();
          },
        }
      : {}),
  });
  /** Pictures the judge refused (or took back) per slide index over the lesson (`SLIDE_REFUSALS_MAX`). */
  const refused = new Map<number, number>();
  /** Every picture this lesson generated (its src). */
  const fresh = new Set<string>();
  /** After a deadline: the slots among `list` still pending with a generated picture, waited for. */
  const graceForMade = async (list: Slot[]) => {
    const late = list.filter((x) => x.state.status === "pending" && x.made);
    if (!late.length || opts.deps.signal.aborted) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      Promise.all(late.map((x) => x.done)),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, WRITER_MADE_GRACE_MS);
      }),
    ]);
    if (timer) clearTimeout(timer);
  };
  /** The round's deps with the slot's own stop on the signal. */
  const slotDeps = (slot: Slot): PipelineDeps => {
    const base = slot.own ? opts.deps : deps;
    return { ...base, signal: AbortSignal.any([base.signal, slot.stop.signal]) };
  };
  type Box = { item: string; left: number; top: number; right: number; bottom: number };
  // The placements' own signal: the job's cancel, or the settle deadline, stops their spending.
  // A second round (lostPic's single pictures after editable) gets a fresh stopper and batcher.
  let stopper = new AbortController();
  let deps: PipelineDeps = {
    ...opts.deps,
    signal: AbortSignal.any([opts.deps.signal, stopper.signal]),
  };
  const roundDeps = () => deps;
  const makeDirect = () =>
    opts.direct ?? (opts.batchSystem ? createDirectorBatcher(deps, opts.batchSystem) : undefined);
  const bank = opts.bank ?? opts.maker?.bank;
  let direct = makeDirect();
  const heldPhotos = new Map<string, WriterPictureState>();
  /** A budget stop or a cancel seen by any placement; `settle` rethrows it. */
  let fatal: unknown;
  const slots = new Map<string, Slot>();
  /** A slide's set panels, gathered until the slide's asks are all in (one microtask). */
  const sets = new Map<string, { index: number; slide: SlideForPicture; asks: WriterPhotoAsk[] }>();
  const taken = new Set<string>();
  const sources = new Map<string, PhotoSource>();
  const id = (index: number, key: string) => `${index}:${key}`;
  const requestOf = (ask: WriterPhotoAsk) => [showsOf(ask), ...(ask.mustSee ?? [])].join(". ");
  let settled = false;
  /** The look sets are made in (C5): `lookForSets`, else `opts.look`. */
  let setLook = opts.look;
  /** Keys asked again in a later round (`start` after `settle`), so a round re-asks a key once. */
  const reasked = new Set<string>();
  /** Single slots whose own placement is over (an early retry may ask them again). */
  const over = new WeakSet<object>();

  /** A placed picture as the stage reads it: its OWN aspect (the ranged slots shape round it). */
  const photoState = (
    p: { src: string; alt: string; about?: string; boxes?: Box[] },
    aspect: number,
    request: string,
  ): WriterPictureState => {
    // As base4: only boxes with area become subjects.
    const boxes = p.boxes?.filter((b) => b.right > b.left && b.bottom > b.top);
    return {
      status: "photo",
      photo: {
        src: p.src,
        alt: p.alt,
        aspect,
        request,
        ...(p.about ? { about: p.about } : {}),
        ...(boxes?.length
          ? {
              subjects: boxes.map((b) => ({
                name: b.item,
                x: b.left,
                y: b.top,
                w: b.right - b.left,
                h: b.bottom - b.top,
              })),
            }
          : {}),
      },
    };
  };

  // A rejection is a stop (placeWriterPicture's nonFatal and makePictureSet rethrow only those) or
  // the deadline's own abort: it is kept, and settle rethrows a stop.
  const onError =
    (slot: Slot, roundStop = slot.own ? slot.stop : stopper) =>
    (error: unknown) => {
      if (slot.state.status !== "pending") return;
      slot.state = { status: "failed" };
      // The deadline's own stop is a missing picture; the job's cancel or a budget stop is fatal.
      if (roundStop.signal.aborted && !opts.deps.signal.aborted) {
        slot.miss = "deadline";
        return;
      }
      // A picture whose call the budget refused up front is a missing picture, not a failed lesson
      // (TEACH-110 part z): its slot ends empty for the teacher to fill, the other placements keep
      // running, and nothing was spent on it. Spend over the cap (`BudgetExceeded`) still stops.
      if (isReservationRefusal(error) && !opts.deps.signal.aborted) {
        slot.miss = "budget";
        const key = [...slots].find(([, s]) => s === slot)?.[0];
        opts.deps.logger.warn(
          { stage: "illustrate", picture: key, miss: "budget", err: safeError(error) },
          "picture call refused by the lesson budget; slot left empty",
        );
        return;
      }
      if (isFatal(error) || opts.deps.signal.aborted) {
        fatal ??= error;
        roundStop.abort();
        return;
      }
      slot.miss = "error";
    };

  /** One ask through the director and the ladder, into `slot`. */
  /**
   * Ruling 163 for activity cards (TEACH-101 part c): a history card is a searched picture or its
   * word, never a generated picture (no painted fallback either).
   */
  // Ruling 210: real-only is for a specific real thing (a named ask) only.
  const realOnly = (ask: WriterPhotoAsk, _shows: string[]) =>
    ask.key.startsWith("card.") && ask.named;
  const place = (
    slot: Slot,
    index: number,
    ask: WriterPhotoAsk,
    slide: SlideForPicture,
    real = realOnly(ask, [ask.shows]),
    redraw = opts.draws === true &&
      index >= 2 &&
      !ask.set &&
      !ask.fixedShape &&
      !/^card\./.test(ask.key),
  ) => {
    let reason: PictureOutcome["reason"];
    let diagram: string | undefined;
    return placeWriterPicture({
      ask: {
        key: ask.key,
        shows: ask.shows,
        mustSee: ask.mustSee,
        named: ask.named,
        ...(ask.aspect !== undefined ? { aspect: ask.aspect } : {}),
        slide,
        index,
        ...(opts.style ? { style: opts.style } : {}),
      },
      lesson: opts.lesson,
      country: opts.country,
      images: opts.images,
      deps: slotDeps(slot),
      taken,
      ...(slot.own ? (opts.direct ? { direct: opts.direct } : {}) : direct ? { direct } : {}),
      ...(bank ? { bank: watched(slot, bank, index) } : {}),
      ...(opts.look ? { look: opts.look } : {}),
      onOutcome: (o) => {
        reason = o.reason;
        diagram = o.diagram;
        opts.onOutcome?.(ask.key, o);
      },
      ...(redraw ? { draws: true } : {}),
      ...(real ? { realOnly: true } : {}),
    })
      .then((photo) => {
        if (slot.state.status !== "pending") return;
        if (!photo) {
          slot.state = { status: "failed" };
          slot.miss = reason ?? "generation-refused-or-failed";
          if (reason === "director-code") slot.draw = diagram;
          return;
        }
        if (real && photo.source?.provider === "generated") {
          slot.state = { status: "failed" };
          slot.miss = "history-card-generated";
          opts.deps.logger.info(
            { stage: "generate", picture: id(index, ask.key) },
            "history card picture was generated: word card",
          );
          return;
        }
        sources.set(photo.src, photo.source);
        // A placed picture clears the slide's refusals: a later round (the picture lost to a
        // reroute or a fit) may paint it again.
        slot.won = true;
        refused.delete(index);
        const p = photo as typeof photo & { about?: string; boxes?: Box[] };
        slot.state = photoState(
          p,
          (photo as { aspect?: number }).aspect ?? ask.aspect ?? 1,
          requestOf(ask),
        );
        // match6 + match6w (BAKEOFF base4f): a several-thing picture ships only when the judge saw
        // every thing the slide's own words name; the dropped photo is held on every slide (keepPic)
        // for a slide that would otherwise end with no visual.
        const words = `${slide.heading} ${slide.text ?? ""}`;
        const seen = seenOf({
          alt: photo.alt,
          about: p.about,
          request: requestOf(ask),
          provider: photo.source?.provider,
          source: photo.source,
          subjects: (p.boxes ?? [])
            .filter((b) => b.right > b.left && b.bottom > b.top)
            .map((b) => ({ name: b.item })),
        });
        const named = namedUnmatched(unmatchedItems(ask.mustSee, seen), words);
        if (named.length) {
          const k = id(index, ask.key);
          // Held on every slide (Greg, 10 Oct: a visual is never lost): keepPic ships it only when
          // the slide would otherwise end with no visual at all.
          heldPhotos.set(k, slot.state);
          slot.state = { status: "failed" };
          slot.miss = "match6";
          opts.deps.logger.info(
            { stage: "generate", picture: k, unmatched: named },
            "writer picture dropped (match6)",
          );
        }
      }, onError(slot))
      .then(() => {
        if (slot.state.status !== "photo") return;
        // Best effort: a failing re-lay never rejects (the deck is laid again before editable).
        nonFatalSync(
          () => opts.onPlaced?.(index, ask.key),
          (e) =>
            opts.deps.logger.warn(
              { stage: "generate", picture: id(index, ask.key), err: String(e).slice(0, 200) },
              "writer picture re-lay failed",
            ),
        );
      });
  };

  /**
   * One slide's set, once its panels are all in: made together by the generator when it is a
   * generic same-subject set, else each panel through the director's ladder (a named or
   * historical set: Commons first, ruling 163).
   */
  const placeSet = (setId: string, finish: () => void) => {
    const group = sets.get(setId);
    sets.delete(setId);
    const maker = opts.maker;
    if (!group || !maker) return finish();
    const panels = group.asks.map((a) => ({ ask: a, slot: slots.get(id(group.index, a.key)) }));
    const asks: SetAsk[] = group.asks.map((a) => ({
      key: a.key,
      index: group.index,
      shows: a.shows,
      mustSee: a.mustSee,
      named: a.named,
      ...(a.aspect !== undefined ? { aspect: a.aspect } : {}),
    }));
    const set = (p: SetPicture | undefined, ask: WriterPhotoAsk, slot: Slot | undefined) => {
      opts.onOutcome?.(ask.key, {
        director: "set",
        via: p ? "generated" : "none",
        ...(p ? {} : { reason: "generation-refused-or-failed" as const }),
      });
      if (!slot || slot.state.status !== "pending") return;
      if (!p) {
        slot.state = { status: "failed" };
        slot.miss = "generation-refused-or-failed";
        return;
      }
      sources.set(p.src, p.source);
      // The panel's own aspect, never the slot's.
      slot.state = photoState(p, p.aspect, p.request || requestOf(ask));
    };
    const generateSet = (look: typeof setLook) =>
      makePictureSet(
        asks,
        {
          generator: maker.generator,
          save: maker.save,
          ...directedSetJudges(opts.lesson, deps),
          ...(maker.grid !== undefined ? { grid: maker.grid } : {}),
          ...(maker.allow ? { allow: maker.allow } : {}),
          ...(maker.spent ? { spent: maker.spent } : {}),
          signal: AbortSignal.any([
            deps.signal,
            ...panels.flatMap(({ slot }) => (slot ? [slot.stop.signal] : [])),
          ]),
          log: (event) => deps.logger.info({ stage: "generate", ...event }, "picture set"),
        },
        look,
      ).then(
        (made) => {
          for (const [i, { ask, slot }] of panels.entries()) set(made[i], ask, slot);
          finish();
        },
        (error: unknown) => {
          for (const { slot } of panels) if (slot) onError(slot)(error);
          finish();
        },
      );
    if (!setIsGenerated(asks, opts.lesson)) {
      // Rulings 163 and 210: a set naming a specific real thing takes the real ladder only, each
      // panel; a panel with no real picture is a caption tile, never a generated picture beside
      // real ones.
      void Promise.all(
        panels.map(({ ask, slot }) =>
          slot ? place(slot, group.index, ask, group.slide, true) : undefined,
        ),
      ).then(finish, finish);
      return;
    }
    // Ruling 210: anything else is generated, in one look (drawn for history, rulings 163/209).
    generateSet(
      setLookFor(
        opts.lesson,
        asks.map((a) => a.shows),
        setLook,
      ),
    );
  };

  /**
   * A compound ask split at ask time: one panel per subject, made and judged as one generated set
   * in the lesson's look, then joined side by side into the slot's one picture. Every panel must
   * land: a picture missing one of the things it names is no picture of them.
   */
  const splitAsks = (index: number, ask: WriterPhotoAsk, subjects: string[]): SetAsk[] => {
    const head = ask.shows.slice(0, ask.shows.indexOf(":")).trim();
    const panelAspect = (ask.aspect ?? 1.6) / subjects.length;
    const same = isSameSubjectSet(subjects);
    return subjects.map((x, i) => ({
      key: `${ask.key}#${i + 1}`,
      index,
      shows: `${x} (${head})`,
      mustSee: [x],
      named: false,
      aspect: panelAspect,
      sameSubject: same,
    }));
  };
  const placeSplit = async (
    slot: Slot,
    index: number,
    ask: WriterPhotoAsk,
    maker: PictureMaker,
    subjects: string[],
    asks: SetAsk[],
  ): Promise<void> => {
    // An early re-ask runs on the job's signal (Slot.own), not the round's.
    const sdeps = () => (slot.own ? opts.deps : roundDeps());
    const k = id(index, ask.key);
    const bytes = new Map<string, Uint8Array>();
    /**
     * The panels are only parts of the joined picture: none is shown on its own, so every stored
     * panel is deleted, whether the join goes ahead, a panel failed or the set stopped.
     */
    const cleanup = async () => {
      const saved = [...bytes.keys()];
      bytes.clear();
      await Promise.all(
        saved.map((src) =>
          (maker.remove?.(src) ?? Promise.resolve()).catch(whenNonFatal(() => undefined)),
        ),
      );
    };
    const run = async (): Promise<void> => {
      sdeps().logger.info(
        { stage: "generate", picture: k, panels: asks.length },
        "picture split at ask",
      );
      const made = await makePictureSet(
        asks,
        {
          generator: maker.generator,
          save: async (png) => {
            const saved = await maker.save(png);
            bytes.set(saved.src, png);
            return saved;
          },
          ...directedSetJudges(opts.lesson, sdeps()),
          ...(maker.grid !== undefined ? { grid: maker.grid } : {}),
          ...(maker.allow ? { allow: maker.allow } : {}),
          ...(maker.spent ? { spent: maker.spent } : {}),
          signal: AbortSignal.any([sdeps().signal, slot.stop.signal]),
          log: (event) => sdeps().logger.info({ stage: "generate", ...event }, "picture set"),
        },
        setLook,
      );
      const pngs = made.map((m) => (m ? bytes.get(m.src) : undefined));
      await cleanup();
      const first = made[0];
      const whole = first && pngs.every((p): p is Uint8Array => p !== undefined);
      opts.onOutcome?.(ask.key, {
        director: "set",
        via: whole ? "generated" : "none",
        ...(whole ? {} : { reason: "generation-refused-or-failed" as const }),
      });
      if (slot.state.status !== "pending") return;
      if (!whole) {
        slot.state = { status: "failed" };
        slot.miss = "generation-refused-or-failed";
        return;
      }
      const joined = joinPanels(pngs as Uint8Array[]);
      const saved = await maker.save(joined.png);
      if (slot.state.status !== "pending") return;
      const dims = pngSize(joined.png);
      sources.set(saved.src, { ...first.source, id: saved.id });
      slot.state = photoState(
        {
          src: saved.src,
          alt: ask.shows,
          boxes: subjects.map((item, i) => ({
            item,
            left: joined.boxes[i]?.left ?? 0,
            right: joined.boxes[i]?.right ?? 1,
            top: 0,
            bottom: 1,
          })),
        },
        dims ? dims.width / dims.height : (ask.aspect ?? 1),
        requestOf(ask),
      );
    };
    return run().then(undefined, async (error: unknown) => {
      await cleanup().then(undefined, () => undefined);
      onError(slot)(error);
    });
  };

  return {
    start(index, ask, slide) {
      const k = id(index, ask.key);
      const prev = slots.get(k);
      // A later round (lostPic's split after settle) may ask a failed key again, once per round.
      // An early retry (the stage's lost picture, before editable) may ask a single failed key
      // again once its own placement is over, also once per round.
      if (
        prev &&
        !((settled || over.has(prev)) && prev.state.status === "failed" && !reasked.has(k))
      )
        return;
      const early = !!prev && !settled;
      if (prev) {
        reasked.add(k);
        heldPhotos.delete(k);
      }
      // An ask with nothing to search for is a miss, never a throw that fails the lesson.
      if (!showsOf(ask).trim()) {
        slots.set(k, {
          state: { status: "failed" },
          miss: "malformed-ask",
          done: Promise.resolve(),
          stop: new AbortController(),
        });
        opts.deps.logger.info(
          { stage: "generate", picture: k, miss: "malformed-ask" },
          "writer picture ask has no shows: miss",
        );
        return;
      }
      const slot: Slot = {
        state: { status: "pending" },
        done: Promise.resolve(),
        stop: new AbortController(),
        ...(early ? { own: true } : {}),
        ...((refused.get(index) ?? 0) >= SLIDE_REFUSALS_MAX ? { noPaint: true } : {}),
      };
      if (ask.set) {
        if (!opts.maker) {
          slots.set(k, {
            state: { status: "failed" },
            miss: "set-not-searched",
            done: Promise.resolve(),
            stop: new AbortController(),
          });
          return;
        }
        // The stage hands a slide's asks over in one loop: the set is placed once they are all in.
        const setId = id(index, ask.set);
        const group = sets.get(setId);
        if (group) {
          group.asks.push(ask);
          const first = slots.get(id(index, group.asks[0]?.key ?? ""));
          slot.done = first?.done ?? Promise.resolve();
        } else {
          sets.set(setId, { index, slide, asks: [ask] });
          slot.done = new Promise<void>((finish) => queueMicrotask(() => placeSet(setId, finish)));
        }
        slots.set(k, slot);
        return;
      }
      const subjects = opts.maker ? splitSubjects(ask) : undefined;
      const parts = subjects && splitAsks(index, ask, subjects);
      // Ruling 163, as for a set: never generated in a history lesson or for a historical subject
      // (the whole request and each panel are checked); those keep the director's ladder.
      if (
        opts.maker &&
        subjects &&
        parts &&
        !isHistoricalSet([ask.shows]) &&
        setIsGenerated(parts, opts.lesson)
      ) {
        slot.done = placeSplit(slot, index, ask, opts.maker, subjects, parts);
        slots.set(k, slot);
        return;
      }
      // An ask the director sent to the drawer, asked again (the drawer could not draw it): the
      // picture route this time, so it ends with a picture or a real miss, never none.
      slot.done = place(
        slot,
        index,
        ask,
        slide,
        undefined,
        prev?.miss === "director-code" ? false : undefined,
      );
      slots.set(k, slot);
      // Its own placement is over: a failed single ask may be asked again before the round ends.
      void slot.done.then(
        () => over.add(slot),
        () => over.add(slot),
      );
    },
    state(index, key) {
      const slot = slots.get(id(index, key));
      // An ask never started is not searched: after settle it is failed, never a placeholder.
      if (!slot) return settled ? { status: "failed" } : { status: "pending" };
      return slot.state;
    },
    async settle(deadlineMs = WRITER_PICTURE_DEADLINE_MS) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let onAbort: (() => void) | undefined;
      const deadline = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, deadlineMs);
        // A cancel ends the wait at once.
        onAbort = () => resolve();
        opts.deps.signal.addEventListener("abort", onAbort, { once: true });
      });
      // An early re-ask (Slot.own) is not the round's: editable never waits for it.
      const round = [...slots.values()].filter((s) => !s.own);
      await Promise.race([Promise.all(round.map((s) => s.done)), deadline]);
      if (timer) clearTimeout(timer);
      if (onAbort) opts.deps.signal.removeEventListener("abort", onAbort);
      await graceForMade(round);
      // Placements still running stop spending (the deadline or the cancel).
      stopper.abort();
      // A later round (lostPic) starts on a fresh stopper and batcher.
      stopper = new AbortController();
      deps = { ...opts.deps, signal: AbortSignal.any([opts.deps.signal, stopper.signal]) };
      direct = makeDirect();
      if (opts.deps.signal.aborted)
        throw Object.assign(new Error("The lesson was stopped while its pictures were placed."), {
          name: "AbortError",
          cause: opts.deps.signal.reason,
        });
      if (fatal !== undefined) throw fatal;
      settled = true;
      reasked.clear();
      for (const slot of slots.values())
        if (slot.state.status === "pending" && !slot.own) {
          slot.state = { status: "failed" };
          slot.miss = "deadline";
        }
    },
    async whenSlideDone(index, deadlineMs = WRITER_PICTURE_DEADLINE_MS) {
      const prefix = `${index}:`;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let ended = false;
      const deadline = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, deadlineMs);
        if (opts.deps.signal.aborted) resolve();
        else opts.deps.signal.addEventListener("abort", () => resolve(), { once: true });
      }).then(() => {
        ended = true;
      });
      for (;;) {
        const mine = [...slots].filter(([k]) => k.startsWith(prefix)).map(([, s]) => s.done);
        await Promise.race([Promise.all(mine), deadline]);
        const now = [...slots].filter(([k]) => k.startsWith(prefix)).map(([, s]) => s.done);
        if (ended || now.every((d) => mine.includes(d))) break;
      }
      if (timer) clearTimeout(timer);
    },
    async settleSlide(index, deadlineMs = WRITER_PICTURE_DEADLINE_MS) {
      const prefix = `${index}:`;
      const mine = () => [...slots].filter(([k]) => k.startsWith(prefix));
      let timer: ReturnType<typeof setTimeout> | undefined;
      let onAbort: (() => void) | undefined;
      const deadline = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, deadlineMs);
        onAbort = () => resolve();
        opts.deps.signal.addEventListener("abort", onAbort, { once: true });
      });
      await Promise.race([Promise.all(mine().map(([, s]) => s.done)), deadline]);
      if (timer) clearTimeout(timer);
      if (onAbort) opts.deps.signal.removeEventListener("abort", onAbort);
      await graceForMade(mine().map(([, s]) => s));
      if (opts.deps.signal.aborted)
        throw Object.assign(new Error("The lesson was stopped while its pictures were placed."), {
          name: "AbortError",
          cause: opts.deps.signal.reason,
        });
      if (fatal !== undefined) throw fatal;
      for (const [k, slot] of mine()) {
        // This slide's round is over: its keys may be asked once more in a later round.
        reasked.delete(k);
        if (slot.state.status !== "pending") continue;
        slot.stop.abort();
        slot.state = { status: "failed" };
        slot.miss = "deadline";
      }
    },
    vetoed(index, key) {
      const slot = slots.get(id(index, key));
      // match6 is not a veto: the reroute is not told (as the evidence ran).
      return slot?.miss && slot.miss !== "match6" ? MISS_LINE[slot.miss] : undefined;
    },
    drawAs(index, key) {
      const slot = slots.get(id(index, key));
      return slot?.miss === "director-code" ? slot.draw : undefined;
    },
    canReask(index, key) {
      const k = id(index, key);
      const prev = slots.get(k);
      return (
        !prev || ((settled || over.has(prev)) && prev.state.status === "failed" && !reasked.has(k))
      );
    },
    retryable(index, key) {
      const miss = slots.get(id(index, key))?.miss;
      return miss === "deadline" || miss === "error";
    },
    held: (index, key) => heldPhotos.get(id(index, key)),
    sources: () => sources,
    forget(index) {
      const prefix = `${index}:`;
      for (const [k, slot] of slots) {
        if (!k.startsWith(prefix)) continue;
        // Its photo is no longer on any slide: uncredited, and a late answer is ignored.
        if (slot.state.status === "photo") sources.delete(slot.state.photo.src);
        slot.state = { status: "failed" };
        slot.miss = undefined;
        slot.stop.abort();
        slots.delete(k);
        heldPhotos.delete(k);
        reasked.delete(k);
      }
      for (const k of sets.keys()) if (k.startsWith(prefix)) sets.delete(k);
      // New words are a new ask: the slide's refusals count again from none.
      refused.delete(index);
    },
    lookForSets(look) {
      setLook = look;
    },
  };
}

type ElementWithSource = { type: string; src?: string; source?: PhotoSource; children?: unknown[] };

/**
 * Credits onto a laid-out deck (TEACH-251 part b): each image element showing a placed picture
 * gets that picture's `source`, so the editor's info dot, the report action and every export
 * credit it truly (Pexels, Commons with its licence, or generated).
 */
export function withPhotoSources<T extends { elements: unknown[] }>(
  slides: T[],
  sources: ReadonlyMap<string, PhotoSource>,
): T[] {
  const tag = (els: unknown[]): unknown[] =>
    els.map((raw) => {
      const el = raw as ElementWithSource;
      if (el.type === "group" && Array.isArray(el.children))
        return { ...el, children: tag(el.children) };
      const source = el.type === "image" && el.src ? sources.get(el.src) : undefined;
      return source && !el.source ? { ...el, source } : el;
    });
  return slides.map((s) => ({ ...s, elements: tag(s.elements) }));
}

/** The line a writer slide asks pupils to look with (its figure's `ask`, else its lead), as base4 read it. */
export function pointOf(s: Record<string, unknown>): string {
  for (const k of ["figure", "picture", "diagram"]) {
    const f = s[k] as { ask?: unknown } | null | undefined;
    if (f && typeof f.ask === "string" && f.ask.trim()) return f.ask;
  }
  return typeof s.lead === "string" ? s.lead : typeof s.ask === "string" ? s.ask : "";
}
