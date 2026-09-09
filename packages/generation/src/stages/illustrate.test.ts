import { describe, expect, test } from "bun:test";
import { createFakeAi } from "@tj/ai/testing";
import type { ImageBrief, Lesson } from "@tj/domain/documents";
import { PexelsError, type PhotoResult, type StoredPhoto } from "@tj/images";
import {
  type MaterialiseMeta,
  materialiseSlide,
  PLACEHOLDER_IMAGE,
  SlideSpecSchema,
} from "@tj/slides";
import { recordingDeps, SAMPLE_JOB_ID, sampleBriefLesson } from "../testing";
import type { PhotoPlacer } from "../types";
import { illustrate } from "./illustrate";

const meta: MaterialiseMeta = {
  promptVersion: "generate-slide.v3",
  model: "test",
  at: "2026-09-08T10:00:00.000Z",
};

function pexelsPhoto(id: string, portrait: boolean): PhotoResult {
  return {
    id,
    width: portrait ? 4000 : 6000,
    height: portrait ? 6000 : 4000,
    alt: `Photo ${id}`,
    photographer: "Ada",
    photographerUrl: "https://www.pexels.com/@ada/",
    pageUrl: `https://www.pexels.com/photo/${id}/`,
    src: {
      large: `https://images.pexels.com/photos/${id}/large.jpeg`,
      medium: `https://images.pexels.com/photos/${id}/medium.jpeg`,
      tiny: `https://images.pexels.com/photos/${id}/tiny.jpeg`,
    },
  };
}

function storedFor(photo: PhotoResult): StoredPhoto {
  return {
    key: `ws/images/${photo.id}.jpg`,
    url: `/files/ws/images/${photo.id}.jpg`,
    width: photo.width,
    height: photo.height,
    bytes: 100,
    contentType: "image/jpeg",
    source: {
      provider: "pexels",
      id: photo.id,
      pageUrl: photo.pageUrl,
      photographer: photo.photographer,
      photographerUrl: photo.photographerUrl,
    },
  };
}

function fakeImages(
  searchImpl: (query: string) => Promise<PhotoResult[]>,
  storeImpl: (photo: PhotoResult) => Promise<StoredPhoto> = async (photo) => storedFor(photo),
): { images: PhotoPlacer; searches: string[]; stores: string[] } {
  const searches: string[] = [];
  const stores: string[] = [];
  return {
    searches,
    stores,
    images: {
      search: async (query, _opts) => {
        searches.push(query);
        return searchImpl(query);
      },
      store: async (photo, _target) => {
        stores.push(photo.id);
        return storeImpl(photo);
      },
    },
  };
}

/** One image-text slide per brief (`null` = a content slide), outlines aligned by index. */
function imageLesson(briefs: (ImageBrief | null)[]): Lesson {
  const base = sampleBriefLesson();
  let n = 0;
  const ids = () => `e${++n}`;
  const slides = briefs.map((brief, i) => {
    if (brief === null) {
      return materialiseSlide(
        SlideSpecSchema.parse({
          kind: "content",
          factRefs: [],
          heading: `Heading ${i}`,
          body: "Some body copy.",
        }),
        "chalk",
        meta,
        ids,
      );
    }
    return materialiseSlide(
      SlideSpecSchema.parse({
        kind: "image-text",
        factRefs: [],
        heading: `Heading ${i}`,
        body: "Some body copy.",
      }),
      "chalk",
      meta,
      ids,
    );
  });
  return {
    ...base,
    slides,
    facts: {
      objectives: [],
      vocabulary: [],
      workedExamples: [],
      questions: [],
      misconceptions: [],
      outline: briefs.map((brief, i) => ({
        id: `s${i + 1}`,
        kind: (brief === null ? "content" : "image-text") as "content" | "image-text",
        minutes: 5,
        factRefs: [],
        ...(brief === null ? {} : { imageBrief: brief }),
      })),
      durationMin: 60,
    },
    generation: {
      jobId: SAMPLE_JOB_ID,
      stage: "generated",
      startedAt: "2026-09-08T10:00:00.000Z",
      promptVersions: {},
      usage: { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: null },
      findings: [],
    },
  };
}

function imageOf(lesson: Lesson, index: number) {
  const element = lesson.slides[index]?.elements.find((el) => el.type === "image");
  if (element?.type !== "image") throw new Error("no image element");
  return element;
}

describe("illustrate", () => {
  test("places the first portrait photo and patches src, alt and source", async () => {
    const portrait = pexelsPhoto("p1", true);
    const { images, searches, stores } = fakeImages(async () => [
      pexelsPhoto("l1", false),
      portrait,
    ]);
    const deps = recordingDeps(fakeAi(), { images });
    const lesson = imageLesson([{ subject: "river severn dawn" }]);
    const state = await illustrate({ lesson, worksheetId: "w", worksheet: undefined }, deps);

    expect(searches).toEqual(["river severn dawn"]);
    expect(stores).toEqual(["p1"]);
    const element = imageOf(state.lesson, 0);
    expect(element.src).toBe("/files/ws/images/p1.jpg");
    expect(element.alt).toBe("Photo p1");
    expect(element.source).toEqual(storedFor(portrait).source);
    expect(element.authoredBy).toBe("ai");
    expect(element.generatedFrom).toBeDefined();
    expect(deps.persisted).toHaveLength(1);
    expect(deps.imageCounts).toEqual({ requested: 1, placed: 1, empty: 0, failed: 0 });
    const progress = deps.progress[deps.progress.length - 1];
    expect(progress?.message).toBe("Pictures placed");
  });

  test("falls back to alt text and retries with the dropped word", async () => {
    const calls: string[] = [];
    const photo = { ...pexelsPhoto("p2", true), alt: "" };
    const { images } = fakeImages(async (query) => {
      calls.push(query);
      return query === "river severn" ? [photo] : [];
    });
    const retrying: PhotoPlacer = {
      search: images.search,
      store: async () => storedFor(photo),
    };
    const deps = recordingDeps(fakeAi(), { images: retrying });
    const state = await illustrate(
      {
        lesson: imageLesson([{ subject: "river severn dawn" }]),
        worksheetId: "w",
        worksheet: undefined,
      },
      deps,
    );
    expect(calls).toEqual(["river severn dawn", "river severn"]);
    expect(imageOf(state.lesson, 0).alt).toBe("river severn dawn");
  });

  test("no result keeps the placeholder and records a warning", async () => {
    const { images } = fakeImages(async () => []);
    const deps = recordingDeps(fakeAi(), { images });
    const lesson = imageLesson([{ subject: "nothing anywhere" }]);
    const state = await illustrate({ lesson, worksheetId: "w", worksheet: undefined }, deps);

    expect(imageOf(state.lesson, 0).src).toBe(PLACEHOLDER_IMAGE);
    const findings = state.lesson.generation?.findings ?? [];
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      check: "image",
      severity: "warning",
      target: { slideId: lesson.slides[0]?.id, elementId: imageOf(lesson, 0).id },
    });
    expect(deps.imageCounts).toEqual({ requested: 1, placed: 0, empty: 1, failed: 0 });
  });

  test("landscape-only results count as empty", async () => {
    const { images } = fakeImages(async () => [pexelsPhoto("l1", false)]);
    const deps = recordingDeps(fakeAi(), { images });
    const state = await illustrate(
      { lesson: imageLesson([{ subject: "river" }]), worksheetId: "w", worksheet: undefined },
      deps,
    );
    expect(imageOf(state.lesson, 0).src).toBe(PLACEHOLDER_IMAGE);
    expect(deps.imageCounts?.empty).toBe(1);
  });

  test("a 429 stops searching and warns every remaining slide", async () => {
    const { images, searches } = fakeImages(async () => {
      throw new PexelsError(429, "slow");
    });
    const deps = recordingDeps(fakeAi(), { images });
    const lesson = imageLesson([{ subject: "river" }, { subject: "mountain" }]);
    const state = await illustrate({ lesson, worksheetId: "w", worksheet: undefined }, deps);

    expect(searches).toHaveLength(1);
    const findings = state.lesson.generation?.findings ?? [];
    expect(findings).toHaveLength(2);
    for (const finding of findings) {
      expect(finding.check).toBe("image");
      expect(finding.message).toContain("busy");
    }
    expect(imageOf(state.lesson, 0).src).toBe(PLACEHOLDER_IMAGE);
    expect(imageOf(state.lesson, 1).src).toBe(PLACEHOLDER_IMAGE);
  });

  test("a failed store counts failed and the next slide still places", async () => {
    const { images } = fakeImages(
      async () => [pexelsPhoto("p", true)],
      async (photo) => {
        if (photo.id === "a") throw new Error("disk full");
        return storedFor(photo);
      },
    );
    const searching: PhotoPlacer = {
      search: async (query) =>
        query.includes("first") ? [pexelsPhoto("a", true)] : [pexelsPhoto("b", true)],
      store: images.store,
    };
    const deps = recordingDeps(fakeAi(), { images: searching });
    const state = await illustrate(
      {
        lesson: imageLesson([{ subject: "first thing" }, { subject: "second thing" }]),
        worksheetId: "w",
        worksheet: undefined,
      },
      deps,
    );
    expect(imageOf(state.lesson, 0).src).toBe(PLACEHOLDER_IMAGE);
    expect(imageOf(state.lesson, 1).src).toBe("/files/ws/images/b.jpg");
    expect(deps.imageCounts).toEqual({ requested: 2, placed: 1, empty: 0, failed: 1 });
  });

  test("without images the state returns unchanged and nothing persists", async () => {
    const deps = recordingDeps(fakeAi());
    const lesson = imageLesson([{ subject: "river" }]);
    const state = await illustrate({ lesson, worksheetId: "w", worksheet: undefined }, deps);
    expect(state.lesson).toBe(lesson);
    expect(deps.persisted).toHaveLength(0);
    expect(deps.progress).toHaveLength(0);
  });

  test("an aborted signal throws AbortError", async () => {
    const { images } = fakeImages(async () => [pexelsPhoto("p", true)]);
    const deps = recordingDeps(fakeAi(), { images });
    deps.abort.abort(new DOMException("cancelled", "AbortError"));
    await expect(
      illustrate(
        { lesson: imageLesson([{ subject: "river" }]), worksheetId: "w", worksheet: undefined },
        deps,
      ),
    ).rejects.toThrowError(DOMException);
  });
});

function fakeAi() {
  return createFakeAi({ script: [], usage: { inputTokens: 0, outputTokens: 0 } });
}
