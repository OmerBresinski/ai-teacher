import { describe, expect, test } from "bun:test";
import { LessonFactsSchema } from "@tj/domain/documents";
import { lessonShapeOf, OBJECTIVE_VERBS, PRIOR_CONFIDENCES } from "./shapes";
import {
  assignFactIds,
  EMPTY_PLAN_FACTS,
  EvaluateOutputSchema,
  PlanSkeletonSchema,
  planFactsSchemaFor,
  planSkeletonSchemaFor,
  usesTerm,
  verifyOutputSchemaFor,
  WorksheetSpecSchema,
} from "./specs";
import { FIXTURES, PLAN_SKELETONS } from "./testing";

/* The Plan schemas (ADR 0025 §7; Generation quality §1–§2, TEACH-211; Lesson shape, TEACH-229). */

const O = (index: number) => ({ type: "objective" as const, index });
const RIVER = { subject: "river severn", mustShow: ["river water"], purpose: "observe" as const };
const brief = { adds: "One thing" };
/** The shape of a cell, for an older class unless a year is given. */
const shapeOf = (verb: string, confidence: string, yearGroup = "Year 8") =>
  lessonShapeOf({ objectiveVerb: verb, priorConfidence: confidence }, { yearGroup });
const EXPLAIN_SOME = shapeOf("Explain", "Some prior knowledge");

/**
 * A valid 60-minute skeleton for the default cell (Explain / Some): 24 explain minutes of 60, two
 * content slides, a worked example, an open-response, phases in order.
 */
const outline = (): Record<string, unknown>[] => [
  { kind: "title", minutes: 2, factRefs: [] },
  { kind: "objectives", minutes: 3, factRefs: [O(0)] },
  { kind: "starter", minutes: 5, factRefs: [O(0)], phase: "starter", brief },
  { kind: "content", minutes: 10, factRefs: [O(0)], phase: "explain", brief },
  { kind: "content", minutes: 6, factRefs: [O(0)], phase: "explain", brief },
  { kind: "worked-example", minutes: 8, factRefs: [O(0)], phase: "explain", brief },
  { kind: "multiple-choice", minutes: 8, factRefs: [O(0)], phase: "practise", brief },
  { kind: "open-response", minutes: 7, factRefs: [O(0)], phase: "practise", brief },
  { kind: "exit-ticket", minutes: 11, factRefs: [O(0)], phase: "check", brief },
];

/** Structural rules only unless a shape is given. */
const parse = (
  entries: unknown[],
  context: Parameters<typeof planSkeletonSchemaFor>[0] = { durationMin: 60 },
) =>
  planSkeletonSchemaFor(context).safeParse({
    learningObjectives: [{ text: "Describe rivers" }],
    outline: entries,
  });

const messagesOf = (result: ReturnType<typeof parse>) =>
  result.success ? [] : result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);

describe("planSkeletonSchemaFor", () => {
  test("the fixture skeleton and a well-formed outline parse, with and without the default shape", () => {
    expect(parse(outline()).success).toBe(true);
    expect(parse(outline(), { durationMin: 60, shape: EXPLAIN_SOME }).success).toBe(true);
    expect(
      planSkeletonSchemaFor({ durationMin: 60, shape: EXPLAIN_SOME }).safeParse(
        FIXTURES.planSkeleton,
      ).success,
    ).toBe(true);
  });

  test("row 1: explain minutes 8 of 60 is an issue that names the 18 needed (the shape's 30 %)", () => {
    const entries = outline();
    entries[3] = { ...entries[3], minutes: 4 };
    entries[4] = { ...entries[4], minutes: 2 };
    entries[5] = { ...entries[5], minutes: 2 };
    entries[6] = { ...entries[6], minutes: 20 };
    const messages = messagesOf(parse(entries, { durationMin: 60, shape: EXPLAIN_SOME }));
    expect(messages).toContainEqual(
      expect.stringContaining("explain phase needs at least 18 minutes (30% of 60)"),
    );
    expect(messages).toContainEqual(
      expect.stringContaining(
        "it has 8. Add 10 minutes to content, worked-example, image-text or vocabulary slides.",
      ),
    );
    // Without a shape (the structural schema) the share is not checked.
    expect(parse(entries).success).toBe(true);
  });

  describe("TEACH-237: the rules that rejected a good outline in production", () => {
    const EXPLAIN_NEW = shapeOf("Explain", "New to it", "Year 5");
    /** The rodents outline the worker rejected twice on 2026-09-10 (reconstructed from the messages). */
    const rodents = (): Record<string, unknown>[] => [
      { kind: "title", minutes: 2, factRefs: [] },
      { kind: "objectives", minutes: 3, factRefs: [O(0)] },
      { kind: "starter", minutes: 5, factRefs: [O(0)], phase: "starter", brief },
      { kind: "content", minutes: 8, factRefs: [O(0)], phase: "explain", brief },
      { kind: "vocabulary", minutes: 5, factRefs: [O(0)], phase: "explain", brief },
      { kind: "content", minutes: 8, factRefs: [O(0)], phase: "explain", brief },
      { kind: "worked-example", minutes: 7, factRefs: [O(0)], phase: "explain", brief },
      { kind: "multiple-choice", minutes: 6, factRefs: [O(0)], phase: "practise", brief },
      { kind: "open-response", minutes: 8, factRefs: [O(0)], phase: "practise", brief },
      { kind: "exit-ticket", minutes: 8, factRefs: [O(0)], phase: "check", brief },
    ];

    test("row 1: the production outline — vocabulary in the explain phase, 23 + 5 explain minutes of 60 — parses for Explain / New to it", () => {
      expect(messagesOf(parse(rodents(), { durationMin: 60, shape: EXPLAIN_NEW }))).toEqual([]);
    });

    test("vocabulary counts towards the explain share and may open the explain phase before the definition", () => {
      const entries = rodents();
      // Vocabulary first, then the definition: the opener check looks past it.
      const [vocab] = entries.splice(4, 1);
      if (!vocab) throw new Error("fixture");
      entries.splice(3, 0, vocab);
      expect(messagesOf(parse(entries, { durationMin: 60, shape: EXPLAIN_NEW }))).toEqual([]);
      // But a worked-example after the vocabulary is still not the definition.
      const wrong = rodents();
      wrong[5] = { ...wrong[5], kind: "worked-example" };
      wrong[3] = { ...wrong[3], kind: "worked-example" };
      expect(messagesOf(parse(wrong, { durationMin: 60, shape: EXPLAIN_NEW }))).toContainEqual(
        expect.stringMatching(
          /^outline\.3\.kind: Outline position 3 is the first explain-phase slide \(after any vocabulary\) and is a worked-example/,
        ),
      );
    });

    test("row 2: a phase two minutes under its share passes; three under names the minutes to add", () => {
      // 24 needed (40 % of 60). 22 passes.
      const short2 = rodents();
      short2[6] = { ...short2[6], minutes: 1 };
      expect(messagesOf(parse(short2, { durationMin: 60, shape: EXPLAIN_NEW }))).toEqual([]);
      // 21 fails, asking for 3 (back to the full share), not 1.
      const short3 = rodents();
      short3[6] = { ...short3[6], minutes: 0 };
      short3[4] = { ...short3[4], minutes: 5 };
      expect(messagesOf(parse(short3, { durationMin: 60, shape: EXPLAIN_NEW }))).toContainEqual(
        "outline: The explain phase needs at least 24 minutes (40% of 60); it has 21. Add 3 minutes to content, worked-example, image-text or vocabulary slides.",
      );
      // The practise share tolerates the same two minutes (Apply: 24 of 60; 22 passes, 21 fails).
      const apply = (practise: number) => {
        const e = rodents();
        e[7] = { ...e[7], minutes: practise - 8 };
        return messagesOf(
          parse(e, { durationMin: 60, shape: shapeOf("Apply", "Some prior knowledge") }),
        );
      };
      expect(apply(22)).not.toContainEqual(expect.stringContaining("practise phase needs"));
      expect(apply(21)).toContainEqual(
        "outline: The practise phase needs at least 24 minutes (40% of 60); it has 21. Add 3 minutes to practise slides.",
      );
    });

    test("row 3: an imageBrief with six avoid items passes the Plan schema and then the domain schema (assignFactIds)", () => {
      const entries = rodents();
      const avoid = ["cage", "fence", "bars", "glass", "hands", "toys"];
      entries[5] = { ...entries[5], kind: "image-text", imageBrief: { ...RIVER, avoid } };
      const result = parse(entries, { durationMin: 60, shape: EXPLAIN_NEW });
      expect(messagesOf(result)).toEqual([]);
      if (!result.success) return;
      const facts = assignFactIds(result.data, EMPTY_PLAN_FACTS, 60);
      expect(facts.outline[5]?.imageBrief?.avoid).toEqual(avoid);
      expect(LessonFactsSchema.safeParse(facts).success).toBe(true);
    });
  });

  test("row 2: practise before explain is an issue naming the position", () => {
    const entries = outline();
    const [practise] = entries.splice(6, 1);
    if (!practise) throw new Error("fixture");
    entries.splice(3, 0, practise);
    const messages = messagesOf(parse(entries));
    expect(messages).toContainEqual(
      'outline.4.phase: Outline position 4 is a "explain" slide but position 3 is already "practise"; phases run starter, explain, practise, check and never go back. Move this slide before the first "practise" slide, or give it the phase "practise".',
    );
  });

  test("a missing brief or phase from position 2 names the position; one on the title is refused", () => {
    const bare = outline();
    bare[3] = { kind: "content", minutes: 10, factRefs: [O(0)] };
    const messages = messagesOf(parse(bare));
    expect(messages).toContainEqual(
      expect.stringContaining("outline.3.brief: Outline position 3 needs a brief"),
    );
    expect(messages).toContainEqual(
      expect.stringContaining("outline.3.phase: Outline position 3 needs a phase"),
    );
    const titled = outline();
    titled[0] = { ...titled[0], phase: "starter" };
    expect(messagesOf(parse(titled))).toContainEqual(
      "outline.0: The title and objectives slides carry no phase or brief.",
    );
  });

  test("a lesson with no check slide is an issue", () => {
    const entries = outline();
    entries[8] = { ...entries[8], phase: "practise" };
    expect(messagesOf(parse(entries))).toContainEqual(
      'outline: The lesson needs at least one "check" slide.',
    );
  });

  test("a class new to the topic needs an explain slide per objective", () => {
    const context = { durationMin: 60, shape: shapeOf("Explain", "New to it") };
    const schema = planSkeletonSchemaFor(context);
    const entries = outline();
    entries[3] = { kind: "vocabulary", minutes: 4, factRefs: [O(0)], phase: "starter", brief };
    entries.splice(4, 0, {
      kind: "content",
      minutes: 10,
      factRefs: [O(0)],
      phase: "explain",
      brief,
    });
    const two = schema.safeParse({
      learningObjectives: [{ text: "A" }, { text: "B" }],
      outline: entries,
    });
    expect(two.success).toBe(false);
    if (two.success) return;
    expect(two.error.issues.map((i) => i.message)).toEqual([
      "The class is new to this: objective 1 needs a content or worked-example slide that names it.",
    ]);
    // Any other confidence: the rule does not apply.
    expect(
      planSkeletonSchemaFor({ durationMin: 60, shape: EXPLAIN_SOME }).safeParse({
        learningObjectives: [{ text: "A" }, { text: "B" }],
        outline: outline(),
      }).success,
    ).toBe(true);
  });

  describe("the lesson shape's deterministic column (TEACH-229)", () => {
    const withShape = (entries: unknown[], verb: string, confidence: string, year?: string) =>
      messagesOf(parse(entries, { durationMin: 60, shape: shapeOf(verb, confidence, year) }));

    test("row 1: Explain / New to it with a worked-example opening the explain phase names the position and the content slide that defines", () => {
      const entries = outline();
      entries.splice(3, 0, {
        kind: "vocabulary",
        minutes: 4,
        factRefs: [O(0)],
        phase: "starter",
        brief,
      });
      // The worked-example moves to the front of the explain phase.
      const [method] = entries.splice(6, 1);
      if (!method) throw new Error("fixture");
      entries.splice(4, 0, method);
      const messages = withShape(entries, "Explain", "New to it");
      expect(messages).toContainEqual(
        expect.stringMatching(
          /^outline\.4\.kind: Outline position 4 is the first explain-phase slide \(after any vocabulary\) and is a worked-example; for this lesson it is a content slide that defines the topic/,
        ),
      );
      // The same outline with the content first passes the cell.
      expect(withShape(outline_new(), "Explain", "New to it")).toEqual([]);
    });

    /** The default outline made valid for a "New to it" cell: a vocabulary slide added. */
    function outline_new(): Record<string, unknown>[] {
      const entries = outline();
      entries.splice(3, 0, {
        kind: "vocabulary",
        minutes: 4,
        factRefs: [O(0)],
        phase: "starter",
        brief,
      });
      return entries;
    }

    test("row 2: Recall forbids open-response, and names the retrieval kinds to use; the missing vocabulary slide is named too", () => {
      const messages = withShape(outline(), "Recall", "Some prior knowledge");
      expect(messages).toContainEqual(
        "outline.7.kind: Outline position 7 is an open-response slide; a Recall lesson has none. Make it matching, fill-gap, multiple-choice or true-false.",
      );
      expect(messages).toContainEqual(
        "outline: The outline has no vocabulary slide and this lesson needs one; add it in the starter or explain phase.",
      );
      // The Recall fixture passes both Recall cells the eval uses.
      for (const confidence of ["New to it", "Some prior knowledge"]) {
        expect(
          planSkeletonSchemaFor({
            durationMin: 20,
            shape: shapeOf("Recall", confidence, "Reception"),
          }).safeParse(PLAN_SKELETONS.Recall).success,
        ).toBe(true);
      }
    });

    test("row 3: Apply / Revisiting with a practise slide before the worked-example names both positions", () => {
      const entries = outline();
      const [practise] = entries.splice(6, 1);
      if (!practise) throw new Error("fixture");
      entries.splice(5, 0, practise);
      const messages = withShape(entries, "Apply", "Revisiting");
      expect(messages).toContainEqual(
        "outline.5.phase: Outline position 5 is a practise slide but the worked-example (the method) is at position 6; pupils practise only after the method. Move the worked-example before position 5, in the explain phase.",
      );
      // Apply wants 40 % practise: the default outline's 15 of 60 is named too.
      expect(messages).toContainEqual(
        expect.stringContaining("practise phase needs at least 24 minutes (40% of 60); it has 15"),
      );
    });

    test("row 4 (withdrawn by TEACH-237): Evaluate / Some with no matching, sort or second worked-example is a prompt rule, not an issue", () => {
      expect(withShape(outline(), "Evaluate", "Some prior knowledge")).toEqual([]);
      const paired = outline();
      paired[6] = { ...paired[6], kind: "matching" };
      expect(withShape(paired, "Evaluate", "Some prior knowledge")).toEqual([]);
      const twoExamples = outline();
      twoExamples[4] = { ...twoExamples[4], kind: "worked-example" };
      expect(withShape(twoExamples, "Evaluate", "Some prior knowledge")).toEqual([]);
    });

    test("minContent and minCheckEntries name the count found and the count needed", () => {
      const entries = outline();
      // An image-text slide is a content slide with a picture: it counts (TEACH-237).
      entries[4] = { ...entries[4], kind: "image-text", imageBrief: RIVER };
      expect(withShape(entries, "Explain", "Some prior knowledge")).toEqual([]);
      // A second worked-example instead: only one content-like slide remains.
      entries[4] = { ...entries[4], kind: "worked-example", imageBrief: undefined };
      expect(withShape(entries, "Explain", "Some prior knowledge")).toEqual([
        "outline: The outline has 1 content or image-text slide. At least 2 content slides: the definition first, then the mechanism (how or why) on its own slide; add one in the explain phase.",
      ]);
      // Revisiting has no definition slide, so the message does not ask for one.
      expect(withShape(entries, "Explain", "Revisiting")).toContainEqual(
        "outline: The outline has 1 content or image-text slide. At least 2 content slides, each explaining one mechanism (how or why); add one in the explain phase.",
      );
      const recall = outline_new();
      recall.splice(7, 1);
      recall[7] = { ...recall[7], kind: "exit-ticket" };
      expect(withShape(recall, "Recall", "Some prior knowledge")).toEqual([
        "outline: Only 2 slides where pupils answer (practise and check phases); this lesson needs at least 3. Add a practise slide.",
      ]);
    });

    test("every verb's fixture satisfies every eval cell of that verb, for the eval's durations", () => {
      const cells: Record<string, [string, number, string][]> = {
        Recall: [
          ["New to it", 20, "Reception"],
          ["Some prior knowledge", 60, "Year 5"],
        ],
        // The Explain fixture also serves the e2e worker, whose brief screen pre-selects "New to it".
        Explain: [
          ["New to it", 60, "Year 8"],
          ["Some prior knowledge", 60, "Year 8"],
          ["Revisiting", 50, "Year 11"],
        ],
        Apply: [
          ["New to it", 60, "Year 3"],
          ["Some prior knowledge", 60, "Year 7"],
        ],
        Evaluate: [
          ["New to it", 60, "Year 12"],
          ["Revisiting", 60, "Year 10"],
        ],
      };
      for (const verb of OBJECTIVE_VERBS) {
        for (const [confidence, durationMin, year] of cells[verb] ?? []) {
          const result = planSkeletonSchemaFor({
            durationMin,
            shape: shapeOf(verb, confidence, year),
          }).safeParse(PLAN_SKELETONS[verb]);
          expect({ verb, confidence, issues: messagesOf(result) }).toEqual({
            verb,
            confidence,
            issues: [],
          });
        }
      }
      // Every fixture parses structurally, and the facts fixture fits each one.
      for (const verb of OBJECTIVE_VERBS) {
        expect(PlanSkeletonSchema.safeParse(PLAN_SKELETONS[verb]).success).toBe(true);
        for (const confidence of PRIOR_CONFIDENCES) {
          const facts = planFactsSchemaFor(PLAN_SKELETONS[verb], shapeOf(verb, confidence));
          expect({ verb, confidence, ok: facts.safeParse(FIXTURES.planFacts).success }).toEqual({
            verb,
            confidence,
            ok: true,
          });
        }
      }
    });
  });

  test("TEACH-224 row 3: a mustShow item made only of the subject's words is refused; one naming a visible part is not", () => {
    const entries = outline();
    entries[3] = {
      kind: "image-text",
      minutes: 10,
      factRefs: [O(0)],
      phase: "explain",
      brief,
      imageBrief: {
        subject: "rodent incisors close-up",
        mustShow: ["rodent", "front teeth", "mouth"],
        purpose: "identify-parts",
      },
    };
    expect(messagesOf(parse(entries))).toEqual([
      expect.stringMatching(
        /^outline\.3\.imageBrief\.mustShow\.0: mustShow names the subject \("rodent"\)/,
      ),
    ]);
    // "river water" for "river severn" shares a word but names something you can see.
    const river = outline();
    river[3] = { ...entries[3], imageBrief: RIVER };
    expect(parse(river).success).toBe(true);
    // Parts made of subject words are what the list is for: "front teeth" for "rodent front
    // teeth close-up" passes (the production brief the stricter rule refused).
    const teeth = outline();
    teeth[3] = {
      ...entries[3],
      imageBrief: {
        subject: "rodent front teeth close-up",
        mustShow: ["front teeth", "mouth"],
        purpose: "identify-parts",
      },
    };
    expect(parse(teeth).success).toBe(true);
  });

  test("image-text needs a list-form picture brief; a brief on a content entry is refused", () => {
    const missing = outline();
    missing[3] = {
      kind: "image-text",
      minutes: 10,
      factRefs: [O(0)],
      phase: "explain",
      brief,
    };
    expect(messagesOf(parse(missing))).toContainEqual(
      "outline.3.imageBrief: image-text entries carry an imageBrief",
    );
    const stringForm = outline();
    stringForm[3] = {
      ...missing[3],
      imageBrief: { subject: "river severn", mustShow: "river water", purpose: "observe" },
    };
    expect(parse(stringForm).success).toBe(false);
    const present = outline();
    present[3] = { ...missing[3], imageBrief: RIVER };
    expect(parse(present).success).toBe(true);
    const misplaced = outline();
    misplaced[3] = { ...misplaced[3], imageBrief: RIVER };
    expect(messagesOf(parse(misplaced))).toContainEqual(
      "outline.3.imageBrief: imageBrief is only allowed on image-text entries",
    );
  });

  test("PlanSkeletonSchema (no brief context) applies the structural rules only", () => {
    expect(
      PlanSkeletonSchema.safeParse({ learningObjectives: [{ text: "A" }], outline: outline() })
        .success,
    ).toBe(true);
  });
  test("a question slide tagged explain is refused and does not count towards the explain share", () => {
    const entries = outline();
    entries[3] = {
      kind: "multiple-choice",
      minutes: 10,
      factRefs: [O(0)],
      phase: "explain",
      brief,
    };
    const messages = messagesOf(parse(entries, { durationMin: 60, shape: EXPLAIN_SOME }));
    expect(messages).toContainEqual(
      "outline.3.phase: Outline position 3 is a multiple-choice slide in the explain phase; explain slides are content, worked-example, image-text or vocabulary. Give it the phase it belongs to, or change its kind.",
    );
    expect(messages).toContainEqual(
      expect.stringContaining("explain phase needs at least 18 minutes"),
    );
  });
});

describe("planFactsSchemaFor", () => {
  const schema = (shape = EXPLAIN_SOME) => planFactsSchemaFor(FIXTURES.planSkeleton, shape);
  const facts = () => structuredClone(FIXTURES.planFacts);

  test("the fixture facts parse", () => {
    expect(schema().safeParse(facts()).success).toBe(true);
  });

  test("TEACH-224 rows 4–6: pitch.avoid may not list a vocabulary term; a problem or stem may not presume a picture; an unexplained term is not a rejection", () => {
    const issues = (f: ReturnType<typeof facts>, s = FIXTURES.planSkeleton) => {
      const r = planFactsSchemaFor(s, EXPLAIN_SOME).safeParse(f);
      return r.success ? [] : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    };
    const avoid = facts();
    avoid.pitch.avoid = ["kinetic", "Particle"];
    expect(issues(avoid)).toEqual([
      expect.stringMatching(
        /^pitch\.avoid\.1: pitch\.avoid lists "Particle", which the vocabulary defines/,
      ),
    ]);

    const photo = facts();
    const x = photo.workedExamples[0];
    const q = photo.questions[0];
    if (!x || !q) throw new Error("fixture");
    x.problem = "A photo shows an ice cube on a plate. Why does it melt?";
    q.stem = "Look at the diagram above. Which state is it?";
    expect(issues(photo).sort()).toEqual([
      expect.stringMatching(/^questions\.0\.stem: Problems and question stems are self-contained/),
      expect.stringMatching(
        /^workedExamples\.0\.problem: Problems and question stems are self-contained/,
      ),
    ]);
    // Every common form of pointing at a picture is caught; a picture noun as a plain subject is not.
    const presumes = (stem: string) => {
      const f = facts();
      const q0 = f.questions[0];
      if (!q0) throw new Error("fixture");
      q0.stem = stem;
      return issues(f).some((m) => m.startsWith("questions.0.stem"));
    };
    for (const stem of [
      "Look at the diagram. Which state is shown?",
      "Look at the photo and name the animal.",
      "In the picture, which particles are closest?",
      "This image shows a solid. Why does it keep its shape?",
      "Use the particle diagram to explain melting.",
      "Which state is pictured above?",
    ]) {
      expect({ stem, presumes: presumes(stem) }).toEqual({ stem, presumes: true });
    }
    for (const stem of [
      "Why do scientists draw particle diagrams?",
      "Describe how particles are arranged in a solid.",
    ]) {
      expect({ stem, presumes: presumes(stem) }).toEqual({ stem, presumes: false });
    }

    // Whether a term is taught before it is asked about is a prompt rule, not a rejection
    // (TEACH-227); `usesTerm` stays for whole-word matching elsewhere.
    expect(usesTerm("tiny particles move", "particle")).toBe(true);
    expect(usesTerm("tiny particles move", "art")).toBe(false);
    const noVocabSlide = structuredClone(FIXTURES.planSkeleton);
    noVocabSlide.outline = noVocabSlide.outline.map((e) =>
      e.kind === "vocabulary" ? { ...e, kind: "content" as const } : e,
    );
    const unexplained = facts();
    unexplained.vocabulary.push({
      term: "Diastema",
      definition: "A gap between teeth.",
      objectiveRefs: [O(0)],
    });
    // The only issue is the unrelated kind-fit one the swapped slide creates: no vocabulary issue.
    expect(issues(unexplained, noVocabSlide).filter((m) => m.startsWith("vocabulary"))).toEqual([]);
  });

  test("one key idea is enough (a narrow lesson has one); none is not", () => {
    const f = facts();
    f.keyIdeas = f.keyIdeas.slice(0, 1);
    const only = f.keyIdeas[0];
    if (!only) throw new Error("fixture");
    only.objectiveRefs = [O(0), O(1), O(2)];
    f.outlineFactRefs = f.outlineFactRefs.map((e) =>
      e.index === 4 || e.index === 5
        ? { ...e, factRefs: [{ type: "keyIdea" as const, index: 0 }] }
        : e,
    );
    expect(schema().safeParse(f).success).toBe(true);
    f.keyIdeas = [];
    expect(schema().safeParse(f).success).toBe(false);
  });

  test("row 4: nine questions is an issue naming twelve", () => {
    const f = facts();
    f.questions = f.questions.slice(0, 9);
    const result = schema().safeParse(f);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((i) => i.message)).toContainEqual(
      expect.stringContaining("at least 12 questions"),
    );
  });

  test("row 5: a content entry that receives no keyIdea ref is an issue naming its position", () => {
    const f = facts();
    f.outlineFactRefs = f.outlineFactRefs.filter((e) => e.index !== 4);
    const result = schema().safeParse(f);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((i) => i.message)).toContainEqual(
      "Outline position 4 is a content slide and needs at least one keyIdea reference in outlineFactRefs.",
    );
  });

  test("a fact's own objectiveRefs must land in the skeleton's objectives; a misconceptionRef in this call's list", () => {
    const f = facts();
    const objectives = FIXTURES.planSkeleton.learningObjectives.length;
    const k = f.keyIdeas[0];
    if (!k) throw new Error("fixture");
    k.objectiveRefs = [O(objectives)];
    const x = f.workedExamples[0];
    if (!x) throw new Error("fixture");
    x.misconceptionRef = { type: "misconception", index: 4 };
    const result = schema().safeParse(f);
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = result.error.issues.map((i) => i.path);
    expect(paths).toContainEqual(["keyIdeas", 0, "objectiveRefs", 0, "index"]);
    expect(paths).toContainEqual(["workedExamples", 0, "misconceptionRef", "index"]);
  });

  test("the outline may reference key ideas and misconceptions by ordinal", () => {
    const f = facts();
    f.outlineFactRefs.push({
      index: 3,
      factRefs: [
        { type: "keyIdea", index: 0 },
        { type: "misconception", index: 0 },
      ],
    });
    expect(schema().safeParse(f).success).toBe(true);
    const ids = assignFactIds(FIXTURES.planSkeleton, f, 60);
    expect(ids.outline[3]?.factRefs).toEqual(expect.arrayContaining(["k1", "m1"]));
  });
  test("every objective is served by a key idea and checked by a question; tiers have their minimums", () => {
    const f = facts();
    for (const k of f.keyIdeas) k.objectiveRefs = [O(0)];
    for (const q of f.questions) q.objectiveRefs = [O(0)];
    const r = schema().safeParse(f);
    expect(r.success).toBe(false);
    if (r.success) return;
    const messages = r.error.issues.map((i) => i.message);
    expect(messages).toContainEqual(
      expect.stringContaining("Objective 1 is served by no key idea"),
    );
    expect(messages).toContainEqual(
      expect.stringContaining("Objective 2 is checked by no question"),
    );
    const flat = facts();
    for (const q of flat.questions) q.tier = "core";
    const t = schema().safeParse(flat);
    expect(t.success).toBe(false);
    if (t.success) return;
    expect(t.error.issues.map((i) => i.message)).toContainEqual(
      'Only 0 "easy" questions; give at least 3 (the target is 4 easy, 5 core, 3 stretch).',
    );
    // The floor follows the shape: Recall / New to it weights 7 easy, so six are needed.
    const recall = schema(shapeOf("Recall", "New to it")).safeParse(facts());
    expect(recall.success).toBe(true);
    const five = facts();
    const sixthEasy = five.questions.find((q, i) => i > 4 && q.tier === "easy");
    if (!sixthEasy) throw new Error("fixture");
    sixthEasy.tier = "core";
    const r2 = schema(shapeOf("Recall", "New to it")).safeParse(five);
    expect(r2.success).toBe(false);
    if (r2.success) return;
    expect(r2.error.issues.map((i) => i.message)).toContainEqual(
      'Only 5 "easy" questions; give at least 6 (the target is 7 easy, 4 core, 2 stretch).',
    );
  });

  test("the misconception rule is a prompt rule, not a rejection (TEACH-237): no true-false and no misconceptionRef still parses", () => {
    const noTrueFalse = structuredClone(FIXTURES.planSkeleton);
    noTrueFalse.outline = noTrueFalse.outline.map((e) =>
      e.kind === "true-false" ? { ...e, kind: "multiple-choice" as const } : e,
    );
    const f = facts();
    for (const q of f.questions) {
      q.distractors = q.distractors?.map(({ text }) => ({ text }));
    }
    expect(planFactsSchemaFor(noTrueFalse, EXPLAIN_SOME).safeParse(f).success).toBe(true);
  });
});

describe("assignFactIds", () => {
  test("row 6: the fixtures merge into valid LessonFacts with k/m ids, briefs, phases and pitch", () => {
    const facts = assignFactIds(FIXTURES.planSkeleton, FIXTURES.planFacts, 60);
    expect(facts.keyIdeas?.map((k) => k.id)).toEqual(["k1", "k2"]);
    expect(facts.keyIdeas?.[0]?.objectiveRefs).toEqual(["o1"]);
    expect(facts.misconceptions.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(facts.questions).toHaveLength(FIXTURES.planFacts.questions.length);
    expect(facts.questions[2]).toMatchObject({
      id: "q3",
      objectiveRefs: ["o1"],
      distractors: [{ text: "True", misconceptionRef: "m1" }],
      use: "slide",
      tier: "easy",
    });
    expect(facts.workedExamples[0]?.misconceptionRef).toBe("m1");
    expect(facts.pitch).toEqual(FIXTURES.planFacts.pitch);
    for (const [i, entry] of facts.outline.entries()) {
      if (i < 2) {
        expect("brief" in entry).toBe(false);
        expect("phase" in entry).toBe(false);
      } else {
        expect(entry.brief?.adds.length).toBeGreaterThan(0);
        expect(entry.phase).toBeDefined();
      }
    }
    // A question without distractors has no `distractors` key (jsonb round-trip).
    const plain = facts.questions[1];
    expect(plain && "distractors" in plain).toBe(false);
    expect(JSON.parse(JSON.stringify(facts))).toEqual(facts);
  });

  test("passes the picture brief through onto the outline", () => {
    const facts = assignFactIds(
      {
        learningObjectives: [{ text: "Describe rivers" }],
        outline: [
          { kind: "title", minutes: 2, factRefs: [] },
          { kind: "objectives", minutes: 3, factRefs: [O(0)] },
          { kind: "image-text", minutes: 6, factRefs: [O(0)], imageBrief: RIVER },
        ],
      },
      EMPTY_PLAN_FACTS,
      16,
    );
    expect(facts.outline[2]).toMatchObject({ kind: "image-text", imageBrief: RIVER });
  });

  test("with the empty plan facts: no key ideas, no pitch, an empty misconceptions list", () => {
    const facts = assignFactIds(FIXTURES.planSkeleton, EMPTY_PLAN_FACTS, 60);
    expect("keyIdeas" in facts).toBe(false);
    expect("pitch" in facts).toBe(false);
    expect(facts.misconceptions).toEqual([]);
  });
});

describe("verifyOutputSchemaFor (TEACH-212)", () => {
  const facts = () => assignFactIds(FIXTURES.planSkeleton, FIXTURES.planFacts, 60);
  const messages = (corrections: unknown[]) => {
    const r = verifyOutputSchemaFor(facts()).safeParse({ corrections });
    return r.success ? [] : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
  };
  const ok = { factId: "v1", field: "term", value: "Clan", reason: "wrong-term" };

  test("a valid correction and an empty list parse", () => {
    expect(messages([])).toEqual([]);
    expect(messages([ok])).toEqual([]);
    expect(
      messages([{ factId: "x1", field: "steps", index: 0, value: "Step", reason: "arithmetic" }]),
    ).toEqual([]);
  });

  test("row 2: an unknown fact id names the id; an objective is refused the same way", () => {
    expect(messages([{ ...ok, factId: "v9" }])).toEqual([
      expect.stringContaining("corrections.0.factId: unknown fact id v9"),
    ]);
    expect(messages([{ ...ok, factId: "o1" }])[0]).toContain("unknown fact id o1");
  });

  test("a field the kind lacks names both; a steps index out of range or missing is refused; index elsewhere is refused", () => {
    expect(messages([{ ...ok, field: "stem" }])).toEqual([
      'corrections.0.field: v1 has no field "stem"; its fields are term, definition',
    ]);
    expect(
      messages([{ factId: "x1", field: "steps", index: 7, value: "S", reason: "arithmetic" }])[0],
    ).toContain("x1 has 3 steps; index 7 does not exist");
    expect(
      messages([{ factId: "x1", field: "steps", value: "S", reason: "arithmetic" }])[0],
    ).toContain("needs an index");
    expect(messages([{ ...ok, index: 0 }])[0]).toContain("index is only for steps");
  });

  test("a value over the field's own limit is refused even though it fits the body cap", () => {
    expect(messages([{ ...ok, value: "x".repeat(61) }])[0]).toContain("at most 60 characters");
  });
});

describe("EvaluateOutputSchema (TEACH-216)", () => {
  const finding = (over: Record<string, unknown>) => ({
    check: "pitch",
    severity: "warning",
    target: { slideId: "s1" },
    evidence: "the quoted span",
    message: "Too hard.",
    ...over,
  });
  const messages = (findings: unknown[]) => {
    const r = EvaluateOutputSchema.safeParse({ findings });
    return r.success ? [] : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
  };

  test("a warning with evidence parses; an error is allowed for the two correctness checks", () => {
    expect(messages([finding({})])).toEqual([]);
    expect(messages([finding({ check: "answer-correctness", severity: "error" })])).toEqual([]);
    expect(
      messages([
        finding({
          check: "fact-consistency",
          severity: "error",
          target: { slideId: "s1", factId: "v1" },
        }),
      ]),
    ).toEqual([]);
  });

  test("row 1: an error on any other check names the rule", () => {
    expect(messages([finding({ severity: "error" })])).toEqual([
      'findings.0.severity: pitch findings are warnings: only answer-correctness and fact-consistency may be errors. Set severity to "warning".',
    ]);
  });

  test("row 3: a check outside the set is refused; so is a finding without evidence", () => {
    expect(messages([finding({ check: "terminology" })])[0]).toContain("findings.0.check");
    expect(messages([finding({ evidence: "" })])[0]).toContain("findings.0.evidence");
    const { evidence: _dropped, ...noEvidence } = finding({});
    expect(messages([noEvidence])[0]).toContain("findings.0.evidence");
  });
});

describe("WorksheetSpecSchema (TEACH-223)", () => {
  test("a block that refers to a picture is refused on initial generation, naming the block and field", () => {
    const sheet = {
      title: "The Rodent Family",
      criteria: [],
      blocks: [
        { type: "heading", text: "Rodents", level: 1, factRefs: ["o1"] },
        { type: "paragraph", text: "Rodents gnaw.", factRefs: ["o1"] },
        { type: "paragraph", text: "Rodents have incisors.", factRefs: ["o1"] },
        {
          type: "question",
          text: "Look at the photo. Is it a rodent?",
          answer: "Yes.",
          answerLines: 1,
          marks: 1,
          factRefs: ["o1"],
        },
      ],
    };
    const result = WorksheetSpecSchema.safeParse(sheet);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.path.join("."))).toEqual(["blocks.3.text"]);
    }
  });
});
