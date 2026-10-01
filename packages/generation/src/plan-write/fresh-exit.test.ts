import { describe, expect, test } from "bun:test";
import type { LessonFacts, Slide } from "@tj/domain/documents";
import { DEMO_LESSON_FACTS, text } from "@tj/slides";
import { closingQuestionsWritten, freshClosingItems, freshClosingWritten } from "./closing";
import { fitWritten } from "./fit";
import { freshExitItems, inLessonQuestions, SIMILARITY_MAX, similarity } from "./fresh-exit";
import { setSchema } from "./menu";

const R = { x: 0, y: 0, w: 400, h: 40 };
const el = (s: string, name?: string) => text("body", s, R, {}, name ? { name } : {});
const slide = (kind: string, lines: (string | [string, string])[]): Slide =>
  ({
    id: `s-${kind}-${lines.length}`,
    kind,
    elements: lines.map((l) => (typeof l === "string" ? el(l) : el(l[0], l[1]))),
  }) as unknown as Slide;

const facts: LessonFacts = {
  ...DEMO_LESSON_FACTS,
  objectives: [
    { id: "o1", text: "Explain how igneous rocks form." },
    { id: "o2", text: "Describe how sedimentary rocks form." },
    { id: "o3", text: "Group rocks using their properties." },
  ],
  vocabulary: [],
  workedExamples: [],
  keyIdeas: [
    {
      id: "k1",
      statement: "Igneous rock forms from melted rock",
      explanation: "",
      example: "",
      objectiveRefs: ["o1"],
    },
    {
      id: "k2",
      statement: "Sedimentary rock forms from layers",
      explanation: "",
      example: "",
      objectiveRefs: ["o2"],
    },
    {
      id: "k3",
      statement: "Crystals and grains are clues",
      explanation: "",
      example: "",
      objectiveRefs: ["o3"],
    },
    {
      id: "k4",
      statement: "Your turn: sort the rocks",
      explanation: "",
      example: "",
      objectiveRefs: ["o1", "o2", "o3"],
    },
  ],
  questions: [
    {
      id: "q1",
      stem: "Which process makes metamorphic rock?",
      answer: "Heat and pressure",
      reasoning: "",
      objectiveRefs: ["o1"],
    },
    {
      id: "q2",
      stem: "Name the rock group that often holds fossils.",
      answer: "Sedimentary",
      reasoning: "",
      objectiveRefs: ["o2"],
    },
  ],
  misconceptions: [
    {
      id: "m1",
      belief:
        "Metamorphic rocks form when rock melts. In fact, heat and pressure change solid rock without melting it.",
      correction: "",
      objectiveRefs: ["o1", "o2", "o3"],
    },
  ],
  outline: [
    { id: "s1", kind: "title", factRefs: ["o1"] },
    { id: "s2", kind: "multiple-choice", factRefs: ["o1", "q1"] },
  ],
} as LessonFacts;

const slides: Slide[] = [
  slide("title", ["Rocks"]),
  slide("objectives", ["Explain how igneous rocks form."]),
  slide("starter", [
    ["Do now", "Heading"],
    ["STARTER", "Kind tag"],
    ["What is a solid made of?", "Row text"],
    ["Hard", "Row reveal"],
  ]),
  slide("content", [
    ["Igneous rock forms from melted rock", "Heading"],
    "Granite has crystals that fit together.",
  ]),
  slide("multiple-choice", ["Which process makes metamorphic rock?"]),
  slide("content", [
    ["Your turn", "Heading"],
    ["PRACTICE", "Kind tag"],
    ["1: Sort granite, sandstone and marble into rock groups.", "Point"],
  ]),
];

describe("similarity", () => {
  test("a verbatim repeat is 1, whatever its case and punctuation", () => {
    expect(
      similarity("Which process makes metamorphic rock?", "which process makes METAMORPHIC rock"),
    ).toBe(1);
  });
  test("a stem wrapped in a short frame is still a repeat", () => {
    const stem = "Which process makes metamorphic rock from solid rock underground?";
    expect(similarity(`Explain your answer: ${stem}`, stem)).toBeGreaterThanOrEqual(SIMILARITY_MAX);
  });
  test("another question on the same topic is not", () => {
    expect(
      similarity("Describe how fossils form in sediment.", "Which process makes metamorphic rock?"),
    ).toBeLessThan(SIMILARITY_MAX);
  });
});

describe("the lesson's own questions", () => {
  test("starter, question and tagged practice text, without headings, tags, reveals or teaching slides", () => {
    expect(inLessonQuestions(slides)).toEqual([
      "What is a solid made of?",
      "Which process makes metamorphic rock?",
      "1: Sort granite, sandstone and marble into rock groups.",
    ]);
  });
});

describe("fresh exit items", () => {
  const items = freshExitItems(facts, slides, { max: 3 });

  test("none is, or is close to, a question the lesson asked", () => {
    expect(items.length).toBeGreaterThan(0);
    for (const i of items) {
      for (const q of inLessonQuestions(slides))
        expect(similarity(i.question, q)).toBeLessThan(SIMILARITY_MAX);
      expect(i.similarity).toBeLessThan(SIMILARITY_MAX);
    }
    expect(items.map((i) => i.question)).not.toContain("Which process makes metamorphic rock?");
  });

  test("every objective is covered, one item each, within the set's maximum", () => {
    expect(items).toHaveLength(3);
    for (const o of facts.objectives)
      expect(items.some((i) => i.objectiveRefs.includes(o.id))).toBe(true);
  });

  test("a fact question no slide asked is preferred, word for word", () => {
    const q2 = items.find((i) => i.source === "q2");
    expect(q2).toMatchObject({
      form: "fact-question",
      question: "Name the rock group that often holds fossils.",
    });
  });

  test("an objective is asked as 'explain how', answered by its key ideas, never by a practice prompt", () => {
    const o3 = items.find((i) => i.source === "o3");
    expect(o3).toMatchObject({
      form: "explain-objective",
      question: "Explain how to group rocks using their properties.",
      answer: "Crystals and grains are clues.",
    });
  });

  test("a reused fact changes form: a misconception becomes 'explain why they are wrong'", () => {
    const all = freshExitItems(facts, slides, { max: 9 });
    const m = all.find((i) => i.source === "m1");
    expect(m?.form).toBe("explain-misconception");
    expect(m?.question).toBe(
      "A classmate says: “Metamorphic rocks form when rock melts.” Explain why they are wrong.",
    );
    expect(m?.answer).toBe("Heat and pressure change solid rock without melting it.");
  });

  test("an asked question with a short answer is turned round, never repeated", () => {
    const all = freshExitItems(facts, slides, { max: 9 });
    const q1 = all.find((i) => i.source === "q1");
    expect(q1?.form).toBe("answer-to-question");
    expect(q1?.question).toBe(
      "Write a new question from today's lesson whose answer is “Heat and pressure”.",
    );
    expect(similarity(q1?.question ?? "", "Which process makes metamorphic rock?")).toBeLessThan(
      SIMILARITY_MAX,
    );
  });

  test("a candidate too like a lesson question is dropped, even when it would cover an objective", () => {
    const asks = [
      ...slides,
      slide("multiple-choice", ["Explain how to group rocks using their properties?"]),
    ];
    const out = freshExitItems(facts, asks, { max: 3 });
    expect(out.find((i) => i.source === "o3")).toBeUndefined();
    // o3 is still covered, by the misconception, which serves every objective.
    expect(out.some((i) => i.objectiveRefs.includes("o3"))).toBe(true);
  });

  test("a set that does not fit takes a shorter answer, then a shorter question, before dropping an item", () => {
    const long: LessonFacts = {
      ...facts,
      questions: [],
      misconceptions: [],
      objectives: [
        { id: "o1", text: "Explain how igneous rocks form, including granite and basalt." },
      ],
      keyIdeas: [
        {
          id: "k1",
          statement: "Igneous rock forms from melted rock",
          explanation: "",
          example: "",
          objectiveRefs: ["o1"],
        },
        {
          id: "k2",
          statement: "Cooling speed sets crystal size",
          explanation: "",
          example: "",
          objectiveRefs: ["o1"],
        },
      ],
    } as LessonFacts;
    const short = (qs: readonly { question: string; answer: string }[]) =>
      qs.every((q) => q.answer.length < 40 && q.question.length < 40);
    const [only] = freshExitItems(long, [], { max: 3, fits: short });
    expect(only).toMatchObject({
      question: "Explain how igneous rocks form.",
      answer: "Igneous rock forms from melted rock.",
    });
  });

  test("no two items share a source or an answer", () => {
    const sources = items.map((i) => i.source);
    expect(new Set(sources).size).toBe(sources.length);
    const answers = items.map((i) => i.answer.toLowerCase());
    expect(new Set(answers).size).toBe(answers.length);
  });
});

describe("the fresh closing set", () => {
  test("within the exit-ticket set's schema and fitting every theme with answers revealed", () => {
    const out = freshClosingWritten(facts, slides);
    expect(out).toBeDefined();
    if (!out) return;
    expect(setSchema("exit-ticket").safeParse(out).success).toBe(true);
    expect(fitWritten("exit-ticket", "exit-ticket", out).ok).toBe(true);
    expect(out.notes).toContain("not ones asked earlier");
    expect(out.questions).toEqual(
      freshClosingItems(facts, slides).map(({ question, answer }) => ({ question, answer })),
    );
  });

  test("a lesson with nothing fresh to ask keeps the reference slide", () => {
    const bare = { ...facts, questions: [], misconceptions: [], keyIdeas: [] } as LessonFacts;
    expect(freshClosingWritten(bare, slides)).toBeUndefined();
    expect(closingQuestionsWritten([])).toBeUndefined();
  });
});
