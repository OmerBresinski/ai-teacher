import { describe, expect, test } from "bun:test";
import { generatedLesson, imageElement, textElement } from "./fixtures.test-helpers";
import {
  isStartingJob,
  keepWritingSlides,
  mergeJobLesson,
  sameJson,
  startingJobBase,
  writingSlideIds,
} from "./generation-merge";
import type { Lesson } from "./lesson";
import type { Slide } from "./slide";

/** A lesson mid-fill: slide 1 done (a picture placeholder and notes), slide 2 still writing. */
function filling(): Lesson {
  const lesson = generatedLesson();
  const one: Slide = {
    id: "w1",
    kind: "content",
    elements: [textElement("w1-t", "Water evaporates."), imageElement("w1-pic", { src: "" })],
    notes: "Ask what happens to a puddle.",
  } as Slide;
  const two: Slide = {
    id: "w2",
    kind: "content",
    elements: [textElement("w2-t", "Clouds form…")],
  } as Slide;
  return {
    ...lesson,
    slides: [one, two],
    generation: {
      jobId: "job",
      stage: "planned",
      startedAt: "2026-10-09T09:00:00.000Z",
      promptVersions: {},
      usage: { calls: 1, inputTokens: 1, outputTokens: 1, costUsd: 0 },
      findings: [],
      slideStates: { w1: "done", w2: "writing" },
    },
  };
}

const slide = (l: Lesson, id: string) => l.slides.find((s) => s.id === id) as Slide;
const el = (s: Slide, id: string) => s.elements.find((e) => e.id === id) as Record<string, unknown>;
const typed = (l: Lesson, value: string): Lesson => ({
  ...l,
  slides: l.slides.map((s) =>
    s.id === "w1" ? { ...s, elements: [textElement("w1-t", value), ...s.elements.slice(1)] } : s,
  ),
});

describe("mergeJobLesson (ADR 0037, ruling 189)", () => {
  test("an untouched slide takes the job's copy; new slides and states come through", () => {
    const base = filling();
    const theirs: Lesson = {
      ...base,
      slides: [
        ...base.slides.slice(0, 1),
        { ...slide(base, "w2"), elements: [textElement("w2-t", "Clouds form when…")] },
        { id: "w3", kind: "content", elements: [] } as unknown as Slide,
      ],
      generation: {
        ...(base.generation as NonNullable<Lesson["generation"]>),
        slideStates: { w1: "done", w2: "done", w3: "writing" },
      },
    };
    const merged = mergeJobLesson(base, base, theirs);
    expect(sameJson(merged, theirs)).toBe(true);
    expect([...writingSlideIds(merged)]).toEqual(["w3"]);
  });

  test("a slide the teacher typed into keeps the words; the job's rewording is dropped", () => {
    const base = filling();
    const mine = typed(base, "Water evaporates in the sun.");
    const theirs = typed(base, "Look at the picture: water evaporates.");
    const merged = mergeJobLesson(base, mine, theirs);
    expect(el(slide(merged, "w1"), "w1-t")).toEqual(el(slide(mine, "w1"), "w1-t"));
  });

  test("a late picture lands in an untouched slot of an edited slide, where the teacher moved it", () => {
    const base = filling();
    const moved: Lesson = {
      ...typed(base, "Mine"),
      slides: typed(base, "Mine").slides.map((s) =>
        s.id === "w1"
          ? {
              ...s,
              elements: s.elements.map((e) => (e.id === "w1-pic" ? { ...e, x: 10, y: 20 } : e)),
            }
          : s,
      ),
    };
    const theirs: Lesson = {
      ...base,
      slides: base.slides.map((s) =>
        s.id === "w1"
          ? {
              ...s,
              elements: s.elements.map((e) =>
                e.id === "w1-pic" ? { ...e, src: "https://img/puddle.jpg" } : e,
              ),
              notes: "New notes.",
            }
          : s,
      ),
    };
    const merged = slide(mergeJobLesson(base, moved, theirs), "w1");
    expect(el(merged, "w1-pic")).toMatchObject({ src: "https://img/puddle.jpg", x: 10, y: 20 });
    expect(el(merged, "w1-t")).toEqual(el(slide(moved, "w1"), "w1-t"));
    expect(merged.notes).toBe("New notes.");
  });

  test("a slot the teacher deleted or replaced is not refilled; edited notes are kept", () => {
    const base = filling();
    const mine: Lesson = {
      ...base,
      slides: base.slides.map((s) =>
        s.id === "w1"
          ? { ...s, elements: s.elements.filter((e) => e.id !== "w1-pic"), notes: "My notes." }
          : s,
      ),
    };
    const theirs: Lesson = {
      ...base,
      slides: base.slides.map((s) =>
        s.id === "w1"
          ? {
              ...s,
              elements: s.elements.map((e) => (e.id === "w1-pic" ? { ...e, src: "https://x" } : e)),
              notes: "Job notes.",
            }
          : s,
      ),
    };
    const merged = slide(mergeJobLesson(base, mine, theirs), "w1");
    expect(merged.elements.map((e) => e.id)).toEqual(["w1-t"]);
    expect(merged.notes).toBe("My notes.");
  });

  test("teacher's added and deleted slides and title stay; the theme is the teacher's", () => {
    const base = filling();
    const added = { id: "mine", kind: "content", elements: [] } as unknown as Slide;
    const mine: Lesson = {
      ...base,
      title: "My title",
      themeId: "ocean",
      slides: [added, slide(base, "w2")],
    };
    const theirs: Lesson = { ...base, title: "Job title" };
    const merged = mergeJobLesson(base, mine, theirs);
    expect(merged.slides.map((s) => s.id)).toEqual(["mine", "w2"]);
    expect(merged.title).toBe("My title");
    expect(merged.themeId).toBe("ocean");
  });
});

describe("keepWritingSlides", () => {
  test("a teacher write cannot change, drop or restate a writing slide or the generation", () => {
    const stored = filling();
    const incoming: Lesson = {
      ...typed(stored, "Edited"),
      slides: [slide(typed(stored, "Edited"), "w1")],
      generation: {
        ...(stored.generation as NonNullable<Lesson["generation"]>),
        slideStates: { w1: "done", w2: "done" },
      },
    };
    const kept = keepWritingSlides(stored, incoming);
    expect(kept.slides.map((s) => s.id)).toEqual(["w1", "w2"]);
    expect(slide(kept, "w2")).toEqual(slide(stored, "w2"));
    expect(el(slide(kept, "w1"), "w1-t")).toEqual(el(slide(incoming, "w1"), "w1-t"));
    expect(kept.generation).toEqual(stored.generation);
  });
});

/*
 * UX audit J2 (answer 66): the editor opens on a confirmed plan before the job has marked a slide.
 * Until it does, the job owns every slide, so a re-fit on open is never kept as the teacher's edit.
 */
describe("a starting job (no slide states yet)", () => {
  function starting(): Lesson {
    const { slideStates: _states, ...generation } = filling().generation as NonNullable<
      Lesson["generation"]
    >;
    return {
      ...filling(),
      plan: { revision: 1, state: "confirmed", jobId: "plan" },
      generation,
    } as Lesson;
  }
  /** The editor's copy after the on-open fit migration touched both slides (read-only to the teacher). */
  const refitted = (l: Lesson): Lesson => ({
    ...l,
    slides: l.slides.map((s) => ({
      ...s,
      elements: s.elements.map((e) => ({ ...e, y: (e as { y: number }).y + 4 })),
    })) as Slide[],
  });
  const marked = (
    l: Lesson,
    slides: Slide[],
    states: Record<string, "writing" | "done">,
  ): Lesson => ({
    ...l,
    slides,
    generation: { ...(l.generation as NonNullable<Lesson["generation"]>), slideStates: states },
  });

  test("is recognised, and its base marks every slide writing", () => {
    const row = starting();
    expect(isStartingJob(row)).toBe(true);
    expect([...writingSlideIds(startingJobBase(row))].sort()).toEqual(["w1", "w2"]);
    expect(isStartingJob(filling())).toBe(false);
    const done = filling();
    expect(startingJobBase(done)).toBe(done);
  });

  test("a slide the job drops is gone, not kept as the teacher's re-fitted copy", () => {
    const row = starting();
    const theirs = marked(row, [slide(row, "w1")], { w1: "writing" });
    const merged = mergeJobLesson(startingJobBase(row), refitted(row), theirs);
    expect(merged.slides.map((s) => s.id)).toEqual(["w1"]);
    expect(sameJson(slide(merged, "w1"), slide(theirs, "w1"))).toBe(true);
    // Without the starting base the re-fit reads as an edit and the dropped slide survives.
    const naive = mergeJobLesson(row, refitted(row), theirs);
    expect(naive.slides.map((s) => s.id)).toContain("w2");
  });

  test("a slide the job splits comes in as the job's two slides, both still writing", () => {
    const row = starting();
    const a = { ...slide(row, "w2"), id: "w2a" } as Slide;
    const b = { ...slide(row, "w2"), id: "w2b" } as Slide;
    const theirs = marked(row, [slide(row, "w1"), a, b], {
      w1: "writing",
      w2a: "writing",
      w2b: "writing",
    });
    const merged = mergeJobLesson(startingJobBase(row), refitted(row), theirs);
    expect(merged.slides.map((s) => s.id)).toEqual(["w1", "w2a", "w2b"]);
    expect([...writingSlideIds(merged)].sort()).toEqual(["w1", "w2a", "w2b"]);
  });
});
