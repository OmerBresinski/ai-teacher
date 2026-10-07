/**
 * The picture director (PHOTO-BANK round 3; prompt in prompts/picture-director.ts): one `small`
 * call per picture slot, off the writing clock, decides the route, the searches, mustShow, the
 * image prompt, a count and a period. Code checks the answer and runs the library ladder. A slot
 * whose call fails (after callStructured's one retry) or whose answer is unusable gets no picture.
 */

import type { ImageBrief } from "@tj/domain/documents";
import { anchorQueries, type CountArray } from "@tj/images";
import { z } from "zod";
import { type CallStructuredOptions, callStructured } from "../call";
import {
  PICTURE_DIRECTOR_VERSION,
  type PictureDirection,
  type PictureDirectorInput,
  PictureDirectorSchema,
  pictureDirectorPrompt,
} from "../prompts/picture-director";
import type { PlacedPhoto } from "./illustrate";
import {
  type BankRequest,
  findPicture,
  historyPolicy,
  type MadePicture,
  type PictureBank,
  REAL_FALLBACK,
  sharedVerdictCache,
} from "./photo-bank";

export type DirectorDeps = CallStructuredOptions<PictureDirectorInput, PictureDirection>["deps"];

/** The director's answer, or undefined when the call fails (an abort still throws). */
export async function directPicture(
  input: PictureDirectorInput,
  deps: DirectorDeps,
): Promise<PictureDirection | undefined> {
  const built = pictureDirectorPrompt(input);
  try {
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
  } catch (error) {
    if ((error instanceof Error && error.name === "AbortError") || deps.signal.aborted) throw error;
    return undefined;
  }
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
  const head = [
    `Lesson: ${first.yearGroup} ${first.subject}, "${first.title}", taught in ${first.country}.`,
    `Picture style for this lesson: ${first.style ?? "photo"}`,
  ];
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
 * Every slot's direction in one call (BAKEOFF round 3 COST.md), with the batched system prompt the
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
  try {
    const call = await callStructured({
      deps,
      stage: "illustrate",
      cls: "small",
      effort: "low",
      prompt: { version: `${PICTURE_DIRECTOR_VERSION}-batch`, system, user: () => user },
      input: slots,
      schema: PictureDirectorBatchSchema,
      maxOutputTokens: 3000 * Math.min(slots.length, 6),
    });
    for (const { id, ...direction } of call.output.slots) out.set(id, direction);
  } catch (error) {
    if ((error instanceof Error && error.name === "AbortError") || deps.signal.aborted) throw error;
  }
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
  const flush = () => {
    const batch = queue;
    queue = [];
    const answers = directPictures(batch, deps, system);
    for (const slot of batch)
      slot.done(answers.then((m) => m.get(slot.id) ?? directPicture(slot.input, deps)));
  };
  return (input) =>
    new Promise((resolve) => {
      if (queue.length === 0) setTimeout(flush, windowMs);
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

/** A historical subject Commons missed (ruling 163): an obvious painted illustration in its period. */
export function illustrationPrompt(prompt: string, period: string): string {
  return [
    "A hand-painted educational illustration, clearly a painting and not a photograph.",
    prompt,
    `Everything in it belongs to ${period}.`,
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

/** The default style line until the prompt agent's file lands: the ruling 163 painted look. */
export const ILLUSTRATION_LINE =
  "A hand-painted educational illustration, clearly a painting and not a photograph.";

/** The house photo look (code's default until the prompt agent's file lands). */
export const HOUSE_PHOTO_LINE =
  "A natural-light photograph taken at eye level: the subject sharp and filling the frame, in a simple, slightly soft setting that suits it; a plain background only when the subject is a small object. Uncluttered.";

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
}

/** The slot's plan from the director's answer; none when there is no usable answer. */
export function planPicture(d: PictureDirection | undefined, ask: Ask): PicturePlan {
  if (!d || d.route === "none") return { kind: "none" };
  const base = { named: ask.named, ...(ask.aspect !== undefined ? { aspect: ask.aspect } : {}) };
  const counted = countOk(d.count) ? d.count : undefined;
  // FIX1: a photo framed as a count only when there is something to count. A pair (an adult and
  // its young) is a picture of what it shows; framed as "exactly two animals" it lost the cow.
  const countedPhoto = counted && counted.total >= COUNT_PHOTO_MIN ? counted : undefined;
  if (d.route === "code") {
    // Only a plain array is drawn; a diagram kind the bank cannot draw leaves the text layout.
    if (!counted || counted.empty > 0) return { kind: "none" };
    const { total, groups, perGroup, arrangement } = counted;
    const draw: CountArray = { total, groups, perGroup, arrangement };
    return { kind: "draw", request: { ...base, text: ask.text, route: "generic", draw } };
  }
  const period = d.period?.trim() || undefined;
  // Ruling 163 (SOL-SIMPLE): a period makes the subject historical on any route, so it takes the
  // real ladder (Commons first) and the history table's fallback, never a stock-photo generation.
  // BAKEOFF round 7: a period makes a picture historical only when it depicts a past event or
  // person (r6 y4: wheat and ore with a period were refused generation and the deck had no
  // pictures). A generic thing (a wheat field, a lump of ore) stays generic, period or not.
  const depicts =
    !!period &&
    (d.named === "event" ||
      d.named === "person" ||
      (!d.named && DEPICTS.test(`${ask.text} ${d.pictures[0]?.shows ?? ""}`)));
  const real = d.route === "commons" || depicts;
  // The request's year-plus-event anchor leads a Commons search ("hyperinflation 1923" ranks the
  // real 1923 Weimar photo first; the director's own wording did not).
  const dated = real ? anchorQueries(ask.text).filter((q) => /\d{4}/.test(q)) : [];
  const pictures: DirectedPicture[] = d.pictures
    .map((p) => ({
      shows: clip(p.shows, 400),
      mustShow: uniq(p.mustShow.map((m) => clip(m, 40))).slice(0, 3),
      queries: uniq([...dated, ...p.queries.map((q) => clip(q, 80))]).slice(0, 4),
      imagePrompt: p.imagePrompt.replace(/\s+/g, " ").trim(),
    }))
    .filter((p) => p.shows && p.imagePrompt);
  const first = pictures[0];
  if (!first) return { kind: "none" };
  // A historical scene with no named kind is read as an event (an illustration under `strict`).
  const kind = d.named ?? (depicts ? "event" : "object");
  const fallback = real ? REAL_FALLBACK[period ? historyPolicy() : "present"][kind] : undefined;
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
      stockFirst: d.route === "pexels" && !countedPhoto && !looked && !housed,
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
      specific: real,
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
  lesson: { title: string; yearGroup?: string; subject?: string };
  country: string;
  index: number;
  stock: (brief: ImageBrief) => Promise<PlacedPhoto | undefined>;
  judgeMade: (brief: ImageBrief, picture: MadePicture, reuse?: boolean) => Promise<boolean>;
  deps: DirectorDeps;
  /** The lesson's picture look, the same on every call of the lesson. */
  look?: LessonLook;
  /** How the director is asked (a batcher); absent, one call for this slot. */
  direct?: (input: PictureDirectorInput) => Promise<PictureDirection | undefined>;
  /** How the slot ended: the director's route, the ladder's step, and why it is empty when it is. */
  onOutcome?: (o: PictureOutcome) => void;
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
  const plan = planPicture(direction, {
    text: ask.subject,
    named: ask.named ?? null,
    ...(b.aspect !== undefined ? { aspect: b.aspect } : {}),
    ...(args.look ? { look: args.look } : {}),
  });
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
  if (plan.kind === "none") {
    log({ plan: "none" });
    args.onOutcome?.({
      director: direction?.route ?? "failed",
      via: "none",
      reason: direction ? "director-none" : "director-failed",
    });
    return undefined;
  }
  const req = plan.request;
  const brief: ImageBrief =
    plan.kind === "photo"
      ? { ...b, ...plan.brief, specific: plan.brief.specific || b.specific === true }
      : b;
  let out = await findPicture(
    req,
    args.bank,
    () => args.stock(brief),
    deps.signal,
    (made, reuse) => args.judgeMade(brief, made, reuse),
    Date.now,
    sharedVerdictCache,
  );
  // BAKEOFF round 7, ruling 163: a past event or person that the scene search missed is shown by a
  // real artefact, coin, map, site or museum object (the round 5 Claudius bust), before nothing.
  if (!out.photo && req.depicts && plan.kind === "photo") {
    const t0 = Date.now();
    const artefact: ImageBrief = {
      ...brief,
      request: artefactRequest(req.text, req.period),
      mustShow: [],
      queries: artefactQueries(req.text, req.period),
      specific: true,
    };
    const got = await args.stock(artefact).catch(() => undefined);
    if (got) out = { photo: got, via: "fetched", route: req.route, ms: out.ms + Date.now() - t0 };
  }
  log({ via: out.via, ms: out.ms });
  const style = (out.photo as MadePicture | undefined)?.style;
  args.onOutcome?.({
    director: direction?.route ?? "failed",
    via: out.via,
    route: req.route,
    ...(req.period ? { period: req.period } : {}),
    ...(out.photo
      ? {}
      : {
          reason:
            req.route === "real" && (req.realFallback ?? "none") === "none"
              ? "real-miss-no-fallback"
              : "generation-refused-or-failed",
        }),
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
  /** Why the slot is empty: the director gave nothing, a real thing missed with no fallback, or generation was refused (cap, judge, or error). */
  reason?:
    | "director-none"
    | "director-failed"
    | "real-miss-no-fallback"
    | "generation-refused-or-failed";
}
