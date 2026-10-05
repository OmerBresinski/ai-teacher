/**
 * The picture director (PHOTO-BANK round 3; prompt in prompts/picture-director.ts): one `small`
 * call per picture slot, off the writing clock, decides the route, the searches, mustShow, the
 * image prompt, a count and a period. Code checks the answer and runs the library ladder. A slot
 * whose call fails (after callStructured's one retry) or whose answer is unusable gets no picture.
 */
import type { ImageBrief } from "@tj/domain/documents";
import { anchorQueries, type CountArray } from "@tj/images";
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

interface Ask {
  text: string;
  named: string | null;
  aspect?: number;
}

/** The slot's plan from the director's answer; none when there is no usable answer. */
export function planPicture(d: PictureDirection | undefined, ask: Ask): PicturePlan {
  if (!d || d.route === "none") return { kind: "none" };
  const base = { named: ask.named, ...(ask.aspect !== undefined ? { aspect: ask.aspect } : {}) };
  const counted = countOk(d.count) ? d.count : undefined;
  if (d.route === "code") {
    // Only a plain array is drawn; a diagram kind the bank cannot draw leaves the text layout.
    if (!counted || counted.empty > 0) return { kind: "none" };
    const { total, groups, perGroup, arrangement } = counted;
    const draw: CountArray = { total, groups, perGroup, arrangement };
    return { kind: "draw", request: { ...base, text: ask.text, route: "generic", draw } };
  }
  const real = d.route === "commons";
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
  const period = d.period?.trim() || undefined;
  const fallback = real
    ? REAL_FALLBACK[period ? historyPolicy() : "present"][d.named ?? "object"]
    : undefined;
  const mustShow = counted
    ? uniq([`exactly ${counted.total} ${counted.things.trim()}`, ...first.mustShow]).slice(0, 3)
    : first.mustShow;
  const imagePrompt =
    (counted && countImagePrompt(counted)) ||
    (fallback === "illustration" && period
      ? illustrationPrompt(first.imagePrompt, period)
      : first.imagePrompt);
  return {
    kind: "photo",
    request: {
      ...base,
      text: first.shows,
      route: real ? "real" : "generic",
      imagePrompt,
      draw: null,
      stockFirst: d.route === "pexels" && !counted,
      ...(fallback ? { realFallback: fallback } : {}),
      ...(period ? { period } : {}),
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
  judgeMade: (brief: ImageBrief, picture: MadePicture) => Promise<boolean>;
  deps: DirectorDeps;
}): Promise<PlacedPhoto | undefined> {
  const { ask, brief: b, lesson, deps } = args;
  const direction = await directPicture(
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
  const plan = planPicture(direction, {
    text: ask.subject,
    named: ask.named ?? null,
    ...(b.aspect !== undefined ? { aspect: b.aspect } : {}),
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
    return undefined;
  }
  const req = plan.request;
  const brief: ImageBrief =
    plan.kind === "photo"
      ? { ...b, ...plan.brief, specific: plan.brief.specific || b.specific === true }
      : b;
  const out = await findPicture(
    req,
    args.bank,
    () => args.stock(brief),
    deps.signal,
    (made) => args.judgeMade(brief, made),
  );
  log({ via: out.via, ms: out.ms });
  return out.photo;
}
