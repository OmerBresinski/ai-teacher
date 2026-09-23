import { describe, expect, test } from "bun:test";
import { SLIDE_COUNTS, type SlideCount } from "@tj/domain/documents";
import { clip, type OutlineFacts, outlineFromFacts } from "./outline-from-facts";
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

  test("phases run starter → explain → practise → check and the exit ticket closes", () => {
    // Two objectives: with three, the remaining worked examples (placed before the starter) fill
    // the deck and no starter fits, which is the intended trade.
    const r = run({ n: 2, slideCount: 12, shape: shapeOf("Apply") });
    const order = { starter: 0, explain: 1, practise: 2, check: 3 };
    const ranks = r.result.skeleton.outline.slice(2).map((e) => order[e.phase ?? "check"]);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
    expect(kinds(r)).toContain("starter");
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
  const explainSlides = (r: ReturnType<typeof run>) =>
    r.result.skeleton.outline.filter(
      (e) =>
        e.phase === "explain" &&
        ["content", "worked-example", "image-text", "vocabulary"].includes(e.kind),
    ).length;
  const practiseSlides = (r: ReturnType<typeof run>) =>
    r.result.skeleton.outline.filter((e) => e.phase === "practise").length;

  test("Apply at 8 slides: 40 % of the 6 slides after title and objectives is 2 practise slides", () => {
    // One objective: P1–P3 alone give one practise slide; the floor adds the second.
    const r = run({ n: 1, shape: shapeOf("Apply"), slideCount: 8, options: { bare: true } });
    expect(r.result.skeleton.outline).toHaveLength(8);
    expect(practiseSlides(r)).toBeGreaterThanOrEqual(2); // floor(6 × 40 / 100)
    expect(explainSlides(r)).toBeGreaterThanOrEqual(1); // floor(6 × 30 / 100)
    expect(r.result.gaps.some((g) => /practise phase|explain slide/.test(g))).toBe(false);
    const parsed = planSkeletonSchemaFor({ shape: shapeOf("Apply"), slideCount: 8 }).safeParse(
      r.result.skeleton,
    );
    const shareIssues = parsed.success
      ? []
      : parsed.error.issues.filter((i) => /slides after the title/.test(i.message));
    expect(shareIssues).toEqual([]);
  });

  test("three objectives in an 8-slide Apply deck: every key idea is taught and the second practise slide is the gap", () => {
    const r = run({ n: 3, shape: shapeOf("Apply"), slideCount: 8, options: { bare: true } });
    for (const o of [0, 1, 2]) expect(r.result.coverage[o]?.taught.length).toBeGreaterThan(0);
    // Five slots: three content slides (a worked example no longer stands in for objective 3's,
    // which left its key ideas untaught), the worked example, the shared practise slide.
    expect(r.result.unplaced.keyIdeas).toEqual([]);
    expect(kinds(r)).toContain("worked-example");
    expect(practiseSlides(r)).toBe(1);
    expect(r.result.gaps.some((g) => /in the practise phase/.test(g))).toBe(true);
  });

  test("three objectives in an 8-slide Apply deck without worked examples: practice gives way to teaching (ruling 81)", () => {
    const r = run({
      n: 3,
      shape: shapeOf("Apply"),
      slideCount: 8,
      options: { bare: true, workedExamples: false },
    });
    for (const o of [0, 1, 2]) expect(r.result.coverage[o]?.taught.length).toBeGreaterThan(0);
    // Three content slides, the shared practise slide, one more practise slide: the share holds.
    expect(practiseSlides(r)).toBe(2);
  });

  test("four objectives in an 8-slide Apply deck: teaching takes four slots and the share is a gap", () => {
    const r = run({ n: 4, shape: shapeOf("Apply"), slideCount: 8, options: { bare: true } });
    for (const o of [0, 1, 2, 3]) expect(r.result.coverage[o]?.taught.length).toBeGreaterThan(0);
    expect(r.result.gaps).toContain(
      "At least 2 of the 6 slides after the title and objectives slides are in the practise phase. A 8-slide deck has room for 1 once every objective is taught.",
    );
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
    expect(kinds(r)).toContain("multiple-choice");
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

  test("Recall forbids open-response: a bare question becomes a discussion, multiple-choice otherwise", () => {
    const r = run({
      n: 2,
      slideCount: 12,
      shape: shapeOf("Recall"),
      options: { bare: true, keyIdeasPer: 1, workedExamples: false },
    });
    const k = kinds(r);
    expect(k).not.toContain("open-response");
    expect(k).toContain("multiple-choice");
    expect(k).toContain("discussion");
    expect(k).not.toContain("true-false");
  });

  const questionsOnSlides = (r: ReturnType<typeof run>) =>
    r.result.outlineFactRefs
      .filter((e) => r.result.skeleton.outline[e.index]?.kind !== "exit-ticket")
      .flatMap((e) => e.factRefs.filter((ref) => ref.type === "question").map((ref) => ref.index));

  test("no question is used twice and a worksheet question reaches only the practice set when the floor does not need it", () => {
    const r = run({ n: 3, slideCount: 12 });
    const used = questionsOnSlides(r);
    expect(new Set(used).size).toBe(used.length);
    for (const e of r.result.outlineFactRefs) {
      const sheet = e.factRefs.some(
        (ref) => ref.type === "question" && r.facts.questions[ref.index]?.use === "worksheet",
      );
      if (sheet) expect(r.result.skeleton.outline[e.index]?.kind).toBe("instructions");
    }
    expect(r.result.unplaced.questions).toEqual([]);
  });

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

  test("the exit ticket carries every exit question", () => {
    const r = run({ n: 3, slideCount: 8 });
    const exit = refsAt(r, 7).map((ref) => ref.index);
    const expected = r.facts.questions.flatMap((q, i) => (q.use === "exit" ? [i] : []));
    expect(exit).toEqual(expected);
    expect(r.result.coverage.every((c) => c.checked.includes(7))).toBe(true);
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

  test("the fixed templates", () => {
    const r = run({ n: 2, slideCount: 12, shape: shapeOf("Recall") });
    const outline = r.result.skeleton.outline;
    const adds = (kind: string) => outline.find((e) => e.kind === kind)?.brief?.adds;
    expect(adds("starter")).toBe(
      "Pupils say what they already think about Rivers before being told.",
    );
    expect(adds("vocabulary")).toBe("Defines the key words: term 1a, term 1b, term 2a, term 2b.");
    // The fixture's exit questions are multiple-choice-native with no open question to swap in.
    expect(adds("exit-ticket")).toBe(
      "2 questions, one per objective. Multiple choice for objectives 1 and 2, each with its options listed.",
    );
    expect(adds("multiple-choice")).toMatch(/^Checks: Slide question/);
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
  const shared = (r: ReturnType<typeof run>) => {
    const position = kinds(r).indexOf("instructions");
    return { position, entry: r.result.skeleton.outline[position], refs: refsAt(r, position) };
  };

  // Apply: its only required kind is the worked example, so the shared slide's own placement shows.
  test("three objectives at eight slides: three teaching slides, one shared practise slide, one more practise slide", () => {
    const r = run({
      n: 3,
      slideCount: 8,
      shape: shapeOf("Apply"),
      options: {
        workedExamples: false,
        forms: ["multiple-choice", "open-response"],
        distractors: 2,
      },
    });
    const k = kinds(r);
    expect(k).toHaveLength(8);
    expect(k.filter((x) => x === "instructions")).toHaveLength(1);
    // No worked example to place, so the fifth slot is the second practise slide the 40 % share
    // asks for.
    expect(k.filter((x) => x === "content" || x === "worked-example")).toHaveLength(3);
    expect(r.result.skeleton.outline.filter((e) => e.phase === "practise")).toHaveLength(2);
    for (const o of [0, 1, 2]) expect(r.result.coverage[o]?.taught.length).toBeGreaterThan(0);
    const { position, entry, refs } = shared(r);
    expect(entry?.phase).toBe("practise");
    expect(entry?.factRefs).toEqual([obj(0), obj(1), obj(2)]);
    // A question on each objective, then filled to four from the unused ones (P8), never an exit
    // question.
    expect(entry?.brief?.adds).toBe("Your turn: 4 questions.");
    expect(refs.every((ref) => ref.type === "question")).toBe(true);
    expect(refs).toHaveLength(4);
    expect(refs.map((ref) => r.facts.questions[ref.index]?.use)).not.toContain("exit");
    expect(
      new Set(refs.map((ref) => r.facts.questions[ref.index]?.objectiveRefs[0]?.index)),
    ).toEqual(new Set([0, 1, 2]));
    for (const o of [0, 1, 2]) {
      expect(r.result.coverage[o]?.practised).toContain(position);
      expect(r.result.coverage[o]?.checked).toEqual([7]);
    }
    expect(r.result.gaps.some((g) => /no room to practise it/.test(g))).toBe(false);
    expect(r.result.gaps.some((g) => /in the practise phase/.test(g))).toBe(false);
  });

  test("two objectives at six slides: two teaching slides and one shared practise slide", () => {
    const r = run({
      n: 2,
      slideCount: 6,
      shape: shapeOf("Apply"),
      options: { forms: ["multiple-choice", "open-response"], distractors: 2 },
    });
    const k = kinds(r);
    expect(k.slice(2, 4).every((x) => x === "content" || x === "worked-example")).toBe(true);
    expect(k[4]).toBe("instructions");
    expect(shared(r).entry?.factRefs).toEqual([obj(0), obj(1)]);
    expect(shared(r).refs.length).toBeGreaterThanOrEqual(2);
    expect(r.result.coverage.map((c) => c.practised)).toEqual([[4], [4]]);
    expect(r.result.gaps.some((g) => /no room to practise it/.test(g))).toBe(false);
  });

  test("an Explain lesson keeps its open-response before the shared slide: the reach objective is explained", () => {
    const r = run({
      n: 3,
      slideCount: 8,
      options: { forms: ["multiple-choice", "open-response"], distractors: 2 },
    });
    expect(kinds(r)).toContain("open-response");
    expect(r.result.coverage.every((c) => c.checked.length > 0)).toBe(true);
  });

  test("the shared slide falls back on worksheet questions, never an exit question", () => {
    const facts = factsFor(2, { forms: ["multiple-choice", "open-response"], distractors: 2 });
    const r = run({
      n: 2,
      slideCount: 6,
      facts: { ...facts, questions: facts.questions.filter((q) => q.use !== "slide") },
    });
    expect(shared(r).refs.map((ref) => r.facts.questions[ref.index]?.use)).toEqual([
      "worksheet",
      "worksheet",
    ]);
  });

  test("the shared slide prints stems only: a multiple-choice-native question never joins it", () => {
    // Native forms: three distractors make every slide and worksheet question multiple choice.
    const r = run({ n: 2, slideCount: 6, shape: shapeOf("Apply") });
    expect(kinds(r)).not.toContain("instructions");
    for (const [position, entry] of r.result.skeleton.outline.entries()) {
      if (entry.kind !== "instructions" && entry.kind !== "open-response") continue;
      for (const ref of refsAt(r, position)) {
        if (ref.type === "question")
          expect(r.facts.questions[ref.index]?.distractors?.length ?? 0).toBeLessThan(3);
      }
    }
  });

  test("the shared slide counts once towards the practise floor", () => {
    const r = run({
      n: 3,
      shape: shapeOf("Apply"),
      slideCount: 8,
      options: { bare: true, workedExamples: false },
    });
    expect(kinds(r)).toContain("instructions");
    // The floor is 2 of 6: the shared slide is one, a practise slide of its own the other.
    expect(r.result.skeleton.outline.filter((e) => e.phase === "practise")).toHaveLength(2);
    expect(r.result.coverage.every((c) => c.practised.length > 0)).toBe(true);
  });

  test("room for a practise slide per objective: each objective practised, the last single-question slide becomes a practice set of the unused questions", () => {
    for (const slideCount of [10, 12] as const) {
      const r = run({
        n: 3,
        slideCount,
        options: { forms: ["multiple-choice", "open-response"], distractors: 2 },
      });
      const k = kinds(r);
      expect(k.filter((x) => x === "instructions")).toHaveLength(1);
      expect(r.result.coverage.every((c) => c.practised.length > 0)).toBe(true);
      const { refs } = shared(r);
      expect(refs.length).toBeGreaterThanOrEqual(3);
      expect(refs.length).toBeLessThanOrEqual(4);
      expect(refs.map((ref) => r.facts.questions[ref.index]?.use)).not.toContain("exit");
      // Asked easiest first.
      const tiers = refs.map((ref) => r.facts.questions[ref.index]?.tier ?? "core");
      const order = ["easy", "core", "stretch"];
      expect([...tiers].sort((a, b) => order.indexOf(a) - order.indexOf(b))).toEqual(tiers);
    }
  });

  test("a question the facts declared multiple-choice only never joins a set: its stem needs its options", () => {
    const r = run({ n: 3, slideCount: 10, options: { forms: ["multiple-choice"] } });
    expect(kinds(r)).not.toContain("instructions");
  });

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
      const parsed = planSkeletonSchemaFor({ shape, slideCount }).safeParse(r.result.skeleton);
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
    refsAt(r, r.result.skeleton.outline.length - 1).map((ref) => ref.index);
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
    expect(exitRefs(r)).toEqual(exits);
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
    expect(r.result.unplaced.keyIdeas).toEqual([]);
    expect(contentKeyIdeas(r)).toHaveLength(6);
    expect(r.result.skeleton.outline.filter((e) => e.phase === "practise").length).toBe(1);
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
    expect(exitRefs(r).length).toBe(3 - untaught.size);
    expect(r.result.skeleton.outline.at(-1)?.brief?.adds).toMatch(
      /^3 questions, one per objective, each on what the slides taught\. Multiple choice for objectives? /,
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
    expect(exitRefs(r).length).toBe(3);
    expect(exitRefs(before).length).toBeLessThan(3);
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
    expect(exitRefs(held).length).toBe(2);
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

  test("a multiple-choice-native exit question is swapped for an open question on its objective", () => {
    const facts = factsFor(1);
    facts.questions.push({
      stem: "Open worksheet question for objective 1?",
      answer: "A full answer",
      reasoning: "Because.",
      tier: "core",
      use: "worksheet",
      objectiveRefs: [obj(0)],
    });
    const open = facts.questions.length - 1;
    const r = run({ n: 1, slideCount: 8, facts });
    expect(exitQuestions(r)).toEqual([open]);
    // The objective is still checked, and the swapped question is on no other slide.
    expect(r.result.coverage[0]?.checked).toEqual([exitAt(r)]);
    const elsewhere = r.result.outlineFactRefs
      .filter((e) => e.index !== exitAt(r))
      .flatMap((e) => e.factRefs.filter((f) => f.type === "question").map((f) => f.index));
    expect(elsewhere).not.toContain(open);
    expect(r.result.unplaced.questions).not.toContain(open);
    expect(r.result.skeleton.outline.at(-1)?.brief?.adds).toBe("1 question, one per objective.");
  });

  test("dropped when its objective already has an open exit question", () => {
    const facts = factsFor(1);
    facts.questions.push({
      stem: "Open exit question for objective 1?",
      answer: "A full answer",
      reasoning: "Because.",
      tier: "core",
      use: "exit",
      objectiveRefs: [obj(0)],
    });
    const r = run({ n: 1, slideCount: 8, facts });
    const asked = exitQuestions(r);
    expect(asked).toEqual([facts.questions.length - 1]);
    expect(r.result.skeleton.outline.at(-1)?.brief?.adds).not.toMatch(/Multiple choice/);
  });

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
  const STEM_ONLY = new Set(["instructions", "open-response", "discussion", "exit-ticket"]);
  const stemOnlyQuestions = (r: ReturnType<typeof run>) =>
    r.result.skeleton.outline.flatMap((entry, position) =>
      STEM_ONLY.has(entry.kind)
        ? refsAt(r, position)
            .filter((ref) => ref.type === "question")
            .map((ref) => ({ kind: entry.kind, q: r.facts.questions[ref.index] }))
        : [],
    );

  test("a question with three distractors declared open as well is set as multiple choice, never as a bare stem", () => {
    for (const slideCount of [6, 8, 10, 12] as const) {
      for (const verb of ["Explain", "Apply"] as const) {
        const r = run({
          n: 3,
          slideCount,
          shape: shapeOf(verb),
          options: { forms: ["multiple-choice", "open-response"] },
        });
        const brief = r.result.skeleton.outline.at(-1)?.brief?.adds ?? "";
        for (const { kind, q } of stemOnlyQuestions(r)) {
          if ((q?.distractors?.length ?? 0) < 3) continue;
          // Only the exit ticket may carry one, and then its brief lists the options.
          expect(kind).toBe("exit-ticket");
          expect(brief).toMatch(/Multiple choice for objective/);
        }
        if (slideCount >= 10) expect(kinds(r)).toContain("multiple-choice");
      }
    }
  });

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

  test("a declared true-false exit question with nothing to swap in is left off, and the gap and brief say so", () => {
    const facts = factsFor(1, { distractors: 3 });
    const exit = facts.questions.find((q) => q.use === "exit");
    if (!exit) throw new Error("fixture has no exit question");
    Object.assign(exit, { forms: ["true-false", "open-response"], distractors: [] });
    const r = run({ n: 1, slideCount: 8, facts });
    expect(exitQuestions(r)).toEqual([]);
    expect(r.result.gaps.some((g) => /cannot be asked as a line of the exit ticket/.test(g))).toBe(
      true,
    );
    expect(r.result.skeleton.outline.at(-1)?.brief?.adds).toMatch(
      /^0 questions, on the objectives/,
    );
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
