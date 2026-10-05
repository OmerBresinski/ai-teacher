/**
 * The picture director's call and what code makes of its answer (PHOTO-BANK round 3; prompt in
 * prompts/picture-director.ts). One `small` call per picture slot, off the writing clock. It
 * replaces the regex route (`routePicture`) and the fixed image template (`imagePrompt`) whenever it
 * answers; a failed or unusable answer falls back to both, so a picture slot never waits on it.
 */

import type { ImageBrief } from "@tj/domain/documents";
import { anchorQueries, type CountArray, countArrayOf } from "@tj/images";
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
  type PictureBank,
  realFallback,
  routePicture,
} from "./photo-bank";

export const PICTURE_DIRECTOR_EFFORT = "low" as const;
const MAX_OUTPUT_TOKENS_DIRECTOR = 3000;
/** The judge's `visible` limit and the brief's `MustShowItem` cap. */
const ITEM_CHARS = 40;
const QUERY_CHARS = 80;

export type DirectorDeps = CallStructuredOptions<PictureDirectorInput, PictureDirection>["deps"];

export interface DirectorAnswer {
  direction: PictureDirection;
  ms: number;
  modelId: string;
  usage: { inputTokens?: number; outputTokens?: number; cachedInputTokens?: number };
}

/** The director's answer, or undefined when the call fails (an abort still throws). */
export async function directPicture(
  input: PictureDirectorInput,
  deps: DirectorDeps,
  now: () => number = Date.now,
): Promise<DirectorAnswer | undefined> {
  const t0 = now();
  try {
    const built = pictureDirectorPrompt(input);
    const call = await callStructured({
      deps,
      stage: "illustrate",
      cls: "small",
      effort: PICTURE_DIRECTOR_EFFORT,
      prompt: { version: PICTURE_DIRECTOR_VERSION, system: built.system, user: () => built.user },
      input,
      schema: PictureDirectorSchema,
      maxOutputTokens: MAX_OUTPUT_TOKENS_DIRECTOR,
    });
    return {
      direction: call.output,
      ms: now() - t0,
      modelId: call.modelId,
      usage: call.usage as DirectorAnswer["usage"],
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    if (deps.signal.aborted) throw error;
    return undefined;
  }
}

export interface DirectedPicture {
  shows: string;
  mustShow: string[];
  queries: string[];
  imagePrompt: string;
}

/** What the slot does, after code has checked the director's answer. */
export type PicturePlan =
  | {
      kind: "photo";
      request: BankRequest;
      /** Brief fields for the stock search and the judge. */
      brief: { request: string; mustShow: string[]; queries: string[]; specific: boolean };
      /** Every picture the director asked for; the zone shows the first (layout is later work). */
      pictures: DirectedPicture[];
      directed: boolean;
    }
  | { kind: "draw"; request: BankRequest; directed: boolean }
  /** A drawing kind the bank cannot draw yet: the slide falls back to its text layout. */
  | { kind: "diagram"; diagram: string }
  | { kind: "none" };

const clip = (s: string, n: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= n ? t : t.slice(0, n).replace(/\s+\S*$/, "");
};
const uniq = (xs: string[]) =>
  xs.filter((x, i) => x && xs.findIndex((y) => y.toLowerCase() === x.toLowerCase()) === i);

function pictureOf(p: PictureDirection["pictures"][number]): DirectedPicture | undefined {
  const shows = p.shows.replace(/\s+/g, " ").trim();
  const imagePrompt = p.imagePrompt.replace(/\s+/g, " ").trim();
  if (!shows || !imagePrompt) return undefined;
  return {
    shows: clip(shows, 400),
    mustShow: uniq(p.mustShow.map((m) => clip(m, ITEM_CHARS))).slice(0, 3),
    queries: uniq(p.queries.map((q) => clip(q, QUERY_CHARS))).slice(0, 4),
    imagePrompt,
  };
}

/** A count code can draw or prompt: whole, consistent (spaces = total + empty), at most 120. */
function countOf(c: PictureDirection["count"]): CountArray | undefined {
  if (!c) return undefined;
  const { total, groups, perGroup, arrangement } = c;
  const empty = Math.max(0, c.empty ?? 0);
  if (!(groups >= 1 && perGroup >= 1 && total >= 2 && total <= 120)) return undefined;
  if (groups * perGroup !== total + empty) return undefined;
  if (empty > 0) return undefined; // a drawn array has no empty spaces
  return { total, groups, perGroup, arrangement };
}

const WORDS =
  "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty".split(
    " ",
  );
const inWords = (n: number) => (WORDS[n] ? `${WORDS[n]} (${n})` : String(n));

/**
 * COUNT-TEST arm B (16 of 16 exact): the count in words and digits, the layout from the slot, a
 * view from directly above on a plain surface, every object separate, nothing else. Undefined when
 * the slot is not consistent (spaces = total + empty).
 */
/** A historical subject Commons missed (ruling 163): an obvious painted illustration in its period. */
export function illustrationPrompt(prompt: string, period: string | null): string {
  return [
    "A hand-painted educational illustration, clearly a painting and not a photograph.",
    prompt.replace(/\s+/g, " ").trim(),
    ...(period?.trim() ? [`Everything in it belongs to ${period.trim()}.`] : []),
  ].join("\n");
}

export function countImagePrompt(c: NonNullable<PictureDirection["count"]>): string | undefined {
  const empty = Math.max(0, c.empty);
  const things = c.things.replace(/\s+/g, " ").trim();
  if (!things || c.total < 1 || c.total > 120 || c.groups < 1 || c.perGroup < 1) return undefined;
  if (c.groups * c.perGroup !== c.total + empty) return undefined;
  const layout =
    empty > 0
      ? `They fill ${inWords(c.total)} of ${inWords(c.groups * c.perGroup)} spaces set out in ${c.groups} ${c.arrangement === "rows" || c.groups === 1 ? "rows" : "groups"} of ${c.perGroup}; exactly ${inWords(empty)} spaces are empty and clearly visible.`
      : c.groups === 1
        ? c.total <= 10
          ? `They are in one straight row.`
          : `They are in one neat grid.`
        : c.arrangement === "rows"
          ? `They are in ${inWords(c.groups)} rows of ${inWords(c.perGroup)}, the rows evenly spaced.`
          : `They are in ${inWords(c.groups)} separate groups of ${inWords(c.perGroup)}, with wide gaps between the groups, each group a neat block.`;
  return [
    `One realistic photograph, seen from directly above: exactly ${inWords(c.total)} ${things}, on a plain surface.`,
    layout,
    "Every object is whole and clearly separate, with a visible gap around it: none overlap, touch, stack or are cut off by the edge of the frame.",
    "Nothing else is in the picture.",
  ].join("\n");
}

interface Ask {
  text: string;
  named: string | null;
  aspect?: number;
  context?: BankRequest["context"];
}

/** The pre-director behaviour: the regex route, the fixed template, counts read off the text. */
function fallbackPlan(ask: Ask): PicturePlan {
  const base = {
    text: ask.text,
    named: ask.named,
    ...(ask.aspect !== undefined ? { aspect: ask.aspect } : {}),
    ...(ask.context ? { context: ask.context } : {}),
  };
  const drawn = countArrayOf(ask.text);
  if (drawn)
    return { kind: "draw", request: { ...base, route: "generic", draw: drawn }, directed: false };
  const route = routePicture({ text: ask.text, named: ask.named });
  return {
    kind: "photo",
    request: { ...base, route, draw: null, stockFirst: true },
    brief: { request: ask.text, mustShow: [], queries: [], specific: route === "real" },
    pictures: [],
    directed: false,
  };
}

/**
 * The slot's plan from the director's answer; the fallback when there is none, or when it is not
 * usable (a photo route with no picture, a code route with nothing code can draw or name).
 */
export function planPicture(direction: PictureDirection | undefined, ask: Ask): PicturePlan {
  if (!direction) return fallbackPlan(ask);
  const base = {
    named: ask.named,
    ...(ask.aspect !== undefined ? { aspect: ask.aspect } : {}),
    ...(ask.context ? { context: ask.context } : {}),
  };
  switch (direction.route) {
    case "none":
      return { kind: "none" };
    case "code": {
      const drawn = countOf(direction.count);
      if (drawn)
        return {
          kind: "draw",
          request: { ...base, text: ask.text, route: "generic", draw: drawn },
          directed: true,
        };
      if (direction.diagram) return { kind: "diagram", diagram: direction.diagram };
      return fallbackPlan(ask);
    }
    default: {
      // Round 2's anchors from the writer's request are always searched. A year-plus-event anchor
      // ("hyperinflation 1923") leads on a real route: Commons ranks the real photo third for it,
      // while the director's "1923 German hyperinflation" fills the shortlist with banknote scans
      // (round 3, Weimar). Two-name anchors follow the director's searches.
      const anchors = anchorQueries(ask.text);
      const dated = direction.route === "commons" ? anchors.filter((q) => /\d{4}/.test(q)) : [];
      const pictures = direction.pictures
        .map(pictureOf)
        .filter((p) => p !== undefined)
        .map((p) => ({ ...p, queries: uniq([...dated, ...p.queries, ...anchors]) }));
      // A countable real thing: code writes arm B's prompt from the slot and the judge checks the count.
      const counted = direction.count ? countImagePrompt(direction.count) : undefined;
      const first = pictures[0]
        ? counted && direction.count
          ? {
              ...pictures[0],
              imagePrompt: counted,
              mustShow: uniq([
                `exactly ${direction.count.total} ${direction.count.things}`,
                ...pictures[0].mustShow,
              ]).slice(0, 3),
            }
          : pictures[0]
        : undefined;
      if (!first) return fallbackPlan(ask);
      const real = direction.route === "commons";
      return {
        kind: "photo",
        request: {
          ...base,
          text: first.shows,
          route: real ? "real" : "generic",
          imagePrompt: first.imagePrompt,
          draw: null,
          stockFirst: direction.route !== "library-or-generate" && !counted,
          ...(real
            ? {
                realFallback: realFallback(
                  direction.named,
                  !!direction.period?.trim(),
                  historyPolicy(),
                ),
              }
            : {}),
          ...(real && direction.period?.trim() ? { period: direction.period.trim() } : {}),
          // A historical event's (or, by policy, person's) fallback is an obvious illustration.
          ...(real &&
          direction.period?.trim() &&
          realFallback(direction.named, true, historyPolicy()) === "illustration"
            ? { imagePrompt: illustrationPrompt(first.imagePrompt, direction.period) }
            : {}),
        },
        brief: {
          request: first.shows,
          mustShow: first.mustShow,
          queries: first.queries,
          specific: real,
        },
        pictures,
        directed: true,
      };
    }
  }
}

/** The slide a picture is for, as the director reads it. */
export interface SlideForPicture {
  heading: string;
  text?: string;
  point?: string;
}

/**
 * One picture slot through the director and the library ladder (both T3 builders call this). The
 * director runs first; its plan picks the route, the searches, the judge's mustShow and the image
 * prompt. `none` and an undrawable diagram leave the zone empty (the slide keeps its text layout).
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
  deps: DirectorDeps;
}): Promise<PlacedPhoto | undefined> {
  const { ask, brief: b, lesson, deps } = args;
  const named = ask.named ?? null;
  const answer = await directPicture(
    {
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
    },
    deps,
  );
  const plan = planPicture(answer?.direction, {
    text: ask.subject,
    named,
    ...(b.aspect !== undefined ? { aspect: b.aspect } : {}),
    context: { title: lesson.title, yearGroup: lesson.yearGroup, subject: lesson.subject },
  });
  const director = answer
    ? { route: answer.direction.route, ms: answer.ms, pictures: answer.direction.pictures.length }
    : { failed: true };
  if (plan.kind === "none" || plan.kind === "diagram") {
    deps.logger.info(
      { stage: "illustrate", slideIndex: args.index, director, plan: plan.kind },
      "picture director",
    );
    return undefined;
  }
  const req = plan.request;
  const brief: ImageBrief =
    plan.kind === "photo"
      ? {
          ...b,
          request: plan.brief.request,
          ...(plan.brief.mustShow.length ? { mustShow: plan.brief.mustShow } : {}),
          ...(plan.brief.queries.length ? { queries: plan.brief.queries } : {}),
          ...(req.period ? { period: req.period } : {}),
          specific: plan.brief.specific || b.specific === true,
        }
      : b;
  const out = await findPicture(
    req,
    args.bank,
    () => args.stock(req.route === "real" ? { ...brief, specific: true } : brief),
    deps.signal,
  );
  deps.logger.info(
    {
      stage: "illustrate",
      slideIndex: args.index,
      director,
      bank: { route: out.route, via: out.via, ms: out.ms, lookCheck: out.lookCheck },
    },
    "picture library",
  );
  return out.photo;
}
