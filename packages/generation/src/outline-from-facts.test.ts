import { describe, expect, test } from "bun:test";
import { SLIDE_COUNTS, type SlideCount } from "@tj/domain/documents";
import {
  clip,
  EXIT_MAX,
  EXIT_MIN,
  type OutlineFacts,
  outlineFromFacts,
} from "./outline-from-facts";
import { questionLine } from "./planner/coded-slides";
import { slidesFor } from "./prompts/shape";
import { type LessonShape, lessonShapeOf } from "./shapes";
import { assignFactIds, planSkeletonSchemaFor } from "./specs";

/*
 * The outline step over small synthetic facts (the five real briefs are
 * `outline-from-facts.fixtures.test.ts`): the count, the priorities, the slide shares, the question
 * kinds, the briefs, the callouts, the gaps, and the two gates every outline has always passed —
 * `planSkeletonSchemaFor` and `assignFactIds`.
 */

const obj = (index: number) => ({ type: "objective" as const, index });
const mis = (index: number) => ({ type: "misconception" as const, index });
const PITCH = { readingAgeTarget: 10, sentenceLengthMax: 14, avoid: [] };

type Options = {
  keyIdeasPer?: number;
  workedExamples?: boolean;
  exit?: boolean;
  /** One slide question per objective with no distractors (askable openly). */
  bare?: boolean;
  distractors?: number;
  vocabulary?: boolean;
  misconceptions?: boolean;
  statement?: (o: number, k: number) => string;
  /** The forms the facts call declares for every slide and worksheet question (absent: the native form). */
  forms?: ("multiple-choice" | "true-false" | "open-response")[];
  /** The demand declared on the bare (open) question, when `bare`. */
  demand?: "explanation" | "judgement";
};

/** Facts for `n` objectives: per objective, key ideas, one misconception, two terms, one worked example, three questions. */
function factsFor(n: number, options: Options = {}): OutlineFacts {
  const {
    keyIdeasPer = 2,
    workedExamples = true,
    exit = true,
    bare = false,
    distractors = 3,
    vocabulary = true,
    misconceptions = true,
    statement = (o, k) => `Key idea ${k + 1} of objective ${o + 1}`,
    forms,
    demand,
  } = options;
  const facts: OutlineFacts = {
    keyIdeas: [],
    misconceptions: [],
    vocabulary: [],
    workedExamples: [],
    questions: [],
  };
  for (let o = 0; o < n; o++) {
    for (let k = 0; k < keyIdeasPer; k++) {
      facts.keyIdeas.push({
        statement: statement(o, k),
        explanation: `Why key idea ${k + 1} of objective ${o + 1} holds.`,
        example: `Example for key idea ${k + 1} of objective ${o + 1}.`,
        objectiveRefs: [obj(o)],
      });
    }
    if (misconceptions) {
      facts.misconceptions.push({
        belief: `Wrong belief about objective ${o + 1}`,
        correction: `The correction for objective ${o + 1}.`,
        objectiveRefs: [obj(o)],
      });
    }
    if (vocabulary) {
      facts.vocabulary.push(
        { term: `term ${o + 1}a`, definition: `Definition ${o + 1}a.`, objectiveRefs: [obj(o)] },
        { term: `term ${o + 1}b`, definition: `Definition ${o + 1}b.`, objectiveRefs: [obj(o)] },
      );
    }
    if (workedExamples) {
      facts.workedExamples.push({
        problem: `Worked problem for objective ${o + 1}?`,
        steps: ["Step one.", "Step two."],
        answer: `Answer ${o + 1}`,
        ...(misconceptions ? { misconceptionRef: mis(o) } : {}),
        objectiveRefs: [obj(o)],
      });
    }
    const wrong = Array.from({ length: distractors }, (_, d) => ({
      text: `Wrong ${d + 1} for objective ${o + 1}`,
      ...(d === 0 && misconceptions ? { misconceptionRef: mis(o) } : {}),
    }));
    facts.questions.push(
      {
        stem: `Slide question for objective ${o + 1}?`,
        answer: `Right ${o + 1}`,
        reasoning: "Because.",
        tier: "core",
        use: "slide",
        distractors: wrong,
        objectiveRefs: [obj(o)],
        ...(forms ? { forms } : {}),
      },
      {
        stem: `Worksheet question for objective ${o + 1}?`,
        answer: `Right ${o + 1}`,
        reasoning: "Because.",
        tier: "easy",
        use: "worksheet",
        distractors: wrong,
        objectiveRefs: [obj(o)],
        ...(forms ? { forms } : {}),
      },
    );
    if (exit) {
      facts.questions.push({
        stem: `Exit question for objective ${o + 1}?`,
        answer: `Right ${o + 1}`,
        reasoning: "Because.",
        tier: "stretch",
        use: "exit",
        distractors: wrong,
        objectiveRefs: [obj(o)],
      });
    }
    if (bare) {
      facts.questions.push({
        stem: `Open question for objective ${o + 1}?`,
        answer: `A full answer ${o + 1}`,
        reasoning: "Because.",
        tier: "core",
        use: "slide",
        objectiveRefs: [obj(o)],
        ...(demand ? { demand } : {}),
      });
    }
  }
  return facts;
}

const objectives = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ text: `Objective ${i + 1} text` }));

const shapeOf = (verb: string, confidence = "Some prior knowledge") =>
  lessonShapeOf({ objectiveVerb: verb, priorConfidence: confidence });

function run(over: {
  n?: number;
  shape?: LessonShape;
  slideCount?: SlideCount;
  facts?: OutlineFacts;
  options?: Options;
  priorKnowledge?: string;
  retrieval?: { question: string; answer: string }[];
}) {
  const n = over.n ?? 2;
  const facts = over.facts ?? factsFor(n, over.options);
  const shape = over.shape ?? shapeOf("Explain");
  const slideCount = over.slideCount ?? 10;
  const result = outlineFromFacts({
    topic: "Rivers",
    objectives: objectives(n),
    facts,
    shape,
    slideCount,
    ...(over.priorKnowledge === undefined ? {} : { priorKnowledge: over.priorKnowledge }),
    ...(over.retrieval === undefined ? {} : { retrieval: over.retrieval }),
  });
  return { result, facts, shape, slideCount };
}

const kinds = (r: ReturnType<typeof run>) => r.result.skeleton.outline.map((e) => e.kind);
const refsAt = (r: ReturnType<typeof run>, position: number) =>
  r.result.outlineFactRefs.find((e) => e.index === position)?.factRefs ?? [];

/** Schema issues the module is allowed: the picture question, and anything a gap sentence explains. */
function unexplained(issues: { path: PropertyKey[]; message: string }[], gaps: string[]) {
  return issues.filter(({ path, message }) => {
    if (path[0] === "photographable") return false;
    const kind = /no ([a-z-]+) slide/.exec(message)?.[1];
    if (kind && gaps.some((g) => g.includes(`${kind} slide`))) return false;
    if (
      /pupils answer|"practise" slide/.test(message) &&
      gaps.some((g) => /pupils answer/.test(g))
    ) {
      return false;
    }
    if (/content or image-text/.test(message) && gaps.some((g) => /content slides/.test(g))) {
      return false;
    }
    // A share issue opens with the same sentence as its gap.
    const share = /^At least \d+ of the \d+ slides[^.]*\./.exec(message)?.[0];
    if (share && gaps.some((g) => g.startsWith(share))) return false;
    return true;
  });
}

describe("outlineFromFacts: the count and the fixed slots", () => {
  for (const slideCount of SLIDE_COUNTS) {
    test(`exactly ${slideCount} entries: title, objectives, …, exit-ticket`, () => {
      const r = run({ n: 2, slideCount });
      const outline = r.result.skeleton.outline;
      expect(outline).toHaveLength(slideCount);
      expect(outline[0]).toEqual({ kind: "title", factRefs: [] });
      // Ruling 82: no entry carries minutes.
      expect(outline.every((e) => e.minutes === undefined)).toBe(true);
      expect(outline[1]?.kind).toBe("objectives");
      expect(outline[1]?.factRefs).toEqual([obj(0), obj(1)]);
      expect(outline[1]?.phase).toBeUndefined();
      expect(outline.at(-1)?.kind).toBe("exit-ticket");
      expect(outline.at(-1)?.phase).toBe("check");
      expect(r.result.outlineFactRefs.every((e) => e.index >= 2)).toBe(true);
    });
  }

  test("every objective is taught in a New-to-it Explain lesson at six slides with three objectives", () => {
    const r = run({ n: 3, slideCount: 6, shape: shapeOf("Explain", "New to it") });
    expect(r.result.skeleton.outline).toHaveLength(6);
    for (const c of r.result.coverage) expect(c.taught.length).toBeGreaterThan(0);
    // The budget of three cannot also hold a practise slide: said, not hidden.
    expect(r.result.gaps.some((g) => /pupils answer/.test(g))).toBe(true);
  });

  test("the outline is deterministic", () => {
    expect(run({ n: 3, slideCount: 12 }).result).toEqual(run({ n: 3, slideCount: 12 }).result);
  });
});

describe("outlineFromFacts: priorities", () => {
  test("an objective's key ideas share its content slide, so the required worked example still fits", () => {
    const r = run({ n: 2, slideCount: 8, shape: shapeOf("Apply") });
    const k = kinds(r);
    expect(k).toContain("worked-example");
    // Five slots: two content slides carrying both of their objective's key ideas, the worked
    // example, a practise slide per objective. Every key idea is taught.
    expect(k.filter((x) => x === "content")).toHaveLength(2);
    const keyIdeas = k.flatMap((kind, i) =>
      kind === "content"
        ? [
            refsAt(r, i)
              .filter((ref) => ref.type === "keyIdea")
              .map((ref) => ref.index),
          ]
        : [],
    );
    expect(keyIdeas).toEqual([
      [0, 1],
      [2, 3],
    ]);
    expect(r.result.unplaced.keyIdeas).toEqual([]);
  });

  test("the required vocabulary slide opens the explain phase, before the first content slide", () => {
    const r = run({ n: 2, slideCount: 10, shape: shapeOf("Recall") });
    const k = kinds(r);
    expect(k.indexOf("vocabulary")).toBeLessThan(k.indexOf("content"));
    expect(k.indexOf("vocabulary")).toBeGreaterThan(k.indexOf("starter"));
    expect(refsAt(r, k.indexOf("vocabulary")).every((ref) => ref.type === "vocabulary")).toBe(true);
  });

  test("the starter opens, explain and practise alternate in cycles, the exit ticket closes", () => {
    const r = run({ n: 2, slideCount: 12, shape: shapeOf("Apply") });
    const order = { starter: 0, explain: 1, practise: 1, check: 3 };
    const ranks = r.result.skeleton.outline.slice(2).map((e) => order[e.phase ?? "check"]);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
    expect(kinds(r)[2]).toBe("starter");
    expect(kinds(r).at(-1)).toBe("exit-ticket");
    const method = kinds(r).indexOf("worked-example");
    const firstPractise = r.result.skeleton.outline.findIndex((e) => e.phase === "practise");
    expect(method).toBeLessThan(firstPractise);
  });

  test("a spare slot becomes a plenary before the exit ticket; more than the facts allow is a gap", () => {
    const r = run({
      n: 1,
      slideCount: 12,
      options: { keyIdeasPer: 1, workedExamples: false, vocabulary: false },
    });
    const k = kinds(r);
    expect(k.at(-2)).toBe("plenary");
    expect(r.result.skeleton.outline.length).toBeLessThan(12);
    expect(r.result.gaps.some((g) => /allow only \d+ slides/.test(g))).toBe(true);
  });
});

describe("outlineFromFacts: slide shares (ruling 82)", () => {
  const practiseSlides = (r: ReturnType<typeof run>) =>
    r.result.skeleton.outline.filter((e) => e.phase === "practise").length;

  test("the same deck with prior knowledge declared: the retrieval starter takes the second practise slot", () => {
    const r = run({
      n: 3,
      shape: shapeOf("Apply"),
      slideCount: 8,
      options: { bare: true, workedExamples: false },
      priorKnowledge: "Fractions.",
    });
    expect(kinds(r)[2]).toBe("starter");
    expect(practiseSlides(r)).toBe(1);
    expect(kinds(r)).toContain("instructions");
    expect(r.result.coverage.every((c) => c.practised.length > 0)).toBe(true);
    expect(r.result.gaps.some((g) => /in the practise phase/.test(g))).toBe(true);
  });

  test("a share the facts cannot fill is a gap in the Shape block's words", () => {
    const facts = factsFor(1, { workedExamples: false });
    const r = run({
      n: 1,
      shape: shapeOf("Apply"),
      slideCount: 12,
      facts: { ...facts, questions: facts.questions.filter((q) => q.use !== "slide") },
    });
    expect(
      r.result.gaps.some((g) =>
        /^At least \d+ of the \d+ slides after the title and objectives slides (is|are) in the practise phase\./.test(
          g,
        ),
      ),
    ).toBe(true);
  });
});

describe("outlineFromFacts: question kinds", () => {
  test("true-false once when the misconception must be confronted and a question declares that form; its refs carry the misconception", () => {
    const r = run({
      n: 3,
      slideCount: 12,
      shape: shapeOf("Explain"),
      options: { forms: ["multiple-choice", "true-false"] },
    });
    const k = kinds(r);
    expect(k.filter((x) => x === "true-false")).toHaveLength(1);
    const at = k.indexOf("true-false");
    expect(
      refsAt(r, at)
        .map((ref) => ref.type)
        .sort(),
    ).toEqual(["misconception", "question"]);
    expect(r.result.skeleton.outline[at]?.brief?.adds).toMatch(/^Confronts the misconception: /);
  });

  test("no true-false is inferred from a misconception-tagged distractor: undeclared, the question stays multiple-choice", () => {
    const r = run({ n: 3, slideCount: 12, shape: shapeOf("Explain") });
    expect(kinds(r)).not.toContain("true-false");
    expect(kinds(r).some((k) => k === "multiple-choice" || k === "instructions")).toBe(true);
  });

  test("a declared true-false form without a misconception-tagged distractor is not usable", () => {
    const r = run({
      n: 3,
      slideCount: 12,
      shape: shapeOf("Explain"),
      options: { forms: ["true-false"], misconceptions: false },
    });
    expect(kinds(r)).not.toContain("true-false");
  });

  test("open-response comes from a question declared askable openly, the last objective's first", () => {
    const r = run({
      n: 2,
      slideCount: 10,
      shape: shapeOf("Explain"),
      options: { forms: ["multiple-choice", "open-response"], distractors: 2 },
    });
    // With two distractors every slide question is asked openly; the required one is objective 2's.
    const open = kinds(r).flatMap((k, at) => (k === "open-response" ? [at] : []));
    expect(open.length).toBeGreaterThan(0);
    const stems = open.map((at) => {
      const q = refsAt(r, at).find((ref) => ref.type === "question");
      return r.facts.questions[q?.index ?? -1]?.stem;
    });
    expect(stems).toContain("Slide question for objective 2?");
    for (const at of open)
      expect(r.result.skeleton.outline[at]?.brief?.adds).toMatch(/^Pupils explain: /);
  });

  test("no open-response is forced from a multiple-choice question: without a declaration the gap says so", () => {
    const r = run({ n: 2, slideCount: 10, shape: shapeOf("Explain") });
    expect(kinds(r)).not.toContain("open-response");
    expect(r.result.gaps).toContain(
      "The shape needs a open-response slide and the facts have no question that can be asked openly.",
    );
  });

  test("a question with no distractors is natively open; declared a judgement it closes the practise phase", () => {
    const r = run({
      n: 2,
      slideCount: 10,
      shape: shapeOf("Evaluate"),
      options: { bare: true, demand: "judgement" },
    });
    const outline = r.result.skeleton.outline;
    const practise = outline.map((e, i) => (e.phase === "practise" ? i : -1)).filter((i) => i >= 0);
    const last = practise.at(-1) ?? -1;
    expect(outline[last]?.kind).toBe("open-response");
    expect(outline[last]?.brief?.adds).toMatch(/^Pupils judge: Open question/);
  });

  test("without a declared demand an open question in an Evaluate lesson is explained, not judged", () => {
    const r = run({ n: 2, slideCount: 10, shape: shapeOf("Evaluate"), options: { bare: true } });
    const open = r.result.skeleton.outline.filter((e) => e.kind === "open-response");
    expect(open.length).toBeGreaterThan(0);
    for (const e of open) expect(e.brief?.adds).toMatch(/^Pupils explain: /);
  });

  const questionsOnSlides = (r: ReturnType<typeof run>) =>
    r.result.outlineFactRefs
      .filter((e) => r.result.skeleton.outline[e.index]?.kind !== "exit-ticket")
      .flatMap((e) => e.factRefs.filter((ref) => ref.type === "question").map((ref) => ref.index));

  test("the practise floor falls back on worksheet questions: the least-practised objective, easiest tier first, never an exit question", () => {
    const facts = factsFor(1, { keyIdeasPer: 1, workedExamples: false });
    // Objective 1 keeps its one slide question; two more worksheet questions, stretch before core.
    const sheet = facts.questions.find((q) => q.use === "worksheet");
    if (!sheet) throw new Error("factsFor writes a worksheet question per objective");
    facts.questions.push(
      { ...sheet, stem: "Stretch worksheet?", tier: "stretch" },
      { ...sheet, stem: "Core worksheet?", tier: "core" },
    );
    const shape = shapeOf("Apply");
    const r = run({ n: 1, slideCount: 12, facts, shape });
    const used = questionsOnSlides(r);
    const worksheet = used.filter((i) => r.facts.questions[i]?.use === "worksheet");
    expect(worksheet.length).toBeGreaterThan(0);
    for (const i of used) expect(r.facts.questions[i]?.use).not.toBe("exit");
    const tiers = worksheet.map((i) => r.facts.questions[i]?.tier);
    expect(tiers).toEqual((["easy", "core", "stretch"] as const).slice(0, tiers.length));
    const practise = r.result.skeleton.outline.filter((e) => e.phase === "practise").length;
    expect(practise).toBeLessThanOrEqual(slidesFor(shape.practiseMinPercent, 10));
  });
});

describe("outlineFromFacts: briefs", () => {
  test("every brief is one distinct sentence of at most 160 characters", () => {
    const long = "A statement that runs on and on about rivers and their many meandering courses";
    const r = run({
      n: 2,
      slideCount: 12,
      options: { keyIdeasPer: 3, statement: () => `${long} ${long} ${long}` },
    });
    const briefs = r.result.skeleton.outline.slice(2).map((e) => e.brief?.adds ?? "");
    expect(new Set(briefs).size).toBe(briefs.length);
    for (const b of briefs) expect(b.length).toBeLessThanOrEqual(160);
    const content = r.result.skeleton.outline.find((e) => e.kind === "content");
    expect(content?.brief?.adds.endsWith("…")).toBe(true);
    expect(content?.brief?.adds.startsWith("Explains: ")).toBe(true);
  });

  test("a content slide after another of the same objective says what not to repeat", () => {
    const r = run({ n: 1, slideCount: 8, options: { keyIdeasPer: 2 } });
    const contents = r.result.skeleton.outline.filter((e) => e.kind === "content");
    expect(contents).toHaveLength(2);
    expect(contents[0]?.brief?.avoids).toBeUndefined();
    expect(contents[1]?.brief?.avoids).toBe("Do not repeat: Key idea 1 of objective 1");
  });

  test("clip cuts at a word boundary", () => {
    expect(clip("short")).toBe("short");
    const cut = clip(`${"word ".repeat(40)}end`, 50);
    expect(cut.length).toBeLessThanOrEqual(50);
    expect(cut.endsWith("word…")).toBe(true);
  });
});

describe("outlineFromFacts: callouts", () => {
  test("a content slide gets its objective's misconception as a watch-out, the next one the example", () => {
    const r = run({ n: 1, slideCount: 8, options: { keyIdeasPer: 2, vocabulary: false } });
    const positions = r.result.skeleton.outline
      .map((e, i) => (e.kind === "content" ? i : -1))
      .filter((i) => i >= 0);
    expect(r.result.callouts[positions[0] ?? -1]).toEqual({
      kind: "watch-out",
      ref: mis(0),
      text: "Wrong belief about objective 1",
    });
    expect(r.result.callouts[positions[1] ?? -1]?.kind).toBe("example");
  });

  test("terms no vocabulary slide shows ride on the content slide as key-words", () => {
    const r = run({
      n: 1,
      slideCount: 8,
      shape: shapeOf("Apply"),
      options: { keyIdeasPer: 2, misconceptions: false },
    });
    const at = kinds(r).indexOf("content");
    expect(refsAt(r, at).filter((ref) => ref.type === "vocabulary")).toHaveLength(2);
    expect(r.result.callouts[at]).toEqual({
      kind: "key-words",
      ref: { type: "vocabulary", index: 0 },
      text: "term 1a, term 1b",
    });
  });

  test("only teaching slides carry callouts", () => {
    const r = run({ n: 3, slideCount: 12 });
    for (const [position, callout] of Object.entries(r.result.callouts)) {
      const kind = r.result.skeleton.outline[Number(position)]?.kind ?? "";
      expect(["content", "worked-example"]).toContain(kind);
      expect(callout.text.length).toBeGreaterThan(0);
    }
  });
});

describe("outlineFromFacts: gaps on thin facts", () => {
  test("four objectives in a six-slide deck: the fourth is not taught and the gap says so", () => {
    const r = run({ n: 4, slideCount: 6 });
    expect(r.result.coverage[3]?.taught).toEqual([]);
    expect(r.result.gaps).toContain(
      "Objective 4 has a key idea but a 6-slide deck has no room to teach it.",
    );
  });

  test("three objectives at six slides: teaching takes every slot, so nothing is practised and the gaps say so", () => {
    const r = run({ n: 3, slideCount: 6 });
    expect(kinds(r)).not.toContain("instructions");
    expect(r.result.skeleton.outline.filter((e) => e.phase === "practise")).toHaveLength(0);
    for (const o of [0, 1, 2]) {
      expect(r.result.coverage[o]?.taught.length).toBeGreaterThan(0);
      expect(r.result.coverage[o]?.practised).toEqual([]);
      expect(r.result.gaps).toContain(
        `Objective ${o + 1} has a slide question but a 6-slide deck has no room to practise it; the exit ticket is its only check.`,
      );
    }
  });
});

describe("outlineFromFacts: the shared practise slide (ruling 81)", () => {
  // Apply: its only required kind is the worked example, so the shared slide's own placement shows.
  test("a shape that forbids instructions gets no practice set", () => {
    const shape = shapeOf("Apply");
    const r = run({
      n: 3,
      slideCount: 10,
      shape: { ...shape, forbiddenKinds: [...shape.forbiddenKinds, "instructions"] },
    });
    expect(kinds(r)).not.toContain("instructions");
  });
});

describe("outlineFromFacts: gaps on thin facts (continued)", () => {
  test("a required worked example the facts do not have", () => {
    const r = run({ n: 2, shape: shapeOf("Apply"), options: { workedExamples: false } });
    expect(r.result.gaps).toContain(
      "The shape needs a worked-example slide and the facts have no worked example.",
    );
    expect(kinds(r)).not.toContain("worked-example");
  });

  test("a worked example that names no objective is left unowned and unplaced, never assigned by position", () => {
    const facts = factsFor(2, { workedExamples: false, misconceptions: false });
    facts.workedExamples.push({
      problem: "An orphan problem?",
      steps: ["Step."],
      answer: "An answer",
    });
    const r = run({ n: 2, shape: shapeOf("Apply"), slideCount: 12, facts });
    expect(kinds(r)).not.toContain("worked-example");
    expect(r.result.unplaced.workedExamples).toEqual([0]);
    expect(r.result.gaps).toContain("Worked example 1 names no objective, so no slide carries it.");
    expect(r.result.gaps).toContain(
      "The shape needs a worked-example slide and the facts have no worked example that names an objective.",
    );
  });

  test("a worked example owned only through the misconception it corrects is placed under that objective", () => {
    const facts = factsFor(2, { workedExamples: false });
    facts.workedExamples.push({
      problem: "A problem that heads off objective 2's misconception?",
      steps: ["Step."],
      answer: "An answer",
      misconceptionRef: mis(1),
    });
    const r = run({ n: 2, shape: shapeOf("Apply"), slideCount: 12, facts });
    const at = kinds(r).indexOf("worked-example");
    expect(at).toBeGreaterThan(-1);
    expect(r.result.skeleton.outline[at]?.factRefs).toEqual([obj(1)]);
    expect(r.result.unplaced.workedExamples).toEqual([]);
  });

  test("an objective without an exit question, a slide question or a key idea", () => {
    const facts = factsFor(2, { exit: false });
    facts.keyIdeas = facts.keyIdeas.filter((k) => k.objectiveRefs[0]?.index !== 1);
    facts.questions = facts.questions.filter(
      (q) => !(q.use === "slide" && q.objectiveRefs[0]?.index === 1),
    );
    const r = run({ n: 2, facts });
    expect(r.result.gaps).toContain(
      "Objective 1 has no exit question, so the exit ticket cannot check it.",
    );
    expect(r.result.gaps).toContain("Objective 2 has no key idea, so no content slide teaches it.");
    expect(r.result.gaps).toContain(
      "Objective 2 has no slide question, so no practise slide checks it.",
    );
    // Its worked example still teaches it; no content slide does.
    const contents = r.result.skeleton.outline.filter((e) => e.kind === "content");
    expect(contents.some((e) => e.factRefs.some((ref) => ref.index === 1))).toBe(false);
  });

  test("empty facts never throw", () => {
    const empty: OutlineFacts = {
      keyIdeas: [],
      misconceptions: [],
      vocabulary: [],
      workedExamples: [],
      questions: [],
    };
    const r = run({ n: 2, facts: empty, slideCount: 6 });
    expect(r.result.skeleton.outline.map((e) => e.kind)).toEqual([
      "title",
      "objectives",
      "starter",
      "plenary",
      "exit-ticket",
    ]);
    expect(r.result.gaps.length).toBeGreaterThan(3);
  });
});

describe("outlineFromFacts: the two gates", () => {
  const cases: [string, LessonShape, number, SlideCount][] = [
    ["Explain, new to it", shapeOf("Explain", "New to it"), 3, 8],
    ["Explain, new to it", shapeOf("Explain", "New to it"), 3, 12],
    ["Apply", shapeOf("Apply"), 2, 10],
    ["Recall", shapeOf("Recall"), 2, 10],
    ["Evaluate, revisiting", shapeOf("Evaluate", "Revisiting"), 3, 10],
    ["Apply, no worked examples", shapeOf("Apply"), 2, 8],
  ];
  for (const [name, shape, n, slideCount] of cases) {
    test(`${name} at ${slideCount} passes planSkeletonSchemaFor and assignFactIds`, () => {
      const options = name.includes("no worked") ? { workedExamples: false } : {};
      const r = run({ n, shape, slideCount, options });
      const parsed = planSkeletonSchemaFor({ shape, slideCount, learningCycles: true }).safeParse(
        r.result.skeleton,
      );
      expect(parsed.success ? [] : unexplained(parsed.error.issues, r.result.gaps)).toEqual([]);
      const merged = assignFactIds(
        r.result.skeleton,
        { ...r.facts, outlineFactRefs: r.result.outlineFactRefs, pitch: PITCH },
        60,
      );
      expect(merged.outline).toHaveLength(slideCount);
      expect(merged.durationMin).toBe(60);
    });
  }
});

describe("outlineFromFacts: every key idea taught, every question fair (np1 RC1)", () => {
  const contentKeyIdeas = (r: ReturnType<typeof run>) =>
    kinds(r).flatMap((kind, i) =>
      kind === "content"
        ? [
            refsAt(r, i)
              .filter((ref) => ref.type === "keyIdea")
              .map((ref) => ref.index),
          ]
        : [],
    );
  const exitRefs = (r: ReturnType<typeof run>) =>
    refsAt(r, r.result.skeleton.outline.length - 1).flatMap((ref) =>
      ref.type === "question" ? [ref.index] : [],
    );
  /** Question indices on practise slides. */
  const practised = (r: ReturnType<typeof run>) =>
    r.result.skeleton.outline.flatMap((e, i) =>
      e.phase === "practise"
        ? refsAt(r, i)
            .filter((ref) => ref.type === "question")
            .map((ref) => ref.index)
        : [],
    );

  test("ten slides, three objectives, two key ideas each: all six are taught", () => {
    const r = run({ n: 3, slideCount: 10 });
    expect(r.result.skeleton.outline).toHaveLength(10);
    expect(r.result.unplaced.keyIdeas).toEqual([]);
    expect(contentKeyIdeas(r).flat().sort()).toEqual([0, 1, 2, 3, 4, 5]);
    expect(contentKeyIdeas(r).every((ks) => ks.length <= 2)).toBe(true);
    // Every exit question is fair, so every one is on the exit ticket.
    const exits = r.facts.questions.flatMap((q, i) => (q.use === "exit" ? [i] : []));
    expect(exitRefs(r)).toEqual(expect.arrayContaining(exits));
    expect(r.result.gaps.some((g) => /is on no slide/.test(g))).toBe(false);
  });

  test("a slide carrying two key ideas names both in its brief", () => {
    const r = run({ n: 3, slideCount: 10 });
    const i = kinds(r).indexOf("content");
    expect(r.result.skeleton.outline[i]?.brief?.adds).toBe(
      "Explains: Key idea 1 of objective 1 Then: Key idea 2 of objective 1",
    );
  });

  test("with room to spare a paired slide is split: one key idea per content slide", () => {
    const r = run({ n: 2, slideCount: 12, options: { workedExamples: false } });
    expect(r.result.unplaced.keyIdeas).toEqual([]);
    expect(contentKeyIdeas(r)).toEqual([[0], [1], [2], [3]]);
  });

  test("three key ideas per objective in ten slides: a second content slide each, one slot kept for practice", () => {
    const r = run({ n: 3, slideCount: 10, options: { keyIdeasPer: 3 } });
    expect(r.result.skeleton.outline).toHaveLength(10);
    // r1: the starter and the cycle checks keep their slots, so a key idea may go untaught; each is a gap.
    expect(
      r.result.skeleton.outline.filter((e) => e.phase === "practise").length,
    ).toBeGreaterThanOrEqual(1);
    for (const k of r.result.unplaced.keyIdeas)
      expect(r.result.gaps.some((g) => g.startsWith(`Key idea ${k + 1} (`))).toBe(true);
    // The shape's extras are what gives way, and the gaps say so.
    expect(r.result.gaps).toContain(
      "The shape needs a worked-example slide and a 10-slide deck has no room for one.",
    );
  });

  test("a key idea with no room is a gap, and its objective's questions stay off every slide", () => {
    const r = run({ n: 3, slideCount: 8, options: { keyIdeasPer: 3 } });
    const unplaced = r.result.unplaced.keyIdeas;
    expect(unplaced.length).toBeGreaterThan(0);
    const untaught = new Set(
      unplaced.flatMap((k) => r.facts.keyIdeas[k]?.objectiveRefs.map((ref) => ref.index) ?? []),
    );
    for (const k of unplaced) {
      expect(r.result.gaps.some((g) => g.startsWith(`Key idea ${k + 1} (`))).toBe(true);
    }
    for (const o of untaught) {
      expect(
        r.result.gaps.some((g) =>
          g.startsWith(
            `Objective ${o + 1}'s questions stay off the practise slides and the exit ticket`,
          ),
        ),
      ).toBe(true);
    }
    const onSlides = [...practised(r), ...exitRefs(r)];
    for (const i of onSlides) {
      const owners = r.facts.questions[i]?.objectiveRefs.map((ref) => ref.index) ?? [];
      expect(owners.some((o) => untaught.has(o))).toBe(false);
    }
    // The exit ticket still checks the objectives that are fully taught.
    expect(exitRefs(r).length).toBeGreaterThanOrEqual(3 - untaught.size);
    expect(r.result.skeleton.outline.at(-1)?.brief?.adds).toMatch(
      /quick items? across the objectives, each on what the slides taught; the answers are revealed on the slide\.$/,
    );
  });

  test("keyIdeaRefs make the gate exact: a question on a taught key idea is placed beside an untaught sibling", () => {
    const base = factsFor(3, { keyIdeasPer: 3 });
    const before = run({ n: 3, slideCount: 8, facts: base });
    const unplaced = new Set(before.result.unplaced.keyIdeas);
    expect(unplaced.size).toBeGreaterThan(0);
    // Every question declares the first key idea of its objective, which P1 always places.
    const firstOf = (o: number) =>
      base.keyIdeas.findIndex((k) => k.objectiveRefs.some((ref) => ref.index === o));
    const declared: OutlineFacts = {
      ...base,
      questions: base.questions.map((q) => ({
        ...q,
        keyIdeaRefs: [{ type: "keyIdea" as const, index: firstOf(q.objectiveRefs[0]?.index ?? 0) }],
      })),
    };
    const r = run({ n: 3, slideCount: 8, facts: declared });
    expect(new Set(r.result.unplaced.keyIdeas)).toEqual(unplaced);
    // All three exit questions come back: none tests the untaught idea.
    expect(exitRefs(r).length).toBeGreaterThanOrEqual(3);
    expect(exitRefs(before).length).toBeLessThan(exitRefs(r).length);
    expect(r.result.gaps.some((g) => g.includes("questions stay off"))).toBe(false);

    // A question declaring the untaught idea is withheld, and the gap says it tests it.
    const k = [...unplaced][0] as number;
    const o = base.keyIdeas[k]?.objectiveRefs[0]?.index ?? 0;
    const onUntaught: OutlineFacts = {
      ...declared,
      questions: declared.questions.map((q) =>
        q.use === "exit" && q.objectiveRefs[0]?.index === o
          ? { ...q, keyIdeaRefs: [{ type: "keyIdea" as const, index: k }] }
          : q,
      ),
    };
    const held = run({ n: 3, slideCount: 8, facts: onUntaught });
    const tests = (i: number) =>
      (held.facts.questions[i]?.keyIdeaRefs ?? []).some((ref) =>
        held.result.unplaced.keyIdeas.includes(ref.index),
      );
    expect(exitRefs(held).some(tests)).toBe(false);
    expect(held.result.gaps).toContain(
      `Objective ${o + 1}'s questions stay off the practise slides and the exit ticket: key idea ${held.result.unplaced.keyIdeas
        .filter((i) => base.keyIdeas[i]?.objectiveRefs[0]?.index === o)
        .map((i) => i + 1)
        .join(", ")} is on no slide, and they test it.`,
    );
  });

  test("a six-slide deck with more objectives than slots: the untaught objective's exit question is withheld", () => {
    const r = run({ n: 4, slideCount: 6, shape: shapeOf("Apply") });
    const untaught = r.result.coverage.flatMap((c, o) => (c.taught.length === 0 ? [o] : []));
    expect(untaught.length).toBeGreaterThan(0);
    for (const o of untaught) {
      expect(r.result.coverage[o]?.checked).toEqual([]);
      expect(exitRefs(r).some((i) => r.facts.questions[i]?.objectiveRefs[0]?.index === o)).toBe(
        false,
      );
    }
  });
});

describe("outlineFromFacts: the exit ticket prints stems only (W2e)", () => {
  const exitAt = (r: ReturnType<typeof run>) => r.result.skeleton.outline.length - 1;
  const exitQuestions = (r: ReturnType<typeof run>) =>
    refsAt(r, exitAt(r)).flatMap((ref) => (ref.type === "question" ? [ref.index] : []));

  test("an exit question declared askable openly stays", () => {
    const facts = factsFor(1);
    const exit = facts.questions.find((q) => q.use === "exit");
    if (!exit) throw new Error("fixture has no exit question");
    exit.forms = ["multiple-choice", "open-response"];
    const r = run({ n: 1, slideCount: 8, facts });
    expect(exitQuestions(r)).toEqual([facts.questions.indexOf(exit)]);
  });
});

describe("outlineFromFacts: no question without its options (w0)", () => {
  const exitQuestions = (r: ReturnType<typeof run>) =>
    refsAt(r, r.result.skeleton.outline.length - 1).flatMap((ref) =>
      ref.type === "question" ? [ref.index] : [],
    );
  test("a declared true-false exit question is swapped for an open question on its objective", () => {
    const facts = factsFor(1, { distractors: 2, forms: ["open-response"] });
    const exit = facts.questions.find((q) => q.use === "exit");
    if (!exit) throw new Error("fixture has no exit question");
    Object.assign(exit, { forms: ["true-false", "open-response"], distractors: [] });
    const r = run({ n: 1, slideCount: 8, facts });
    const asked = exitQuestions(r);
    expect(asked).not.toContain(facts.questions.indexOf(exit));
    expect(asked).toHaveLength(1);
    expect(facts.questions[asked[0] ?? -1]?.use).not.toBe("exit");
  });

  test("the exit ticket's stand-ins are kept from the practice set: every objective is still checked", () => {
    for (const slideCount of [8, 10, 12] as const) {
      const facts = factsFor(3, { distractors: 2, forms: ["open-response"] });
      for (const q of facts.questions)
        if (q.use === "exit") Object.assign(q, { forms: ["true-false", "open-response"] });
      const r = run({ n: 3, slideCount, facts });
      expect(r.result.coverage.every((c) => c.checked.length > 0)).toBe(true);
      const asked = exitQuestions(r);
      expect(asked.map((i) => facts.questions[i]?.use)).not.toContain("exit");
      const set = r.result.outlineFactRefs.flatMap((e) =>
        e.factRefs.filter((f) => f.type === "question").map((f) => f.index),
      );
      // No question is asked twice.
      expect(new Set(set).size).toBe(set.length);
    }
  });
});

describe("outlineFromFacts: a stem that asks for options it does not list (rivers, 25 Sep)", () => {
  const RIVERS = "Which of the following new housing plans would most reduce flood risk?";
  test("the question is placed nowhere and a gap names it; a real multiple-choice one is placed", () => {
    const facts = factsFor(3, { distractors: 0, forms: ["open-response"] });
    const target = facts.questions.findIndex(
      (q) => q.use === "slide" && q.stem.includes("objective 2"),
    );
    const q = facts.questions[target];
    if (!q) throw new Error("fixture has no slide question for objective 2");
    q.stem = RIVERS;
    const r = run({ n: 3, facts });
    const placed = r.result.outlineFactRefs.flatMap((e) =>
      e.factRefs.filter((f) => f.type === "question").map((f) => f.index),
    );
    expect(placed).not.toContain(target);
    expect(r.result.gaps).toContain(
      `Question ${target + 1} asks pupils to choose from options it does not list, so it is left off the slides.`,
    );
    // The same stem with three distractors is a real multiple-choice question.
    const listed = factsFor(3, { distractors: 3, forms: ["multiple-choice"] });
    const mcQ = listed.questions[target];
    if (!mcQ) throw new Error("fixture has no slide question for objective 2");
    mcQ.stem = RIVERS;
    const withOptions = run({ n: 3, facts: listed });
    expect(withOptions.result.gaps.some((g) => g.includes("options it does not list"))).toBe(false);
    expect(
      withOptions.result.outlineFactRefs.some((e) =>
        e.factRefs.some((f) => f.type === "question" && f.index === target),
      ),
    ).toBe(true);
  });
});

describe("outlineFromFacts: a distractor that repeats the answer", () => {
  test("the question is not placed as multiple choice, nor as a bare stem", () => {
    const facts = factsFor(2);
    for (const q of facts.questions) {
      const first = q.distractors?.[0];
      if (q.use === "slide" && first) first.text = ` ${q.answer.toUpperCase()}. `;
    }
    const r = run({ n: 2, slideCount: 10, facts });
    const placed = r.result.outlineFactRefs.flatMap((e) =>
      e.factRefs.filter((f) => f.type === "question").map((f) => f.index),
    );
    for (const i of placed) expect(facts.questions[i]?.use).not.toBe("slide");
  });
});

describe("outlineFromFacts: lesson flow (w0b)", () => {
  const questionsAt = (r: ReturnType<typeof run>, position: number) =>
    refsAt(r, position).flatMap((f) => (f.type === "question" ? [f.index] : []));
  const keyIdeasAt = (r: ReturnType<typeof run>, position: number) =>
    refsAt(r, position).flatMap((f) => (f.type === "keyIdea" ? [f.index] : []));
  /** Outline position of the slide that first carries key idea `k`. */
  const taughtAt = (r: ReturnType<typeof run>, k: number) =>
    r.result.outlineFactRefs.find((e) => keyIdeasAt(r, e.index).includes(k))?.index ?? Infinity;

  describe("rule 1: a starter near the start", () => {
    test("declared prior knowledge: the starter opens the lesson and retrieves it, asking nothing this lesson teaches", () => {
      const r = run({
        n: 3,
        slideCount: 10,
        priorKnowledge: "Pythagoras and labelling the hypotenuse.",
      });
      const outline = r.result.skeleton.outline;
      expect(outline[2]?.kind).toBe("starter");
      expect(outline[2]?.phase).toBe("starter");
      expect(outline[2]?.brief?.adds).toBe(
        "Retrieval: pupils recall what the class has already covered: Pythagoras and labelling the hypotenuse.",
      );
      expect(refsAt(r, 2)).toEqual([]);
      expect(r.result.gaps.some((g) => /declares no prior knowledge/.test(g))).toBe(false);
    });

    test("a deck with no room once every objective is taught says so in a gap", () => {
      const r = run({ n: 3, slideCount: 6, options: { keyIdeasPer: 1 } });
      expect(kinds(r)).not.toContain("starter");
      expect(r.result.gaps.some((g) => /no room for a starter/.test(g))).toBe(true);
    });

    for (const slideCount of [10, 12] as const) {
      test(`a ${slideCount}-slide deck of three objectives with prior knowledge declared has its starter at position 2`, () => {
        for (const verb of ["Explain", "Apply", "Describe", "Recall", "Evaluate"]) {
          const r = run({ n: 3, slideCount, shape: shapeOf(verb), priorKnowledge: "Unit 1." });
          expect(kinds(r)[2]).toBe("starter");
        }
      });
    }
  });

  describe("rule 2: learning cycles", () => {
    test("each objective's teaching is followed by its own check before the next objective is taught", () => {
      const r = run({ n: 3, slideCount: 12 });
      expect(r.result.cycles).toHaveLength(3);
      r.result.cycles.forEach((c, i) => {
        expect(c.check.length).toBeGreaterThan(0);
        const next = r.result.cycles[i + 1];
        for (const at of c.check) {
          expect(at).toBeGreaterThan(Math.max(...c.teach));
          if (next) expect(at).toBeLessThan(Math.min(...next.teach));
        }
      });
      // The first cycle's check tests the first objective only.
      const first = r.result.cycles[0]?.check[0] ?? -1;
      for (const i of questionsAt(r, first)) {
        expect(r.facts.questions[i]?.objectiveRefs.map((o) => o.index)).toEqual([0]);
      }
    });

    test("an apply question declaring an early key idea still waits for its objective's worked example", () => {
      const facts = factsFor(1, { keyIdeasPer: 3 });
      const slide = facts.questions.find((q) => q.use === "slide");
      if (!slide) throw new Error("fixture has no slide question");
      Object.assign(slide, { keyIdeaRefs: [{ type: "keyIdea", index: 0 }], demand: "apply" });
      const r = run({ n: 1, slideCount: 12, facts, options: { keyIdeasPer: 3 } });
      const i = facts.questions.indexOf(slide);
      const at = r.result.outlineFactRefs.find((e) => questionsAt(r, e.index).includes(i))?.index;
      const example = kinds(r).indexOf("worked-example");
      expect(example).toBeGreaterThan(0);
      expect(at ?? 0).toBeGreaterThan(example);
    });

    test("a question placed in a cycle comes after every key idea it declares (keyIdeaRefs), and may come before its objective's later ideas", () => {
      // Objective 1 with three key ideas: two cycles; a question declaring only key idea 0 is
      // checked after the first cycle, before key idea 2 is taught.
      const facts = factsFor(1, { keyIdeasPer: 3 });
      const slide = facts.questions.find((q) => q.use === "slide");
      if (!slide) throw new Error("fixture has no slide question");
      Object.assign(slide, { keyIdeaRefs: [{ type: "keyIdea", index: 0 }] });
      const r = run({ n: 1, slideCount: 12, facts, options: { keyIdeasPer: 3 } });
      const i = facts.questions.indexOf(slide);
      const at = r.result.outlineFactRefs.find((e) => questionsAt(r, e.index).includes(i))?.index;
      expect(at).toBeDefined();
      expect(at ?? 0).toBeGreaterThan(taughtAt(r, 0));
      expect(r.result.cycles.length).toBeGreaterThan(1);
    });

    test("no slide asks a question before every key idea it may test is on an earlier slide", () => {
      for (const n of [1, 2, 3, 4]) {
        for (const slideCount of SLIDE_COUNTS) {
          const r = run({ n, slideCount });
          const exit = r.result.skeleton.outline.length - 1;
          for (const entry of r.result.outlineFactRefs) {
            // r1: the starter's retrieval set asks before teaching by design (no prior knowledge).
            if (entry.index === exit || r.result.skeleton.outline[entry.index]?.kind === "starter")
              continue;
            for (const i of questionsAt(r, entry.index)) {
              const owners = r.facts.questions[i]?.objectiveRefs.map((o) => o.index) ?? [];
              const ideas = r.facts.keyIdeas.flatMap((k, j) =>
                k.objectiveRefs.some((o) => owners.includes(o.index)) ? [j] : [],
              );
              for (const k of ideas) expect(taughtAt(r, k)).toBeLessThan(entry.index);
            }
          }
        }
      }
    });

    test("a declared judgement closes the practise slides, after every cycle", () => {
      const r = run({
        n: 3,
        slideCount: 12,
        shape: shapeOf("Evaluate"),
        options: { bare: true, demand: "judgement" },
      });
      const outline = r.result.skeleton.outline;
      const judged = outline.findIndex((e) => /^Pupils judge/.test(e.brief?.adds ?? ""));
      expect(judged).toBeGreaterThan(0);
      const lastTeach = Math.max(...r.result.cycles.flatMap((c) => c.teach));
      expect(judged).toBeGreaterThan(lastTeach);
    });

    test("the skeleton passes planSkeletonSchemaFor with learningCycles and fails it without", () => {
      const r = run({ n: 3, slideCount: 12, shape: shapeOf("Explain") });
      const withCycles = planSkeletonSchemaFor({ learningCycles: true }).safeParse(
        r.result.skeleton,
      );
      expect(withCycles.success).toBe(true);
      const without = planSkeletonSchemaFor({}).safeParse(r.result.skeleton);
      expect(without.success).toBe(false);
    });
  });

  describe("rule 2: a short exit ticket", () => {});

  describe("rule 3: model, then practise", () => {
    test("an objective whose questions declare apply gets its worked example, before its practice", () => {
      // Eight slides, three objectives, Describe: no worked example is required, so without the
      // declaration none would fit before practice.
      const facts = factsFor(3);
      for (const q of facts.questions) {
        if (q.objectiveRefs[0]?.index === 1) Object.assign(q, { demand: "apply" });
      }
      const r = run({ n: 3, slideCount: 10, shape: shapeOf("Describe"), facts });
      const outline = r.result.skeleton.outline;
      const example = outline.findIndex(
        (e, i) =>
          e.kind === "worked-example" &&
          refsAt(r, i).some((f) => f.type === "workedExample" && f.index === 1),
      );
      expect(example).toBeGreaterThan(0);
      const practised = r.result.coverage[1]?.practised ?? [];
      expect(practised.length).toBeGreaterThan(0);
      for (const at of practised) expect(at).toBeGreaterThan(example);
      // Its objective's content comes first: the example sits in its cycle, after the teaching.
      expect(example).toBeGreaterThan(Math.min(...(r.result.coverage[1]?.taught ?? [])));
    });

    test("without the declaration a placed worked example still comes before its objective's practice", () => {
      for (const verb of ["Explain", "Apply"]) {
        const r = run({ n: 3, slideCount: 12, shape: shapeOf(verb) });
        r.result.skeleton.outline.forEach((e, i) => {
          if (e.kind !== "worked-example") return;
          for (const o of e.factRefs.map((f) => f.index)) {
            for (const at of r.result.coverage[o]?.practised ?? []) expect(at).toBeGreaterThan(i);
          }
        });
      }
    });

    test("apply questions and no worked example for the objective: a gap, nothing invented", () => {
      const facts = factsFor(2, { workedExamples: false });
      for (const q of facts.questions) Object.assign(q, { demand: "apply" });
      const r = run({ n: 2, slideCount: 10, facts });
      expect(kinds(r)).not.toContain("worked-example");
      for (const o of [1, 2]) {
        expect(r.result.gaps).toContain(
          `Objective ${o}'s questions ask pupils to apply it and the facts have no worked example for it, so no slide models it before they practise.`,
        );
      }
    });
  });
});

describe("lab r1 structure: sets, cycle checks, starter, exit quiz", () => {
  const questionRefs = (r: ReturnType<typeof run>, position: number) =>
    refsAt(r, position).flatMap((f) => (f.type === "question" ? [f.index] : []));
  const exitAt = (r: ReturnType<typeof run>) => r.result.skeleton.outline.length - 1;

  test("ten slides, three objectives: a check after every cycle but the last, which the exit quiz follows", () => {
    const r = run({ n: 3, slideCount: 10 });
    expect(r.result.skeleton.outline).toHaveLength(10);
    const cycles = r.result.cycles;
    const byObjective = (o: number) =>
      cycles.filter((c) =>
        c.teach.some((p) => r.result.skeleton.outline[p]?.factRefs.some((f) => f.index === o)),
      );
    for (const o of [0, 1]) {
      const last = byObjective(o).at(-1);
      expect(last?.check.length ?? 0).toBeGreaterThan(0);
    }
    const lastTeach = Math.max(...cycles.flatMap((c) => c.teach));
    const after = r.result.skeleton.outline.slice(lastTeach + 1).map((e) => e.kind);
    expect(after.at(-1)).toBe("exit-ticket");
  });

  test("a check is a set of 2-3 questions when the facts have them, multiple choice included", () => {
    const r = run({ n: 2, slideCount: 10 });
    const sets = r.result.skeleton.outline.flatMap((e, i) =>
      e.kind === "instructions" && e.phase === "practise" ? [i] : [],
    );
    expect(sets.length).toBeGreaterThan(0);
    for (const at of sets) {
      const qs = questionRefs(r, at);
      expect(qs.length).toBeGreaterThanOrEqual(2);
      expect(qs.length).toBeLessThanOrEqual(4);
      for (const i of qs) {
        const q = r.facts.questions[i];
        expect(q?.use).not.toBe("exit");
        expect(questionLine(q ?? { stem: "", answer: "" }).text.length).toBeLessThanOrEqual(240);
      }
    }
    const mcInSet = sets
      .flatMap((at) => questionRefs(r, at))
      .some((i) => (r.facts.questions[i]?.distractors?.length ?? 0) >= 3);
    expect(mcInSet).toBe(true);
  });

  test("no prior knowledge: the starter opens with a retrieval set of the easiest questions", () => {
    // A second worksheet question per objective: each keeps a set's worth for its check.
    const facts = factsFor(3);
    const more = facts.questions
      .filter((q) => q.use === "worksheet")
      .map((q) => ({ ...q, stem: q.stem.replace("Worksheet", "Another worksheet") }));
    const r = run({
      n: 3,
      slideCount: 10,
      facts: { ...facts, questions: [...facts.questions, ...more] },
    });
    expect(kinds(r)[2]).toBe("starter");
    const qs = questionRefs(r, 2);
    expect(qs.length).toBeGreaterThanOrEqual(2);
    expect(qs.every((i) => r.facts.questions[i]?.use !== "exit")).toBe(true);
    expect(r.result.skeleton.outline[2]?.brief?.adds).toMatch(/^Retrieval: \d quick questions/);
  });

  test("declared prior knowledge: the starter retrieves it and asks nothing from the lesson", () => {
    const r = run({ n: 3, slideCount: 10, priorKnowledge: "Pythagoras." });
    expect(kinds(r)[2]).toBe("starter");
    expect(questionRefs(r, 2)).toEqual([]);
  });

  test(`the exit quiz: ${EXIT_MIN}-${EXIT_MAX} quick items, fair ones only, answers revealed on the slide`, () => {
    for (const n of [1, 2, 3]) {
      const r = run({ n, slideCount: 10 });
      const items = refsAt(r, exitAt(r)).filter((f) => f.type !== "objective");
      expect(items.length).toBeGreaterThanOrEqual(Math.min(EXIT_MIN, items.length));
      expect(items.length).toBeLessThanOrEqual(EXIT_MAX);
      expect(r.result.skeleton.outline.at(-1)?.brief?.adds).toMatch(
        /quick items? across the objectives.*answers are revealed on the slide\.$/,
      );
    }
    const r = run({ n: 3, slideCount: 10 });
    expect(
      refsAt(r, exitAt(r)).filter((f) => f.type !== "objective").length,
    ).toBeGreaterThanOrEqual(EXIT_MIN);
  });

  test("pw prompts-2: an exit question that rewords one already on the quiz stays off it", () => {
    const facts = factsFor(3);
    const reworded = facts.questions
      .filter((q) => q.use === "exit")
      .map((q) => ({ ...q, stem: q.stem.replace("Exit", "Second exit") }));
    const r = run({
      n: 3,
      slideCount: 10,
      facts: { ...facts, questions: [...facts.questions, ...reworded] },
    });
    const qs = questionRefs(r, exitAt(r));
    expect(qs.some((i) => i >= facts.questions.length)).toBe(false);
  });

  test("two exit questions per objective (facts v14): six items, two per objective", () => {
    const facts = factsFor(3);
    const extra = facts.questions
      .filter((q) => q.use === "exit")
      // A second question of its own on each objective, not the first reworded (a repeat stays off).
      .map((q, k) => ({
        ...q,
        stem: `Give a fresh case that shows idea ${k + 1} in practice.`,
        answer: "A case of its own",
      }));
    const r = run({
      n: 3,
      slideCount: 10,
      facts: { ...facts, questions: [...facts.questions, ...extra] },
    });
    const qs = questionRefs(r, exitAt(r));
    expect(qs).toHaveLength(EXIT_MAX);
    for (const o of [0, 1, 2]) {
      expect(qs.filter((i) => r.facts.questions[i]?.objectiveRefs[0]?.index === o)).toHaveLength(2);
    }
  });
});

describe("the retrieval starter (lab r2)", () => {
  const retrieval = [
    { question: "What does a river carry downstream?", answer: "Water and sediment" },
    { question: "Where does a river start: its source or its mouth?", answer: "Its source" },
    { question: "Name one way water reaches a river.", answer: "Rain running off the land" },
  ];
  /** The round-1 deck of the easiest-question starter test: a second worksheet question each. */
  const richer = () => {
    const facts = factsFor(3);
    const more = facts.questions
      .filter((q) => q.use === "worksheet")
      .map((q) => ({ ...q, stem: q.stem.replace("Worksheet", "Another worksheet") }));
    return { ...facts, questions: [...facts.questions, ...more] };
  };
  const questionRefs = (r: ReturnType<typeof run>, position: number) =>
    refsAt(r, position).flatMap((f) => (f.type === "question" ? [f.index] : []));
  const placedQuestions = (r: ReturnType<typeof run>) =>
    r.result.outlineFactRefs.flatMap((e) =>
      e.factRefs.flatMap((f) => (f.type === "question" ? [f.index] : [])),
    );

  test("no prior knowledge: the starter keeps round 1's slot and is the retrieval set, with no question of the lesson's", () => {
    const facts = richer();
    const before = run({ n: 3, slideCount: 10, facts });
    const after = run({ n: 3, slideCount: 10, facts, retrieval });
    expect(questionRefs(before, 2).length).toBeGreaterThanOrEqual(2);
    expect(kinds(after)[2]).toBe("starter");
    expect(refsAt(after, 2)).toEqual([]);
    expect(after.result.skeleton.outline[2]?.brief?.adds).toBe(
      "Retrieval: 3 quick questions on earlier lessons pupils answer from memory before the teaching.",
    );
    expect(kinds(after)).toHaveLength(10);
    // The questions the starter no longer takes stay for the checks and the exit quiz.
    expect(placedQuestions(after).length).toBeGreaterThanOrEqual(
      placedQuestions(before).length - questionRefs(before, 2).length,
    );
    expect(after.result.gaps.some((g) => /declares no prior knowledge/.test(g))).toBe(false);
  });

  test("declared prior knowledge: the retrieval set takes the round-1 starter slot, no misconception, no question", () => {
    const before = run({ n: 3, slideCount: 10, priorKnowledge: "The water cycle." });
    const after = run({ n: 3, slideCount: 10, priorKnowledge: "The water cycle.", retrieval });
    expect(kinds(after)).toEqual(kinds(before));
    const at = kinds(after).indexOf("starter");
    expect(refsAt(after, at)).toEqual([]);
    expect(after.result.skeleton.outline[at]?.brief?.adds).toMatch(/on earlier lessons/);
  });

  test("the retrieval set is never a check or exit item, and no slide after the starter is a retrieval slide", () => {
    for (const slideCount of [6, 8, 10, 12] as SlideCount[]) {
      const r = run({ n: 3, slideCount, retrieval });
      const starters = kinds(r).flatMap((k, i) => (k === "starter" ? [i] : []));
      expect(starters.length).toBeLessThanOrEqual(1);
      for (const i of starters) expect(questionRefs(r, i)).toEqual([]);
      // Every question ref on a check or the exit quiz is a lesson fact.
      for (const e of r.result.outlineFactRefs)
        for (const f of e.factRefs)
          if (f.type === "question") expect(r.facts.questions[f.index]).toBeDefined();
    }
  });

  test("an empty retrieval list is round 1's starter", () => {
    const facts = richer();
    const none = run({ n: 3, slideCount: 10, facts });
    const empty = run({ n: 3, slideCount: 10, facts, retrieval: [] });
    expect(empty.result.outlineFactRefs).toEqual(none.result.outlineFactRefs);
  });
});

describe("a declared judgement on an early objective (l6j, DIAG-ratio-checks gap 2)", () => {
  /** Three objectives, each with one open question; only the ones in `judged` are declared judgements. */
  const withJudgements = (judged: number[]) => {
    const facts = factsFor(3, { bare: true });
    facts.questions.forEach((q, i) => {
      const o = q.objectiveRefs?.[0]?.index ?? -1;
      if (q.distractors === undefined && judged.includes(o)) {
        facts.questions[i] = { ...q, demand: "judgement" };
      }
    });
    return facts;
  };
  const judgedAt = (r: ReturnType<typeof run>) =>
    r.result.skeleton.outline.findIndex((e) => /^Pupils judge/.test(e.brief?.adds ?? ""));

  for (const slideCount of [10, 12] as const) {
    test(`${slideCount} slides: objective 1's judgement stays in its own cycle, before objective 2 is taught`, () => {
      const r = run({ n: 3, slideCount, shape: shapeOf("Explain"), facts: withJudgements([0]) });
      const judged = judgedAt(r);
      const cycles = r.result.cycles;
      expect(cycles.length).toBeGreaterThan(1);
      expect(judged).toBeGreaterThan(0);
      expect(judged).toBeLessThan(Math.min(...(cycles[1]?.teach ?? [])));
      // Objective 1 is practised before objective 2's teaching starts, whichever slide checks it.
      const secondTeach = Math.min(...(cycles[1]?.teach ?? []));
      const practisedFirst = r.result.outlineFactRefs.some(
        (e) =>
          e.index < secondTeach &&
          r.result.skeleton.outline[e.index]?.phase === "practise" &&
          e.factRefs.some(
            (f) =>
              f.type === "question" &&
              r.facts.questions[f.index]?.objectiveRefs?.some((x) => x.index === 0),
          ),
      );
      expect(practisedFirst).toBe(true);
    });
  }

  test("a judgement on the last objective is preferred and closes the practise phase", () => {
    const r = run({
      n: 3,
      slideCount: 12,
      shape: shapeOf("Explain"),
      facts: withJudgements([0, 2]),
    });
    const judged = judgedAt(r);
    expect(judged).toBeGreaterThan(Math.max(...r.result.cycles.flatMap((c) => c.teach)));
    const asked = refsAt(r, judged).flatMap((f) => (f.type === "question" ? [f.index] : []));
    expect(asked.map((i) => r.facts.questions[i]?.objectiveRefs?.[0]?.index)).toEqual([2]);
  });
});
