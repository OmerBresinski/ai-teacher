import { describe, expect, test } from "bun:test";
import { LessonFactsSchema } from "@tj/domain/documents";
import { isEditorialIssue, slideSpecSchemaFor } from "@tj/slides";
import { lessonShapeOf, OBJECTIVE_VERBS, PRIOR_CONFIDENCES } from "./shapes";
import {
  askableAsStem,
  assignFactIds,
  distractorsEchoingAnswer,
  EMPTY_PLAN_FACTS,
  EvaluateOutputSchema,
  PlanSkeletonSchema,
  planFactsSchemaFor,
  planSkeletonSchemaFor,
  usesTerm,
  verifyOutputSchemaFor,
  WorksheetSpecSchema,
  withAssignedCallout,
  worksheetSpecSchemaFor,
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
 * A valid skeleton for the default cell (Explain / Some): 3 explain slides of the 7 after title and
 * objectives (the floor is 2), two
 * content slides, a worked example, an open-response, phases in order.
 */
const outline = (): Record<string, unknown>[] => [
  { kind: "title", factRefs: [] },
  { kind: "objectives", factRefs: [O(0)] },
  { kind: "starter", factRefs: [O(0)], phase: "starter", brief },
  { kind: "content", factRefs: [O(0)], phase: "explain", brief },
  { kind: "content", factRefs: [O(0)], phase: "explain", brief },
  { kind: "worked-example", factRefs: [O(0)], phase: "explain", brief },
  { kind: "multiple-choice", factRefs: [O(0)], phase: "practise", brief },
  { kind: "open-response", factRefs: [O(0)], phase: "practise", brief },
  { kind: "exit-ticket", factRefs: [O(0)], phase: "check", brief },
];

/** The skeleton's own answer on the topic (TEACH-238); "no" so the test outlines need no picture. */
const NOT_PHOTOGRAPHABLE = { yes: false, why: "River processes are a diagram, not a photograph." };

/** Structural rules only unless a shape is given. */
const parse = (
  entries: unknown[],
  context: Parameters<typeof planSkeletonSchemaFor>[0] = {},
  /** `null` omits the field (a model answer that forgot it; the resume path). */
  photographable: { yes: boolean; why: string } | null = NOT_PHOTOGRAPHABLE,
) =>
  planSkeletonSchemaFor(context).safeParse({
    learningObjectives: [{ text: "Describe rivers" }],
    ...(photographable ? { photographable } : {}),
    outline: entries,
  });

const messagesOf = (result: ReturnType<typeof parse>) =>
  result.success ? [] : result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);

describe("planSkeletonSchemaFor", () => {
  test("the fixture skeleton and a well-formed outline parse, with and without the default shape", () => {
    expect(parse(outline()).success).toBe(true);
    expect(parse(outline(), { shape: EXPLAIN_SOME }).success).toBe(true);
    expect(
      planSkeletonSchemaFor({ shape: EXPLAIN_SOME }).safeParse(FIXTURES.planSkeleton).success,
    ).toBe(true);
  });

  test("row 1: the explain share is counted in slides and the issue repeats the Shape sentence (ruling 82)", () => {
    // 16 entries: 14 after title and objectives; 30 % of 14 rounds down to 4; three teach.
    const entries = outline();
    const exit = entries.pop();
    const mc = { kind: "multiple-choice", factRefs: [O(0)], phase: "practise", brief };
    entries.push(...Array.from({ length: 7 }, () => ({ ...mc })), exit ?? {});
    expect(entries).toHaveLength(16);
    const messages = messagesOf(parse(entries, { shape: EXPLAIN_SOME }));
    expect(messages).toContainEqual(
      "outline: At least 4 of the 14 slides after the title and objectives slides are explain slides. This outline has 3. Add 1 content, worked-example, image-text or vocabulary slide in the explain phase.",
    );
    expect(messages.join("\n")).not.toContain("minute");
    // Without a shape (the structural schema) the share is not checked.
    expect(parse(entries).success).toBe(true);
  });

  test("outline entries may carry minutes (lessons planned before ruling 82) and need not", () => {
    const old = outline().map((e) => ({ ...e, minutes: 5 }));
    expect(messagesOf(parse(old, { shape: EXPLAIN_SOME }))).toEqual([]);
    expect(messagesOf(parse(outline(), { shape: EXPLAIN_SOME }))).toEqual([]);
  });

  describe("TEACH-237: the rules that rejected a good outline in production", () => {
    const EXPLAIN_NEW = shapeOf("Explain", "New to it", "Year 5");
    /** The rodents outline the worker rejected twice on 2026-09-10 (reconstructed from the messages). */
    const rodents = (): Record<string, unknown>[] => [
      { kind: "title", factRefs: [] },
      { kind: "objectives", factRefs: [O(0)] },
      { kind: "starter", factRefs: [O(0)], phase: "starter", brief },
      { kind: "content", factRefs: [O(0)], phase: "explain", brief },
      { kind: "vocabulary", factRefs: [O(0)], phase: "explain", brief },
      { kind: "content", factRefs: [O(0)], phase: "explain", brief },
      { kind: "worked-example", factRefs: [O(0)], phase: "explain", brief },
      { kind: "multiple-choice", factRefs: [O(0)], phase: "practise", brief },
      { kind: "open-response", factRefs: [O(0)], phase: "practise", brief },
      { kind: "exit-ticket", factRefs: [O(0)], phase: "check", brief },
    ];

    test("row 1: the production outline — vocabulary in the explain phase, 23 + 5 explain minutes of 60 — parses for Explain / New to it", () => {
      expect(messagesOf(parse(rodents(), { shape: EXPLAIN_NEW }))).toEqual([]);
    });

    test("vocabulary counts towards the explain share and may open the explain phase before the definition", () => {
      const entries = rodents();
      // Vocabulary first, then the definition: the opener check looks past it.
      const [vocab] = entries.splice(4, 1);
      if (!vocab) throw new Error("fixture");
      entries.splice(3, 0, vocab);
      expect(messagesOf(parse(entries, { shape: EXPLAIN_NEW }))).toEqual([]);
      // But a worked-example after the vocabulary is still not the definition.
      const wrong = rodents();
      wrong[5] = { ...wrong[5], kind: "worked-example" };
      wrong[3] = { ...wrong[3], kind: "worked-example" };
      expect(messagesOf(parse(wrong, { shape: EXPLAIN_NEW }))).toContainEqual(
        expect.stringMatching(
          /^outline\.3\.kind: Outline position 3 is the first explain-phase slide \(after any vocabulary\) and is a worked-example/,
        ),
      );
    });

    test("row 2: a share rounds down and allows no shortfall; the issue names the slides to add", () => {
      const mc = { kind: "multiple-choice", factRefs: [O(0)], phase: "practise", brief };
      /** The rodents outline with `n` more practise slides before the exit ticket. */
      const longer = (n: number) => {
        const e = rodents();
        const exit = e.pop();
        e.push(...Array.from({ length: n }, () => ({ ...mc })), exit ?? {});
        return e;
      };
      const explainNew = (n: number) => messagesOf(parse(longer(n), { shape: EXPLAIN_NEW }));
      // Four teaching slides. 40 % of 10 is exactly 4; of 11, 4.4 rounds down to 4: both pass.
      expect(explainNew(2)).toEqual([]);
      expect(explainNew(3)).toEqual([]);
      // 40 % of 13 rounds down to 5: one short.
      expect(explainNew(5)).toContainEqual(
        "outline: At least 5 of the 13 slides after the title and objectives slides are explain slides. This outline has 4. Add 1 content, worked-example, image-text or vocabulary slide in the explain phase.",
      );
      // Apply's practise share: 40 % of 8 is 3 with two practise slides; one more passes.
      const apply = (n: number) =>
        messagesOf(parse(longer(n), { shape: shapeOf("Apply", "Some prior knowledge") }));
      expect(apply(0)).toContainEqual(
        "outline: At least 3 of the 8 slides after the title and objectives slides are in the practise phase. This outline has 2. Add 1 practise slide.",
      );
      expect(apply(1)).not.toContainEqual(expect.stringContaining("practise phase."));
    });

    test("row 3: an imageBrief with six avoid items passes the Plan schema and then the domain schema (assignFactIds)", () => {
      const entries = rodents();
      const avoid = ["cage", "fence", "bars", "glass", "hands", "toys"];
      entries[5] = { ...entries[5], kind: "image-text", imageBrief: { ...RIVER, avoid } };
      const result = parse(entries, { shape: EXPLAIN_NEW });
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
    bare[3] = { kind: "content", factRefs: [O(0)] };
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
    const context = { shape: shapeOf("Explain", "New to it") };
    const schema = planSkeletonSchemaFor(context);
    const entries = outline();
    entries[3] = { kind: "vocabulary", factRefs: [O(0)], phase: "starter", brief };
    entries.splice(4, 0, {
      kind: "content",
      factRefs: [O(0)],
      phase: "explain",
      brief,
    });
    const two = schema.safeParse({
      learningObjectives: [{ text: "A" }, { text: "B" }],
      photographable: NOT_PHOTOGRAPHABLE,
      outline: entries,
    });
    expect(two.success).toBe(false);
    if (two.success) return;
    expect(two.error.issues.map((i) => i.message)).toEqual([
      "The class is new to this: objective 1 needs a content, worked-example or image-text slide that names it.",
    ]);
    // An image-text slide that names the objective teaches it too (TEACH-237).
    const pictured = structuredClone(entries);
    pictured[5] = { ...pictured[5], kind: "image-text", imageBrief: RIVER, factRefs: [O(1)] };
    expect(
      messagesOf(
        schema.safeParse({
          learningObjectives: [{ text: "A" }, { text: "B" }],
          photographable: NOT_PHOTOGRAPHABLE,
          outline: pictured,
        }),
      ),
    ).toEqual([]);
    // Any other confidence: the rule does not apply.
    expect(
      planSkeletonSchemaFor({ shape: EXPLAIN_SOME }).safeParse({
        learningObjectives: [{ text: "A" }, { text: "B" }],
        photographable: NOT_PHOTOGRAPHABLE,
        outline: outline(),
      }).success,
    ).toBe(true);
  });

  describe("TEACH-238: the model says whether the topic can be photographed", () => {
    const EXPLAIN_NEW = { shape: shapeOf("Explain", "New to it", "Year 5") };
    const yes = { yes: true, why: "A rodent is a real animal a camera captures." };

    test("row 1: a yes with no image-text slide is one issue at outline; the why is never in the message (it is logged on a retry)", () => {
      const messages = messagesOf(parse(outline_new(), EXPLAIN_NEW, yes));
      expect(messages).toEqual([
        'outline: You said this topic can be photographed ("photographable": true); add one image-text slide in the explain phase with an imageBrief.',
      ]);
      expect(messages.join()).not.toContain(yes.why);
      const pictured = outline_new();
      pictured[5] = { ...pictured[5], kind: "image-text", imageBrief: RIVER };
      expect(messagesOf(parse(pictured, EXPLAIN_NEW, yes))).toEqual([]);
    });

    test("row 2: a no needs no picture", () => {
      expect(
        messagesOf(parse(outline_new(), EXPLAIN_NEW, { yes: false, why: "Abstract." })),
      ).toEqual([]);
    });

    test("row 3: a live answer without the flag is asked for it; row 4: the shape-less schema (resume) does not require it", () => {
      expect(messagesOf(parse(outline_new(), EXPLAIN_NEW, null))).toEqual([
        'photographable: Say whether this topic can be photographed: "photographable": { "yes": true|false, "why": one sentence }.',
      ]);
      expect(parse(outline_new(), { durationMin: 60 }, null).success).toBe(true);
      expect(
        PlanSkeletonSchema.safeParse({ ...FIXTURES.planSkeleton, photographable: undefined })
          .success,
      ).toBe(true);
    });

    /** The default outline made valid for a "New to it" cell: a vocabulary slide added. */
    function outline_new(): Record<string, unknown>[] {
      const entries = outline();
      entries.splice(3, 0, {
        kind: "vocabulary",
        factRefs: [O(0)],
        phase: "starter",
        brief,
      });
      return entries;
    }
  });

  describe("the lesson shape's deterministic column (TEACH-229)", () => {
    const withShape = (entries: unknown[], verb: string, confidence: string, year?: string) =>
      messagesOf(parse(entries, { shape: shapeOf(verb, confidence, year) }));

    test("row 1: Explain / New to it with a worked-example opening the explain phase names the position and the content slide that defines", () => {
      const entries = outline();
      entries.splice(3, 0, {
        kind: "vocabulary",
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
      // Apply wants 40 % practise, in slides: 2 of the 7, which the two practise slides meet.
      expect(messages.join("\n")).not.toContain("practise phase.");
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
      factRefs: [O(0)],
      phase: "explain",
      brief,
    };
    // Three more practise slides: 30 % of 10 is 3, and only the content and worked-example teach.
    const exit = entries.pop();
    const mc = { kind: "multiple-choice", factRefs: [O(0)], phase: "practise", brief };
    entries.push({ ...mc }, { ...mc }, { ...mc }, exit ?? {});
    const messages = messagesOf(parse(entries, { shape: EXPLAIN_SOME }));
    expect(messages).toContainEqual(
      "outline.3.phase: Outline position 3 is a multiple-choice slide in the explain phase; explain slides are content, worked-example, image-text or vocabulary. Give it the phase it belongs to, or change its kind.",
    );
    expect(messages).toContainEqual(
      expect.stringContaining(
        "At least 3 of the 10 slides after the title and objectives slides are explain slides. This outline has 2.",
      ),
    );
  });
});

describe("planFactsSchemaFor", () => {
  const schema = (shape = EXPLAIN_SOME) => planFactsSchemaFor(FIXTURES.planSkeleton, shape);
  const facts = () => structuredClone(FIXTURES.planFacts);

  test("a distractor that repeats the answer is an editorial issue: strict retries, soft accepts", () => {
    const f = facts();
    const q = f.questions.find((x) => (x.distractors?.length ?? 0) > 0);
    const d = q?.distractors?.[0];
    if (!q || !d) throw new Error("fixture has no question with distractors");
    d.text = `${q.answer.toLowerCase()} `;
    const r = schema().safeParse(f);
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues.some((i) => /repeats the answer/.test(i.message))).toBe(true);
    expect(
      planFactsSchemaFor(FIXTURES.planSkeleton, EXPLAIN_SOME, { soft: true }).safeParse(f).success,
    ).toBe(true);
  });

  test("TEACH-256: an unknown key on a fact item is stripped, not fatal; an unknown top-level key still is", () => {
    const f = facts() as Record<string, unknown> & { workedExamples: Record<string, unknown>[] };
    f.workedExamples[0] = { ...f.workedExamples[0], explanation: "extra" };
    const r = schema().safeParse(f);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect("explanation" in (r.data.workedExamples[0] ?? {})).toBe(false);
    expect(
      LessonFactsSchema.safeParse(assignFactIds(FIXTURES.planSkeleton, r.data, 60)).success,
    ).toBe(true);
    const top = schema().safeParse({ ...facts(), summary: "no such list" });
    expect(top.success).toBe(false);
    if (top.success) return;
    expect(top.error.issues.some((i) => i.code === "unrecognized_keys")).toBe(true);
  });

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
  test("TEACH-244: an exit question no entry claims is attached to the first check-phase slide", () => {
    const f = structuredClone(FIXTURES.planFacts);
    // The fixture's exit-ticket entry (index 9) claims questions 7, 8 and 11 (all `exit`). Unclaim 11.
    f.outlineFactRefs = f.outlineFactRefs.map((e) =>
      e.index === 9
        ? { ...e, factRefs: e.factRefs.filter((r) => !(r.type === "question" && r.index === 11)) }
        : e,
    );
    const facts = assignFactIds(FIXTURES.planSkeleton, f, 60);
    expect(facts.questions[11]?.use).toBe("exit");
    expect(facts.outline[9]?.factRefs).toContain("q12");
    // Claimed elsewhere: left alone. A worksheet question is never moved.
    const claimed = structuredClone(f);
    claimed.outlineFactRefs.push({ index: 8, factRefs: [{ type: "question", index: 11 }] });
    const facts2 = assignFactIds(FIXTURES.planSkeleton, claimed, 60);
    expect(facts2.outline[9]?.factRefs).not.toContain("q12");
    expect(facts2.outline[8]?.factRefs).toContain("q12");
    // No check-phase entry: nothing added.
    const noCheck = structuredClone(FIXTURES.planSkeleton);
    noCheck.outline = noCheck.outline.map((e) =>
      e.phase === "check" ? { ...e, phase: "practise" as const } : e,
    );
    const facts3 = assignFactIds(noCheck, f, 60);
    expect(facts3.outline[9]?.factRefs).not.toContain("q12");
    // A multiple-choice-native exit question (three distractors, no declared open form) is not
    // attached: the check slide would print its stem without options.
    const mc = structuredClone(f);
    const q12 = mc.questions[11];
    if (!q12) throw new Error("fixture has no question 12");
    q12.distractors = [{ text: "a" }, { text: "b" }, { text: "c" }];
    expect(assignFactIds(FIXTURES.planSkeleton, mc, 60).outline[9]?.factRefs).not.toContain("q12");
    // Declared askable openly as well: still not attached, its three options would be missing (w0).
    Object.assign(q12, { forms: ["multiple-choice", "open-response"] });
    expect(assignFactIds(FIXTURES.planSkeleton, mc, 60).outline[9]?.factRefs).not.toContain("q12");
    // Two distractors and declared open: attached.
    q12.distractors = [{ text: "a" }, { text: "b" }];
    expect(assignFactIds(FIXTURES.planSkeleton, mc, 60).outline[9]?.factRefs).toContain("q12");
    // A declared true-false statement is not a question on a line of its own: not attached.
    Object.assign(q12, { forms: ["true-false", "open-response"], distractors: [] });
    expect(assignFactIds(FIXTURES.planSkeleton, mc, 60).outline[9]?.factRefs).not.toContain("q12");
  });

  test("distractorsEchoingAnswer: case, spacing and sentence punctuation ignored, maths signs kept", () => {
    expect(
      distractorsEchoingAnswer({
        answer: "Water resistance.",
        distractors: [
          { text: "water  resistance" },
          { text: "Air resistance" },
          { text: "‘Water resistance’" },
        ],
      }),
    ).toEqual([0, 2]);
    expect(
      distractorsEchoingAnswer({
        answer: "x + 1",
        distractors: [{ text: "x - 1" }, { text: "X+1" }],
      }),
    ).toEqual([1]);
    expect(distractorsEchoingAnswer({ answer: "4", distractors: undefined })).toEqual([]);
  });

  test("askableAsStem: open, fewer than three distractors, no declared true-false", () => {
    const d = (n: number) => Array.from({ length: n }, (_, i) => ({ text: `d${i}` }));
    expect(askableAsStem({ distractors: d(0) })).toBe(true);
    expect(askableAsStem({ distractors: d(2) })).toBe(true);
    expect(askableAsStem({ distractors: d(3) })).toBe(false);
    expect(askableAsStem({ forms: ["multiple-choice", "open-response"], distractors: d(3) })).toBe(
      false,
    );
    expect(askableAsStem({ forms: ["multiple-choice", "open-response"], distractors: d(2) })).toBe(
      true,
    );
    expect(askableAsStem({ forms: ["multiple-choice"], distractors: d(2) })).toBe(false);
    expect(askableAsStem({ forms: ["true-false", "open-response"], distractors: d(0) })).toBe(
      false,
    );
    expect(askableAsStem({ forms: ["open-response"], distractors: d(1) })).toBe(true);
  });

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
          { kind: "title", factRefs: [] },
          { kind: "objectives", factRefs: [O(0)] },
          { kind: "image-text", factRefs: [O(0)], imageBrief: RIVER },
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

  test("TEACH-230 row 2: verb-fit is a check, and a warning only", () => {
    expect(messages([finding({ check: "verb-fit" })])).toEqual([]);
    expect(messages([finding({ check: "verb-fit", severity: "error" })])).toEqual([
      'findings.0.severity: verb-fit findings are warnings: only answer-correctness and fact-consistency may be errors. Set severity to "warning".',
    ]);
  });
});

describe("WorksheetSpecSchema (TEACH-223)", () => {
  test("TEACH-263: extra block fields are stripped, but extra worksheet fields stay shape errors", () => {
    for (const schema of [WorksheetSpecSchema, worksheetSpecSchemaFor({ soft: true })]) {
      const sheet = schema.parse(FIXTURES.worksheet);
      expect(
        schema.parse({
          ...FIXTURES.worksheet,
          blocks: FIXTURES.worksheet.blocks.map((block) => ({ ...block, hint: "Extra." })),
        }),
      ).toEqual(sheet);
      const result = schema.safeParse({ ...FIXTURES.worksheet, notes: "An invented structure." });
      expect(result.success).toBe(false);
      if (result.success) throw new Error("expected a shape error");
      expect(result.error.issues).toHaveLength(1);
      expect(result.error.issues[0]?.code).toBe("unrecognized_keys");
      expect(isEditorialIssue(result.error.issues[0] ?? {})).toBe(false);
    }
  });

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

describe("planSkeletonSchemaFor: slideCount and objectiveCount (ADR 0029 items 8–9)", () => {
  const eight = () => FIXTURES.planSkeleton.outline.slice(0, 8);
  const nine = () => FIXTURES.planSkeleton.outline.slice(0, 9);
  const skeleton = (outline: unknown[], objectives = 3) => ({
    learningObjectives: Array.from({ length: objectives }, (_, i) => ({ text: `Objective ${i}` })),
    photographable: NOT_PHOTOGRAPHABLE,
    outline,
  });
  const shapeIssues = (result: { success: boolean; error?: { issues: unknown[] } }) =>
    ((result.error?.issues ?? []) as { message: string; path: PropertyKey[] }[]).filter(
      (issue) => !isEditorialIssue(issue),
    );

  test("row 3: nine entries against slideCount 8 is a shape issue naming 8 on `outline`, in the strict and the soft schema alike", () => {
    for (const soft of [false, true]) {
      const result = planSkeletonSchemaFor({ durationMin: 60, slideCount: 8 }, { soft }).safeParse(
        skeleton(nine()),
      );
      expect(result.success).toBe(false);
      const issues = shapeIssues(result);
      expect(issues).toHaveLength(1);
      expect(issues[0]?.path).toEqual(["outline"]);
      expect(issues[0]?.message).toContain("exactly 8");
      expect(issues[0]?.message).toContain("this one has 9");
    }
  });

  test("eight entries against slideCount 8 pass the count; the shape's own rules are unchanged", () => {
    const result = planSkeletonSchemaFor({ durationMin: 60, slideCount: 8 }).safeParse(
      skeleton(eight()),
    );
    expect(shapeIssues(result)).toEqual([]);
  });

  test("row 4: without slideCount the structural 2–16 bound alone applies", () => {
    const strict = planSkeletonSchemaFor({ durationMin: 60 });
    expect(shapeIssues(strict.safeParse(skeleton(nine())))).toEqual([]);
    expect(shapeIssues(strict.safeParse(skeleton(eight())))).toEqual([]);
    expect(strict.safeParse(skeleton(FIXTURES.planSkeleton.outline.slice(0, 1))).success).toBe(
      false,
    );
    const seventeen = [
      ...FIXTURES.planSkeleton.outline,
      ...FIXTURES.planSkeleton.outline.slice(2, 9),
    ];
    expect(seventeen).toHaveLength(17);
    expect(strict.safeParse(skeleton(seventeen)).success).toBe(false);
  });

  test("objectiveCount: an answer with a different number of learningObjectives than pinned is a shape issue on `learningObjectives`", () => {
    // Every reference on the first objective, so the count is the only thing that can fail.
    const outline = FIXTURES.planSkeleton.outline.map((e) => ({
      ...e,
      factRefs: e.factRefs.map((ref) => ({ ...ref, index: 0 })),
    }));
    for (const soft of [false, true]) {
      const schema = planSkeletonSchemaFor({ durationMin: 60, objectiveCount: 3 }, { soft });
      const two = shapeIssues(schema.safeParse(skeleton(outline, 2)));
      expect(two).toHaveLength(1);
      expect(two[0]?.path).toEqual(["learningObjectives"]);
      expect(two[0]?.message).toContain("3 given objectives");
      expect(shapeIssues(schema.safeParse(skeleton(FIXTURES.planSkeleton.outline, 3)))).toEqual([]);
    }
  });
});

describe("TEACH-257: editorial and shape rules in the Plan and worksheet schemas", () => {
  const SKELETON = { shape: EXPLAIN_SOME };
  const skeleton = (entries: unknown[], patch: Record<string, unknown> = {}) => ({
    learningObjectives: [{ text: "Describe rivers" }],
    photographable: NOT_PHOTOGRAPHABLE,
    outline: entries,
    ...patch,
  });
  const facts = () => structuredClone(FIXTURES.planFacts);
  const factsSchema = (soft: boolean) =>
    planFactsSchemaFor(FIXTURES.planSkeleton, EXPLAIN_SOME, { soft });

  const expectEditorial = (
    strict: { safeParse: (v: unknown) => { success: boolean; error?: { issues: unknown[] } } },
    soft: { safeParse: (v: unknown) => { success: boolean } },
    value: unknown,
  ) => {
    const result = strict.safeParse(value);
    expect(result.success).toBe(false);
    const issues = (result.error?.issues ?? []) as { params?: Record<string, unknown> }[];
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((issue) => isEditorialIssue(issue))).toBe(true);
    expect(soft.safeParse(value).success).toBe(true);
  };
  const expectShape = (
    strict: { safeParse: (v: unknown) => { success: boolean; error?: { issues: unknown[] } } },
    soft: { safeParse: (v: unknown) => { success: boolean } },
    value: unknown,
  ) => {
    const result = strict.safeParse(value);
    expect(result.success).toBe(false);
    const issues = (result.error?.issues ?? []) as { params?: Record<string, unknown> }[];
    expect(issues.some((issue) => !isEditorialIssue(issue))).toBe(true);
    expect(soft.safeParse(value).success).toBe(false);
  };

  test("skeleton: a phase out of order, a missing brief and a broken shape rule are editorial", () => {
    const strict = planSkeletonSchemaFor(SKELETON);
    const soft = planSkeletonSchemaFor(SKELETON, { soft: true });
    const entries = outline();
    // Practise before explain; position 2 without its brief; explain share far short.
    entries[3] = { ...entries[3], phase: "practise" };
    const { brief: _dropped, ...noBrief } = entries[2] as { brief: unknown };
    entries[2] = noBrief;
    expectEditorial(strict, soft, skeleton(entries));
    // A learning objective over its cap, and five of them.
    expectEditorial(
      strict,
      soft,
      skeleton(outline(), {
        learningObjectives: Array.from({ length: 5 }, () => ({ text: "x".repeat(161) })),
      }),
    );
  });

  test("skeleton: an outline that does not open title, objectives and a dangling reference are shape", () => {
    const strict = planSkeletonSchemaFor(SKELETON);
    const soft = planSkeletonSchemaFor(SKELETON, { soft: true });
    const swapped = outline();
    [swapped[0], swapped[1]] = [swapped[1] as never, swapped[0] as never];
    expectShape(strict, soft, skeleton(swapped));
    const dangling = outline();
    dangling[3] = { ...dangling[3], factRefs: [O(4)] };
    expectShape(strict, soft, skeleton(dangling));
    // The picture brief's subject cap is `@tj/domain`'s too: shape.
    const picture = outline();
    picture[3] = {
      kind: "image-text",
      factRefs: [O(0)],
      phase: "explain",
      brief,
      imageBrief: { ...RIVER, subject: "x".repeat(61) },
    };
    expectShape(
      strict,
      soft,
      skeleton(picture, { photographable: { yes: true, why: "A river." } }),
    );
  });

  test("facts: ten questions, a stem that presumes a picture, a long term and a ninth term are editorial", () => {
    const ten = facts();
    ten.questions = ten.questions.slice(0, 10);
    ten.outlineFactRefs = ten.outlineFactRefs.map((e) => ({
      ...e,
      factRefs: e.factRefs.filter((r) => !(r.type === "question" && r.index >= 10)),
    }));
    expectEditorial(factsSchema(false), factsSchema(true), ten);
    const diagram = facts();
    (diagram.questions[0] as { stem: string }).stem = "Look at the diagram. What melts first?";
    expectEditorial(factsSchema(false), factsSchema(true), diagram);
    const terms = facts();
    (terms.vocabulary[0] as { term: string }).term = "x".repeat(61);
    terms.vocabulary.push(
      ...Array.from({ length: 9 - terms.vocabulary.length }, () => terms.vocabulary[1] as never),
    );
    expectEditorial(factsSchema(false), factsSchema(true), terms);
  });

  test("facts: a reference out of range, no key idea and an unknown list are shape", () => {
    const out = facts();
    (out.outlineFactRefs[0] as { factRefs: unknown[] }).factRefs = [
      { type: "question", index: 99 },
    ];
    expectShape(factsSchema(false), factsSchema(true), out);
    const none = facts();
    none.keyIdeas = [];
    expectShape(factsSchema(false), factsSchema(true), none);
    expectShape(factsSchema(false), factsSchema(true), { ...facts(), summary: "no such list" });
  });

  test("facts: the soft build still yields LessonFacts `assignFactIds` accepts", () => {
    const ten = facts();
    ten.questions = ten.questions.slice(0, 10);
    ten.outlineFactRefs = ten.outlineFactRefs.map((e) => ({
      ...e,
      factRefs: e.factRefs.filter((r) => !(r.type === "question" && r.index >= 10)),
    }));
    const parsed = factsSchema(true).safeParse(ten);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(
      LessonFactsSchema.safeParse(assignFactIds(FIXTURES.planSkeleton, parsed.data, 60)).success,
    ).toBe(true);
  });

  test("worksheet: a picture word, a long title and a fifth criterion are editorial; three blocks is shape", () => {
    const strict = worksheetSpecSchemaFor();
    const soft = worksheetSpecSchemaFor({ soft: true });
    const block = (text: string) => ({ type: "paragraph", text, factRefs: ["o1"] });
    const sheet = {
      title: "x".repeat(81),
      criteria: ["a", "b", "c", "d", "e"],
      blocks: [block("Look at the photo."), block("B."), block("C."), block("D.")],
    };
    expectEditorial(strict, soft, sheet);
    expectShape(strict, soft, {
      ...sheet,
      title: "T",
      criteria: [],
      blocks: sheet.blocks.slice(1),
    });
  });
});

describe("planFactsSchemaFor: a misplaced callout is editorial and dropped, never fatal (CB run, 24 Sept)", () => {
  const strict = planFactsSchemaFor(FIXTURES.planSkeleton, EXPLAIN_SOME);
  const soft = planFactsSchemaFor(FIXTURES.planSkeleton, EXPLAIN_SOME, { soft: true });
  const withCallouts = (callouts: Record<number, unknown>) => {
    const f = structuredClone(FIXTURES.planFacts);
    f.outlineFactRefs = f.outlineFactRefs.map((entry, i) =>
      callouts[i] ? { ...entry, callout: callouts[i] as never } : entry,
    );
    return f;
  };
  const good = { kind: "key-words", refs: [{ type: "vocabulary", index: 1 }] };

  test("a callout on its own list validates in both builds and is kept", () => {
    const f = withCallouts({ 1: good });
    expect(strict.safeParse(f).success).toBe(true);
    expect(soft.parse(f).outlineFactRefs[1]?.callout).toEqual(good as never);
  });

  test("the wrong list or an index past the end: editorial issues in strict, the callout dropped in soft", () => {
    const f = withCallouts({
      1: good,
      2: { kind: "example", refs: [{ type: "misconception", index: 0 }] },
      3: {
        kind: "key-words",
        refs: [
          { type: "vocabulary", index: 0 },
          { type: "keyIdea", index: 0 },
        ],
      },
      4: { kind: "watch-out", refs: [{ type: "misconception", index: 9 }] },
    });
    const r = strict.safeParse(f);
    expect(r.success).toBe(false);
    const issues = r.error?.issues ?? [];
    expect(issues.every((issue) => isEditorialIssue(issue))).toBe(true);
    expect(issues.map((i) => i.path.join("."))).toEqual([
      "outlineFactRefs.2.callout.refs.0",
      "outlineFactRefs.3.callout.refs.1",
      "outlineFactRefs.4.callout.refs.0",
    ]);
    expect(issues[0]?.message).toBe(
      'Callout kind "example" may cite only keyIdea references, index below 2.',
    );
    const out = soft.parse(f);
    expect(out.outlineFactRefs.map((e) => e.callout?.kind)).toEqual([
      undefined,
      "key-words",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    // The slide keeps its facts; only the box goes.
    expect(out.outlineFactRefs[2]?.factRefs).toEqual(f.outlineFactRefs[2]?.factRefs as never);
    expect(() => assignFactIds(FIXTURES.planSkeleton, out, 60)).not.toThrow();
  });
});

describe("withAssignedCallout (quality PRD G3): the box is present exactly when assigned, of that kind", () => {
  const content = {
    kind: "content",
    heading: "Roman roads",
    body: "Straight and paved.",
    factRefs: ["k1"],
  };
  const box = { kind: "watch-out" as const, text: "Not every Roman road was straight." };
  const schemaFor = (
    callout: { kind: "watch-out" | "example" | "key-words"; factRefs: string[] } | undefined,
    soft = false,
  ) =>
    withAssignedCallout(
      slideSpecSchemaFor("content", { soft }) as NonNullable<ReturnType<typeof slideSpecSchemaFor>>,
      callout,
      { soft },
    );
  const watch = { kind: "watch-out" as const, factRefs: ["m1"] };
  const issuesOf = (r: {
    success: boolean;
    error?: { issues: { path: PropertyKey[]; message: string }[] };
  }) => (r.success ? [] : (r.error?.issues ?? []).map((i) => `${i.path.join(".")}: ${i.message}`));

  test("assigned and given, same kind: accepted with the text kept", () => {
    const r = schemaFor(watch).safeParse({ ...content, callout: box });
    expect(r.success).toBe(true);
    if (r.success && r.data.kind === "content") expect(r.data.callout).toEqual(box);
  });

  test("assigned but missing: one editorial issue at callout", () => {
    const r = schemaFor(watch).safeParse(content);
    expect(issuesOf(r)).toEqual([
      'callout: This slide carries a "watch-out" callout: give `callout` with that kind and one line of text.',
    ]);
    if (!r.success) expect(r.error.issues.every(isEditorialIssue)).toBe(true);
  });

  test("given but not assigned: one editorial issue at callout", () => {
    const r = schemaFor(undefined).safeParse({ ...content, callout: box });
    expect(issuesOf(r)).toEqual(["callout: This slide has no callout: leave `callout` out."]);
  });

  test("wrong kind: one editorial issue at callout.kind", () => {
    const r = schemaFor(watch).safeParse({ ...content, callout: { ...box, kind: "example" } });
    expect(issuesOf(r)).toEqual([
      'callout.kind: `callout.kind` must be "watch-out", the kind this slide was assigned.',
    ]);
  });

  test("the text cap is the slides schema's (120, ceiling 180) and an unknown kind is shape", () => {
    expect(
      schemaFor(watch).safeParse({ ...content, callout: { ...box, text: "x".repeat(181) } })
        .success,
    ).toBe(false);
    expect(
      schemaFor(watch, true).safeParse({ ...content, callout: { ...box, text: "x".repeat(181) } })
        .success,
    ).toBe(true);
    expect(
      schemaFor(watch, true).safeParse({ ...content, callout: { ...box, kind: "tip" } }).success,
    ).toBe(false);
  });

  test("the soft build applies none of the three rules", () => {
    expect(schemaFor(watch, true).safeParse(content).success).toBe(true);
    expect(schemaFor(undefined, true).safeParse({ ...content, callout: box }).success).toBe(true);
    expect(
      schemaFor(watch, true).safeParse({ ...content, callout: { ...box, kind: "example" } })
        .success,
    ).toBe(true);
  });
});

describe("assignFactIds keeps a question's declared key ideas (lab round 1, tested-not-taught)", () => {
  test("ordinal keyIdeaRefs become key idea ids; out-of-range refs drop; forms and demand still go", () => {
    const f = structuredClone(FIXTURES.planFacts);
    const n = f.keyIdeas.length;
    const questions = f.questions as unknown as Record<string, unknown>[];
    questions[0] = {
      ...questions[0],
      keyIdeaRefs: [
        { type: "keyIdea", index: 0 },
        { type: "keyIdea", index: 0 },
        { type: "keyIdea", index: n },
      ],
      forms: ["open-response"],
      demand: "apply",
    };
    const facts = assignFactIds(FIXTURES.planSkeleton, f as never, 60);
    expect(LessonFactsSchema.safeParse(facts).success).toBe(true);
    expect(facts.questions[0]?.keyIdeaRefs).toEqual(["k1"]);
    expect(facts.questions[0]).not.toHaveProperty("forms");
    expect(facts.questions[1]).not.toHaveProperty("keyIdeaRefs");
  });
});
