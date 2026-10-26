import { describe, expect, test } from "bun:test";
import { generatedLesson, imageElement, textElement } from "./fixtures.test-helpers";
import {
  isStartingJob,
  keepWritingSlides,
  mergeJobLesson,
  sameJson,
  startingJobBase,
  withoutEditorCopies,
  writingSlideIds,
} from "./generation-merge";
import type { Lesson } from "./lesson";
import type { Slide, SlideElement } from "./slide";

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
    s.id === "w1"
      ? {
          ...s,
          teacherEdited: true,
          elements: [textElement("w1-t", value), ...s.elements.slice(1)],
        }
      : s,
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

  // TEACH-251 part s (ADR 0037/0039): the writer's layout gate runs after editable; a split of a
  // slide the teacher edited never adds the job's continuation beside the teacher's whole slide.
  test("a split of a slide the teacher edited adds no continuation; an untouched one's lands", () => {
    const base = filling();
    const done = (l: Lesson, extra: Record<string, "done" | "writing">): Lesson => ({
      ...l,
      generation: {
        ...(l.generation as NonNullable<Lesson["generation"]>),
        slideStates: { w1: "done", w2: "done", ...extra },
      },
    });
    const part = (id: string) =>
      ({ id, kind: "content", elements: [textElement(`${id}-t`, "rest")] }) as unknown as Slide;
    const edited = typed(base, "Water evaporates in the sun.");
    const theirs = done(
      { ...base, slides: [slide(base, "w1"), part("w1-c2"), part("w1-c3"), slide(base, "w2")] },
      { "w1-c2": "done", "w1-c3": "done" },
    );
    const merged = mergeJobLesson(base, edited, theirs);
    expect(merged.slides.map((s) => s.id)).toEqual(["w1", "w2"]);
    // Untouched: the job's parts land after the slide they continue.
    expect(mergeJobLesson(base, base, theirs).slides.map((s) => s.id)).toEqual([
      "w1",
      "w1-c2",
      "w1-c3",
      "w2",
    ]);
    // A slide still being written after an edited one lands as ever.
    const streaming = done(
      { ...base, slides: [slide(base, "w1"), part("w9"), slide(base, "w2")] },
      { w9: "writing" },
    );
    expect(mergeJobLesson(base, edited, streaming).slides.map((s) => s.id)).toEqual([
      "w1",
      "w9",
      "w2",
    ]);
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
          ? {
              ...s,
              teacherEdited: true,
              elements: s.elements.filter((e) => e.id !== "w1-pic"),
              notes: "My notes.",
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

  // P0 25 Oct 2026: a partial copy saved under a newer `updatedAt` deleted every slide done since.
  test("a stale copy cannot drop done slides it never saw done; a teacher's delete still lands", () => {
    const stored = filling();
    const gen = stored.generation as NonNullable<Lesson["generation"]>;
    const three = { id: "w3", kind: "content", elements: [textElement("w3-t", "Rain.")] } as Slide;
    const now: Lesson = {
      ...stored,
      slides: [...stored.slides, three],
      generation: { ...gen, slideStates: { w1: "done", w2: "done", w3: "writing" } },
    };
    // The editor's copy from when only w1 was done: w2 was still writing, w3 did not exist.
    const stale: Lesson = { ...stored, slides: [slide(stored, "w1")] };
    expect(keepWritingSlides(now, stale).slides.map((s) => s.id)).toEqual(["w1", "w2", "w3"]);
    // A copy from another job (a retry's first run) saw none of this job's slides.
    const otherJob: Lesson = {
      ...now,
      slides: [slide(now, "w1")],
      generation: { ...gen, jobId: "old-job", slideStates: { w1: "done", w2: "done" } },
    };
    expect(keepWritingSlides(now, otherJob).slides.map((s) => s.id)).toEqual(["w1", "w2", "w3"]);
    // The teacher deleted w2 after seeing it done: the delete lands, w3 stays the job's.
    const deleted: Lesson = { ...now, slides: [slide(now, "w1")] };
    expect(keepWritingSlides(now, deleted).slides.map((s) => s.id)).toEqual(["w1", "w3"]);
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

describe("a picture slot the job took out never survives the merge (picq, 26 Oct)", () => {
  // The job re-laid slide w1 without its picture (the picture failed); the editor holds w1 too.
  const jobDropped = (base: Lesson): Lesson => ({
    ...base,
    slides: base.slides.map((s) =>
      s.id === "w1"
        ? ({ ...s, elements: [{ ...textElement("w1-t", "Water evaporates."), w: 800 }] } as Slide)
        : s,
    ),
  });
  const ids = (l: Lesson) => l.slides.find((s) => s.id === "w1")?.elements.map((e) => e.id);

  test("an editor copy re-fitted on open (positions only) takes the job's re-laid slide", () => {
    const base = filling();
    const mine: Lesson = {
      ...base,
      slides: base.slides.map((s) =>
        s.id === "w1"
          ? ({ ...s, elements: s.elements.map((e) => ({ ...e, h: (e.h ?? 10) + 7 })) } as Slide)
          : s,
      ),
    };
    const theirs = jobDropped(base);
    const merged = mergeJobLesson(base, mine, theirs);
    expect(merged.slides.find((s) => s.id === "w1")).toEqual(
      theirs.slides.find((s) => s.id === "w1"),
    );
  });

  test("a slide whose words the teacher changed keeps them and loses only the empty slot", () => {
    const base = filling();
    const mine: Lesson = {
      ...base,
      slides: base.slides.map((s) =>
        s.id === "w1"
          ? ({
              ...s,
              teacherEdited: true,
              elements: [textElement("w1-t", "Puddles dry up."), s.elements[1]],
            } as Slide)
          : s,
      ),
    };
    const merged = mergeJobLesson(base, mine, jobDropped(base));
    expect(ids(merged)).toEqual(["w1-t"]);
    expect(JSON.stringify(merged)).toContain("Puddles dry up.");
  });

  test("a slot the teacher filled themselves is kept", () => {
    const base = filling();
    const mine: Lesson = {
      ...base,
      slides: base.slides.map((s) =>
        s.id === "w1"
          ? ({
              ...s,
              teacherEdited: true,
              elements: [s.elements[0], imageElement("w1-pic", { src: "/files/mine.png" })],
            } as Slide)
          : s,
      ),
    };
    const merged = mergeJobLesson(base, mine, jobDropped(base));
    expect(ids(merged)).toEqual(["w1-t", "w1-pic"]);
  });
});

describe("the teacher's mark adds certainty; its absence never discards an edit (TEACH-251 part p)", () => {
  // Great Fire Y2 replay (26 Oct): the editor recoloured every job slide into the picked theme, so
  // each counted as the teacher's; diagrams and pictures the job made late were dropped.
  const styled = (color: string, size: number) =>
    textElement("w1-t", "Water evaporates.", {
      style: { preset: "body", color, fontSize: size },
    } as Partial<SlideElement>);
  const diagram = (id = "w1-fig") =>
    imageElement(id, { src: "/files/flow.svg", diagram: { kind: "flow" } } as never);
  const withW1 = (l: Lesson, elements: SlideElement[], extra: Partial<Slide> = {}): Lesson => ({
    ...l,
    slides: l.slides.map((s) => (s.id === "w1" ? ({ ...s, elements, ...extra } as Slide) : s)),
  });
  const mark = { teacherEdited: true } as const;
  const w1 = (l: Lesson) => slide(l, "w1");
  const ids = (l: Lesson) => w1(l).elements.map((e) => e.id);

  test("an unmarked change is still the teacher's on the server (an older editor), and the diagram lands", () => {
    const base = withW1(filling(), [styled("#111111", 32)]);
    const mine = withW1(base, [styled("#c0392b", 28)]);
    const theirs = withW1(base, [styled("#111111", 32), diagram()]);
    const merged = w1(mergeJobLesson(base, mine, theirs));
    expect(merged.elements.map((e) => e.id)).toEqual(["w1-t", "w1-fig"]);
    expect(el(merged, "w1-t")).toEqual(el(w1(mine), "w1-t"));
  });

  test("the editor leaves its unmarked repaint out of the merge: the job's slide comes whole", () => {
    const base = withW1(filling(), [styled("#111111", 32)]);
    const mine = withW1(base, [styled("#c0392b", 28)]);
    const theirs = withW1(base, [styled("#111111", 32), diagram()]);
    const merged = mergeJobLesson(base, withoutEditorCopies(mine, base), theirs);
    expect(w1(merged)).toEqual(w1(theirs));
    // An unmarked slide whose words changed (a mark missed) is kept as the teacher's.
    const typedUnmarked = withW1(base, [textElement("w1-t", "Puddles dry up.")]);
    expect(withoutEditorCopies(typedUnmarked, base)).toBe(typedUnmarked);
    const merged2 = mergeJobLesson(base, withoutEditorCopies(typedUnmarked, base), theirs);
    expect(JSON.stringify(w1(merged2))).toContain("Puddles dry up.");
    // An unmarked slide with an element added or notes changed is kept too.
    const added = withW1(base, [styled("#111111", 32), textElement("extra", "Note")]);
    expect(withoutEditorCopies(added, base)).toBe(added);
    const noted = withW1(base, [styled("#111111", 32)], { notes: "Mine." });
    expect(withoutEditorCopies(noted, base)).toBe(noted);
    // A marked slide is never swapped for the reference copy.
    const marked = withW1(base, [styled("#c0392b", 28)], mark);
    expect(withoutEditorCopies(marked, base)).toBe(marked);
  });

  test("an unmarked recoloured placeholder the job swaps for a diagram: the job's slide, no placeholder", () => {
    const ph = imageElement("w1-pic", { src: "" });
    const base = withW1(filling(), [styled("#111111", 32), ph]);
    const mine = withW1(base, [styled("#c0392b", 28), { ...ph, x: 600 }]);
    const theirs = withW1(base, [styled("#111111", 32), diagram()]);
    const merged = mergeJobLesson(base, mine, theirs);
    expect(ids(merged)).toEqual(["w1-t", "w1-fig"]);
    expect(JSON.stringify(w1(merged))).not.toContain('"src":""');
  });

  test("a teacher's move, resize, recolour and font size on a done slide survive a late picture", () => {
    const ph = imageElement("w1-pic", { src: "" });
    const base = withW1(filling(), [styled("#111111", 32), ph]);
    const mineText = { ...styled("#c0392b", 40), x: 12, y: 300, w: 500, h: 120 };
    const mine = withW1(base, [mineText, ph], mark);
    const theirs = withW1(base, [
      styled("#111111", 32),
      imageElement("w1-photo", { src: "/files/puddle.jpg" }),
    ]);
    const merged = w1(mergeJobLesson(base, mine, theirs));
    expect(el(merged, "w1-t")).toEqual(mineText as never);
    expect(el(merged, "w1-photo")).toMatchObject({ src: "/files/puddle.jpg" });
    expect(merged.teacherEdited).toBe(true);
  });

  test("a teacher who changed the words keeps them and still gets the late picture", () => {
    const ph = imageElement("w1-pic", { src: "" });
    const base = withW1(filling(), [styled("#111111", 32), ph]);
    const mine = withW1(
      base,
      [textElement("w1-t", "Puddles dry up in the sun."), { ...ph, x: 40 }],
      mark,
    );
    const theirs = withW1(base, [
      styled("#111111", 32),
      imageElement("w1-photo", { src: "/files/puddle.jpg" }),
    ]);
    const merged = mergeJobLesson(base, mine, theirs);
    expect(ids(merged)).toEqual(["w1-t", "w1-photo"]);
    expect(el(w1(merged), "w1-photo")).toMatchObject({ src: "/files/puddle.jpg", x: 40 });
    expect(JSON.stringify(w1(merged))).toContain("Puddles dry up in the sun.");
  });

  test("a teacher who changed the words, on a slide with no slot left, still gets the diagram", () => {
    const base = withW1(filling(), [styled("#111111", 32)]);
    const mine = withW1(base, [textElement("w1-t", "Puddles dry up.")], mark);
    const theirs = withW1(base, [styled("#111111", 32), diagram()]);
    const merged = mergeJobLesson(base, mine, theirs);
    expect(ids(merged)).toEqual(["w1-t", "w1-fig"]);
    expect(JSON.stringify(w1(merged))).toContain("Puddles dry up.");
  });

  test("a teacher who deleted the picture box does not get it back", () => {
    const ph = imageElement("w1-pic", { src: "" });
    const base = withW1(filling(), [styled("#111111", 32), ph]);
    const mine = withW1(base, [styled("#111111", 32)], mark);
    const swapped = withW1(base, [styled("#111111", 32), diagram()]);
    expect(ids(mergeJobLesson(base, mine, swapped))).toEqual(["w1-t"]);
    const filled = withW1(base, [styled("#111111", 32), { ...ph, src: "/files/p.jpg" }]);
    expect(ids(mergeJobLesson(base, mine, filled))).toEqual(["w1-t"]);
  });

  test("a teacher who added their own picture keeps the visual area: no second picture", () => {
    const base = withW1(filling(), [styled("#111111", 32)]);
    const mine = withW1(
      base,
      [styled("#111111", 32), imageElement("mine", { src: "/files/m.png" })],
      mark,
    );
    const theirs = withW1(base, [styled("#111111", 32), diagram()]);
    expect(ids(mergeJobLesson(base, mine, theirs))).toEqual(["w1-t", "mine"]);
  });
});
