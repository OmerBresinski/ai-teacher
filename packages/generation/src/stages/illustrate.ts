import type { Finding, ImageBrief, SlideElement } from "@tj/domain/documents";
import { PexelsError, type PhotoResult, queryCandidates } from "@tj/images";
import { PLACEHOLDER_IMAGE } from "@tj/slides";
import {
  emptyImageCounts,
  type PhotoPlacer,
  type PipelineDeps,
  type PipelineState,
  throwIfAborted,
} from "../types";
import { generationOf } from "./shared";

/** Between Generate's last (85) and Evaluate's first (90). */
export const PROGRESS_ILLUSTRATED = 88;

const EMPTY_MESSAGE = "No photograph was found for this slide. Add one from the image panel.";
const BUSY_MESSAGE = "Photo search was busy; add a picture from the image panel.";

type PlaceOutcome =
  | { outcome: "placed"; element: SlideElement }
  | { outcome: "empty" }
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
 * Deterministic illustration (Images project): after Generate, one Pexels photograph per
 * `image-text` slide with a brief. No model call, no checkpoint — cheap and idempotent (a slide
 * whose slot is already filled is skipped, so a resume never re-places). A slide the step cannot
 * fill keeps the recipe's placeholder: never a wrong picture.
 */
export async function illustrate(state: PipelineState, deps: PipelineDeps): Promise<PipelineState> {
  const images = deps.images;
  if (!images) {
    deps.logger.info({ stage: "illustrate" }, "images disabled");
    return state;
  }
  if (!deps.imageCounts) deps.imageCounts = emptyImageCounts();
  const counts = deps.imageCounts;
  const outline = state.lesson.facts?.outline ?? [];
  let lesson = state.lesson;
  const findings: Finding[] = [...generationOf(lesson).findings];
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
    try {
      const placed = await placeOne(target, brief, images, deps.signal);
      if (placed.outcome === "busy") {
        busy = true;
        findings.push(busyFinding(slide.id, target.id));
        counts.empty += 1;
        continue;
      }
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
      counts.placed += 1;
      const { updatedAt } = await deps.persist(lesson);
      await deps.onProgress(PROGRESS_ILLUSTRATED, "Pictures placed", updatedAt);
    } catch (error) {
      deps.logger.info({ stage: "illustrate", slideIndex: index, err: error }, "illustrate failed");
      counts.failed += 1;
    }
  }
  // Warnings with nothing placed still have to reach the database; placements were persisted
  // as they landed (row 14: what was written stays), so this fires only for warnings-only runs.
  if (counts.placed === 0 && findings.length > generationOf(lesson).findings.length) {
    lesson = { ...lesson, generation: { ...generationOf(lesson), findings } };
    await deps.persist(lesson);
  } else if (findings.length > generationOf(lesson).findings.length) {
    lesson = { ...lesson, generation: { ...generationOf(lesson), findings } };
  }
  return { ...state, lesson };
}

/**
 * One slide: each query candidate in order, the first portrait photo wins and is stored.
 * A 429 reports `busy` (the caller stops searching for every remaining slide); any other
 * failure throws for the caller to count as `failed`.
 */
async function placeOne(
  target: SlideElement & { type: "image" },
  brief: ImageBrief,
  images: PhotoPlacer,
  signal: AbortSignal,
): Promise<PlaceOutcome> {
  for (const query of queryCandidates(brief)) {
    let photos: PhotoResult[];
    try {
      photos = await images.search(query, { orientation: "portrait", perPage: 5, signal });
    } catch (error) {
      if (error instanceof PexelsError && error.status === 429) return { outcome: "busy" };
      throw error;
    }
    const photo = photos.find((candidate) => candidate.height > candidate.width);
    if (!photo) continue;
    const stored = await images.store(photo, "slide");
    return {
      outcome: "placed",
      element: {
        ...target,
        src: stored.url,
        alt: photo.alt || brief.subject,
        source: stored.source,
      },
    };
  }
  return { outcome: "empty" };
}
