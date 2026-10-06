import { describe, expect, test } from "bun:test";
import type { Lesson, LessonFacts, OutlineEntry } from "@tj/domain/documents";
import romansFixture from "../fixtures/objective-facts.y4-history-romans.json";
import { codedSetSpec } from "../planner/coded-slides";
import { labAi, romansLesson } from "../planner/testing";
import { recordingDeps } from "../testing";
import { runLessonPipeline } from "../workflow";
import { setFitReason, setFits, withAnswersInNotes } from "./designer";

/* Designer eval r2 (30 Sep 2026): the leaks and the unflagged unfit slides, fixed in code. */

const starterFacts = (answers: string[]): LessonFacts => ({
  objectives: romansFixture.objectives as LessonFacts["objectives"],
  vocabulary: [],
  workedExamples: [],
  questions: [],
  misconceptions: [],
  outline: [],
  durationMin: 60,
  retrieval: answers.map((answer, i) => ({ question: `Question ${i + 1}?`, answer })),
});
const starter: OutlineEntry = { id: "s3", kind: "starter", factRefs: [] };

describe("r2 leaks", () => {
  test("a starter whose answers move to the notes carries the answers line once (14 of 16 r2 decks had it twice)", () => {
    const coded = codedSetSpec(
      starter,
      starterFacts(["Lava", "A level of material", "To keep it"]),
      "x",
    );
    if (!coded) throw new Error("no starter");
    expect(coded.spec.notes).toBe("Answers: 1. Lava 2. A level of material 3. To keep it");
    const moved = withAnswersInNotes(coded.spec, coded.answers);
    expect(moved.notes?.split("\n").filter((l) => l.startsWith("Answers:"))).toEqual([
      "Answers: 1. Lava 2. A level of material 3. To keep it",
    ]);
    // Moved means gone from the face: no answers strip left to reveal.
    expect((moved as { footnote?: string }).footnote).toBeUndefined();
    // A teacher's own note beside the answers stays.
    const withTalk = withAnswersInNotes(
      { ...coded.spec, notes: `Recap first.\n${coded.spec.notes}` },
      coded.answers,
    );
    expect(withTalk.notes).toBe(
      "Recap first.\nAnswers: 1. Lava 2. A level of material 3. To keep it",
    );
  });

  test("a set that fails the save gate gets a reason naming its themes", () => {
    // Ruling 159: long answers no longer take room under their questions, so the set is crowded
    // by its questions: five at the item limit.
    const q = "A very long question that keeps going and going ".repeat(4).trim().slice(0, 158);
    const spec = {
      kind: "starter",
      factRefs: [],
      heading: "Quick check",
      items: [1, 2, 3, 4, 5].map((n) => `${q}${n}?`),
      footnote: "Answers: 1 a  ·  2 b  ·  3 c  ·  4 d  ·  5 e",
    } as unknown as Parameters<typeof setFits>[0];
    expect(setFits(spec)).toBe(false);
    expect(setFitReason(spec)).toMatch(/^fails on \d+ of 10 themes \(/);
  });
});

describe("r2 gate: every saved slide fits or is flagged with why", () => {
  test("the report records each slot as designed and landed, and a flagged slot has a fit finding", async () => {
    const ai = labAi({
      retrieval: [
        { question: "What is an empire?", answer: "Lands ruled by one ruler" },
        { question: "Who were the Celts?", answer: "People living in Britain" },
        { question: "What is a soldier?", answer: "Someone who fights in an army" },
      ],
    });
    const deps = recordingDeps(ai);
    const lesson = romansLesson();
    const final = await runLessonPipeline(
      {
        lesson: {
          ...lesson,
          brief: { ...(lesson.brief as NonNullable<Lesson["brief"]>), slideCount: 10 },
        },
      },
      deps,
      { planner: "designer" },
    );
    const report = final.designReport;
    for (const s of report?.slots ?? []) {
      expect(s.designed).toBeDefined();
      expect((s.landed as { form: string }).form).toBe(s.form);
      if (s.rung === "flagged") expect(s.reason).toBeTruthy();
    }
    const fitFindings = (final.lesson.generation?.findings ?? []).filter((f) => f.check === "fit");
    const flaggedCount = (report?.slots ?? []).filter((s) => s.rung === "flagged").length;
    expect(fitFindings.length).toBe(flaggedCount + (report?.unfitSets?.length ?? 0));
    for (const f of fitFindings)
      expect(f.message).toMatch(/does not fit the save gate: it fails on/);
  });
});
