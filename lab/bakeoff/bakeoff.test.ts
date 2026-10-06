// BAKEOFF harness offline tests (no network, no spend): run `bun test lab/bakeoff`.
import { describe, expect, test } from "bun:test";
import { createFakeAi } from "../../packages/ai/src/testing";
import { judgeMade, pickPhoto } from "../../packages/generation/src/stages/illustrate";
import { recordingDeps } from "../../packages/generation/src/testing";
import { PLACEHOLDER_IMAGE } from "../../packages/slides/src/layouts";
import { getTheme, withKeyStage } from "../../packages/slides/src/themes";
import { armT } from "./arm-t";
import { checkSlide } from "./checks";
import type { MaterialiseCtx, VisualState } from "./harness";
import { guardedGenerator, type PickerLessonInfo, pickerLesson } from "./services";

const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const photo = (id: string) => ({
  id,
  // Portrait, as the picker asks Pexels for when a brief gives no aspect.
  width: 800,
  height: 1200,
  alt: `photo ${id}`,
  photographer: "p",
  photographerUrl: "https://example.test/p",
  pageUrl: `https://example.test/${id}`,
  src: {
    large: `https://example.test/${id}.jpg`,
    medium: `https://example.test/${id}.jpg`,
    tiny: `data:image/png;base64,${PNG}`,
  },
});
const images = {
  search: async () => [photo("p1"), photo("p2")],
  store: async (p: { id: string; width: number; height: number }) => ({
    key: `ws/images/${p.id}.jpg`,
    url: `/files/ws/images/${p.id}.jpg`,
    width: p.width,
    height: p.height,
    bytes: 100,
    contentType: "image/jpeg",
    source: { provider: "pexels", id: p.id },
  }),
};
const INFO: PickerLessonInfo = {
  id: "bakeoff-T-y1",
  title: "Animals and their young",
  yearGroup: "Year 1",
  subject: "Science",
  // As the harness sets it once the stream's objectives arrive (no vocabulary, no keyIdeas).
  base: {
    facts: { objectives: [{ id: "o1", text: "Name animals and their young" }], outline: [] },
  },
};
const BRIEF = {
  subject: "a kitten",
  request: "a kitten. kitten",
  mustShow: ["kitten"],
  purpose: "context",
};
const PICK = (id: string) =>
  JSON.stringify({
    pick: id,
    onSubject: true,
    clear: true,
    fits: true,
    visible: ["kitten"],
    count: "one",
    query: null,
  });

describe("picture stock path (recorded judge answers)", () => {
  test("the harness's lesson carries every facts field the picker reads: a stock pick is placed", async () => {
    const ai = createFakeAi({ script: [PICK("p2")], usage: { inputTokens: 40, outputTokens: 8 } });
    const deps = recordingDeps(ai, { images: images as never });
    const r = (await pickPhoto(pickerLesson(INFO, 3, BRIEF) as never, 3, deps)) as {
      outcome: string;
      photo?: { src: string };
    };
    expect(r.outcome).toBe("placed");
    expect(r.photo?.src).toBe("/files/ws/images/p2.jpg");
  });
  test("the made-picture judge runs on the same lesson without throwing", async () => {
    const ai = createFakeAi({
      script: [PICK("made")],
      usage: { inputTokens: 40, outputTokens: 8 },
    });
    const deps = recordingDeps(ai, { images: images as never });
    const ok = await judgeMade({
      lesson: pickerLesson(INFO, 3) as never,
      index: 3,
      brief: BRIEF as never,
      deps,
      dataUrl: `data:image/png;base64,${PNG}`,
    });
    expect(ok).toBe(true);
  });
  test("the old lesson shape (objectives and outline only) threw in the judge: nothing placed", async () => {
    const ai = createFakeAi({ script: [PICK("p2")], usage: { inputTokens: 40, outputTokens: 8 } });
    const deps = recordingDeps(ai, { images: images as never });
    const old = {
      ...pickerLesson(INFO, 3, BRIEF),
      facts: { objectives: [], outline: pickerLesson(INFO, 3, BRIEF).facts.outline },
    };
    // pickPhoto catches the TypeError (facts.vocabulary is undefined) and reports an empty slot.
    const r = (await pickPhoto(old as never, 3, deps)) as { outcome: string };
    expect(r.outcome).not.toBe("placed");
  });
});

describe("hard generation cap", () => {
  test("10 concurrent generations against a $0.03 cap: at most the cap is spent", async () => {
    let spent = 0;
    let calls = 0;
    const fake = {
      model: "fake",
      generate: async () => {
        calls++;
        await new Promise((r) => setTimeout(r, 20 + Math.random() * 30));
        spent += 0.0063; // the bank reports each generation's cost after it lands
        return { ok: true };
      },
    };
    const g = guardedGenerator(fake, () => spent, 0.03);
    const res = await Promise.allSettled(Array.from({ length: 10 }, () => g.generate({} as never)));
    expect(calls).toBe(4);
    expect(spent).toBeLessThanOrEqual(0.03);
    expect(res.filter((r) => r.status === "rejected")).toHaveLength(6);
  });
});

describe("arm T: a picture that could not be made leaves no hole", () => {
  const theme = withKeyStage("ks1", () => getTheme("splash", "ks1"));
  const ctx = (states: Record<string, VisualState["status"]>): MaterialiseCtx => ({
    brief: {} as never,
    theme,
    stage: "ks1",
    index: 5,
    plan: { slides: [] },
    visual: (k) => {
      const st = states[k] ?? "pending";
      return st === "photo"
        ? { status: "photo", photo: { src: "/files/x.jpg", alt: "x", aspect: 1.5, request: "x" } }
        : ({ status: st } as VisualState);
    },
  });
  const pic = (shows: string) => ({ shows, must_see: [shows], subject: "generic" });
  const compare = {
    template: "compare",
    heading: "A dog and its young",
    columns: [
      { label: "dog", text: "An adult dog.", picture: pic("a dog") },
      { label: "puppy", text: "A baby dog.", picture: pic("a puppy") },
    ],
  };
  const sequence = {
    template: "picture-sequence",
    heading: "A chick grows into a chicken",
    sequence: ["chick", "growing", "adult hen"].map((c) => ({ ...pic(c), caption: c })),
  };
  const laid = (s: Record<string, unknown>, st: Record<string, VisualState["status"]>) =>
    withKeyStage("ks1", () => armT.materialise(s, ctx(st)));
  const imgs = (m: ReturnType<typeof laid>) => m.slide.elements.filter((e) => e.type === "image");

  test("compare, puppy failed (s6): no column keeps a photo, nothing empty, checks clean", () => {
    const m = laid(compare, { "col.0": "photo", "col.1": "failed" });
    expect(imgs(m)).toHaveLength(0);
    expect(
      checkSlide({
        index: 5,
        slide: m.slide,
        over: m.over,
        questions: [],
        answers: [],
        notesChecked: true,
        words: armT.words(compare),
      }).faults,
    ).toEqual([]);
  });
  test("compare, both landed: two photos with their requests", () => {
    const m = laid(compare, { "col.0": "photo", "col.1": "photo" });
    expect(imgs(m)).toHaveLength(2);
    expect(imgs(m).every((e) => (e as { request?: string }).request === "x")).toBe(true);
  });
  test("compare, puppy still pending: an open slot, not a hole", () => {
    const m = laid(compare, { "col.0": "photo" });
    expect(imgs(m).map((e) => (e as { src: string }).src)).toEqual([
      "/files/x.jpg",
      PLACEHOLDER_IMAGE,
    ]);
  });
  test("sequence, all three failed (s8): numbered steps, no arrows over nothing", () => {
    const m = laid(sequence, { "seq.0": "failed", "seq.1": "failed", "seq.2": "failed" });
    expect(imgs(m)).toHaveLength(0);
    expect(m.slide.elements.some((e) => e.name === "Arrow")).toBe(false);
    expect(m.slide.kind).toBe("worked-example");
    expect(m.over).toEqual([]);
  });
  test("sequence, one failed: also steps (a row with a gap reads as broken)", () => {
    const m = laid(sequence, { "seq.0": "photo", "seq.1": "failed", "seq.2": "photo" });
    expect(imgs(m)).toHaveLength(0);
  });
  test("sequence, all landed: three photos and two arrows", () => {
    const m = laid(sequence, { "seq.0": "photo", "seq.1": "photo", "seq.2": "photo" });
    expect(imgs(m)).toHaveLength(3);
    expect(m.slide.elements.filter((e) => e.name === "Arrow")).toHaveLength(2);
  });
});
