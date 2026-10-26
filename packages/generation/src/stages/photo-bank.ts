/**
 * The picture library's ladder (TEACH-84, ruling 158), off the writing clock. The picture
 * director (stages/picture-director.ts) builds the request; this runs it: library, then stock
 * (Commons and Pexels, judged), then generation (judged by the same photo judge), or a count drawn
 * in code. `@tj/generation` sees only the `PictureBank` interface; the worker closes it over the
 * database, storage, embedder and generator.
 */
import { createHash } from "node:crypto";
import {
  type CountArray,
  imageFailReason,
  type PictureFailure,
  pictureFailureOf,
  type RetryHint,
  requestsSent,
  spentOn,
} from "@tj/images";
import { whenNonFatal } from "../writer/services";
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
 * Ruling 163 as one table (Greg confirmed `strict`, 6 Oct). Rows: the history policy
 * for a historical subject, and `present` for a present-day one. Named people, particular objects
 * and works are Commons or nothing; nothing historical is generated in photographic style under
 * `strict`. Change `HISTORY_POLICY` in code to flip it (`labelled` still needs its "AI
 * reconstruction" caption).
 */
export const REAL_FALLBACK: Record<HistoryPolicy | "present", Record<NamedKind, RealFallback>> = {
  // An event's illustration fallback was unreachable under strict (a past event always depicts,
  // and nothing is generated for one), so strict says what happens: no generated picture.
  strict: { event: "none", person: "none", work: "none", place: "none", object: "none" },
  illustrate: {
    event: "illustration",
    person: "illustration",
    work: "none",
    place: "none",
    object: "none",
  },
  labelled: { event: "faithful", person: "faithful", work: "none", place: "none", object: "none" },
  // Ruling 296 / 210: a real place is real-only, present-day too.
  present: { event: "none", person: "none", work: "none", place: "none", object: "none" },
};

/**
 * Ruling 296 (amends 210, 26 Oct 2026): a real thing's fallback when Commons and stock miss. Real
 * places, monuments and works, real people and events keep ruling 163's table (real-only under
 * `strict`). A generic object or artefact of a period (a leather fire bucket, a Roman oil lamp) may
 * be generated: the director's `object` that the writer did not mark `named`, since the writer
 * marks a subject named only when it must show one particular real thing. A unique, identifiable
 * artefact or document (the Rosetta Stone) is named, so it stays real-only. A past object is drawn
 * as the painted illustration (`illustration`), never photo style (ruling 163). A missing kind
 * is real-only.
 */
export function realFallbackFor(
  kind: NamedKind | null | undefined,
  policy: HistoryPolicy | "present",
  writerNamed: boolean,
): RealFallback {
  // Fails closed: a real thing the director did not classify is never generated.
  if (!kind) return "none";
  if (kind === "object" && !writerNamed) return "illustration";
  return REAL_FALLBACK[policy][kind];
}

/** Ruling 163's policy, a code default (Greg confirmed `strict`, 6 Oct): config ships in code. */
export const HISTORY_POLICY: HistoryPolicy = "strict";

export function historyPolicy(env: string | undefined = HISTORY_POLICY): HistoryPolicy {
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
  /** Round 7: the picture depicts a past event or person (ruling 163 applies to it). */
  depicts?: boolean;
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
  /** What a fresh generation cost (the generator's own figure); absent on library and stock rows. */
  costUsd?: number;
  /** The whole prompt the image model got (retry and frame lines included): debug record only. */
  prompt?: string;
  /** How far a fresh generation's subject runs off its frame (`FrameMeasure`): measured, never acted on. */
  frame?: FrameMeasure;
};

/**
 * `frameCut` of a fresh generation's bytes (`@tj/images`), as the worker records it, with how long
 * the measurement took. Measure only (21 Oct 2026): nothing is redrawn on it.
 */
export interface FrameMeasure {
  /** One backdrop colour holds most of the edge; false is a full-bleed scene, never measured. */
  plain: boolean;
  cut: boolean;
  /** The sum of the edge runs (0 when whole or not plain). */
  bleed: number;
  edges: { top: number; right: number; bottom: number; left: number };
  ms: number;
}

/** What failed a picture's judge, as fixed codes (`failedChecks` in `illustrate.ts`). */
export const JUDGE_CHECKS = [
  "no-pick",
  "off-subject",
  "wrong-kind",
  "unclear",
  "misfit",
  "items-missing",
] as const;
export type JudgeCheck = (typeof JUDGE_CHECKS)[number];

/** One generation a slot asked for, for its trace (debug record and the outcome event). */
export interface PictureAttempt {
  /** How it ended: placed, refused by the judge, the judge call failed, the wrong style, the bank
   * declined it (daily cap, no generator), or the generator's failure code. */
  result: string;
  src?: string;
  costUsd?: number;
  frame?: FrameMeasure;
  failedChecks?: readonly JudgeCheck[];
  /** The judge's one sentence (debug record only; never an event). */
  why?: string;
  /** The image model's whole prompt (debug record only; never an event). */
  prompt?: string;
  /**
   * Why a try threw (generate, save or judge): stage, error class, code, status and a sanitised
   * message. The message is debug record only; the outcome event takes stage, code and status.
   */
  failure?: PictureFailure;
}

/** Everything one slot's ladder did, for the debug record and the outcome event. */
export interface PictureTrace {
  attempts: PictureAttempt[];
  /** The library row offered, and whether the judge took it. */
  library?: "reused" | "refused" | "down";
  /** The stock search ran and found nothing, or found the picture placed. */
  stock?: "placed" | "miss";
  /** The stock search threw (a miss as far as the ladder goes): why, as for a try. */
  stockFailure?: PictureFailure;
}

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
 * Ruling 163, tightened in a lesson trial (an AI "illustration" of the Roman landing):
 * a request that depicts a past event or person never places a generated picture of any style; only
 * a code drawing (`drawn`) may. They are shown by real artefacts and artworks. Round 7: a generic
 * thing with a period (wheat, ore) is not depicting and may still be generated.
 */
export function styleAllowed(req: BankRequest, picture: MadePicture): boolean {
  if (!req.period || !req.depicts || picture.source.provider !== "generated") return true;
  return picture.style === "drawn";
}

export interface PictureBank {
  /**
   * A stored picture for this request (same family, above the threshold), else undefined; with
   * its bytes (`dataUrl`) so the judge sees it before it is used, and its style when generated.
   */
  lookup(req: BankRequest, signal: AbortSignal): Promise<MadePicture | undefined>;
  /** Store a placed picture once: fetched, or generated and judged (licence-filtered by the implementation). */
  remember(req: BankRequest, photo: PlacedPhoto): Promise<void>;
  /**
   * Generate (or draw), store and return a picture; undefined when refused. A retry passes why the
   * last try failed (`retry`), which the prompt carries (`withRetryLine`), so it never repeats.
   */
  generate(
    req: BankRequest,
    faithful: boolean,
    signal: AbortSignal,
    retry?: RetryHint,
  ): Promise<MadePicture | undefined>;
  /** Take a picture the judge refused (fresh or from the library) out of the library for good. */
  reject?(photo: PlacedPhoto): Promise<void>;
}

/**
 * The judge's verdicts on library reuse, by (stored picture, request): a pair already judged is
 * not judged again. Only real verdicts are kept, never a failed call.
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
  /** Generations asked for this request (0 when none ran). */
  attempts: number;
  /** Why the last generation failed (`judge`, or a generator code such as `refused-safety`). */
  reason?: string;
  trace: PictureTrace;
}

/**
 * Generations one picture may take: the first and two retries (was two). Each retry carries why
 * the last one failed: the judge's reason, or a safety refusal's line.
 */
export const MADE_ATTEMPTS = 3;

/**
 * The ladder for one request: library, then stock (real things, and generic ones stock can show),
 * then generation. A generated picture is shown to the same photo judge (mustShow, stated
 * relations, count, period); a refusal regenerates up to twice, each carrying the judge's reason
 * (`MADE_ATTEMPTS`), then nothing. A safety refusal is retried only with its own line. A library or generator
 * failure never throws: it is a miss. A generated picture the judge passed is stored in the
 * library (`remember`) once it is the one placed, as a fetched one is (TEACH-84 part b).
 */
export async function findPicture(
  req: BankRequest,
  bank: PictureBank,
  fetchStock: (signal?: AbortSignal) => Promise<PlacedPhoto | undefined>,
  signal: AbortSignal,
  /** The judge; `onWhy` hears its reason when it refuses (the next try carries it). */
  judgeMade?: (
    picture: MadePicture,
    reuse?: boolean,
    onWhy?: (why: string, failed?: readonly JudgeCheck[]) => void,
  ) => Promise<boolean>,
  now: () => number = Date.now,
  verdicts?: VerdictCache,
  /**
   * C7 (TEACH-167 part b): a generic stock-first search still running after `raceMs` starts its
   * generation beside it. The first good picture wins; the loser is cancelled (see `race`).
   * Absent: stock, then generation, one after the other.
   */
  raceMs?: number,
): Promise<BankOutcome> {
  const t0 = now();
  let attempts = 0;
  let lastFail: string | undefined;
  const trace: PictureTrace = { attempts: [] };
  const done = (photo: PlacedPhoto | undefined, via: BankVia): BankOutcome => {
    for (const a of trace.attempts) if (photo && a.src === photo.src) a.result = "placed";
    if (via === "fetched" && !trace.stock) trace.stock = photo ? "placed" : "miss";
    return {
      photo,
      via: photo ? via : "none",
      route: req.route,
      ms: now() - t0,
      attempts,
      ...(lastFail ? { reason: lastFail } : {}),
      trace,
    };
  };
  // Generated pictures this request's judge passed: only these are stored once placed.
  const judged = new WeakSet<PlacedPhoto>();
  const placeMade = async (photo: PlacedPhoto | undefined, via: BankVia): Promise<BankOutcome> => {
    if (photo && judged.has(photo))
      await bank.remember(req, photo).catch(whenNonFatal(() => undefined));
    return done(photo, via);
  };
  const make = async (faithful: boolean, sig: AbortSignal = signal) => {
    // Ruling 163 (narrowed later): nothing is generated for a past event or person.
    if (req.period && req.depicts && !req.draw) return undefined;
    let hint: RetryHint | undefined;
    /** The safety retry runs once at most, with its own line; a second refusal ends the picture. */
    let safetyRetried = false;
    for (let attempt = 0; attempt < MADE_ATTEMPTS; attempt++) {
      let made: MadePicture | undefined;
      try {
        made = await bank.generate(req, faithful, sig, hint);
      } catch (e) {
        rethrowAbort(e);
        // Only a generation that reached the provider counts as an attempt.
        if (requestsSent(e) > 0) attempts++;
        const reason = imageFailReason(e);
        lastFail = reason;
        // A store failure after the picture was made is tagged `save` by the bank (`PictureStageError`).
        // A save that failed after a paid generation still costs what the model charged.
        const spent = spentOn(e);
        trace.attempts.push({
          result: reason,
          ...(spent !== undefined ? { costUsd: spent } : {}),
          failure: pictureFailureOf(e, "generate"),
        });
        // A safety refusal is tried again with its own line, never the same prompt; any other
        // generator failure has had the generator's own retries already.
        if (reason !== "refused-safety" && reason !== "no-image") return undefined;
        if (reason === "refused-safety") {
          if (safetyRetried) return undefined;
          safetyRetried = true;
        }
        hint = { reason };
        continue;
      }
      if (made && !req.draw) attempts++;
      // The bank made nothing and threw nothing: it declined (the daily cap, no generator, no
      // prompt). Recorded so an empty slot says why instead of failing silently.
      if (!made) {
        lastFail = "declined";
        trace.attempts.push({ result: "declined" });
        return undefined;
      }
      const tried: PictureAttempt = {
        result: "made",
        src: made.src,
        ...(made.costUsd !== undefined ? { costUsd: made.costUsd } : {}),
        ...(made.prompt ? { prompt: made.prompt } : {}),
        ...(made.frame ? { frame: made.frame } : {}),
      };
      trace.attempts.push(tried);
      if (!styleAllowed(req, made)) {
        // A photo-style picture for a historical request: the wrong kind, so no retry either.
        tried.result = lastFail = "style";
        await bank.reject?.(made).catch(rethrowAbort);
        return undefined;
      }
      if (req.draw || !judgeMade || !made.dataUrl) return made;
      let why: string | undefined;
      const verdict = await judgeMade(made, undefined, (w, failed) => {
        why = w || undefined;
        if (failed?.length) tried.failedChecks = failed;
      }).catch((e: unknown) => {
        rethrowAbort(e);
        tried.failure = pictureFailureOf(e, "judge");
        return undefined;
      });
      if (verdict) {
        judged.add(made);
        return made;
      }
      // A judge call that failed (no verdict) is told apart from a refusal; both still retry.
      lastFail = verdict === undefined ? "judge-error" : "judge";
      tried.result = lastFail;
      if (why) tried.why = why;
      hint = { reason: "judge", ...(why ? { why } : {}) };
      await bank.reject?.(made).catch(rethrowAbort);
    }
    return undefined;
  };
  // A library hit is judged against this request's mustShow exactly like a fresh picture; one the
  // judge refuses is marked and never reused.
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
  /** The stock search; a throw (not an abort) is a miss with its failure on the trace. */
  const stockFailed = (e: unknown): undefined => {
    rethrowAbort(e);
    trace.stockFailure = pictureFailureOf(e, "stock");
    if (!trace.stock) trace.stock = "miss";
    return undefined;
  };
  let libraryDown = false;
  const hit = await bank.lookup(req, signal).catch((error) => {
    rethrowAbort(error);
    libraryDown = true;
    return undefined;
  });
  if (libraryDown) trace.library = "down";
  else if (hit) trace.library = (await usable(hit)) ? "reused" : "refused";
  if (hit && trace.library === "reused") return done(hit, "library");
  // With the library unreachable nothing could be stored, so nothing is generated.
  if (libraryDown) return done(await fetchStock().catch(stockFailed), "fetched");
  if (req.draw) return done(await make(false), "generated");
  if (req.route !== "real" && req.stockFirst && raceMs !== undefined) return race(raceMs);
  if (req.route === "real" || req.stockFirst) {
    const fetched = await fetchStock().catch(stockFailed);
    if (fetched) {
      await bank.remember(req, fetched).catch(rethrowAbort);
      return done(fetched, "fetched");
    }
    trace.stock = "miss";
  }
  if (req.route === "real") {
    const fallback = req.realFallback ?? "none";
    if (fallback === "none") return done(undefined, "none");
    return placeMade(
      await make(fallback === "faithful"),
      fallback === "faithful" ? "generated-faithful" : "generated",
    );
  }
  return placeMade(await make(false), "generated");

  /**
   * Stock first, and generation beside it once stock has run `ms`. The race settles exactly once:
   * the first good picture wins and is the only one placed (and, from stock, remembered). The
   * other side is cancelled (its stock search or generation aborted through its own signal), and
   * any picture it still delivers, made or fetched, is taken back out (`reject`), never placed.
   */
  async function race(ms: number): Promise<BankOutcome> {
    const stockStop = new AbortController();
    const genStop = new AbortController();
    /** A side cancelled because the other won answers nothing; the job's own abort still throws. */
    const lost = (stop: AbortController) => (error: unknown) => {
      if (stop.signal.aborted && !signal.aborted) return undefined;
      return stop === stockStop ? stockFailed(error) : rethrowAbort(error);
    };
    const discard = (p: PlacedPhoto) =>
      (bank.reject?.(p) ?? Promise.resolve()).catch(whenNonFatal(() => undefined));
    const stockP = fetchStock(AbortSignal.any([signal, stockStop.signal])).then((p) => {
      // A search that ran to the end and found nothing is a miss, whichever side then wins.
      if (!p && !trace.stock) trace.stock = "miss";
      return p;
    }, lost(stockStop));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<"late">((resolve) => {
      timer = setTimeout(() => resolve("late"), ms);
    });
    const early = await Promise.race([stockP, late]);
    clearTimeout(timer);
    if (early !== "late") {
      if (early) {
        await bank.remember(req, early).catch(whenNonFatal(() => undefined));
        return done(early, "fetched");
      }
      return placeMade(await make(false), "generated");
    }
    // Stock is slow: generation starts beside it.
    const genP = make(false, AbortSignal.any([signal, genStop.signal])).then(
      undefined,
      lost(genStop),
    );
    type Win = { via: "fetched" | "generated"; p: PlacedPhoto };
    let won: Win | undefined;
    const win = await new Promise<Win | undefined>((resolve, reject) => {
      const side = (via: Win["via"], answer: Promise<PlacedPhoto | undefined>) =>
        answer.then((p) => {
          if (!p) return;
          // One synchronous check-and-set: two answers can never both win.
          if (won) {
            // A later answer of either side: removed, awaited by nobody. Its own failure, even an
            // abort or a budget stop, is caught here: the race is already decided, and a rejection
            // nobody awaits would crash the worker. The bank logs its own delete failures.
            void discard(p).then(undefined, () => undefined);
            return;
          }
          won = { via, p };
          (via === "fetched" ? genStop : stockStop).abort();
          resolve(won);
        });
      // Both sides done with no winner is no picture; a job abort before a winner rejects.
      Promise.all([side("fetched", stockP), side("generated", genP)]).then(
        () => resolve(undefined),
        reject,
      );
    });
    if (!win) return done(undefined, "none");
    if (win.via === "fetched") {
      await bank.remember(req, win.p).catch(whenNonFatal(() => undefined));
      return done(win.p, "fetched");
    }
    return placeMade(win.p, "generated");
  }
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
 * The things a picture request names, which the picture must visibly contain (
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
