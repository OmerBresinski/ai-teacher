/**
 * The picture library's ladder (TEACH-84, ruling 158), off the writing clock. The picture
 * director (stages/picture-director.ts) builds the request; this runs it: library, then stock
 * (Commons and Pexels, judged), then generation (judged by the same photo judge), or a count drawn
 * in code. `@tj/generation` sees only the `PictureBank` interface; the worker closes it over the
 * database, storage, embedder and generator.
 */
import { createHash } from "node:crypto";
import type { CountArray } from "@tj/images";
import type { PlacedPhoto } from "./illustrate";

/** The code-level switch (default on), so the bank can be A/B tested against the stock ladder. */
export const PHOTO_BANK_DEFAULT = true;

/** On unless `flag` says otherwise, or `PHOTO_BANK=0` in the environment when `flag` is unset. */
export function photoBankOn(flag?: boolean): boolean {
  if (flag !== undefined) return flag;
  const env = process.env.PHOTO_BANK?.trim().toLowerCase();
  if (env === undefined || env === "") return PHOTO_BANK_DEFAULT;
  return !(env === "0" || env === "off" || env === "false");
}

export type PictureRoute = "real" | "generic";

/** What a real thing Commons and Pexels missed falls back to. */
export type RealFallback = "none" | "illustration" | "faithful";
export type NamedKind = "event" | "person" | "work" | "place" | "object";
export type HistoryPolicy = "strict" | "illustrate" | "labelled";

/**
 * Ruling 163 as one table (HISTORY-TEST; Greg confirmed `strict`, 6 Oct). Rows: the history policy
 * for a historical subject, and `present` for a present-day one. Named people, particular objects
 * and works are Commons or nothing; nothing historical is generated in photographic style under
 * `strict`. Flip with HISTORY_POLICY (`labelled` still needs its "AI reconstruction" caption).
 */
export const REAL_FALLBACK: Record<HistoryPolicy | "present", Record<NamedKind, RealFallback>> = {
  strict: { event: "illustration", person: "none", work: "none", place: "none", object: "none" },
  illustrate: {
    event: "illustration",
    person: "illustration",
    work: "none",
    place: "none",
    object: "none",
  },
  labelled: { event: "faithful", person: "faithful", work: "none", place: "none", object: "none" },
  present: { event: "none", person: "none", work: "none", place: "faithful", object: "none" },
};

export function historyPolicy(env = process.env.HISTORY_POLICY): HistoryPolicy {
  const v = env?.trim().toLowerCase();
  return v === "illustrate" || v === "labelled" ? v : "strict";
}

export interface BankRequest {
  /** What the picture shows (the director's `shows`): the library key. */
  text: string;
  named: string | null;
  /** The zone's width over height; the size and the reuse family follow from it. */
  aspect?: number;
  route: PictureRoute;
  /** The image prompt (the director's; code appends the frame and text lines). */
  imagePrompt?: string;
  /** A count drawn in code instead of a picture. */
  draw?: CountArray | null;
  /** Search stock (judged against mustShow) before generating a generic picture. */
  stockFirst?: boolean;
  /** What a real miss falls back to (REAL_FALLBACK); absent: none. */
  realFallback?: RealFallback;
  /** The time and place a historical subject belongs to: the judge's context. */
  period?: string;
  /**
   * How a generation for this request looks: `illustration` is the painted one (ruling 163) or the
   * lesson's locked illustration style; absent is a photo.
   */
  style?: "illustration" | "house";
  /** The lesson's locked illustration palette (theme colours): a library row is reused only in it. */
  palette?: string;
}

/**
 * A generated or stored picture, with its bytes as a data URL so the judge can look at it, and
 * how a generated one looks (`drawn`: a count drawn in code). Stock pictures have no style.
 */
export type MadePicture = PlacedPhoto & {
  dataUrl?: string;
  style?: "photo" | "illustration" | "drawn" | "house";
  /** The palette a generated illustration was made in (`BankRequest.palette`). */
  palette?: string;
};

/**
 * One locked look per lesson: a generated library row is reused only when it looks the way this
 * request would be generated (photo or illustration, and an illustration in the same palette).
 * Stock rows and drawn counts have no look to clash with.
 */
export function lookMatches(req: BankRequest, hit: MadePicture): boolean {
  // `generic: generate`: only a picture made in the house photo look, never a stock row.
  if (req.style === "house") return hit.source.provider === "generated" && hit.style === "house";
  if (hit.source.provider !== "generated" || hit.style === "drawn") return true;
  const want = req.style ?? "photo";
  if ((hit.style ?? "photo") !== want) return false;
  return want !== "illustration" || !req.palette || hit.palette === req.palette;
}

/**
 * Ruling 163, tightened in BAKEOFF round 6 (r5 y4 s3: an AI "illustration" of the Roman landing):
 * a historical request (one with a period) never places a generated picture of any style; only a
 * code drawing (`drawn`) may. Past events and people are shown by real artefacts and artworks.
 */
export function styleAllowed(req: BankRequest, picture: MadePicture): boolean {
  if (!req.period || picture.source.provider !== "generated") return true;
  return picture.style === "drawn";
}

export interface PictureBank {
  /**
   * A stored picture for this request (same family, above the threshold), else undefined; with
   * its bytes (`dataUrl`) so the judge sees it before it is used, and its style when generated.
   */
  lookup(req: BankRequest, signal: AbortSignal): Promise<MadePicture | undefined>;
  /** Store a fetched picture once (licence-filtered by the implementation). */
  remember(req: BankRequest, photo: PlacedPhoto): Promise<void>;
  /** Generate (or draw), store and return a picture; undefined when refused. */
  generate(
    req: BankRequest,
    faithful: boolean,
    signal: AbortSignal,
  ): Promise<MadePicture | undefined>;
  /** Take a picture the judge refused (fresh or from the library) out of the library for good. */
  reject?(photo: PlacedPhoto): Promise<void>;
}

/**
 * The judge's verdicts on library reuse, by (stored picture, request): a pair already judged is
 * not judged again (BAKEOFF round 3 COST.md). Only real verdicts are kept, never a failed call.
 */
export interface VerdictCache {
  get(key: string): boolean | undefined;
  set(key: string, verdict: boolean): void;
}

/** An in-process cache holding the newest `max` verdicts. */
export function createVerdictCache(max = 2000): VerdictCache {
  const m = new Map<string, boolean>();
  return {
    get: (k) => m.get(k),
    set: (k, v) => {
      m.delete(k);
      m.set(k, v);
      if (m.size > max) m.delete(m.keys().next().value as string);
    },
  };
}

/** The worker's shared cache: library rows are reused across lessons in one process. */
export const sharedVerdictCache = createVerdictCache();

/** The cache key: the stored picture and a hash of what the request asks it to show. */
export function verdictKey(req: BankRequest, picture: PlacedPhoto): string {
  const ask = JSON.stringify([req.text, req.named, req.period ?? "", req.style ?? "", req.route]);
  return `${picture.src}#${createHash("sha256").update(ask).digest("hex").slice(0, 16)}`;
}

export type BankVia = "library" | "fetched" | "generated" | "generated-faithful" | "none";

export interface BankOutcome {
  photo: PlacedPhoto | undefined;
  via: BankVia;
  route: PictureRoute;
  ms: number;
}

/**
 * The ladder for one request: library, then stock (real things, and generic ones stock can show),
 * then generation. A generated picture is shown to the same photo judge (mustShow, stated
 * relations, count, period); a refusal regenerates once, then nothing. A library or generator
 * failure never throws: it is a miss.
 */
export async function findPicture(
  req: BankRequest,
  bank: PictureBank,
  fetchStock: () => Promise<PlacedPhoto | undefined>,
  signal: AbortSignal,
  judgeMade?: (picture: MadePicture, reuse?: boolean) => Promise<boolean>,
  now: () => number = Date.now,
  verdicts?: VerdictCache,
): Promise<BankOutcome> {
  const t0 = now();
  const done = (photo: PlacedPhoto | undefined, via: BankVia): BankOutcome => ({
    photo,
    via: photo ? via : "none",
    route: req.route,
    ms: now() - t0,
  });
  const make = async (faithful: boolean) => {
    // Ruling 163 (round 6): nothing is generated for a past event or person.
    if (req.period && !req.draw) return undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      const made = await bank.generate(req, faithful, signal).catch(rethrowAbort);
      if (made && !styleAllowed(req, made)) {
        // A photo-style picture for a historical request: the wrong kind, so no retry either.
        await bank.reject?.(made).catch(rethrowAbort);
        return undefined;
      }
      if (!made || req.draw || !judgeMade || !made.dataUrl) return made;
      if (await judgeMade(made).catch(rethrowAbort)) return made;
      await bank.reject?.(made).catch(rethrowAbort);
    }
    return undefined;
  };
  // A library hit is judged against this request's mustShow exactly like a fresh picture; one the
  // judge refuses is marked and never reused (SOL-SIMPLE: rows from the old counting prompt).
  const usable = async (hit: MadePicture): Promise<boolean> => {
    if (!styleAllowed(req, hit) || !lookMatches(req, hit)) return false;
    if (req.draw || hit.style === "drawn" || !judgeMade) return true;
    if (!hit.dataUrl) return false;
    const key = verdictKey(req, hit);
    const known = verdicts?.get(key);
    if (known !== undefined) return known;
    const verdict = await judgeMade(hit, true).catch(rethrowAbort);
    if (verdict === true || verdict === false) verdicts?.set(key, verdict);
    if (verdict) return true;
    // A judge that failed says nothing about the row: skip it, but only a refusal marks it.
    if (verdict === false) await bank.reject?.(hit).catch(rethrowAbort);
    return false;
  };
  let libraryDown = false;
  const hit = await bank.lookup(req, signal).catch((error) => {
    rethrowAbort(error);
    libraryDown = true;
    return undefined;
  });
  if (hit && (await usable(hit))) return done(hit, "library");
  // With the library unreachable nothing could be stored, so nothing is generated.
  if (libraryDown) return done(await fetchStock().catch(rethrowAbort), "fetched");
  if (req.draw) return done(await make(false), "generated");
  if (req.route === "real" || req.stockFirst) {
    const fetched = await fetchStock().catch(rethrowAbort);
    if (fetched) {
      await bank.remember(req, fetched).catch(rethrowAbort);
      return done(fetched, "fetched");
    }
  }
  if (req.route === "real") {
    const fallback = req.realFallback ?? "none";
    if (fallback === "none") return done(undefined, "none");
    return done(
      await make(fallback === "faithful"),
      fallback === "faithful" ? "generated-faithful" : "generated",
    );
  }
  return done(await make(false), "generated");
}

function rethrowAbort(error: unknown): undefined {
  if (error instanceof Error && error.name === "AbortError") throw error;
  return undefined;
}

/** Words that join the things a picture request names ("a hen beside a chick"). */
const JOINERS = /\s+(?:beside|next to|alongside|and|with|showing|holding|plus)\s+/i;
/** Where a named thing's description stops: a pose, a place, a time or a purpose. */
const TAIL =
  /\s+(?:arranged|reacting|sitting|standing|playing|lying|grazing|walking|running|nursing|keeping|taking|being|both|on|in|at|during|from|under|over|against|for|to|that|which|where|whose|clearly|side)\b.*$/i;
const ARTICLE = /^(?:an?|the|some|two|three|its|their|his|her)\s+/i;
/** Collage and layout words name no thing to see. */
const NOT_A_THING =
  /^(?:(?:a\s+)?(?:two|three|four)-panel|photographic collage|collage|photo|photograph|picture|image)$/i;

/**
 * The things a picture request names, which the picture must visibly contain (PICTURE-AUDIT #1;
 * the T3 writer's picture field has no `mustShow`, so code reads it off the request): the first
 * clause, split at "beside", "and", "with" and the like, each part cut at its pose or place, at
 * most three items of at most 40 characters (the judge's `visible` limit).
 */
export function mustShowOf(request: string): string[] {
  let text = request.replace(/\s+/g, " ").trim();
  const colon = text.indexOf(":");
  if (colon >= 0 && colon < 60) text = text.slice(colon + 1);
  const clause = text.split(/[,;.()]|\s[-–]\s/)[0] ?? "";
  const items: string[] = [];
  for (const raw of clause.split(JOINERS)) {
    let item = raw.trim().replace(ARTICLE, "").replace(TAIL, "").trim();
    item = item.replace(/^(?:a|an|the)\s+/i, "");
    if (item.length > 40) item = item.slice(0, 40).replace(/\s+\S*$/, "");
    if (item.length < 3 || NOT_A_THING.test(item)) continue;
    if (!items.some((x) => x.toLowerCase() === item.toLowerCase())) items.push(item);
    if (items.length === 3) break;
  }
  return items;
}
