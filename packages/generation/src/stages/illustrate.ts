import type { Finding, ImageBrief, Lesson, PhotoSource, SlideElement } from "@tj/domain/documents";
import {
  isBlockedQuery,
  normaliseQuery,
  PexelsError,
  type PhotoResult,
  queryCandidates,
} from "@tj/images";
import { PLACEHOLDER_IMAGE } from "@tj/slides";
import { callStructured, MAX_OUTPUT_TOKENS } from "../call";
import {
  normaliseItem,
  type PickOrRequery,
  pickOrRequeryPrompt,
  pickOrRequerySchemaFor,
} from "../prompts/pick-or-requery-photo";
import {
  type PickOrRequery as DirectedVerdict,
  pickOrRequeryPrompt as directedJudgePrompt,
  pickOrRequerySchemaFor as directedJudgeSchemaFor,
} from "../prompts/pick-or-requery-photo-directed";
import {
  SHORTLIST_MAX,
  shortlistPhotosPrompt,
  shortlistSchemaFor,
} from "../prompts/shortlist-photos";
import {
  BudgetExceeded,
  emptyImageCounts,
  type PhotoPlacer,
  type PipelineDeps,
  type PipelineState,
  throwIfAborted,
} from "../types";
import { withUsage } from "./generate";
import { audienceOf, generationOf, slideText } from "./shared";

/** Between Generate's last (85) and Evaluate's first (90). */
export const PROGRESS_ILLUSTRATED = 88;

const EMPTY_MESSAGE = "No photograph was found for this slide. Add one from the image panel.";
const BUSY_MESSAGE = "Photo search was busy; add a picture from the image panel.";
/**
 * Portrait hits gathered across the query candidates: the caption shortlist (TEACH-227) reads all
 * of them as text, then the picture judge looks at the few it names (`SHORTLIST_MAX`). Thirty
 * captions cost less than one thumbnail.
 */
const MAX_CANDIDATES = 30;
const PER_PAGE = 30;
/** Judge calls per slide: the first pick, and one more after a requery. */
const MAX_JUDGE_CALLS = 2;

type Judged = "pick" | "query" | "none";

type PlaceOutcome =
  | { outcome: "placed"; photo: PlacedPhoto; judged: Judged }
  | { outcome: "empty"; judged?: Judged }
  | { outcome: "busy" };

/** What the picker saw; written onto the element's `source` and given to the slide's text. */
export type PhotoEvidence = NonNullable<PhotoSource["evidence"]>;

/** A stored, gated photograph: what goes onto the slide's image element. */
export type PlacedPhoto = {
  src: string;
  alt: string;
  source: PhotoSource;
  evidence: PhotoEvidence;
};

/** The image element with the photograph on it; geometry and id are the placeholder's. */
export function withPhoto(
  target: SlideElement & { type: "image" },
  photo: PlacedPhoto,
): SlideElement {
  return { ...target, src: photo.src, alt: photo.alt, source: photo.source };
}

export function emptyFinding(slideId: string, elementId: string): Finding {
  return {
    check: "image",
    severity: "warning",
    target: { slideId, elementId },
    message: EMPTY_MESSAGE,
  };
}

export function busyFinding(slideId: string, elementId: string): Finding {
  return {
    check: "image",
    severity: "warning",
    target: { slideId, elementId },
    message: BUSY_MESSAGE,
  };
}

/**
 * Illustration (Images project): after Generate, one Pexels photograph per `image-text` slide
 * with a brief. Search is deterministic; one `small` model call per slide then judges the
 * candidates' captions against the lesson (TEACH-191) — Pexels ranks `rodent incisors` with a
 * hand holding human teeth first, and nothing else in the chain can tell. No checkpoint, and
 * idempotent: a slide whose slot is already filled is skipped, so a resume never re-places. A
 * slide the step cannot fill keeps the recipe's placeholder: a missing picture beats a wrong one.
 *
 * Persistence failures are never swallowed: only the search/judge/store work sits inside the
 * per-slide try, so a lost lock or database error propagates and the job fails loudly instead
 * of completing with orphaned bucket photos. A budget stop is not a per-slide failure either: it
 * ends the step for every remaining slide, like the other stages.
 */
export async function illustrate(state: PipelineState, deps: PipelineDeps): Promise<PipelineState> {
  const images = deps.images;
  if (!images) {
    deps.logger.info({ stage: "illustrate" }, "images disabled");
    return state;
  }
  // Picture-first picks (Generate, TEACH-220) already counted into `deps.imageCounts`; this step
  // adds the slides it still has to place (the resume path).
  const counts = deps.imageCounts ?? emptyImageCounts();
  deps.imageCounts = counts;
  const outline = state.lesson.facts?.outline ?? [];
  // Generate's picture-first pick may already have left an `image` warning on a slide this pass
  // places again (a resume, or a store that failed): the later verdict replaces it, so a slide never
  // carries the same warning twice.
  const handled = new Set<string>();
  const baseFindings = generationOf(state.lesson).findings;
  const findings: Finding[] = [];
  let lesson = state.lesson;
  let judged = false;
  /** The lesson as it must be persisted: placements, usage and every warning so far. */
  const snapshot = (): Lesson => {
    const generation = generationOf(lesson);
    return withUsage(
      {
        ...lesson,
        generation: {
          ...generation,
          findings: [
            ...baseFindings.filter(
              (f) =>
                !(
                  f.check === "image" &&
                  f.target.slideId !== undefined &&
                  handled.has(f.target.slideId)
                ),
            ),
            ...findings,
          ],
          // No checkpoint of its own (`GenerationStage` has none), so the judge's version rides
          // on `generated` the way Plan joins its two prompts under `planned`.
          promptVersions:
            judged && generation.promptVersions.generated !== undefined
              ? {
                  ...generation.promptVersions,
                  generated: joinVersions(
                    generation.promptVersions.generated,
                    pickOrRequeryPrompt.version,
                  ),
                }
              : generation.promptVersions,
        },
      },
      deps,
    );
  };
  let busy = false;
  for (let index = 0; index < lesson.slides.length; index++) {
    throwIfAborted(deps.signal);
    const slide = lesson.slides[index];
    const brief = outline[index]?.imageBrief;
    if (slide?.kind !== "image-text" || !brief) continue;
    const target = slide.elements.find(
      (element) => element.type === "image" && element.src === PLACEHOLDER_IMAGE,
    );
    if (target?.type !== "image") continue;
    handled.add(slide.id);
    counts.requested += 1;
    if (busy) {
      findings.push(busyFinding(slide.id, target.id));
      counts.empty += 1;
      continue;
    }
    let placed: PlaceOutcome;
    try {
      placed = await placeOne({ lesson, slide, brief, images, deps, index });
    } catch (error) {
      if (error instanceof BudgetExceeded) {
        deps.logger.info({ stage: "illustrate", slideIndex: index }, "illustrate budget stop");
        findings.push(emptyFinding(slide.id, target.id));
        counts.empty += 1;
        // Nothing more can be judged; the remaining slides keep their placeholders.
        busy = true;
        continue;
      }
      deps.logger.info({ stage: "illustrate", slideIndex: index, err: error }, "illustrate failed");
      counts.failed += 1;
      continue;
    }
    if (placed.outcome === "busy") {
      busy = true;
      findings.push(busyFinding(slide.id, target.id));
      counts.empty += 1;
      continue;
    }
    if (placed.judged !== undefined) judged = true;
    deps.logger.info(
      {
        stage: "illustrate",
        slideIndex: index,
        judged: placed.judged ?? null,
        outcome: placed.outcome,
      },
      "illustrate judged",
    );
    if (placed.outcome === "empty") {
      findings.push(emptyFinding(slide.id, target.id));
      counts.empty += 1;
      continue;
    }
    lesson = {
      ...lesson,
      slides: lesson.slides.map((candidate, i) =>
        i === index
          ? {
              ...slide,
              elements: slide.elements.map((element) =>
                element.id === target.id ? withPhoto(target, placed.photo) : element,
              ),
            }
          : candidate,
      ),
    };
    // The slide's text was written before this photograph existed (the picture-first pick failed
    // or the job resumed), so it may say there is no picture, or describe the wrong thing. An
    // `error` sends it to Repair, which rewrites the text to the photograph (quality lab, Sept 2026:
    // a placed Hadrian's Wall under notes saying "the slide has no photograph" scored notes 1).
    findings.push({
      check: "image-fit",
      severity: "error",
      target: { slideId: slide.id, elementId: target.id },
      message:
        "The photograph was placed after the text was written; rewrite the text to what it shows.",
    });
    // After the persist: a lost lock must propagate, not read as a placed picture.
    const { updatedAt } = await deps.persist(snapshot());
    await deps.onProgress(PROGRESS_ILLUSTRATED, "Pictures placed", "illustrate", updatedAt);
    counts.placed += 1;
  }
  // Warnings (and the judge's usage) with no placement still have to reach the database;
  // placements were persisted as they landed.
  if ((findings.length > 0 || judged) && counts.placed === 0) {
    await deps.persist(snapshot());
  }
  return { ...state, lesson: findings.length > 0 || judged ? snapshot() : lesson };
}

export function joinVersions(existing: string, added: string): string {
  return existing.split("+").includes(added) ? existing : `${existing}+${added}`;
}

type PlaceArgs = {
  lesson: Lesson;
  /** The slide, when it exists already (the resume path); picture-first picks have none yet. */
  slide: Lesson["slides"][number] | undefined;
  /** The outline entry's brief, used as the judge's "this slide" line when no slide exists yet. */
  slideBrief?: string | undefined;
  brief: ImageBrief;
  images: PhotoPlacer;
  deps: PipelineDeps;
  index: number;
};

/**
 * The outcome of one picture-first pick (TEACH-220): the photograph to put on the slide's image
 * slot with what the judge saw, or `empty` / `busy`. No persist: Generate writes it into the slide
 * in the same persist as the slide's text.
 */
export type PickedPhoto =
  | { outcome: "placed"; photo: PlacedPhoto }
  | { outcome: "empty" }
  | { outcome: "busy" };

/**
 * Picture first: search and judge for one `image-text` outline entry before its slide exists, so the
 * slide's text can be written to the photograph. Returns `empty` for a budget stop or any failure —
 * nothing here fails a lesson; the slide is then written as plain content with the `image` warning.
 */
export async function pickPhoto(
  lesson: Lesson,
  index: number,
  deps: PipelineDeps,
): Promise<PickedPhoto> {
  const images = deps.images;
  const entry = lesson.facts?.outline[index];
  const brief = entry?.imageBrief;
  if (!images || !entry || !brief) return { outcome: "empty" };
  const counts = deps.imageCounts ?? emptyImageCounts();
  deps.imageCounts = counts;
  counts.requested += 1;
  try {
    const placed = await placeOne({
      lesson,
      slide: undefined,
      slideBrief: entry.brief?.adds,
      brief,
      images,
      deps,
      index,
    });
    deps.logger.info(
      {
        stage: "illustrate",
        slideIndex: index,
        judged: placed.outcome === "busy" ? null : (placed.judged ?? null),
        outcome: placed.outcome,
      },
      "illustrate judged",
    );
    if (placed.outcome === "placed") {
      counts.placed += 1;
      return { outcome: "placed", photo: placed.photo };
    }
    counts.empty += 1;
    return { outcome: placed.outcome };
  } catch (error) {
    if (error instanceof BudgetExceeded) {
      deps.logger.info({ stage: "illustrate", slideIndex: index }, "illustrate budget stop");
      counts.empty += 1;
      return { outcome: "empty" };
    }
    if (error instanceof Error && error.name === "AbortError") throw error;
    deps.logger.info({ stage: "illustrate", slideIndex: index, err: error }, "illustrate failed");
    counts.failed += 1;
    return { outcome: "empty" };
  }
}

/**
 * One slide: portrait candidates gathered across the query candidates, then one judge call:
 * `pick` stores that candidate; `query` runs exactly one more (blocklist-checked) search and
 * stores its first portrait; neither leaves the placeholder. A 429 anywhere reports `busy` (the
 * caller stops searching for every remaining slide); a `BudgetExceeded` and any other failure
 * propagate for the caller to classify.
 */
/** Results kept from one query, so two hints and the subject all reach the pool (`MAX_CANDIDATES`). */
const PER_QUERY = 10;

/**
 * Named things the slide's own facts cite — "Hadrian's Wall", "Housesteads Roman Fort" — as
 * search queries ahead of the brief's subject (quality lab, Sept 2026): a stock library holds
 * hundreds of photographs of a named site and few of a category ("Roman fort Britain" returned
 * castles, a Serbian site and a Russian log fort). Two to four capitalised words in a row, the
 * first not opening a sentence, from the key ideas the outline entry references.
 */
export function factQueryHints(lesson: Lesson, index: number): string[] {
  const facts = lesson.facts;
  const entry = facts?.outline[index];
  if (!facts || !entry) return [];
  const refs = new Set(entry.factRefs);
  const text = (facts.keyIdeas ?? [])
    .filter((k) => refs.has(k.id))
    .flatMap((k) => [k.statement, k.explanation, k.example])
    .join(" ");
  const hints: string[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(
    /(?<=^|[a-z,;:(] )((?:[A-Z][a-z]+(?:'s)?(?: (?:of|the|de|du))? ){1,3}[A-Z][a-z]+)/g,
  )) {
    const hint = (m[1] ?? "").trim();
    const key = normaliseQuery(hint);
    if (!hint || seen.has(key) || isBlockedQuery(hint)) continue;
    seen.add(key);
    hints.push(hint);
    if (hints.length === 2) break;
  }
  return hints;
}

async function placeOne(args: PlaceArgs): Promise<PlaceOutcome> {
  const { brief, images, deps, index } = args;
  const candidates: PhotoResult[] = [];
  /** Every query actually searched, so the judge is told all of them and never repeats one. */
  const tried: string[] = [];
  for (const query of [...factQueryHints(args.lesson, index), ...queryCandidates(brief)]) {
    if (candidates.length >= MAX_CANDIDATES) break;
    // Safety (TEACH-162): a blocked candidate searches nothing.
    if (isBlockedQuery(query)) {
      deps.logger.info({ stage: "illustrate", slideIndex: index, blocked: true });
      continue;
    }
    tried.push(query);
    const photos = await searchPortraits(images, query, deps.signal);
    if (photos === "busy") return { outcome: "busy" };
    let kept = 0;
    for (const photo of photos) {
      if (candidates.length >= MAX_CANDIDATES || kept >= PER_QUERY) break;
      if (candidates.some((seen) => seen.id === photo.id)) continue;
      candidates.push(photo);
      kept += 1;
    }
  }
  // Every candidate query was blocked: nothing to judge, nothing to say.
  if (tried.length === 0) return { outcome: "empty" };

  // Captions first, pictures second (TEACH-227): the shortlist names the candidates that are the
  // subject; the judge looks at those and the gate decides. A requery earns exactly one more
  // shortlist + judge round over the new pool — its first result is never placed blind (TEACH-220).
  let pool = candidates;
  for (let round = 0; round < MAX_JUDGE_CALLS; round++) {
    const named = await shortlist(args, pool);
    // The shortlist narrows, it does not veto (TEACH-239): one low-effort caption call over a pool
    // full of the subject answered [] in production and the slide landed empty unjudged. An empty
    // answer over a non-empty pool sends the first few to the judge, who sees the pictures.
    const fallback = pool.length > 0 && named.length === 0;
    const shortlisted = fallback ? firstFew(pool) : named;
    deps.logger.info({
      stage: "illustrate",
      slideIndex: index,
      pool: pool.length,
      shortlisted: named.length,
      ...(fallback ? { judged: "fallback" } : {}),
    });
    const verdict = await judge(args, shortlisted, tried);
    // Only a photograph the judge was shown can be placed.
    const picked = verdict.pick
      ? shortlisted.find((candidate) => candidate.id === verdict.pick)
      : undefined;
    if (picked && gatePasses(brief, verdict)) {
      const evidence: PhotoEvidence = {
        visible: verdict.visible,
        count: verdict.count ?? "one",
        alt: picked.alt,
        promptVersion: pickOrRequeryPrompt.version,
        thumbnail: picked.src.tiny,
      };
      return {
        outcome: "placed",
        photo: await store(images, picked, brief, evidence),
        judged: round === 0 ? "pick" : "query",
      };
    }
    if (picked) {
      deps.logger.info({
        stage: "illustrate",
        slideIndex: index,
        gated: true,
        offSubject: !verdict.onSubject,
        unclear: !verdict.clear,
        noneVisible: brief.mustShow.length > 0 && itemsSeen(brief, verdict).length === 0,
      });
    }
    const requery = verdict.query;
    if (!requery || round === MAX_JUDGE_CALLS - 1) return { outcome: "empty", judged: "none" };
    // A repeat of a query already searched would return the pool the judge just rejected.
    if (tried.map(normaliseQuery).includes(normaliseQuery(requery))) {
      deps.logger.info({ stage: "illustrate", slideIndex: index, repeated: true });
      return { outcome: "empty", judged: "query" };
    }
    if (isBlockedQuery(requery)) {
      deps.logger.info({ stage: "illustrate", slideIndex: index, blocked: true });
      return { outcome: "empty", judged: "query" };
    }
    tried.push(requery);
    const photos = await searchPortraits(images, requery, deps.signal);
    if (photos === "busy") return { outcome: "busy" };
    if (photos.length === 0) return { outcome: "empty", judged: "query" };
    pool = photos.slice(0, MAX_CANDIDATES);
  }
  return { outcome: "empty", judged: "none" };
}

/** The candidates the judge sees when the shortlist cannot choose: the first `SHORTLIST_MAX`. */
function firstFew(pool: PhotoResult[]): PhotoResult[] {
  return pool.slice(0, SHORTLIST_MAX);
}

/**
 * The few candidates worth a look, by caption alone: one `small` call over the whole pool. When
 * the call fails the first `SHORTLIST_MAX` stand in; when it names nothing the caller does the
 * same (TEACH-239) — the judge still looks, so a shortlist miss never loses a photo. Nothing here
 * fails a lesson except the budget or an abort.
 */
async function shortlist(args: PlaceArgs, pool: PhotoResult[]): Promise<PhotoResult[]> {
  const { lesson, brief, deps } = args;
  if (pool.length <= SHORTLIST_MAX) return pool;
  try {
    const call = await callStructured({
      deps,
      stage: "illustrate",
      cls: "small",
      effort: "low",
      prompt: shortlistPhotosPrompt,
      input: {
        topic: lesson.brief?.topic ?? lesson.title,
        subject: brief.subject,
        mustShow: brief.mustShow,
        purpose: brief.purpose,
        avoid: brief.avoid,
        candidates: pool.map((c) => ({ id: c.id, alt: c.alt })),
      },
      schema: shortlistSchemaFor(pool.map((c) => c.id)),
      maxOutputTokens: MAX_OUTPUT_TOKENS.shortlist,
    });
    const byId = new Map(pool.map((c) => [c.id, c]));
    const chosen = call.output.ids.flatMap((id) => {
      const c = byId.get(id);
      return c ? [c] : [];
    });
    return chosen;
  } catch (error) {
    if (error instanceof BudgetExceeded) throw error;
    if (error instanceof Error && error.name === "AbortError") throw error;
    deps.logger.info(
      { stage: "illustrate", slideIndex: args.index, err: error },
      "shortlist failed",
    );
    return firstFew(pool);
  }
}

/** One judge call over `pool`: the thumbnails as image parts, the captions and brief as text. */
async function judge(
  args: PlaceArgs,
  pool: PhotoResult[],
  tried: string[],
): Promise<PickOrRequery> {
  const { lesson, slide, brief, deps } = args;
  const facts = lesson.facts;
  // The judge decides what the slide is written to, and the small class told a llama from a
  // rodent's incisors apart wrongly in production (2026-09-10): this is the one picture call whose
  // judgement is worth the standard class (≈ $0.02 a photo, at most six a lesson; founder decision).
  const call = await callStructured({
    deps,
    stage: "illustrate",
    cls: "standard",
    effort: "low",
    prompt: pickOrRequeryPrompt,
    input: {
      topic: lesson.brief?.topic ?? lesson.title,
      answers: lesson.brief?.answers,
      lessonTitle: lesson.title,
      audience: audienceOf(lesson),
      objectives: facts?.objectives.map((o) => o.text) ?? [],
      vocabulary: facts?.vocabulary.map((v) => v.term) ?? [],
      slideBrief: args.slideBrief ?? (slide ? slideText(slide) : brief.subject),
      subject: brief.subject,
      mustShow: brief.mustShow,
      purpose: brief.purpose,
      avoid: brief.avoid,
      queries: tried,
      candidates: pool.map((c) => ({ id: c.id, alt: c.alt, thumbnail: c.src.tiny })),
    },
    schema: pickOrRequerySchemaFor(brief),
    maxOutputTokens: MAX_OUTPUT_TOKENS.pickPhoto,
    images: pool.map((c) => ({ id: c.id, url: c.src.tiny })),
  });
  return call.output;
}

/** Which `mustShow` items the judge saw, spelt as the brief spells them. */
function itemsSeen(brief: Pick<ImageBrief, "mustShow">, verdict: PickOrRequery): string[] {
  const seen = new Set(verdict.visible.map(normaliseItem));
  return brief.mustShow.filter((item) => seen.has(normaliseItem(item)));
}

/**
 * The deterministic gate: the subject, clearly, with at least one `mustShow` item in view
 * (TEACH-241; TEACH-220 required every item, and stock photography rarely has a whole tail and
 * both ears clear in one frame). The slide's text is written to `visible`, so the picture never
 * shows less than the words claim. A brief with no items (pre-TEACH-159) needs the subject only.
 */
export function gatePasses(brief: Pick<ImageBrief, "mustShow">, verdict: PickOrRequery): boolean {
  if (!verdict.onSubject || !verdict.clear) return false;
  return brief.mustShow.length === 0 || itemsSeen(brief, verdict).length > 0;
}

/**
 * The picture director's gate (the writer planner only; objectives-first keeps `gatePasses` and
 * its judge): the subject, clearly, and the picture as a whole fits the request; a named sex, age
 * or kind the picked subject is not (a cockerel for "hen") fails.
 */
export function directedGatePasses(
  brief: Pick<ImageBrief, "mustShow" | "request" | "specific">,
  verdict: Omit<DirectedVerdict, "kindMatches" | "boxes"> & { kindMatches?: boolean | null },
): boolean {
  if (!verdict.onSubject || !verdict.clear || !verdict.fits) return false;
  if (verdict.kindMatches === false) return false;
  if (brief.mustShow.length === 0) return true;
  // Items taken from the writer's request are the things the slide's words name (the sheep AND
  // the lamb), so every one must be in view; a parts list needs one. A real thing's archive
  // photograph (1923 Germany, a staging of The Tempest) is right with one item in view.
  const need = brief.request && !brief.specific ? brief.mustShow.length : 1;
  return itemsSeen(brief, verdict).length >= need;
}

async function searchPortraits(
  images: PhotoPlacer,
  query: string,
  signal: AbortSignal,
): Promise<PhotoResult[] | "busy"> {
  try {
    const photos = await images.search(query, {
      orientation: "portrait",
      perPage: PER_PAGE,
      signal,
    });
    return photos.filter((candidate) => candidate.height > candidate.width);
  } catch (error) {
    if (error instanceof PexelsError && error.status === 429) return "busy";
    throw error;
  }
}

async function store(
  images: PhotoPlacer,
  photo: PhotoResult,
  brief: ImageBrief,
  evidence: PhotoEvidence,
): Promise<PlacedPhoto> {
  const stored = await images.store(photo, "slide");
  return {
    src: stored.url,
    alt: photo.alt || brief.subject,
    source: { ...stored.source, evidence },
    evidence,
  };
}

// ---------------------------------------------------------------------------------------------
// The writer planner's photo search (TEACH-251): base4's placement, used only through the picture
// director (`placeWriterPicture`). Objectives-first keeps `pickPhoto`, judge v7 and `gatePasses`.
// ---------------------------------------------------------------------------------------------

/** A Commons search as the director's stock path calls it. */
export type CommonsSearch = (
  query: string,
  opts: { perPage: number; signal: AbortSignal },
) => Promise<PhotoResult[]>;

/** The photo placer with Commons beside Pexels (ruling 139). */
export type DirectedPlacer = PhotoPlacer & { searchCommons?: CommonsSearch };

/** A placed photo with what its source says it shows and where the judge saw each item. */
export type DirectedPlacedPhoto = PlacedPhoto & {
  about?: string;
  boxes?: DirectedVerdict["boxes"];
};

type DirectedOutcome =
  | { outcome: "placed"; photo: DirectedPlacedPhoto; judged: Judged }
  | { outcome: "empty"; judged?: Judged }
  | { outcome: "busy" };

/**
 * `{ pick, visible (≤ 4), count, query }` plus reasoning share one cap: Luna spent 143 of 192
 * tokens reasoning on a six-photo pick, so 200 failed.
 */
const DIRECTED_JUDGE_TOKENS = 1500;
/** A Commons photo up to 3:2 landscape is kept: the slot crops to cover. */
const COMMONS_MAX_ASPECT = 1.5;
/** A Commons photo is kept when its crop to the zone keeps at least this share of it. */
const COMMONS_MIN_KEPT = 0.45;
const COMMONS_PER_PAGE = 20;

type PhotoSourceName = "pexels" | "commons";

/**
 * Whether a photo subject names a specific thing (ruling 139: Commons first): a capitalised word
 * after the first, or two capitalised words at the start.
 */
export function isSpecificSubject(subject: string): boolean {
  const words = subject.trim().split(/\s+/).filter(Boolean);
  const cap = (w: string | undefined) => w !== undefined && /^[A-Z][a-z'’-]*[a-z]/.test(w);
  if (cap(words[0]) && cap(words[1])) return true;
  return words.slice(1).some((w) => cap(w));
}

/** The subject as a thing, not a request: no "A photograph of" preamble, no clipped last word. */
export function plainSubject(subject: string, clipped = subject.length >= 60): string {
  let s = subject
    .trim()
    .replace(
      /^(?:an? |the )?(?:real |clear |close-up |colour )*(?:photograph|photo|picture|image)s? (?:of|showing) (?:an? |the )?/i,
      "",
    );
  if (clipped) s = s.replace(/\s+\S{1,3}$/, "");
  return s.trim() || subject.trim();
}

/** The Pexels orientation for a zone of `aspect` (width over height); portrait when unknown. */
export function orientationFor(aspect?: number): "portrait" | "landscape" | "square" {
  if (aspect === undefined) return "portrait";
  return aspect < 0.92 ? "portrait" : aspect > 1.08 ? "landscape" : "square";
}

/** The centred crop of a photo to `aspect`, and the share of the photo it keeps. */
export function cropToAspect(width: number, height: number, aspect: number) {
  const w = Math.min(width, height * aspect);
  const h = w / aspect;
  return { x: (width - w) / 2, y: (height - h) / 2, w, h, kept: (w * h) / (width * height) };
}

/** The director's gate needs every item only for a generic request with several items. */
function itemsSeenDirected(
  brief: Pick<ImageBrief, "mustShow">,
  verdict: Pick<DirectedVerdict, "visible">,
): string[] {
  const seen = new Set(verdict.visible.map(normaliseItem));
  return brief.mustShow.filter((item) => seen.has(normaliseItem(item)));
}

/**
 * One photo slot for the picture director: queries (named thing, director's searches, the lesson
 * title for a real subject, fact hints, the subject), Commons first for a specific subject with
 * Pexels as the fallback (a Commons error or busy reply, on the first search or the requery,
 * never fails the slot), the shortlist with each query's first hit, judge v17 over the source
 * records, `directedGatePasses`. Throws only a budget stop or an abort.
 */
export async function pickDirectedPhoto(args: {
  lesson: Lesson;
  index: number;
  brief: ImageBrief;
  slideBrief?: string;
  images: DirectedPlacer;
  deps: PipelineDeps;
  /** Pages already placed in this lesson: a photo is never placed twice. */
  taken?: Set<string>;
  /** A library picture made for an earlier request, judged against this one. */
  reuse?: boolean;
}): Promise<DirectedOutcome> {
  const brief = { ...args.brief, subject: plainSubject(args.brief.subject) };
  const { images, deps, index, lesson } = args;
  const taken = args.taken ?? new Set<string>();
  const fresh = (photos: PhotoResult[]) => photos.filter((photo) => !taken.has(photo.pageUrl));
  const candidates: PhotoResult[] = [];
  const tried: string[] = [];
  const topHits: PhotoResult[] = [];
  const real = brief.specific ?? isSpecificSubject(brief.subject);
  const queries = [
    ...(brief.named ? [brief.named] : []),
    ...(brief.queries ?? []),
    ...(real && lesson.title ? queryCandidates({ subject: lesson.title }) : []),
    ...factQueryHints(lesson, index),
    ...queryCandidates(brief),
  ].filter((q, i, all) => all.indexOf(q) === i);
  const search = (query: string, source: PhotoSourceName) =>
    searchDirected(images, query, deps.signal, source, brief.aspect);
  const gather = async (source: PhotoSourceName): Promise<"busy" | undefined> => {
    for (const query of queries) {
      if (candidates.length >= MAX_CANDIDATES) break;
      // Safety (TEACH-162): a blocked candidate searches nothing.
      if (isBlockedQuery(query)) {
        deps.logger.info({ stage: "illustrate", slideIndex: index, blocked: true });
        continue;
      }
      if (!tried.includes(query)) tried.push(query);
      const photos = await search(query, source);
      if (photos === "busy") return "busy";
      let kept = 0;
      for (const photo of fresh(photos)) {
        if (candidates.length >= MAX_CANDIDATES || kept >= PER_QUERY) break;
        if (candidates.some((seen) => seen.id === photo.id)) continue;
        if (kept === 0) topHits.push(photo);
        candidates.push(photo);
        kept += 1;
      }
    }
    return undefined;
  };
  // Ruling 139: a named, specific subject searches Commons first and falls back to Pexels.
  const commonsFirst = images.searchCommons !== undefined && real;
  let source: PhotoSourceName = commonsFirst ? "commons" : "pexels";
  if (commonsFirst) {
    const got = await gather("commons").catch((error) => {
      rethrowStop(error);
      deps.logger.warn({ stage: "illustrate", slideIndex: index, commons: "failed" });
      return "busy" as const;
    });
    if (got === "busy" || candidates.length === 0) source = "pexels";
  }
  if (source === "pexels" && candidates.length === 0) {
    if ((await gather("pexels")) === "busy") return { outcome: "busy" };
  }
  deps.logger.info({
    stage: "illustrate",
    slideIndex: index,
    source,
    commonsFirst,
    candidates: candidates.length,
  });
  if (tried.length === 0) return { outcome: "empty" };

  const placeArgs: PlaceArgs = {
    lesson,
    slide: undefined,
    slideBrief: args.slideBrief,
    brief,
    images,
    deps,
    index,
  };
  let pool = candidates;
  for (let round = 0; round < MAX_JUDGE_CALLS; round++) {
    const listed = await shortlistDirected(placeArgs, pool);
    const shortlisted =
      round === 0
        ? [...listed, ...topHits.filter((t) => !listed.some((c) => c.id === t.id))].slice(
            0,
            SHORTLIST_MAX + 3,
          )
        : listed;
    deps.logger.info({
      stage: "illustrate",
      slideIndex: index,
      pool: pool.length,
      shortlisted: listed.length,
      topHits: shortlisted.length - listed.length,
    });
    // No caption names the subject: nothing to pick (no photo beats a wrong one). The judge is
    // still asked, with no candidates, for one new search; on the last round there is none left.
    const unlisted = pool.length > 0 && shortlisted.length === 0;
    if (unlisted && round === MAX_JUDGE_CALLS - 1) return { outcome: "empty", judged: "none" };
    const verdict = await judgeDirected(placeArgs, shortlisted, tried, args.reuse);
    deps.logger.info({
      stage: "illustrate",
      slideIndex: index,
      verdict: {
        pick: verdict.pick,
        onSubject: verdict.onSubject,
        clear: verdict.clear,
        fits: verdict.fits,
        visible: verdict.visible,
        why: verdict.why,
      },
      shown: shortlisted.map((c) => ({ id: c.id, alt: c.alt.slice(0, 120) })),
    });
    // Only a photograph the judge was shown, and no other slide placed meanwhile, is placed.
    const picked = verdict.pick
      ? fresh(shortlisted).find((candidate) => candidate.id === verdict.pick)
      : undefined;
    if (picked && directedGatePasses(brief, verdict)) {
      const evidence: PhotoEvidence = {
        visible: verdict.visible,
        count: verdict.count ?? "one",
        alt: picked.alt,
        promptVersion: directedJudgePrompt.version,
        thumbnail: picked.src.tiny,
      };
      taken.add(picked.pageUrl);
      const placed = await store(images, picked, brief, evidence);
      const withAbout: DirectedPlacedPhoto = { ...placed, about: picked.about || picked.alt };
      return {
        outcome: "placed",
        photo: verdict.boxes.length ? { ...withAbout, boxes: verdict.boxes } : withAbout,
        judged: round === 0 ? "pick" : "query",
      };
    }
    if (picked) {
      deps.logger.info({
        stage: "illustrate",
        slideIndex: index,
        gated: true,
        nextCandidate: round < MAX_JUDGE_CALLS - 1 && shortlisted.length > 1,
        offSubject: !verdict.onSubject,
        unclear: !verdict.clear,
        noneVisible: brief.mustShow.length > 0 && itemsSeenDirected(brief, verdict).length === 0,
      });
    }
    // A pick the gate refused with no better search offered is struck off, and the judge looks
    // again at the rest.
    if (picked && !verdict.query && round < MAX_JUDGE_CALLS - 1) {
      const rest = pool.filter((candidate) => candidate.id !== picked.id);
      if (shortlisted.some((candidate) => candidate.id !== picked.id)) {
        pool = rest;
        continue;
      }
    }
    const requery = verdict.query;
    if (!requery || round === MAX_JUDGE_CALLS - 1) return { outcome: "empty", judged: "none" };
    if (tried.some((query) => normaliseQuery(query) === normaliseQuery(requery))) {
      deps.logger.info({ stage: "illustrate", slideIndex: index, repeatedQuery: true });
      return { outcome: "empty", judged: "query" };
    }
    if (isBlockedQuery(requery)) {
      deps.logger.info({ stage: "illustrate", slideIndex: index, blocked: true });
      return { outcome: "empty", judged: "query" };
    }
    tried.push(requery);
    // Commons failing during the requery falls back to Pexels (the old spike failed the slide).
    let photos: PhotoResult[] | "busy" | undefined;
    if (source === "commons") {
      photos = await search(requery, "commons").catch((error) => {
        rethrowStop(error);
        deps.logger.warn({ stage: "illustrate", slideIndex: index, commons: "requery-failed" });
        return undefined;
      });
      if (photos === undefined || photos === "busy") source = "pexels";
    }
    if (source === "pexels") photos = await search(requery, "pexels");
    if (photos === "busy") return { outcome: "busy" };
    const unseen = fresh(photos ?? []);
    if (unseen.length === 0) return { outcome: "empty", judged: "query" };
    pool = unseen.slice(0, MAX_CANDIDATES);
  }
  return { outcome: "empty", judged: "none" };
}

function rethrowStop(error: unknown): void {
  if (error instanceof BudgetExceeded) throw error;
  if (error instanceof Error && error.name === "AbortError") throw error;
}

async function searchDirected(
  images: DirectedPlacer,
  query: string,
  signal: AbortSignal,
  source: PhotoSourceName,
  aspect?: number,
): Promise<PhotoResult[] | "busy"> {
  if (source === "commons" && images.searchCommons) {
    const photos = await images.searchCommons(query, { perPage: COMMONS_PER_PAGE, signal });
    // With the zone's shape known (ruling 158), a photo is kept when its crop keeps most of it.
    if (aspect !== undefined)
      return photos.filter((c) => cropToAspect(c.width, c.height, aspect).kept >= COMMONS_MIN_KEPT);
    return photos.filter((c) => c.width <= c.height * COMMONS_MAX_ASPECT);
  }
  try {
    const orientation = orientationFor(aspect);
    const photos = await images.search(query, { orientation, perPage: PER_PAGE, signal });
    return photos.filter((c) =>
      orientation === "portrait"
        ? c.height > c.width
        : orientation === "landscape"
          ? c.width > c.height
          : c.width <= c.height * 1.25 && c.height <= c.width * 1.25,
    );
  } catch (error) {
    if (error instanceof PexelsError && error.status === 429) return "busy";
    throw error;
  }
}

/** The shortlist over the source records (Commons: title, description, date, categories). */
async function shortlistDirected(args: PlaceArgs, pool: PhotoResult[]): Promise<PhotoResult[]> {
  const { lesson, brief, deps } = args;
  if (pool.length <= SHORTLIST_MAX) return pool;
  try {
    const call = await callStructured({
      deps,
      stage: "illustrate",
      cls: "small",
      effort: "low",
      prompt: shortlistPhotosPrompt,
      input: {
        topic: lesson.brief?.topic ?? lesson.title,
        subject: brief.request ?? brief.subject,
        mustShow: brief.mustShow,
        purpose: brief.purpose,
        avoid: brief.avoid,
        candidates: pool.map((c) => ({ id: c.id, alt: (c.about ?? c.alt).slice(0, 400) })),
      },
      schema: shortlistSchemaFor(pool.map((c) => c.id)),
      maxOutputTokens: MAX_OUTPUT_TOKENS.shortlist,
    });
    const byId = new Map(pool.map((c) => [c.id, c]));
    return call.output.ids.flatMap((id) => {
      const c = byId.get(id);
      return c ? [c] : [];
    });
  } catch (error) {
    rethrowStop(error);
    deps.logger.info(
      { stage: "illustrate", slideIndex: args.index, err: error },
      "shortlist failed",
    );
    return firstFew(pool);
  }
}

/** Judge v17 over `pool`: thumbnails as image parts, each candidate's source record as text. */
async function judgeDirected(
  args: PlaceArgs,
  pool: PhotoResult[],
  tried: string[],
  reuse?: boolean,
): Promise<DirectedVerdict> {
  const { lesson, slide, brief, deps } = args;
  const facts = lesson.facts;
  const call = await callStructured({
    deps,
    stage: "illustrate",
    cls: "standard",
    effort: "low",
    prompt: directedJudgePrompt,
    input: {
      topic: lesson.brief?.topic ?? lesson.title,
      answers: lesson.brief?.answers,
      lessonTitle: lesson.title,
      audience: audienceOf(lesson),
      objectives: facts?.objectives.map((o) => o.text) ?? [],
      vocabulary: facts?.vocabulary.map((v) => v.term) ?? [],
      slideBrief: args.slideBrief ?? (slide ? slideText(slide) : brief.subject),
      subject: brief.request ?? brief.subject,
      mustShow: brief.mustShow,
      needAll: !!brief.request && !brief.specific && brief.mustShow.length > 1,
      ...(brief.period ? { period: brief.period } : {}),
      ...(reuse ? { reuse: true } : {}),
      purpose: brief.purpose,
      avoid: brief.avoid,
      queries: tried,
      candidates: pool.map((c) => ({
        id: c.id,
        alt: (c.about ?? c.alt).slice(0, 400),
        thumbnail: c.src.tiny,
      })),
    },
    schema: directedJudgeSchemaFor(brief),
    maxOutputTokens: DIRECTED_JUDGE_TOKENS,
    images: pool.map((c) => ({ id: c.id, url: c.src.tiny })),
  });
  return call.output;
}
