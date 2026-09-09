import type { Finding, ImageBrief, Lesson, SlideElement } from "@tj/domain/documents";
import {
  isBlockedQuery,
  normaliseQuery,
  PexelsError,
  type PhotoResult,
  queryCandidates,
} from "@tj/images";
import { PLACEHOLDER_IMAGE } from "@tj/slides";
import { callStructured } from "../call";
import { PickOrRequerySchema, pickOrRequeryPrompt } from "../prompts/pick-or-requery-photo";
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
const MAX_JUDGE_TOKENS = 120;

type Judged = "pick" | "query" | "none";

type PlaceOutcome =
  | { outcome: "placed"; element: SlideElement; judged: Judged }
  | { outcome: "empty"; judged?: Judged }
  | { outcome: "busy" };

function emptyFinding(slideId: string, elementId: string): Finding {
  return {
    check: "image",
    severity: "warning",
    target: { slideId, elementId },
    message: EMPTY_MESSAGE,
  };
}

function busyFinding(slideId: string, elementId: string): Finding {
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
  // A run reports its own counts; a second run with the same deps starts over.
  const counts = emptyImageCounts();
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
      placed = await placeOne({ lesson, slide, target, brief, images, deps, index });
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
                element.id === target.id ? placed.element : element,
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

function joinVersions(existing: string, added: string): string {
  return existing.split("+").includes(added) ? existing : `${existing}+${added}`;
}

type PlaceArgs = {
  lesson: Lesson;
  slide: Lesson["slides"][number];
  target: SlideElement & { type: "image" };
  brief: ImageBrief;
  images: PhotoPlacer;
  deps: PipelineDeps;
  index: number;
};

/**
 * One slide: portrait candidates gathered across the query candidates, then one judge call:
 * `pick` stores that candidate; `query` runs exactly one more (blocklist-checked) search and
 * stores its first portrait; neither leaves the placeholder. A 429 anywhere reports `busy` (the
 * caller stops searching for every remaining slide); a `BudgetExceeded` and any other failure
 * propagate for the caller to classify.
 */
async function placeOne(args: PlaceArgs): Promise<PlaceOutcome> {
  const { lesson, slide, target, brief, images, deps, index } = args;
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

  const facts = lesson.facts;
  const call = await callStructured({
    deps,
    stage: "illustrate",
    cls: "small",
    prompt: pickOrRequeryPrompt,
    input: {
      topic: lesson.brief?.topic ?? lesson.title,
      answers: lesson.brief?.answers,
      lessonTitle: lesson.title,
      audience: audienceOf(lesson),
      objectives: facts?.objectives.map((o) => o.text) ?? [],
      vocabulary: facts?.vocabulary.map((v) => v.term) ?? [],
      slideText: slideText(slide),
      subject: brief.subject,
      mustShow: brief.mustShow,
      queries: tried,
      candidates: candidates.map((c) => ({ id: c.id, alt: c.alt })),
    },
    schema: PickOrRequerySchema,
    maxOutputTokens: MAX_JUDGE_TOKENS,
  });

  const picked = call.output.pick
    ? candidates.find((candidate) => candidate.id === call.output.pick)
    : undefined;
  if (picked)
    return {
      outcome: "placed",
      element: await place(images, target, picked, brief),
      judged: "pick",
    };

  const requery = call.output.query;
  if (!requery) return { outcome: "empty", judged: "none" };
  // A repeat of a query already searched would return the pool the judge just rejected.
  if (tried.map(normaliseQuery).includes(normaliseQuery(requery))) {
    deps.logger.info({ stage: "illustrate", slideIndex: index, repeated: true });
    return { outcome: "empty", judged: "query" };
  }
  if (isBlockedQuery(requery)) {
    deps.logger.info({ stage: "illustrate", slideIndex: index, blocked: true });
    return { outcome: "empty", judged: "query" };
  }
  const photos = await searchPortraits(images, requery, deps.signal);
  if (photos === "busy") return { outcome: "busy" };
  const first = photos[0];
  if (!first) return { outcome: "empty", judged: "query" };
  return { outcome: "placed", element: await place(images, target, first, brief), judged: "query" };
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

async function place(
  images: PhotoPlacer,
  target: SlideElement & { type: "image" },
  photo: PhotoResult,
  brief: ImageBrief,
): Promise<SlideElement> {
  const stored = await images.store(photo, "slide");
  return { ...target, src: stored.url, alt: photo.alt || brief.subject, source: stored.source };
}
