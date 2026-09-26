import { describe, expect, test } from "bun:test";
import { checkLesson, type Lesson } from "@tj/domain/documents";
import { writeElementDoc } from "../../model/reducers";
import { listLesson, objectivesDoc } from "../../model/reducers/objective-lines.test-helpers";
import { findingSlideId, findingsBySlide } from "../residual-findings";
import { untaughtAfterDelete } from "../slide-commands";
import { objectiveNotes, oldWordingSentence, slideAfterForObjective } from "./objective-notes";

/* Ruling 96: what the objectives slide's lines say, the routing and the delete toast. */

const objectivesSlide = (lesson: Lesson) => {
  const slide = lesson.slides.find((s) => s.id === "s-objectives");
  if (!slide) throw new Error("fixture");
  return slide;
};

const notesOf = (lesson: Lesson, over: Partial<Parameters<typeof objectiveNotes>[0]> = {}) =>
  objectiveNotes({
    lesson,
    slide: objectivesSlide(lesson),
    findings: checkLesson(lesson),
    selection: [],
    wordingAtSelect: null,
    updated: new Set(),
    ...over,
  });

const without = (lesson: Lesson, slideId: string): Lesson => ({
  ...lesson,
  slides: lesson.slides.filter((s) => s.id !== slideId),
});

describe("objectiveNotes", () => {
  test("a taught lesson has no notes at rest", () => {
    expect(notesOf(listLesson())).toEqual([]);
  });

  test("an objective with no teaching slide is noted on its own line", () => {
    const lesson = without(listLesson(), "s-teach-2");
    expect(notesOf(lesson)).toEqual([
      {
        kind: "not-taught",
        elementId: "ob-list",
        line: 1,
        factId: "o2",
        afterSlideId: "s-teach-1",
      },
    ]);
  });

  test("Ignore (ignoredChecks) takes the note away", () => {
    const lesson = without(listLesson(), "s-teach-2");
    lesson.ignoredChecks = [{ check: "objective-taught", factId: "o2" }];
    expect(notesOf(lesson)).toEqual([]);
  });

  test("a reworded line notes the AI slides that cite it, only while the box is selected", () => {
    const before = listLesson();
    const wording = new Map(before.facts?.objectives.map((o) => [o.id, o.text]));
    const after = writeElementDoc(
      before,
      "s-objectives",
      "ob-list",
      objectivesDoc([
        { text: "describe the water cycle", id: "o1" },
        { text: "explain how evaporation and condensation are linked", id: "o2" },
      ]),
    );
    const selected = { selection: ["ob-list"], wordingAtSelect: wording };
    expect(notesOf(after, selected)).toEqual([
      { kind: "old-wording", elementId: "ob-list", line: 0, factId: "o1", slides: [4, 5] },
    ]);
    expect(notesOf(after)).toEqual([]);
    expect(notesOf(after, { ...selected, updated: new Set(["o1"]) })).toEqual([]);
  });

  test("a fifth line is red and an empty box says a lesson needs an objective", () => {
    const four = writeElementDoc(
      listLesson(),
      "s-objectives",
      "ob-list",
      objectivesDoc([
        { text: "a", id: "o1" },
        { text: "b", id: "o2" },
        { text: "c" },
        { text: "d" },
        { text: "e" },
      ]),
    );
    expect(notesOf(four).filter((n) => n.kind === "over-cap")).toEqual([
      { kind: "over-cap", elementId: "ob-list", line: 4 },
    ]);
    const empty = writeElementDoc(
      listLesson(),
      "s-objectives",
      "ob-list",
      objectivesDoc([{ text: "", id: "o1" }]),
    );
    expect(notesOf(empty)).toEqual([{ kind: "empty", elementId: "ob-list" }]);
    expect(empty.facts?.objectives).toHaveLength(2);
  });

  test("Add a slide goes after the previous objective's last teaching slide", () => {
    const lesson = listLesson();
    expect(slideAfterForObjective(lesson, "s-objectives", "o2")).toBe("s-teach-1");
    expect(slideAfterForObjective(lesson, "s-objectives", "o1")).toBe("s-objectives");
  });

  test("the sentence reads naturally for one and several slides", () => {
    expect(oldWordingSentence([4])).toBe("Slide 4 uses the old wording");
    expect(oldWordingSentence([4, 5])).toBe("Slides 4 and 5 use the old wording");
    expect(oldWordingSentence([3, 4, 5])).toBe("Slides 3, 4 and 5 use the old wording");
  });
});

describe("routing objective findings (findingsBySlide)", () => {
  test("a finding about an objective sits on the objectives slide; others keep their slide", () => {
    const lesson = without(listLesson(), "s-teach-2");
    const findings = checkLesson(lesson);
    const taught = findings.find((f) => f.check === "objective-taught");
    if (!taught) throw new Error("expected a finding");
    expect(findingSlideId(taught, lesson)).toBe("s-objectives");
    expect(
      findingsBySlide(findings, lesson)
        .get("s-objectives")
        ?.map((f) => f.check),
    ).toContain("objective-taught");
    // Without the lesson (older callers) a lesson-level finding still has no slide.
    expect(findingsBySlide(findings).get("s-objectives")).toBeUndefined();
  });
});

describe("untaughtAfterDelete", () => {
  test("names the objective that lost its last teaching slide", () => {
    const before = listLesson();
    expect(untaughtAfterDelete(before, without(before, "s-teach-2"), [6])).toBe(
      "Slide 6 deleted. Objective 2 is no longer taught on any slide.",
    );
  });

  test("several at once read as a list; nothing lost is no toast", () => {
    const before = listLesson();
    const both = without(without(before, "s-teach-1"), "s-teach-2");
    expect(untaughtAfterDelete(before, both, [5, 6])).toBe(
      "Slides 5 and 6 deleted. Objectives 1 and 2 are no longer taught on any slide.",
    );
    expect(untaughtAfterDelete(before, without(before, "s-vocab"), [3])).toBeNull();
  });

  test("an ignored objective is not toasted", () => {
    const before = listLesson();
    before.ignoredChecks = [{ check: "objective-taught", factId: "o2" }];
    expect(untaughtAfterDelete(before, without(before, "s-teach-2"), [6])).toBeNull();
  });
});
