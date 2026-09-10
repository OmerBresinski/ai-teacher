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
  text,
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

  describe("quality checks (TEACH-210)", () => {
    const withPitch = (l: Lesson, sentenceLengthMax = 12, readingAgeTarget = 9) => {
      if (!l.facts) throw new Error("fixture");
      l.facts.pitch = { readingAgeTarget, sentenceLengthMax, avoid: [] };
      return l;
    };
    const contentSlide = (id: string, body: string): Slide => ({
      id,
      kind: "content",
      elements: [
        generatedText(`${id}-h`, "Heading", ["o1"], { style: { preset: "heading" } }),
        generatedText(`${id}-b`, body, ["o1"]),
      ],
    });
    const of = (findings: ReturnType<typeof checkLesson>, check: string) =>
      findings.filter((f) => f.check === check);
    const twentyWords =
      "The water in the sea is warmed by the sun until it rises into the air as a vapour cloud.";

    test("row 8: a content body averaging 20 words a sentence against sentenceLengthMax 12 is one readability warning naming 20; a 25-word MCQ stem is not", () => {
      const l = withPitch(generatedLesson());
      l.slides.push(contentSlide("s-c", `${twentyWords} ${twentyWords}`));
      const mc = slideOf(l, "s-mc");
      mc.elements[0] = generatedText(
        "q",
        "Which one of the following processes is the one that turns liquid water into vapour when the sun warms the surface of the sea?",
        ["q1", "o1"],
        { style: { preset: "heading" } },
      );
      const findings = of(checkLesson(l, generatedWorksheet()), "readability");
      const sentences = findings.filter((f) => f.message.includes("words a sentence"));
      expect(sentences).toHaveLength(1);
      expect(sentences[0]).toMatchObject({ severity: "warning", target: { slideId: "s-c" } });
      expect(sentences[0]?.message).toContain("20 words");
      expect(findings.some((f) => f.target.slideId === "s-mc")).toBe(false);
      // The message carries the measure, never the text.
      for (const f of findings) expect(f.message).not.toContain("invisible vapour");
    });

    test("readability: a body far above the reading age is a warning with the estimated age", () => {
      const l = withPitch(generatedLesson(), 40, 9);
      l.slides.push(
        contentSlide(
          "s-c",
          "Evaporation, condensation and precipitation constitute the fundamental mechanisms whereby atmospheric moisture is continuously redistributed.",
        ),
      );
      const findings = of(checkLesson(l), "readability");
      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toMatch(
        /reads at about age \d+; the pitch is a reading age of 9/,
      );
    });

    test("row 9: without facts.pitch there are no readability findings", () => {
      const l = generatedLesson();
      l.slides.push(contentSlide("s-c", `${twentyWords} ${twentyWords}`));
      expect(of(checkLesson(l, generatedWorksheet()), "readability")).toEqual([]);
    });

    test("row 10: a worksheet block stem equal to a slide stem is one repetition warning targeting the block", () => {
      const w = generatedWorksheet();
      const block = blockOf(w, "wb2");
      if (block.type !== "question") throw new Error("fixture");
      block.doc = text("Which process turns liquid water into vapour?");
      const findings = of(checkLesson(generatedLesson(), w), "repetition");
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({ severity: "warning", target: { blockId: "wb2" } });
      expect(findings[0]?.message).toContain('slide "multiple-choice"');
      expect(findings[0]?.message).not.toContain("vapour");
    });

    test("row 11: a five-word phrase repeated across slides and sheet is one warning with the count and not the phrase", () => {
      const l = generatedLesson();
      const phrase = "one pair of ever-growing incisors";
      for (let i = 0; i < 6; i++) l.slides.push(contentSlide(`s-r${i}`, `Rodents have ${phrase}.`));
      const w = generatedWorksheet();
      const block = blockOf(w, "wb2");
      if (block.type !== "question") throw new Error("fixture");
      block.doc = text(`Explain why rodents have ${phrase}.`);
      const findings = of(checkLesson(l, w), "repetition").filter((f) => !f.target.blockId);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toMatch(/most repeated 7 times/);
      expect(findings[0]?.message).not.toContain("incisors");
      // The clean fixture pair has no repetition.
      expect(of(checkLesson(generatedLesson(), generatedWorksheet()), "repetition")).toEqual([]);
    });

    test("row 12: an outline with 8 explain minutes of 60 is one explanation-share warning", () => {
      const l = generatedLesson();
      if (!l.facts) throw new Error("fixture");
      l.facts.outline = [
        { id: "s1", kind: "title", minutes: 2, factRefs: [] },
        { id: "s2", kind: "content", minutes: 8, factRefs: ["o1"] },
        { id: "s3", kind: "multiple-choice", minutes: 50, factRefs: ["q1"] },
      ];
      const findings = of(checkLesson(l), "explanation-share");
      expect(findings).toEqual([expect.objectContaining({ severity: "warning", target: {} })]);
      expect(findings[0]?.message).toContain("8 of 60 minutes");
      // 18 of 60 (exactly 30 %) passes.
      l.facts.outline[1] = { id: "s2", kind: "content", minutes: 18, factRefs: ["o1"] };
      l.facts.outline[2] = { id: "s3", kind: "multiple-choice", minutes: 40, factRefs: ["q1"] };
      expect(of(checkLesson(l), "explanation-share")).toEqual([]);
    });

    test("degenerate-question: equal MCQ options on a slide and on a block are errors with a regenerate hint", () => {
      const l = generatedLesson();
      const mc = slideOf(l, "s-mc");
      mc.elements[2] = {
        ...optionElement("o2", "evaporation"),
        generatedFrom: mc.elements[1]?.generatedFrom,
      } as SlideElement;
      const w = generatedWorksheet();
      const block = blockOf(w, "wb3");
      if (block.type !== "multiple-choice") throw new Error("fixture");
      block.options = [
        { id: "wm1", text: "Condensation", correct: true },
        { id: "wm2", text: "condensation", correct: false },
      ];
      const findings = of(checkLesson(l, w), "degenerate-question");
      expect(findings).toEqual([
        expect.objectContaining({
          severity: "error",
          target: { slideId: "s-mc" },
          fix: { kind: "regenerate-slide" },
        }),
        expect.objectContaining({
          severity: "error",
          target: { blockId: "wb3" },
          fix: { kind: "regenerate-block" },
        }),
      ]);
    });

    test("degenerate-question: a stored sort slide with a classify stem, and a true-false double statement", () => {
      const l = generatedLesson();
      l.slides.push({
        id: "s-sort",
        kind: "sort",
        elements: [
          generatedText("so-h", "Classify these animals", ["q1"], { style: { preset: "heading" } }),
          generatedText("so-1", "Rat", ["q1"]),
          generatedText("so-2", "Mouse", ["q1"]),
          generatedText("so-3", "Rabbit", ["q1"]),
        ],
        question: { type: "sort", order: ["so-1", "so-2", "so-3"] },
      });
      const half =
        "the Orcish clans first crossed into Azeroth through the Dark Portal opened by Medivh";
      l.slides.push({
        id: "s-tf2",
        kind: "true-false",
        elements: [
          generatedText("tf-h", `${half} and ${half.replace("first", "later")}`, ["q1"], {
            style: { preset: "heading" },
          }),
        ],
        question: { type: "true-false", correct: true },
      });
      const findings = of(checkLesson(l), "degenerate-question");
      expect(findings.map((f) => f.target.slideId)).toEqual(["s-sort", "s-tf2"]);
      for (const f of findings) expect(f.message).not.toMatch(/Classify|Azeroth/);
    });

    test("leaked-language: a worksheet answer key containing a guarded word is not a pupil-facing leak", () => {
      const w = generatedWorksheet();
      const block = blockOf(w, "wb2");
      if (block.type !== "question") throw new Error("fixture");
      block.answer = "The data is sent as JSON.";
      expect(of(checkLesson(generatedLesson(), w), "leaked-language")).toEqual([]);
    });

    test("degenerate-question: a starter footnote that repeats an item", () => {
      const l = generatedLesson();
      l.slides.push({
        id: "s-st",
        kind: "starter",
        elements: [
          generatedText("st-b", "1. Name a rodent.\n2. Why is it a rodent?", ["o1"]),
          generatedText("st-f", "Why is it a rodent?", [], { style: { preset: "small" } }),
        ],
      });
      const findings = of(checkLesson(l), "degenerate-question");
      expect(findings).toHaveLength(1);
      expect(findings[0]?.target).toEqual({ slideId: "s-st" });
    });

    test("degenerate-question (TEACH-223/226): a stem that asks nothing, or a task about a decision no question posed, is an error; a real question is fine", () => {
      const l = generatedLesson();
      const open = (id: string, stem: string): Slide => ({
        id,
        kind: "open-response",
        elements: [generatedText(`${id}-h`, stem, ["o1"], { style: { preset: "heading" } })],
        question: { type: "open-response" },
      });
      l.slides.push(
        open("s-none", "The rodent family."),
        open(
          "s-anaphor",
          "An animal has one pair of upper incisors, one lower pair and a diastema. Explain your decision using these shared features.",
        ),
        open("s-ok", "Is it a rodent? Explain your decision."),
        {
          id: "s-exit",
          kind: "exit-ticket",
          elements: [
            generatedText("ex-h", "Show what you know", ["o1"], { style: { preset: "heading" } }),
            generatedText("ex-b", "1. Give two features of rodents.\n2. Rodent teeth.", ["o1"]),
          ],
        },
      );
      const w = generatedWorksheet();
      w.blocks.push({
        id: "b-q",
        type: "question",
        doc: {
          type: "doc",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "Explain why it melts." }] },
          ],
        },
        answerLines: 2,
        authoredBy: "ai",
      } as WorksheetBlock);
      const findings = of(checkLesson(l, w), "degenerate-question");
      const by = (id: string) =>
        findings.filter((f) => f.target.slideId === id || f.target.blockId === id);
      expect(by("s-none").map((f) => f.severity)).toEqual(["error"]);
      // An error since TEACH-226, so Repair rewrites it with the question first.
      expect(by("s-anaphor").map((f) => [f.severity, f.fix?.kind])).toEqual([
        ["error", "regenerate-slide"],
      ]);
      expect(by("s-anaphor")[0]?.message).toContain("no question posed");
      expect(by("s-ok")).toEqual([]);
      // Only the second exit-ticket item asks nothing.
      expect(by("s-exit").map((f) => [f.severity, f.message.includes("Rodent teeth")])).toEqual([
        ["error", true],
      ]);
      expect(by("b-q").map((f) => [f.severity, f.fix?.kind])).toEqual([
        ["error", "regenerate-block"],
      ]);
    });

    test("leaked-language: house rules in pupil text and repair commentary in notes are errors; the clean fixture has none", () => {
      const l = generatedLesson();
      l.slides.push(contentSlide("s-l", "Hand in your answers — no names needed."));
      const mc = slideOf(l, "s-mc");
      mc.notes = "Corrected the rodent definition so that it matches the facts.";
      const w = generatedWorksheet();
      const block = blockOf(w, "wb2");
      if (block.type !== "question") throw new Error("fixture");
      block.doc = text("Answer as JSON.");
      const findings = of(checkLesson(l, w), "leaked-language");
      expect(findings.map((f) => [f.target, f.fix?.kind])).toEqual([
        [{ slideId: "s-mc" }, "regenerate-slide"],
        [{ slideId: "s-l" }, "regenerate-slide"],
        [{ blockId: "wb2" }, "regenerate-block"],
      ]);
      for (const f of findings) expect(f.message).not.toMatch(/no names|JSON|Corrected/);
      expect(of(checkLesson(generatedLesson(), generatedWorksheet()), "leaked-language")).toEqual(
        [],
      );
    });
  });
});
