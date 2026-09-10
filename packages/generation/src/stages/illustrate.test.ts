import { describe, expect, test } from "bun:test";
import { createFakeAi, type FakeScriptEntry } from "@tj/ai/testing";
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
  promptVersion: "generate-slide.v4",
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
/** A plan-time brief: `mustShow`/`purpose` take the schema defaults (TEACH-211). */
type BriefInput = {
  subject: string;
  mustShow?: string | string[];
  purpose?: ImageBrief["purpose"];
};
const brief = (b: BriefInput): ImageBrief => ({
  subject: b.subject,
  mustShow: b.mustShow === undefined ? [] : Array.isArray(b.mustShow) ? b.mustShow : [b.mustShow],
  purpose: b.purpose ?? "context",
});

function imageLesson(inputs: (BriefInput | null)[]): Lesson {
  const base = sampleBriefLesson();
  let n = 0;
  const ids = () => `e${++n}`;
  const slides = inputs.map((b, i) => {
    if (b === null) {
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
      outline: inputs.map((b, i) => ({
        id: `s${i + 1}`,
        kind: (b === null ? "content" : "image-text") as "content" | "image-text",
        minutes: 5,
        factRefs: [],
        ...(b === null ? {} : { imageBrief: brief(b) }),
      })),
      durationMin: 60,
    },
    generation: {
      jobId: SAMPLE_JOB_ID,
      stage: "generated",
      startedAt: "2026-09-08T10:00:00.000Z",
      promptVersions: { generated: "generate-slide.v4" },
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

/** The judge's answers in call order; `pick(id)`, `requery(q)` and `NONE` build them. */
function judge(...answers: FakeScriptEntry[]) {
  return createFakeAi({ script: answers, usage: { inputTokens: 40, outputTokens: 8 } });
}
const pick = (id: string) => JSON.stringify({ pick: id, query: null });
const requery = (query: string) => JSON.stringify({ pick: null, query });
const NONE = JSON.stringify({ pick: null, query: null });
const run = (lesson: Lesson, deps: ReturnType<typeof recordingDeps>) =>
  illustrate({ lesson, worksheetId: "w", worksheet: undefined }, deps);

describe("illustrate", () => {
  test("the judge's pick is stored, not the first result", async () => {
    const first = pexelsPhoto("p1", true);
    const second = pexelsPhoto("p2", true);
    const { images, searches, stores } = fakeImages(async () => [
      pexelsPhoto("l1", false),
      first,
      second,
    ]);
    const ai = judge(pick("p2"));
    const deps = recordingDeps(ai, { images });
    const state = await run(imageLesson([{ subject: "river severn dawn" }]), deps);

    // Both query candidates are searched to gather the pool; one judge call sees both portraits.
    expect(searches).toEqual(["river severn dawn", "river severn"]);
    expect(stores).toEqual(["p2"]);
    expect(ai.calls).toHaveLength(1);
    expect(ai.calls[0]?.context?.stage).toBe("illustrate");
    expect(ai.calls[0]?.promptText).toContain("p1");
    expect(ai.calls[0]?.promptText).not.toContain("l1");
    const element = imageOf(state.lesson, 0);
    expect(element.src).toBe("/files/ws/images/p2.jpg");
    expect(element.alt).toBe("Photo p2");
    expect(element.source).toEqual(storedFor(second).source);
    expect(element.authoredBy).toBe("ai");
    expect(deps.persisted).toHaveLength(1);
    expect(deps.imageCounts).toEqual({ requested: 1, placed: 1, empty: 0, failed: 0 });
    expect(deps.progress.at(-1)?.message).toBe("Pictures placed");
    expect(state.lesson.generation?.promptVersions.generated).toContain("pick-or-requery-photo.v2");
    expect(state.lesson.generation?.usage.calls).toBe(1);
  });

  test("the judge sees the lesson context, not just the slide", async () => {
    const { images } = fakeImages(async () => [pexelsPhoto("p", true)]);
    const ai = judge(pick("p"));
    const lesson = imageLesson([{ subject: "rodent incisors", mustShow: "front teeth" }]);
    lesson.brief = { topic: "Rodents and their teeth", durationMin: 60, answers: { q1: "Year 7" } };
    await run(lesson, recordingDeps(ai, { images }));
    const prompt = ai.calls[0]?.promptText ?? "";
    expect(prompt).toContain("Rodents and their teeth");
    expect(prompt).toContain("Year 7");
    expect(prompt).toContain("rodent incisors");
    expect(prompt).toContain("front teeth");
    expect(prompt).toContain("Heading 0");
  });

  test("a requery searches once more and stores its first portrait", async () => {
    const dental = { ...pexelsPhoto("d", true), alt: "Hands holding human teeth" };
    const rodent = pexelsPhoto("r", true);
    const { images, searches, stores } = fakeImages(async (query) =>
      query === "beaver gnawing wood" ? [pexelsPhoto("l", false), rodent] : [dental],
    );
    const ai = judge(requery("beaver gnawing wood"));
    const deps = recordingDeps(ai, { images });
    const state = await run(imageLesson([{ subject: "rodent teeth" }]), deps);

    expect(searches).toEqual(["rodent teeth", "rodent", "beaver gnawing wood"]);
    expect(stores).toEqual(["r"]);
    expect(ai.calls).toHaveLength(1);
    expect(imageOf(state.lesson, 0).src).toBe("/files/ws/images/r.jpg");
    expect(deps.imageCounts).toEqual({ requested: 1, placed: 1, empty: 0, failed: 0 });
  });

  test("a requery with no portrait result is empty, never a third search", async () => {
    const { images, searches } = fakeImages(async (query) =>
      query === "second try" ? [] : [pexelsPhoto("x", true)],
    );
    const deps = recordingDeps(judge(requery("second try")), { images });
    const state = await run(imageLesson([{ subject: "river" }]), deps);
    expect(searches).toEqual(["river", "second try"]);
    expect(imageOf(state.lesson, 0).src).toBe(PLACEHOLDER_IMAGE);
    expect(state.lesson.generation?.findings).toHaveLength(1);
    expect(deps.imageCounts).toEqual({ requested: 1, placed: 0, empty: 1, failed: 0 });
  });

  test("a requery repeating a searched query is empty with no second search", async () => {
    const { images, searches } = fakeImages(async () => [pexelsPhoto("x", true)]);
    const deps = recordingDeps(judge(requery("River Severn!")), { images });
    const state = await run(imageLesson([{ subject: "river severn dawn" }]), deps);
    // Both candidates were searched; the judge's "new" query is the second one, re-punctuated.
    expect(searches).toEqual(["river severn dawn", "river severn"]);
    expect(imageOf(state.lesson, 0).src).toBe(PLACEHOLDER_IMAGE);
    expect(deps.imageCounts).toEqual({ requested: 1, placed: 0, empty: 1, failed: 0 });
  });

  test("the judge is told every query searched", async () => {
    const { images } = fakeImages(async () => [pexelsPhoto("x", true)]);
    const ai = judge(pick("x"));
    await run(imageLesson([{ subject: "river severn dawn" }]), recordingDeps(ai, { images }));
    expect(ai.calls[0]?.promptText).toContain("river severn dawn; river severn");
  });

  test("a blocklisted requery is empty with no second search", async () => {
    const { images, searches } = fakeImages(async () => [pexelsPhoto("x", true)]);
    const deps = recordingDeps(judge(requery("gore")), { images });
    const state = await run(imageLesson([{ subject: "river" }]), deps);
    expect(searches).toEqual(["river"]);
    expect(imageOf(state.lesson, 0).src).toBe(PLACEHOLDER_IMAGE);
    expect(deps.imageCounts).toEqual({ requested: 1, placed: 0, empty: 1, failed: 0 });
  });

  test("a judge that picks an id not in the pool falls back to its query, else empty", async () => {
    const { images, stores } = fakeImages(async () => [pexelsPhoto("x", true)]);
    const deps = recordingDeps(judge(JSON.stringify({ pick: "nope", query: null })), { images });
    const state = await run(imageLesson([{ subject: "river" }]), deps);
    expect(stores).toEqual([]);
    expect(imageOf(state.lesson, 0).src).toBe(PLACEHOLDER_IMAGE);
    expect(deps.imageCounts?.empty).toBe(1);
  });

  test("none keeps the placeholder, records a warning and persists the judge's usage", async () => {
    const { images, stores } = fakeImages(async () => [pexelsPhoto("d", true)]);
    const deps = recordingDeps(judge(NONE), { images });
    const lesson = imageLesson([{ subject: "nothing fits" }]);
    const state = await run(lesson, deps);

    expect(stores).toEqual([]);
    expect(imageOf(state.lesson, 0).src).toBe(PLACEHOLDER_IMAGE);
    const findings = state.lesson.generation?.findings ?? [];
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      check: "image",
      severity: "warning",
      target: { slideId: lesson.slides[0]?.id, elementId: imageOf(lesson, 0).id },
    });
    expect(deps.imageCounts).toEqual({ requested: 1, placed: 0, empty: 1, failed: 0 });
    expect(deps.persisted).toHaveLength(1);
    expect(state.lesson.generation?.usage.calls).toBe(1);
  });

  test("no portrait results still asks the judge, which may requery", async () => {
    const { images, searches } = fakeImages(async (query) =>
      query === "better" ? [pexelsPhoto("b", true)] : [pexelsPhoto("l1", false)],
    );
    const ai = judge(requery("better"));
    const deps = recordingDeps(ai, { images });
    const state = await run(imageLesson([{ subject: "river" }]), deps);
    expect(ai.calls[0]?.promptText).toContain("Results: none.");
    expect(searches).toEqual(["river", "better"]);
    expect(imageOf(state.lesson, 0).src).toBe("/files/ws/images/b.jpg");
  });

  test("a 429 stops searching and warns every remaining slide without a judge call", async () => {
    const { images, searches } = fakeImages(async () => {
      throw new PexelsError(429, "slow");
    });
    const ai = judge();
    const deps = recordingDeps(ai, { images });
    const state = await run(imageLesson([{ subject: "river" }, { subject: "mountain" }]), deps);

    expect(searches).toHaveLength(1);
    expect(ai.calls).toHaveLength(0);
    const findings = state.lesson.generation?.findings ?? [];
    expect(findings).toHaveLength(2);
    for (const finding of findings) expect(finding.message).toContain("busy");
    expect(imageOf(state.lesson, 0).src).toBe(PLACEHOLDER_IMAGE);
    expect(imageOf(state.lesson, 1).src).toBe(PLACEHOLDER_IMAGE);
  });

  test("a judge call that fails counts failed and the next slide still places", async () => {
    const { images } = fakeImages(async () => [pexelsPhoto("p", true)]);
    const ai = judge(() => {
      throw new Error("model down");
    }, pick("p"));
    const deps = recordingDeps(ai, { images });
    const state = await run(imageLesson([{ subject: "first" }, { subject: "second" }]), deps);
    expect(imageOf(state.lesson, 0).src).toBe(PLACEHOLDER_IMAGE);
    expect(imageOf(state.lesson, 1).src).toBe("/files/ws/images/p.jpg");
    expect(deps.imageCounts).toEqual({ requested: 2, placed: 1, empty: 0, failed: 1 });
  });

  test("a failed store counts failed and the next slide still places", async () => {
    const { images } = fakeImages(
      async (query) =>
        query.includes("first") ? [pexelsPhoto("a", true)] : [pexelsPhoto("b", true)],
      async (photo) => {
        if (photo.id === "a") throw new Error("disk full");
        return storedFor(photo);
      },
    );
    const deps = recordingDeps(judge(pick("a"), pick("b")), { images });
    const state = await run(
      imageLesson([{ subject: "first thing" }, { subject: "second thing" }]),
      deps,
    );
    expect(imageOf(state.lesson, 0).src).toBe(PLACEHOLDER_IMAGE);
    expect(imageOf(state.lesson, 1).src).toBe("/files/ws/images/b.jpg");
    expect(deps.imageCounts).toEqual({ requested: 2, placed: 1, empty: 0, failed: 1 });
  });

  test("an exhausted budget leaves every remaining placeholder and is not a failure", async () => {
    const { images, stores } = fakeImages(async () => [pexelsPhoto("p", true)]);
    const ai = judge(pick("p"), pick("p"));
    const deps = recordingDeps(ai, { images });
    deps.budget.exceeded = () => ({ by: "usd" });
    const state = await run(imageLesson([{ subject: "first" }, { subject: "second" }]), deps);
    expect(stores).toEqual([]);
    expect(ai.calls).toHaveLength(0);
    expect(imageOf(state.lesson, 0).src).toBe(PLACEHOLDER_IMAGE);
    expect(imageOf(state.lesson, 1).src).toBe(PLACEHOLDER_IMAGE);
    expect(deps.imageCounts).toEqual({ requested: 2, placed: 0, empty: 2, failed: 0 });
    expect(state.lesson.generation?.findings).toHaveLength(2);
  });

  test("a persist failure propagates instead of counting as failed", async () => {
    const { images } = fakeImages(async () => [pexelsPhoto("p", true)]);
    const deps = recordingDeps(judge(pick("p")), { images });
    const boom = new Error("lost lock");
    deps.persist = async () => {
      throw boom;
    };
    await expect(run(imageLesson([{ subject: "river" }]), deps)).rejects.toBe(boom);
    expect(deps.imageCounts).toEqual({ requested: 1, placed: 0, empty: 0, failed: 0 });
  });

  test("a blocked first candidate is skipped; the clean retry feeds the judge", async () => {
    const { images, searches } = fakeImages(async () => [pexelsPhoto("p", true)]);
    const deps = recordingDeps(judge(pick("p")), { images });
    const state = await run(imageLesson([{ subject: "river severn gore" }]), deps);
    expect(searches).toEqual(["river severn"]);
    expect(imageOf(state.lesson, 0).src).toBe("/files/ws/images/p.jpg");
  });

  test("fully blocked candidates search nothing, ask nothing and warn", async () => {
    const { images, searches } = fakeImages(async () => [pexelsPhoto("p", true)]);
    const ai = judge();
    const deps = recordingDeps(ai, { images });
    const state = await run(imageLesson([{ subject: "gore torture" }]), deps);
    expect(searches).toEqual([]);
    expect(ai.calls).toHaveLength(0);
    expect(imageOf(state.lesson, 0).src).toBe(PLACEHOLDER_IMAGE);
    expect(deps.imageCounts).toEqual({ requested: 1, placed: 0, empty: 1, failed: 0 });
  });

  test("without images the state returns unchanged and nothing persists", async () => {
    const deps = recordingDeps(judge());
    const lesson = imageLesson([{ subject: "river" }]);
    const state = await run(lesson, deps);
    expect(state.lesson).toBe(lesson);
    expect(deps.persisted).toHaveLength(0);
    expect(deps.progress).toHaveLength(0);
  });

  test("an aborted signal throws AbortError", async () => {
    const { images } = fakeImages(async () => [pexelsPhoto("p", true)]);
    const deps = recordingDeps(judge(pick("p")), { images });
    deps.abort.abort(new DOMException("cancelled", "AbortError"));
    await expect(run(imageLesson([{ subject: "river" }]), deps)).rejects.toThrowError(DOMException);
  });
});
