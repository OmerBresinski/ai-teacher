import { describe, expect, test } from "bun:test";
import { checkLesson, objectivesCoveredBy, teachingSlides } from "./checks";
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
import { questionless } from "./quality-checks";
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
      const findings = checkLesson(l, generatedWorksheet()).filter(
        (f) => f.check === "objective-coverage",
      );
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

    test("the objectives slide naming an objective does not cover it (ruling 96)", () => {
      const l = generatedLesson();
      l.slides = l.slides.filter((s) => s.id !== "s-teach-2");
      const coverage = checkLesson(l, generatedWorksheet()).filter(
        (f) => f.check === "objective-coverage",
      );
      // o2 is still named on the objectives slide (`ob-2`), which no longer counts.
      expect(coverage.map((f) => f.target.factId)).toEqual(["o2"]);
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
        { id: "s1", kind: "title", factRefs: [] },
        { id: "s2", kind: "objectives", factRefs: ["o1", "o2", "o3"] },
        { id: "s3", kind: "multiple-choice", factRefs: ["o1", "q1", "q2", "q3"] },
        { id: "s4", kind: "true-false", factRefs: ["o2", "q4", "q5"] },
        { id: "s5", kind: "exit-ticket", factRefs: ["o3", "q6", "q7", "q8"] },
      ],
      durationMin: 60,
    });

    const rodentsLesson = (): Lesson => {
      const l = generatedLesson();
      l.facts = rodentsFacts();
      // The objectives slide names every objective literally, as the recipe does.
      const objectives = slideOf(l, "s-objectives");
      objectives.elements = [generatedText("ob-all", "Objectives", ["o1", "o2", "o3"])];
      // Every objective is taught on a slide; these tests are about the worksheet half.
      slideOf(l, "s-teach-1").elements.push(
        generatedText("c1-all", "All three", ["o1", "o2", "o3"]),
      );
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
      const content = slideOf(l, "s-teach-2");
      content.elements = [
        { id: "grp", type: "group", x: 0, y: 0, w: 1, h: 1, children: content.elements },
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

  describe("objective-taught (ruling 81)", () => {
    /** While the slides are still being written the outline is the rule. */
    const withOutline = (outline: LessonFacts["outline"]): Lesson => {
      const l = generatedLesson();
      const facts = lessonFacts();
      facts.outline = outline;
      l.facts = facts;
      if (l.generation) l.generation.stage = "planned";
      return l;
    };
    const taught = (l: Lesson) => checkLesson(l).filter((f) => f.check === "objective-taught");

    test("an objective no content, picture or worked-example entry names is one warning, by position", () => {
      const findings = taught(
        withOutline([
          { id: "s1", kind: "title", factRefs: [] },
          { id: "s2", kind: "objectives", factRefs: ["o1", "o2"] },
          { id: "s3", kind: "content", factRefs: ["o1"] },
          { id: "s4", kind: "vocabulary", factRefs: ["o2", "v1"] },
          { id: "s5", kind: "multiple-choice", factRefs: ["o2", "q1"] },
        ]),
      );
      expect(findings).toEqual([
        {
          check: "objective-taught",
          severity: "warning",
          target: { factId: "o2" },
          message: "Objective 2 has no slide that teaches it.",
        },
      ]);
    });

    test("an image-text or worked-example entry teaches", () => {
      expect(
        taught(
          withOutline([
            { id: "s3", kind: "image-text", factRefs: ["o1"] },
            { id: "s4", kind: "worked-example", factRefs: ["o2"] },
          ]),
        ),
      ).toEqual([]);
    });

    test("an empty outline is not checked", () => {
      expect(taught(withOutline([]))).toEqual([]);
    });

    describe("once the deck exists, the slides decide (ruling 96)", () => {
      test("the generated lesson teaches both objectives", () => {
        expect(taught(generatedLesson())).toEqual([]);
        expect(teachingSlides(generatedLesson())).toEqual(
          new Map([
            ["o1", ["s-teach-1"]],
            ["o2", ["s-teach-2"]],
          ]),
        );
      });

      test("deleting the only slide teaching o2 is one warning, although the outline still names it", () => {
        const l = generatedLesson();
        l.slides = l.slides.filter((s) => s.id !== "s-teach-2");
        expect(taught(l)).toEqual([
          {
            check: "objective-taught",
            severity: "warning",
            target: { factId: "o2" },
            message: "Objective 2 has no slide that teaches it.",
          },
        ]);
      });

      test("the objectives slide, question slides and vocabulary never teach", () => {
        const l = generatedLesson();
        l.slides = l.slides.filter((s) => s.kind !== "content");
        expect(taught(l).map((f) => f.target.factId)).toEqual(["o1", "o2"]);
        expect(teachingSlides(l)).toEqual(
          new Map([
            ["o1", []],
            ["o2", []],
          ]),
        );
      });

      test("a slide citing a fact that stands for the objective teaches it", () => {
        const l = generatedLesson();
        l.slides = l.slides.filter((s) => s.id !== "s-teach-2");
        l.slides.push({
          id: "s-x",
          kind: "worked-example",
          elements: [generatedText("x", "A puddle dries up.", ["x1"])],
        });
        if (!l.facts) throw new Error("fixture");
        (l.facts.workedExamples[0] as { objectiveRefs?: string[] }).objectiveRefs = ["o2"];
        expect(taught(l)).toEqual([]);
        expect(teachingSlides(l).get("o2")).toEqual(["s-x"]);
      });

      test("an ignored check for that objective is left out, and only for that objective", () => {
        const l = generatedLesson();
        l.slides = l.slides.filter((s) => s.kind !== "content");
        l.ignoredChecks = [{ check: "objective-taught", factId: "o2" }];
        expect(taught(l).map((f) => f.target.factId)).toEqual(["o1"]);
        // Ignoring one check never hides another about the same fact.
        expect(
          checkLesson(l)
            .filter((f) => f.check === "objective-coverage")
            .map((f) => f.target.factId),
        ).toEqual(["o2"]);
      });
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

    test("row 12: explanation-share counts slides after title and objectives, rounding the floor down", () => {
      const l = generatedLesson();
      if (!l.facts) throw new Error("fixture");
      const practice = (n: number) =>
        Array.from({ length: n }, (_, i) => ({
          id: `p${i}`,
          kind: "multiple-choice" as const,
          factRefs: ["q1"],
        }));
      // 7 slides after title/objectives: floor(7 × 30 %) = 2 explain slides needed; 1 is short.
      l.facts.outline = [
        { id: "s1", kind: "title", factRefs: [] },
        { id: "s2", kind: "objectives", factRefs: ["o1"] },
        { id: "s3", kind: "content", factRefs: ["o1"] },
        ...practice(6),
      ];
      const findings = of(checkLesson(l), "explanation-share");
      expect(findings).toEqual([expect.objectContaining({ severity: "warning", target: {} })]);
      expect(findings[0]?.message).toContain("1 of 7 slides");
      // 2 of 7 meets the floor.
      l.facts.outline = [
        ...l.facts.outline.slice(0, 3),
        { id: "s4", kind: "worked-example", factRefs: ["o1"] },
        ...practice(5),
      ];
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

describe("questionless (quality lab, Sept 2026)", () => {
  test("a quoted line or a leading condition before the task still sets a task (l6e)", () => {
    expect(
      questionless(
        "Suppose Prospero tells a spirit, “Wait here until I return.” Explain how the command establishes his authority.",
      ),
    ).toBe("ok");
    expect(
      questionless(
        "Suppose several streaming services compete. If one service raises its price, explain why demand for that service may be responsive.",
      ),
    ).toBe("ok");
    expect(questionless("If it rains, the ground.")).toBe("no-question");
  });
  test('"your answer" to a task set earlier in the same sentence has its referent (l6f)', () => {
    expect(
      questionless(
        "Suppose 36 beads are shared in the ratio 1:3. Explain how to find each share and check your answer.",
      ),
    ).toBe("ok");
    expect(questionless("Share £72 in the ratio 5:7, then check your answer.")).toBe("ok");
    expect(questionless("A shop sells pens. Look again and check your answer.")).toBe(
      "no-referent",
    );
    expect(questionless("A shop sells pens. Explain your answer.")).toBe("no-referent");
  });
  test("an imperative whose referents follow a colon is a question, not a dangling task", () => {
    expect(
      questionless("Put these dates in order from earliest to latest: AD 43, AD 410, AD 1."),
    ).toBe("ok");
    expect(questionless("Sort these into two groups.")).toBe("no-referent");
    expect(questionless("Explain your decision: focus on the evidence.")).toBe("no-referent");
    expect(questionless("A fort has a ditch. Explain your decision.")).toBe("no-referent");
  });
});

describe('questionless: a bare "it" (lab round 1, cb-y1-animals-P/L)', () => {
  test('"it" after a noun it can name is not a dangling task', () => {
    // Recorded stems that raised degenerate-question and set off harmful repairs.
    expect(questionless("Explain how a puppy changes as it grows into an adult dog.")).toBe("ok");
    expect(questionless("Describe two changes a kitten may make as it becomes an adult cat.")).toBe(
      "ok",
    );
    expect(
      questionless("Explain how a caterpillar changes before it becomes an adult butterfly."),
    ).toBe("ok");
    expect(questionless("Explain why Prospero forgives them when it is in his power.")).toBe("ok");
  });

  test('"it" with nothing before it to name is still dangling', () => {
    expect(questionless("Explain why it melts.")).toBe("no-referent");
    expect(questionless("Describe how it moves.")).toBe("no-referent");
    expect(questionless("Is it a rodent? Explain why it is.")).toBe("ok");
  });
});

describe('questionless: "it" naming a noun in an earlier sentence (lab round 2)', () => {
  test("a scenario sentence gives the task its referent", () => {
    // Recorded false degenerate-question errors (r1-h-y2-plants-L slide 7, r1-cb-y1-animals-L exit).
    expect(
      questionless(
        "Suppose a small plant is left in a dark cupboard. Explain why it may grow weak and pale.",
      ),
    ).toBe("ok");
    expect(
      questionless("A foal is a young horse. Explain how you know it will become an adult horse."),
    ).toBe("ok");
    expect(
      questionless(
        "A lamb is a young sheep. Explain why it will grow into an adult sheep, not a goat or rabbit.",
      ),
    ).toBe("ok");
  });

  test("an earlier sentence with no noun phrase does not rescue it", () => {
    expect(questionless("Look closely. Explain why it melts.")).toBe("no-referent");
    expect(questionless("Ice is cold. Explain why it melts.")).toBe("no-referent");
    // "your decision" is not "it": a scenario still poses no decision.
    expect(questionless("A fort has a ditch. Explain your decision.")).toBe("no-referent");
  });
});

describe("questionless: a label or length frame before the task (lab round 2)", () => {
  test("recorded exit items that open with a label or frame are tasks", () => {
    expect(
      questionless(
        "Exit: Name one way Freud proposed that repressed material might appear indirectly.",
      ),
    ).toBe("ok");
    expect(
      questionless("In one line, explain why increasing surface area increases reaction rate."),
    ).toBe("ok");
    expect(
      questionless("In one sentence, explain what coastal erosion does and where it happens."),
    ).toBe("ok");
    expect(
      questionless(
        "Exit: Complete the sentence: Evacuated children did not all have the same experience because…",
      ),
    ).toBe("ok");
  });

  test("a label and a length frame stacked, and 'finish' as the imperative, are tasks (luna-direct, gpt-6-luna at low)", () => {
    expect(questionless("Exit: In one line, explain what billeting arranged for evacuees.")).toBe(
      "ok",
    );
    expect(questionless("Exit: Finish the sentence: Plants need light so their leaves can…")).toBe(
      "ok",
    );
    expect(questionless("Finish the sentence: A ratio compares two quantities by…")).toBe("ok");
    expect(questionless("In one line, exit: name one push factor.")).toBe("ok");
  });

  test("a label with no task after it still asks nothing", () => {
    expect(questionless("The rodent family.")).toBe("no-question");
    expect(questionless("Exit: In one line, the rodent family.")).toBe("no-question");
    expect(questionless("Exit: The rodent family.")).toBe("no-question");
    expect(questionless("In one line, the rodent family.")).toBe("no-question");
    expect(questionless("Exit: Explain why it melts.")).toBe("no-referent");
    expect(questionless("Compare these: a seawall, a groyne.")).toBe("ok");
  });

  test("recorded maths tasks (r1-h-y7-ratio-P) are tasks", () => {
    expect(questionless("Simplify 42:56 and explain why your new ratio is equivalent.")).toBe("ok");
    expect(
      questionless(
        "A learner shares 48 in the ratio 1:3 as 16 and 32. Spot and explain the error.",
      ),
    ).toBe("ok");
    expect(questionless("Share £72 in the ratio 5:7. Give a check for your answer.")).toBe("ok");
    expect(
      questionless(
        "Share 42 counters in the ratio 2:5. Explain how you know your answer is consistent with the ratio.",
      ),
    ).toBe("ok");
  });
});

describe("questionless: every recorded l6 instance, and stems that really ask nothing (l6-i)", () => {
  // Every stem the check raised in the l6 lab outputs (baseline, b2, C to H): all are tasks.
  const recorded: [round: string, stem: string][] = [
    [
      "D, E",
      "Suppose Prospero tells a spirit, “Wait here until I return.” Explain how the command establishes his authority.",
    ],
    [
      "C, D",
      "Suppose Prospero tells a servant, “Bring the book.” Explain what this command suggests about his power and what it cannot prove about the servant’s feelings.",
    ],
    [
      "C",
      "A reader says, “Prospero can influence Ariel only through magic.” Explain how Prospero’s words can influence Ariel and why this challenges the reader’s claim.",
    ],
    [
      "D",
      "A reader says, “Because the audience knows Prospero arranged a spectacle that the characters do not understand, he has complete power over everyone.” Explain how the dramatic irony shapes the audience’s view of Prospero’s authority, and why the reader’s conclusion is too absolute.",
    ],
    [
      "b2",
      "A child says, “A plant gets its food from the soil.” Explain what the roots and leaves really do.",
    ],
    [
      "C",
      "Suppose several similar music-streaming services compete. If one service raises its price, explain why demand for that service may be responsive.",
    ],
    [
      "G",
      "A firm estimates a product’s PED as −1.2. Classify its demand and explain what this indicates about quantity demanded’s proportional response to price.",
    ],
    [
      "G",
      "A firm says demand for its essential home internet service must be price inelastic in every circumstance. Assess this claim, including how demand might change over time.",
    ],
    [
      "E, H",
      "Suppose 36 beads are shared in the ratio 1:3. Explain how to find each share and check your answer.",
    ],
    [
      "H",
      "Suppose two amounts are in the ratio 16:28. Divide both parts by their highest common factor to give the simplest whole-number ratio.",
    ],
    [
      "H",
      "A child says evacuees chose their host families before leaving. Correct this account, explaining how they travelled and where the arrangements were made.",
    ],
    [
      "baseline",
      "A particular brand of washing-up liquid has few close alternatives and costs little. Explain how these features affect its likely price elasticity of demand.",
    ],
    // Verbs no list names, told by "<verb> <object>".
    ["new verb", "Water the seedlings daily and record their height."],
    ["new verb", "Trace the route the evacuees took."],
    ["new verb", "Water is needed. Rearrange the steps into the right order."],
    // K18 h arm: a leading frame of any kind, ending in a comma, before the command (l6-k).
    [
      "K18",
      "In a new coastal town, explain how a sea wall and a groyne reduce erosion by different means.",
    ],
    [
      "K18",
      "In “the silent Iron Man with a cracked helmet”, explain how “silent” and “with a cracked helmet” add different details.",
    ],
    [
      "K18",
      "In « Elle a chanté », explain how the two parts combine to describe a completed action and why each part is written that way.",
    ],
    [
      "K18",
      "For the regular verb jouer, explain how to form its past participle and give the result.",
    ],
    ["K18", "Besides keeping it firm, name one way water helps a plant."],
    // Other frames the rule covers without a list of them.
    ["frame", "In 1940, during the Blitz, explain why children were evacuated."],
    ["frame", "Having read the extract, identify two ways Prospero shows power."],
    ["frame", "Briefly, describe the water cycle."],
    ["frame", "Exit: In your own words, explain what a groyne does."],
    ["frame", "Using the map, trace the route the evacuees took."],
    ["frame", "Weigh the bags daily."],
  ];
  test.each(recorded)("%s: %s sets a task", (_round, stem) => {
    expect(questionless(stem)).toBe("ok");
  });

  const asksNothing: string[] = [
    "The rodent family.",
    "Exit: The rodent family.",
    "Plants need light and water.",
    "Evacuees travelled by train to the countryside.",
    "Children who were evacuated travelled by train.",
    "Demand for bread is price inelastic.",
    "Suppose 36 beads are shared in the ratio 1:3.",
    "Suppose two amounts are in the ratio 16:28.",
    "Consider the ratio 16:28.",
    "A firm estimates a product’s PED as −1.2.",
    "A child says, “A plant gets its food from the soil.”",
    "Suppose Prospero tells a spirit, “Wait here.”",
    "All the animals are mammals.",
    "In the Blitz, many children were evacuated.",
    "Sharing the sweets equally is fair.",
    "Finally the war ended.",
    "Alfred the Great ruled Wessex.",
    "Using the diagram.",
    "If it rains, the ground.",
    // Frames and appositives the l6-k rule must not mistake for a task.
    "Prospero the magician rules the island.",
    "Prospero the magician controls Ariel.",
    "Ariel the spirit obeyed the command.",
    "In the Blitz, children carried gas masks, name tags and food.",
    "Evacuees carried gas masks, name tags and food.",
    "In a new coastal town, the sea wall protects the houses.",
    "For the regular verb jouer, the past participle is joué.",
    "In 1940, when bombs fell, children left the cities.",
    "If prices rise, is demand elastic.",
    "In “the silent Iron Man”, the adjective adds detail.",
    "Suppose Prospero tells a spirit, “Explain yourself.”",
  ];
  test.each(asksNothing)("%s asks nothing", (stem) => {
    expect(questionless(stem)).toBe("no-question");
  });

  const leansOnNothing: string[] = [
    "Sort these into two groups.",
    "Ice is cold. Sort these into two groups.",
    "A bat has wings. Sort these into two groups.",
    "A fort has a ditch. Explain your decision.",
    "A shop sells pens. Explain your answer.",
    "Explain why it melts.",
  ];
  test.each(leansOnNothing)("%s leans on a question never posed", (stem) => {
    expect(questionless(stem)).toBe("no-referent");
  });
});
