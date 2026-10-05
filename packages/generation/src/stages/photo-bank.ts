/**
 * The picture library's ladder (TEACH-84, UX ruling 158), off the writing clock like every photo:
 *
 * 1. Every request asks the library first: a stored picture of the same request (cosine over the
 *    request embeddings at or above the calibrated threshold, same aspect family) is reused.
 * 2. A real or specific thing (a named place, person, artefact, document or event) is searched on
 *    Wikimedia Commons and Pexels (the existing pick, credited); what it places is stored once.
 * 3. A real thing no library had is generated with the "faithful" prompt and flagged for the look
 *    check (ruling 158 item 1).
 * 4. A generic scene searches stock first when the director (or the fallback) says stock can show
 *    it, then is generated at the zone's aspect ratio; a count is drawn in code.
 *
 * `@tj/generation` sees only the `PictureBank` interface; the worker (or the lab) closes it over
 * the database, storage, embedder and generator.
 */
import type { CountArray } from "@tj/images";
import { isSpecificSubject, type PlacedPhoto } from "./illustrate";

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

/**
 * What a real thing Commons and Pexels missed falls back to (ruling 163, HISTORY-TEST): named
 * people, particular objects and works are Commons or nothing; a historical event is drawn as an
 * obvious illustration and period-checked; a present-day place may still be generated faithfully.
 * Nothing historical is ever generated in photographic style.
 */
export type RealFallback = "none" | "illustration" | "faithful";

/**
 * History policy (ruling 163; Greg confirmed `strict` on 6 Oct). `strict`: people, objects and
 * works are Commons or none, an event is illustrated. `illustrate`: people may be illustrated too.
 * `labelled`: any AI style, every AI image on a historical subject captioned "AI reconstruction".
 * The wrong-period check runs in every mode. Flip with HISTORY_POLICY; the code default is strict.
 */
export type HistoryPolicy = "strict" | "illustrate" | "labelled";
export const HISTORY_POLICY_DEFAULT: HistoryPolicy = "strict";
export function historyPolicy(env = process.env.HISTORY_POLICY): HistoryPolicy {
  const v = env?.trim().toLowerCase();
  return v === "illustrate" || v === "labelled" ? v : HISTORY_POLICY_DEFAULT;
}

export function realFallback(
  named: "event" | "person" | "work" | "place" | "object" | null,
  historical: boolean,
  policy: HistoryPolicy = HISTORY_POLICY_DEFAULT,
): RealFallback {
  if (!historical) return named === "place" ? "faithful" : "none";
  if (policy === "labelled") return named === "event" || named === "person" ? "faithful" : "none";
  if (named === "event") return "illustration";
  if (named === "person" && policy === "illustrate") return "illustration";
  return "none";
}

/** A year (1066, 1923), a century or an era marks a historical, so real, subject. */
const HISTORICAL =
  /\b(1[0-9]{3}|20[0-2][0-9])s?\b|\b\d{1,2}(st|nd|rd|th) century\b|\b(BC|BCE|AD)\b/;

/**
 * Real or specific (ruling 158 item 1): the writer named it, or the subject reads as a proper
 * name (`isSpecificSubject`, ruling 139's Commons test), or it dates itself. Everything else is a
 * generic scene.
 */
export function routePicture(req: { text: string; named?: string | null }): PictureRoute {
  if (req.named?.trim()) return "real";
  // The first sentence only: a later sentence's capital ("Both are…") is not a proper name.
  const first = req.text.split(/(?<=[.!?])\s+/)[0] ?? req.text;
  if (isSpecificSubject(first)) return "real";
  if (HISTORICAL.test(req.text)) return "real";
  return "generic";
}

export interface BankRequest {
  /** The writer's full picture request (never clipped). */
  text: string;
  named: string | null;
  /** The zone's width over height; the size and the reuse family follow from it. */
  aspect?: number;
  route: PictureRoute;
  /** The lesson's title, year and subject: the period and place a real subject is set in. */
  context?: { title?: string; yearGroup?: string; subject?: string };
  /**
   * The picture director's image prompt (code appends the frame and text lines). Absent: the
   * fixed template (`imagePrompt` in @tj/images).
   */
  imagePrompt?: string;
  /** A count drawn in code. null: never draw (a photo was chosen). Absent: read off the text. */
  draw?: CountArray | null;
  /**
   * A generic picture searches stock (Pexels, judged against mustShow) before it is generated
   * (Greg, 6 Oct: real stock looks real and is free). false: the director judged that no real
   * photo is likely to show it, so the search is skipped.
   */
  stockFirst?: boolean;
  /** What a real miss falls back to (ruling 163). Absent: faithful (the pre-director behaviour). */
  realFallback?: RealFallback;
  /** The time and place a historical subject belongs to: the illustration and its period check. */
  period?: string;
}

export interface PictureBank {
  /** A stored picture for this request (same family, above the threshold), else undefined. */
  lookup(req: BankRequest, signal: AbortSignal): Promise<PlacedPhoto | undefined>;
  /** Store a fetched picture once (licence-filtered by the implementation). */
  remember(req: BankRequest, photo: PlacedPhoto): Promise<void>;
  /** Generate, store and return a picture; undefined when the generator or budget refuses. */
  generate(
    req: BankRequest,
    faithful: boolean,
    signal: AbortSignal,
  ): Promise<PlacedPhoto | undefined>;
  /**
   * The wrong-period check on a generated illustration (ruling 163): the vision judge is given the
   * period and place as text and says whether anything visible is out of period. true: keep.
   * Absent: no illustration is placed.
   */
  checkPeriod?(req: BankRequest, picture: PlacedPhoto, signal: AbortSignal): Promise<boolean>;
}

export type BankVia = "library" | "fetched" | "generated" | "generated-faithful" | "none";

export interface BankOutcome {
  photo: PlacedPhoto | undefined;
  via: BankVia;
  route: PictureRoute;
  /** A generated stand-in for a real thing: the look check must confirm it (ruling 158). */
  lookCheck: boolean;
  ms: number;
}

/** The ladder for one request. A library or generator failure never throws: it is a miss. */
export async function findPicture(
  req: BankRequest,
  bank: PictureBank,
  fetchReal: () => Promise<PlacedPhoto | undefined>,
  signal: AbortSignal,
  now: () => number = Date.now,
): Promise<BankOutcome> {
  const t0 = now();
  const done = (photo: PlacedPhoto | undefined, via: BankVia, lookCheck = false): BankOutcome => ({
    photo,
    via: photo ? via : "none",
    route: req.route,
    lookCheck: photo ? lookCheck : false,
    ms: now() - t0,
  });
  let libraryDown = false;
  const hit = await bank.lookup(req, signal).catch((error) => {
    rethrowAbort(error);
    libraryDown = true;
    return undefined;
  });
  if (hit) return done(hit, "library");
  // PHOTO-BANK smoke: with the library unreachable nothing could be stored, so nothing is
  // generated (a paid picture would be lost); the stock ladder serves every route.
  if (libraryDown) return done(await fetchReal().catch(rethrowAbort), "fetched");
  if (req.draw)
    return done(await bank.generate(req, false, signal).catch(rethrowAbort), "generated");
  if (req.route === "real") {
    const fetched = await fetchReal().catch(rethrowAbort);
    if (fetched) {
      await bank.remember(req, fetched).catch(rethrowAbort);
      return done(fetched, "fetched");
    }
    const fallback = req.realFallback ?? "faithful";
    if (fallback === "none") return done(undefined, "none");
    if (fallback === "illustration") {
      // Generate once, check the period, regenerate once on a fail, then nothing.
      for (let attempt = 0; attempt < 2; attempt++) {
        if (!bank.checkPeriod) break;
        const made = await bank.generate(req, false, signal).catch(rethrowAbort);
        if (!made) break;
        const ok = await bank.checkPeriod(req, made, signal).catch(rethrowAbort);
        if (ok) return done(made, "generated");
      }
      return done(undefined, "none");
    }
    const made = await bank.generate(req, true, signal).catch(rethrowAbort);
    // A historical subject is period-checked whatever the policy (an AI label is the worker's job).
    if (made && req.period && bank.checkPeriod) {
      const ok = await bank.checkPeriod(req, made, signal).catch(rethrowAbort);
      if (!ok) return done(undefined, "none");
    }
    return done(made, "generated-faithful", true);
  }
  if (req.stockFirst) {
    const fetched = await fetchReal().catch(rethrowAbort);
    if (fetched) {
      await bank.remember(req, fetched).catch(rethrowAbort);
      return done(fetched, "fetched");
    }
  }
  const made = await bank.generate(req, false, signal).catch(rethrowAbort);
  return done(made, "generated");
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
