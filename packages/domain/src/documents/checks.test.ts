import { describe, expect, test } from "bun:test";
import { checkLesson, objectivesCoveredBy } from "./checks";
import {
  generatedFrom,
  generatedLesson,
  generatedText,
  generatedWorksheet,
  lesson,
  lessonFacts,
  optionElement,
} from "./fixtures.test-helpers";
import type { Lesson } from "./lesson";
import type { LessonFacts } from "./lesson-facts";
import type { Slide, SlideElement } from "./slide";
import type { Worksheet, WorksheetBlock } from "./worksheet";

const slideOf = (l: Lesson, id: string): Slide => {
  const slide = l.slides.find((s) => s.id === id);
  if (!slide) throw new Error(`fixture has no slide ${id}`);
  return slide;
};

const blockOf = (w: Worksheet, id: string): WorksheetBlock => {
  const block = w.blocks.find((b) => b.id === id);
  if (!block) throw new Error(`fixture has no block ${id}`);
  return block;
};

describe("checkLesson", () => {
  test("a lesson without facts yields no findings", () => {
    expect(checkLesson(lesson())).toEqual([]);
    expect(checkLesson(lesson(), generatedWorksheet())).toEqual([]);
  });

  test("the generated fixture pair is clean", () => {
    expect(checkLesson(generatedLesson(), generatedWorksheet())).toEqual([]);
  });

  test("is deterministic: the same input gives the same findings twice", () => {
    const l = generatedLesson();
    l.facts = { ...lessonFacts(), durationMin: 30 };
    const w = generatedWorksheet();
    expect(checkLesson(l, w)).toEqual(checkLesson(l, w));
  });

  describe("question-answer", () => {
    test("a multiple-choice slide with no correct option is one error targeting the slide", () => {
      const l = generatedLesson();
      const slide = slideOf(l, "s-mc");
      if (slide.question?.type !== "multiple-choice") throw new Error("fixture changed");
      slide.question.options = slide.question.options.map((o) => ({ ...o, correct: false }));
      const findings = checkLesson(l);
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({
        check: "question-answer",
        severity: "error",
        target: { slideId: "s-mc" },
        fix: { kind: "set-answer" },
      });
    });

    test("an open-response slide with a blank model answer is an error; a filled one is not", () => {
      const l = generatedLesson();
      const slide = slideOf(l, "s-mc");
      slide.kind = "open-response";
      slide.question = { type: "open-response", modelAnswer: "  " };
      expect(checkLesson(l).map((f) => f.check)).toEqual(["question-answer"]);
      slide.question = { type: "open-response", modelAnswer: "Evaporation" };
      expect(checkLesson(l)).toEqual([]);
    });

    test("a fill-gap slide with an empty gap answer is an error", () => {
      const l = generatedLesson();
      const slide = slideOf(l, "s-mc");
      slide.kind = "fill-gap";
      slide.question = {
        type: "fill-gap",
        gaps: [
          { id: "g1", answer: "rain" },
          { id: "g2", answer: "" },
        ],
      };
      expect(checkLesson(l)).toEqual([
        expect.objectContaining({ check: "question-answer", target: { slideId: "s-mc" } }),
      ]);
    });

    test("a true-false slide always has an answer", () => {
      const l = generatedLesson();
      const slide = slideOf(l, "s-mc");
      slide.kind = "true-false";
      slide.question = { type: "true-false", correct: false };
      expect(checkLesson(l)).toEqual([]);
    });

    test("worksheet blocks: a question without an answer, a choice without a correct option, a gap without an answer", () => {
      const w = generatedWorksheet();
      const question = blockOf(w, "wb2");
      if (question.type !== "question") throw new Error("fixture changed");
      question.answer = "";
      const mc = blockOf(w, "wb3");
      if (mc.type !== "multiple-choice") throw new Error("fixture changed");
      mc.options = mc.options.map((o) => ({ ...o, correct: false }));
      w.blocks.push({
        id: "wb4",
        type: "fill-gap",
        doc: { type: "doc" },
        gaps: [{ id: "g", answer: " " }],
      });
      const findings = checkLesson(generatedLesson(), w).filter(
        (f) => f.check === "question-answer",
      );
      expect(findings.map((f) => f.target.blockId)).toEqual(["wb2", "wb3", "wb4"]);
      expect(findings.every((f) => f.severity === "error")).toBe(true);
    });
  });

  describe("objective-coverage", () => {
    test("an objective no element references is an error with target.factId", () => {
      const l = generatedLesson();
      for (const slide of l.slides) {
        for (const el of slide.elements) {
          if (el.generatedFrom) {
            el.generatedFrom = {
              ...el.generatedFrom,
              factRefs: el.generatedFrom.factRefs.filter((r) => r !== "o2"),
            };
          }
        }
      }
      const findings = checkLesson(l, generatedWorksheet());
      expect(findings).toEqual([
        expect.objectContaining({
          check: "objective-coverage",
          severity: "error",
          target: { factId: "o2" },
          fix: { kind: "add-objective-coverage" },
        }),
      ]);
      expect(findings[0]?.message).toContain("any slide");
    });

    test("an objective referenced on slides but not on the worksheet: skipped without a worksheet, one finding with it", () => {
      const w = generatedWorksheet();
      for (const block of w.blocks) {
        if (block.generatedFrom) {
          block.generatedFrom = {
            ...block.generatedFrom,
            factRefs: block.generatedFrom.factRefs.filter((r) => r !== "o1"),
          };
        }
      }
      expect(checkLesson(generatedLesson())).toEqual([]);
      const findings = checkLesson(generatedLesson(), w);
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({
        check: "objective-coverage",
        target: { factId: "o1" },
      });
      expect(findings[0]?.message).toContain("the worksheet");
    });

    /*
     * The production shape (Generation quality, Problem 6): three objectives, eight questions,
     * outline entries that list an objective beside the questions that practise it, and worksheet
     * blocks that reference questions only. Ids and refs, no prose.
     */
    const rodentsFacts = (): LessonFacts => ({
      objectives: [
        { id: "o1", text: "Objective one" },
        { id: "o2", text: "Objective two" },
        { id: "o3", text: "Objective three" },
      ],
      vocabulary: [{ id: "v1", term: "incisor", definition: "a front tooth" }],
      workedExamples: [],
      questions: Array.from({ length: 8 }, (_, i) => ({
        id: `q${i + 1}`,
        stem: `Question ${i + 1}`,
        answer: "a",
        reasoning: "b",
      })),
      misconceptions: [],
      outline: [
        { id: "s1", kind: "title", minutes: 2, factRefs: [] },
        { id: "s2", kind: "objectives", minutes: 3, factRefs: ["o1", "o2", "o3"] },
        { id: "s3", kind: "multiple-choice", minutes: 15, factRefs: ["o1", "q1", "q2", "q3"] },
        { id: "s4", kind: "true-false", minutes: 15, factRefs: ["o2", "q4", "q5"] },
        { id: "s5", kind: "exit-ticket", minutes: 25, factRefs: ["o3", "q6", "q7", "q8"] },
      ],
      durationMin: 60,
    });

    const rodentsLesson = (): Lesson => {
      const l = generatedLesson();
      l.facts = rodentsFacts();
      // The objectives slide names every objective literally, as the recipe does.
      const objectives = slideOf(l, "s-objectives");
      objectives.elements = [generatedText("ob-all", "Objectives", ["o1", "o2", "o3"])];
      return l;
    };

    /** A worksheet whose blocks reference the given question ids only, one block each. */
    const worksheetRefs = (refs: string[][]): Worksheet => {
      const w = generatedWorksheet();
      w.blocks = refs.map((factRefs, i) => ({
        id: `wb${i + 1}`,
        type: "question",
        doc: { type: "doc", content: [] },
        answerLines: 2,
        answer: "an answer",
        generatedFrom: generatedFrom(factRefs),
        authoredBy: "ai",
      }));
      return w;
    };

    test("A1: blocks referencing questions cover the objectives the outline links them to", () => {
      const findings = checkLesson(rodentsLesson(), worksheetRefs([["q1"], ["q4"], ["q8"]]));
      expect(findings.filter((f) => f.check === "objective-coverage")).toEqual([]);
    });

    test("A2: an objective none of the blocks' facts link to is one worksheet-side error", () => {
      const findings = checkLesson(rodentsLesson(), worksheetRefs([["q1"], ["q4"], ["q5"]]));
      const coverage = findings.filter((f) => f.check === "objective-coverage");
      expect(coverage).toHaveLength(1);
      expect(coverage[0]).toMatchObject({ severity: "error", target: { factId: "o3" } });
      expect(coverage[0]?.message).toContain("the worksheet");
      expect(coverage[0]?.message).not.toContain("any slide");
    });

    test("A3: a fact's own objectiveRefs link it to an objective the outline does not", () => {
      const l = rodentsLesson();
      const facts = rodentsFacts();
      // `objectiveRefs` on a question is the richer-facts shape (PR B); the checker reads it already.
      facts.questions[0] = {
        ...(facts.questions[0] as LessonFacts["questions"][number]),
        objectiveRefs: ["o2"],
      } as LessonFacts["questions"][number];
      l.facts = facts;
      const findings = checkLesson(l, worksheetRefs([["q1"], ["q8"]]));
      expect(findings.filter((f) => f.check === "objective-coverage")).toEqual([]);
      expect(objectivesCoveredBy(facts).get("q1")).toEqual(new Set(["o1", "o2"]));
    });

    test("A4: without a worksheet the block side is skipped, whatever the outline says", () => {
      const findings = checkLesson(rodentsLesson());
      expect(findings.filter((f) => f.check === "objective-coverage")).toEqual([]);
    });

    test("objectivesCoveredBy: an objective covers itself; a ref to no objective covers nothing", () => {
      const covers = objectivesCoveredBy(rodentsFacts());
      expect(covers.get("o1")).toEqual(new Set(["o1"]));
      expect(covers.get("q4")).toEqual(new Set(["o2"]));
      expect(covers.get("v1")).toBeUndefined();
      expect(covers.get("o9")).toBeUndefined();
    });

    test("references inside groups count as slide coverage", () => {
      const l = generatedLesson();
      const objectives = slideOf(l, "s-objectives");
      const inner = objectives.elements.filter((e) => e.id !== "ob-h");
      objectives.elements = [
        objectives.elements[0] as SlideElement,
        { id: "grp", type: "group", x: 0, y: 0, w: 1, h: 1, children: inner },
      ];
      expect(checkLesson(l, generatedWorksheet())).toEqual([]);
    });
  });

  describe("vocabulary-in-facts", () => {
    test("a term shown on the vocabulary slide that is not in facts.vocabulary is a warning", () => {
      const l = generatedLesson();
      const vocab = slideOf(l, "s-vocab");
      vocab.elements.push(generatedText("v3-term", "Precipitation", []));
      const findings = checkLesson(l, generatedWorksheet());
      expect(findings).toEqual([
        expect.objectContaining({
          check: "vocabulary-in-facts",
          severity: "warning",
          target: { slideId: "s-vocab", elementId: "v3-term" },
        }),
      ]);
      expect(findings[0]?.message).toContain("Precipitation");
    });

    test("matching is case-insensitive and reads only the first paragraph", () => {
      const l = generatedLesson();
      const vocab = slideOf(l, "s-vocab");
      const term = vocab.elements.find((e) => e.id === "v1-term");
      if (term?.type !== "text") throw new Error("fixture changed");
      term.doc = {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "EVAPORATION" }] },
          { type: "paragraph", content: [{ type: "text", text: "not a term" }] },
        ],
      };
      expect(checkLesson(l)).toEqual([]);
    });

    test("headings, definitions and other slide kinds are not read", () => {
      const l = generatedLesson();
      // The heading and definitions on the vocabulary slide are not in `facts.vocabulary` and
      // must not be flagged; neither is prose on a content slide.
      l.slides.push({
        id: "s-content",
        kind: "content",
        elements: [generatedText("c1", "Precipitation falls as rain, hail or snow.", ["o1"])],
      });
      expect(checkLesson(l)).toEqual([]);
    });

    test("an option element on a vocabulary slide is not a term", () => {
      const l = generatedLesson();
      slideOf(l, "s-vocab").elements.push(optionElement("opt", "Precipitation"));
      expect(checkLesson(l)).toEqual([]);
    });
  });

  describe("timing", () => {
    const withMinutes = (total: number, durationMin: number): Lesson => {
      const l = generatedLesson();
      const facts = lessonFacts();
      facts.durationMin = durationMin;
      facts.outline = [{ id: "s1", kind: "content", minutes: total, factRefs: [] }];
      l.facts = facts;
      return l;
    };

    test("outline minutes 70 for a 60-minute lesson is a warning", () => {
      const findings = checkLesson(withMinutes(70, 60));
      expect(findings).toEqual([
        expect.objectContaining({ check: "timing", severity: "warning", target: {} }),
      ]);
      expect(findings[0]?.message).toContain("70");
    });

    test("outline minutes 65 (and 66, 54) for a 60-minute lesson is within tolerance", () => {
      expect(checkLesson(withMinutes(65, 60))).toEqual([]);
      expect(checkLesson(withMinutes(66, 60))).toEqual([]);
      expect(checkLesson(withMinutes(54, 60))).toEqual([]);
    });

    test("53 minutes for a 60-minute lesson is a warning", () => {
      expect(checkLesson(withMinutes(53, 60)).map((f) => f.check)).toEqual(["timing"]);
    });
  });
});
