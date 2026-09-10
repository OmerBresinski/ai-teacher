import type { Finding, ImageBrief, Lesson, PhotoSource, SlideElement } from "@tj/domain/documents";
import {
  isBlockedQuery,
  normaliseQuery,
  PexelsError,
  type PhotoResult,
  queryCandidates,
} from "@tj/images";
import { PLACEHOLDER_IMAGE } from "@tj/slides";
import { callStructured } from "../call";
import {
  normaliseItem,
  type PickOrRequery,
  pickOrRequeryPrompt,
  pickOrRequerySchemaFor,
} from "../prompts/pick-or-requery-photo";
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
/** Portrait hits gathered across the query candidates before the judge sees them. */
const MAX_CANDIDATES = 6;
/** The judge answers one id or a few words. */
/** `{ pick, visible (≤ 4), count, query }`: room for the list (TEACH-220). */
const MAX_JUDGE_TOKENS = 200;
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
          findings: [...baseFindings, ...findings],
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
    // After the persist: a lost lock must propagate, not read as a placed picture.
    const { updatedAt } = await deps.persist(snapshot());
    await deps.onProgress(PROGRESS_ILLUSTRATED, "Pictures placed", updatedAt);
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
async function placeOne(args: PlaceArgs): Promise<PlaceOutcome> {
  const { brief, images, deps, index } = args;
  const candidates: PhotoResult[] = [];
  /** Every query actually searched, so the judge is told all of them and never repeats one. */
  const tried: string[] = [];
  for (const query of queryCandidates(brief)) {
    if (candidates.length >= MAX_CANDIDATES) break;
    // Safety (TEACH-162): a blocked candidate searches nothing.
    if (isBlockedQuery(query)) {
      deps.logger.info({ stage: "illustrate", slideIndex: index, blocked: true });
      continue;
    }
    tried.push(query);
    const photos = await searchPortraits(images, query, deps.signal);
    if (photos === "busy") return { outcome: "busy" };
    for (const photo of photos) {
      if (candidates.length >= MAX_CANDIDATES) break;
      if (!candidates.some((seen) => seen.id === photo.id)) candidates.push(photo);
    }
  }
  // Every candidate query was blocked: nothing to judge, nothing to say.
  if (tried.length === 0) return { outcome: "empty" };

  // The judge looks at the candidates; the gate decides. A requery earns exactly one more judge
  // call over the new pool — its first result is never placed blind (TEACH-220).
  let pool = candidates;
  for (let round = 0; round < MAX_JUDGE_CALLS; round++) {
    const verdict = await judge(args, pool, tried);
    const picked = verdict.pick
      ? pool.find((candidate) => candidate.id === verdict.pick)
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
    if (picked) deps.logger.info({ stage: "illustrate", slideIndex: index, gated: true });
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

/** One judge call over `pool`: the thumbnails as image parts, the captions and brief as text. */
async function judge(
  args: PlaceArgs,
  pool: PhotoResult[],
  tried: string[],
): Promise<PickOrRequery> {
  const { lesson, slide, brief, deps } = args;
  const facts = lesson.facts;
  const call = await callStructured({
    deps,
    stage: "illustrate",
    cls: "small",
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
    maxOutputTokens: MAX_JUDGE_TOKENS,
    images: pool.map((c) => ({ id: c.id, url: c.src.tiny })),
  });
  return call.output;
}

/** The deterministic gate: every `mustShow` item is among what the judge saw. */
export function gatePasses(brief: Pick<ImageBrief, "mustShow">, verdict: PickOrRequery): boolean {
  const seen = new Set(verdict.visible.map(normaliseItem));
  return brief.mustShow.every((item) => seen.has(normaliseItem(item)));
}

async function searchPortraits(
  images: PhotoPlacer,
  query: string,
  signal: AbortSignal,
): Promise<PhotoResult[] | "busy"> {
  try {
    const photos = await images.search(query, { orientation: "portrait", perPage: 5, signal });
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
