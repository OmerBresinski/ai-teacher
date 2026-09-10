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
import { memoryLogger, recordingDeps, SAMPLE_JOB_ID, sampleBriefLesson } from "../testing";
import type { PhotoPlacer } from "../types";
import { illustrate } from "./illustrate";

const meta: MaterialiseMeta = {
  promptVersion: "generate-slide.v4",
  model: "test",
  at: "2026-09-08T10:00:00.000Z",
};

/** A 1×1 PNG, the thumbnail every fake photo carries. */
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

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
      // A data URL: the SDK fetches https images in-process before the call, which a test must not.
      tiny: `data:image/png;base64,${PNG}`,
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
/** A pick that passes the gate for a brief with the given `mustShow` (none by default). */
const pick = (id: string, visible: string[] = [], count: "one" | "several" = "one") =>
  JSON.stringify({ pick: id, onSubject: true, clear: true, visible, count, query: null });
const requery = (query: string) => JSON.stringify({ pick: null, visible: [], count: null, query });
const NONE = JSON.stringify({ pick: null, visible: [], count: null, query: null });
const run = (lesson: Lesson, deps: ReturnType<typeof recordingDeps>) =>
  illustrate({ lesson, worksheetId: "w", worksheet: undefined }, deps);

describe("illustrate", () => {
  test("the judge may omit the fields it has nothing to say for (the shapes Luna sends in production)", async () => {
    // A pick without `query`; a requery without `pick`/`count`/`visible`. Both were rejected by a
    // strict schema on 2026-09-10 and no photo was ever placed.
    const { images, stores } = fakeImages(async (query) =>
      query === "beaver gnawing" ? [pexelsPhoto("r", true)] : [pexelsPhoto("d", true)],
    );
    const ai = judge(
      JSON.stringify({ query: "beaver gnawing", visible: [] }),
      JSON.stringify({ pick: "r", onSubject: true, clear: true, visible: [], count: "one" }),
    );
    const state = await run(
      imageLesson([{ subject: "rodent teeth" }]),
      recordingDeps(ai, { images }),
    );
    expect(ai.calls).toHaveLength(2);
    expect(stores).toEqual(["r"]);
    expect(imageOf(state.lesson, 0).src).toBe("/files/ws/images/r.jpg");
  });

  test("an empty object from the judge means none, not a schema miss", async () => {
    const { images, stores } = fakeImages(async () => [pexelsPhoto("d", true)]);
    const ai = judge("{}");
    const state = await run(imageLesson([{ subject: "river" }]), recordingDeps(ai, { images }));
    expect(ai.calls).toHaveLength(1);
    expect(stores).toEqual([]);
    expect(imageOf(state.lesson, 0).src).toBe(PLACEHOLDER_IMAGE);
  });

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
    expect(element.source).toEqual({
      ...storedFor(second).source,
      evidence: {
        visible: [],
        count: "one",
        alt: "Photo p2",
        promptVersion: "pick-or-requery-photo.v5",
        thumbnail: second.src.tiny,
      },
    });
    expect(element.authoredBy).toBe("ai");
    // The judge saw the two portrait thumbnails as image parts, numbered to match their ids.
    expect(ai.calls[0]?.imageParts).toBe(2);
    expect(ai.calls[0]?.promptText).toContain("photo 1 — id p1");
    expect(deps.persisted).toHaveLength(1);
    expect(deps.imageCounts).toEqual({
      photographable: null,
      requested: 1,
      placed: 1,
      empty: 0,
      failed: 0,
    });
    expect(deps.progress.at(-1)?.message).toBe("Pictures placed");
    expect(state.lesson.generation?.promptVersions.generated).toContain("pick-or-requery-photo.v5");
    expect(state.lesson.generation?.usage.calls).toBe(1);
  });

  test("the judge sees the lesson context, not just the slide", async () => {
    const { images } = fakeImages(async () => [pexelsPhoto("p", true)]);
    const ai = judge(pick("p", ["front teeth"]));
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

  test("a requery searches once more and the second judge call decides; its result is never placed blind", async () => {
    const dental = { ...pexelsPhoto("d", true), alt: "Hands holding human teeth" };
    const rodent = pexelsPhoto("r", true);
    const { images, searches, stores } = fakeImages(async (query) =>
      query === "beaver gnawing wood" ? [pexelsPhoto("l", false), rodent] : [dental],
    );
    const ai = judge(requery("beaver gnawing wood"), pick("r"));
    const deps = recordingDeps(ai, { images });
    const state = await run(imageLesson([{ subject: "rodent teeth" }]), deps);

    expect(searches).toEqual(["rodent teeth", "rodent", "beaver gnawing wood"]);
    expect(stores).toEqual(["r"]);
    expect(ai.calls).toHaveLength(2);
    // The second judge is told every search so far and sees only the new pool.
    expect(ai.calls[1]?.promptText).toContain("beaver gnawing wood");
    expect(ai.calls[1]?.promptText).toContain("id r");
    expect(ai.calls[1]?.promptText).not.toContain("id d");
    expect(imageOf(state.lesson, 0).src).toBe("/files/ws/images/r.jpg");
    expect(deps.imageCounts).toEqual({
      photographable: null,
      requested: 1,
      placed: 1,
      empty: 0,
      failed: 0,
    });
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
    expect(deps.imageCounts).toEqual({
      photographable: null,
      requested: 1,
      placed: 0,
      empty: 1,
      failed: 0,
    });
  });

  test("a requery repeating a searched query is empty with no second search", async () => {
    const { images, searches } = fakeImages(async () => [pexelsPhoto("x", true)]);
    const deps = recordingDeps(judge(requery("River Severn!")), { images });
    const state = await run(imageLesson([{ subject: "river severn dawn" }]), deps);
    // Both candidates were searched; the judge's "new" query is the second one, re-punctuated.
    expect(searches).toEqual(["river severn dawn", "river severn"]);
    expect(imageOf(state.lesson, 0).src).toBe(PLACEHOLDER_IMAGE);
    expect(deps.imageCounts).toEqual({
      photographable: null,
      requested: 1,
      placed: 0,
      empty: 1,
      failed: 0,
    });
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
    expect(deps.imageCounts).toEqual({
      photographable: null,
      requested: 1,
      placed: 0,
      empty: 1,
      failed: 0,
    });
  });

  test("a judge that picks an id not in the pool falls back to its query, else empty", async () => {
    const { images, stores } = fakeImages(async () => [pexelsPhoto("x", true)]);
    const deps = recordingDeps(judge(pick("nope")), { images });
    const state = await run(imageLesson([{ subject: "river" }]), deps);
    expect(stores).toEqual([]);
    expect(imageOf(state.lesson, 0).src).toBe(PLACEHOLDER_IMAGE);
    expect(deps.imageCounts?.empty).toBe(1);
  });

  test("row 2 (TEACH-220): a pick whose visible list misses a required item fails the gate — a query earns one more judge call, else empty; nothing placed blind", async () => {
    const flower = {
      subject: "buttercup flower close-up",
      mustShow: ["open flower head", "petals", "stamens"],
      purpose: "identify-parts" as const,
    };
    const { images, searches, stores } = fakeImages(async (query) =>
      query === "buttercup macro" ? [pexelsPhoto("B", true)] : [pexelsPhoto("A", true)],
    );
    // First judge: picks A but sees only the ladybird's worth — gate fails; it offers a query.
    // Second judge over the new pool: picks B with everything visible.
    const gatedThenQuery = JSON.stringify({
      pick: "A",
      onSubject: true,
      clear: true,
      visible: ["petals"],
      count: "one",
      query: "buttercup macro",
    });
    const ai = judge(gatedThenQuery, pick("B", flower.mustShow));
    const deps = recordingDeps(ai, { images });
    const state = await run(imageLesson([flower]), deps);
    expect(ai.calls).toHaveLength(2);
    expect(searches).toEqual(["buttercup flower close", "buttercup flower", "buttercup macro"]);
    expect(stores).toEqual(["B"]);
    const element = imageOf(state.lesson, 0);
    expect(element.src).toBe("/files/ws/images/B.jpg");
    // Row 4: the evidence on the element is what the judge saw.
    expect(element.source?.evidence).toEqual({
      visible: ["open flower head", "petals", "stamens"],
      count: "one",
      alt: "Photo B",
      promptVersion: "pick-or-requery-photo.v5",
      thumbnail: `data:image/png;base64,${PNG}`,
    });

    // The same first verdict with no query: empty, one call, nothing stored.
    const gatedNoQuery = JSON.stringify({
      pick: "A",
      onSubject: true,
      clear: true,
      visible: ["petals"],
      count: "one",
      query: null,
    });
    const again = fakeImages(async () => [pexelsPhoto("A", true)]);
    const ai2 = judge(gatedNoQuery);
    const deps2 = recordingDeps(ai2, { images: again.images });
    const state2 = await run(imageLesson([flower]), deps2);
    expect(ai2.calls).toHaveLength(1);
    expect(again.stores).toEqual([]);
    expect(imageOf(state2.lesson, 0).src).toBe(PLACEHOLDER_IMAGE);
    expect(deps2.imageCounts).toEqual({
      photographable: null,
      requested: 1,
      placed: 0,
      empty: 1,
      failed: 0,
    });
  });

  test("TEACH-224: a pick that is not the subject fails the gate however much is visible — its query is followed, else nothing is placed", async () => {
    // The production case: a llama's snout for "rodent incisors close-up", every part visible.
    const { images, searches, stores } = fakeImages(async (query) =>
      query === "brown rat teeth" ? [pexelsPhoto("rat", true)] : [pexelsPhoto("llama", true)],
    );
    const brief = { subject: "rodent incisors close-up", mustShow: ["front teeth", "mouth"] };
    const offSubject = JSON.stringify({
      pick: "llama",
      onSubject: false,
      visible: ["front teeth", "mouth"],
      count: "one",
      query: "brown rat teeth",
    });
    const { lines, logger } = memoryLogger();
    const ai = judge(offSubject, pick("rat", brief.mustShow));
    const state = await run(imageLesson([brief]), recordingDeps(ai, { images, logger }));
    expect(ai.calls).toHaveLength(2);
    expect(searches).toEqual(["rodent incisors close", "rodent incisors", "brown rat teeth"]);
    expect(stores).toEqual(["rat"]);
    expect(imageOf(state.lesson, 0).src).toBe("/files/ws/images/rat.jpg");
    const gated = lines.map((l) => JSON.parse(l)).find((r) => r.gated === true);
    expect(gated).toMatchObject({ stage: "illustrate", offSubject: true });

    // A reply that omits onSubject is a pick that never said it was the subject: not placed.
    const silent = JSON.stringify({
      pick: "llama",
      visible: ["front teeth", "mouth"],
      count: "one",
    });
    const again = fakeImages(async () => [pexelsPhoto("llama", true)]);
    const ai2 = judge(silent);
    const state2 = await run(imageLesson([brief]), recordingDeps(ai2, { images: again.images }));
    expect(again.stores).toEqual([]);
    expect(imageOf(state2.lesson, 0).src).toBe(PLACEHOLDER_IMAGE);
  });

  test("TEACH-226: a pick that is not clear fails the gate; its query is followed; omitted clear is not placed; the judge sees up to eight", async () => {
    const fenced = JSON.stringify({
      pick: "fence",
      onSubject: true,
      clear: false,
      visible: ["front teeth"],
      count: "one",
      query: "brown rat close up",
    });
    const { images, searches, stores } = fakeImages(async (query) =>
      query === "brown rat close up"
        ? [pexelsPhoto("rat", true)]
        : Array.from({ length: 10 }, (_, i) => pexelsPhoto(i === 0 ? "fence" : `p${i}`, true)),
    );
    const { lines, logger } = memoryLogger();
    // Ten results: the caption shortlist (TEACH-227) runs first and names four; the judge sees
    // those four as pictures. The requery's single result needs no shortlist.
    const shortlisted = JSON.stringify({ ids: ["fence", "p1", "p2", "p3"] });
    const ai = judge(shortlisted, fenced, pick("rat", ["front teeth"]));
    const brief = { subject: "rodent incisors", mustShow: ["front teeth"] };
    const state = await run(imageLesson([brief]), recordingDeps(ai, { images, logger }));
    expect(ai.calls).toHaveLength(3);
    expect(ai.calls[0]?.context?.promptVersion).toBe("shortlist-photos.v1");
    expect(ai.calls[0]?.modelClass).toBe("small");
    expect(ai.calls[0]?.imageParts).toBeUndefined();
    expect(ai.calls[0]?.promptText).toContain("id p9");
    expect(ai.calls[1]?.imageParts).toBe(4);
    expect(ai.calls[1]?.promptText).not.toContain("id p9");
    expect(searches).toEqual(["rodent incisors", "rodent", "brown rat close up"]);
    const counts = lines.map((l) => JSON.parse(l)).find((r) => r.pool !== undefined);
    expect(counts).toMatchObject({ pool: 10, shortlisted: 4 });
    expect(stores).toEqual(["rat"]);
    expect(imageOf(state.lesson, 0).src).toBe("/files/ws/images/rat.jpg");
    const gated = lines.map((l) => JSON.parse(l)).find((r) => r.gated === true);
    expect(gated).toMatchObject({ unclear: true, offSubject: false });

    const silent = JSON.stringify({
      pick: "p1",
      onSubject: true,
      visible: ["front teeth"],
      count: "one",
    });
    const again = fakeImages(async () => [pexelsPhoto("p1", true)]);
    const state2 = await run(
      imageLesson([brief]),
      recordingDeps(judge(silent), { images: again.images }),
    );
    expect(again.stores).toEqual([]);
    expect(imageOf(state2.lesson, 0).src).toBe(PLACEHOLDER_IMAGE);
  });

  test("TEACH-227: a shortlist that misses twice falls back to the first six; one that names nothing ends the slide without a judge call", async () => {
    const ten = Array.from({ length: 10 }, (_, i) => pexelsPhoto(`p${i}`, true));
    const { images, stores } = fakeImages(async () => ten);
    const ai = judge("not json", "still not json", pick("p2"));
    const state = await run(imageLesson([{ subject: "river" }]), recordingDeps(ai, { images }));
    expect(ai.calls).toHaveLength(3);
    expect(ai.calls[2]?.imageParts).toBe(6);
    expect(ai.calls[2]?.promptText).toContain("id p5");
    expect(ai.calls[2]?.promptText).not.toContain("id p6");
    expect(stores).toEqual(["p2"]);
    expect(imageOf(state.lesson, 0).src).toBe("/files/ws/images/p2.jpg");

    // A pick of an id the judge was not shown is not placed, however good the caption looked.
    const unseen = fakeImages(async () => ten);
    const ai3 = judge(JSON.stringify({ ids: ["p0", "p1"] }), pick("p7"));
    const state3 = await run(
      imageLesson([{ subject: "river" }]),
      recordingDeps(ai3, { images: unseen.images }),
    );
    expect(unseen.stores).toEqual([]);
    expect(imageOf(state3.lesson, 0).src).toBe(PLACEHOLDER_IMAGE);

    const none = fakeImages(async () => ten);
    const ai2 = judge(JSON.stringify({ ids: [] }));
    const state2 = await run(
      imageLesson([{ subject: "river" }]),
      recordingDeps(ai2, { images: none.images }),
    );
    expect(ai2.calls).toHaveLength(1);
    expect(none.stores).toEqual([]);
    expect(imageOf(state2.lesson, 0).src).toBe(PLACEHOLDER_IMAGE);
  });

  test("row 3: a visible item outside mustShow is a validation issue the retry names", async () => {
    const flower = {
      subject: "buttercup",
      mustShow: ["stamens"],
      purpose: "identify-parts" as const,
    };
    const { images } = fakeImages(async () => [pexelsPhoto("A", true)]);
    const bad = JSON.stringify({
      pick: "A",
      onSubject: true,
      clear: true,
      visible: ["stamens", "bee"],
      count: "one",
      query: null,
    });
    const ai = judge(bad, pick("A", ["stamens"]));
    const state = await run(imageLesson([flower]), recordingDeps(ai, { images }));
    expect(ai.calls).toHaveLength(2);
    expect(ai.calls[1]?.promptText).toContain("visible lists only items from mustShow: stamens");
    expect(imageOf(state.lesson, 0).src).toBe("/files/ws/images/A.jpg");
  });

  test("at most two judge calls per slide: a second requery is not followed", async () => {
    const { images, searches } = fakeImages(async () => [pexelsPhoto("A", true)]);
    const ai = judge(requery("try two"), requery("try three"));
    const deps = recordingDeps(ai, { images });
    const state = await run(imageLesson([{ subject: "river" }]), deps);
    expect(ai.calls).toHaveLength(2);
    expect(searches).toEqual(["river", "try two"]);
    expect(imageOf(state.lesson, 0).src).toBe(PLACEHOLDER_IMAGE);
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
    expect(deps.imageCounts).toEqual({
      photographable: null,
      requested: 1,
      placed: 0,
      empty: 1,
      failed: 0,
    });
    expect(deps.persisted).toHaveLength(1);
    expect(state.lesson.generation?.usage.calls).toBe(1);
  });

  test("no portrait results still asks the judge, which may requery", async () => {
    const { images, searches } = fakeImages(async (query) =>
      query === "better" ? [pexelsPhoto("b", true)] : [pexelsPhoto("l1", false)],
    );
    const ai = judge(requery("better"), pick("b"));
    const deps = recordingDeps(ai, { images });
    const state = await run(imageLesson([{ subject: "river" }]), deps);
    expect(ai.calls[0]?.promptText).toContain("Candidates: none.");
    expect(ai.calls[0]?.imageParts).toBeUndefined();
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
    expect(deps.imageCounts).toEqual({
      photographable: null,
      requested: 2,
      placed: 1,
      empty: 0,
      failed: 1,
    });
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
    expect(deps.imageCounts).toEqual({
      photographable: null,
      requested: 2,
      placed: 1,
      empty: 0,
      failed: 1,
    });
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
    expect(deps.imageCounts).toEqual({
      photographable: null,
      requested: 2,
      placed: 0,
      empty: 2,
      failed: 0,
    });
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
    expect(deps.imageCounts).toEqual({
      photographable: null,
      requested: 1,
      placed: 0,
      empty: 0,
      failed: 0,
    });
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
    expect(deps.imageCounts).toEqual({
      photographable: null,
      requested: 1,
      placed: 0,
      empty: 1,
      failed: 0,
    });
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
