import { describe, expect, test } from "bun:test";
import { isEditorialIssue, SPEC_LIMITS } from "@tj/slides";
import { lessonShapeOf } from "../shapes";
import { audienceOf } from "../stages/shared";
import { sampleBriefLesson } from "../testing";
import {
  carriesWorkedExample,
  type PlanFactsObjectiveInput,
  PlanFactsObjectiveOutputSchema,
  planFactsObjectiveOutputSchemaFor,
  planFactsObjectivePrompt,
  REFERENCE_INSTRUCTION,
  SHAPE_SKETCH,
} from "./plan-facts-objective";
import { CURRICULUM_INSTRUCTION, PRIOR_KNOWLEDGE_LABEL } from "./plan-objectives";

/*
 * F06-R13 / ADR 0025 §17: the prompt's wording is pinned to its version, as `prompts.test.ts` does
 * for the registered prompts. `plan-facts-objective` is not in the registry until the per-objective
 * facts fan-out lands, so it is pinned here on its own, the way `plan-objectives` is. The sample
 * carries three objectives and a whole curriculum unit, so the stay-in-your-lane wording, the
 * target line and the curriculum instruction are all part of the hash.
 */
const audience = audienceOf(sampleBriefLesson());

const SHAPE = lessonShapeOf(
  { objectiveVerb: "Explain the Roman invasion of Britain", priorConfidence: "New to it" },
  { yearGroup: "Year 4" },
);

const SAMPLE: PlanFactsObjectiveInput = {
  topic: "The Roman invasion of Britain",
  audience: { ...audience, subject: "History", yearGroup: "Year 4" },
  shape: SHAPE,
  objectives: [
    { text: "Explain why the Romans invaded Britain" },
    { text: "Explain how the Romans changed daily life in Britain" },
    { text: "Explain why Boudica led a revolt" },
  ],
  target: 1,
  curriculum: {
    text: [
      "Programme of study: the Roman Empire and its impact on Britain.",
      "Key learning points: the Romans invaded Britain in AD 43; roads and towns changed daily life;",
      "Boudica's revolt was defeated in AD 61.",
      "Misconception: pupils think the Romans left no trace in Britain.",
    ].join("\n"),
  },
  reference: {
    text: [
      "- Key idea: Roads joined the new towns. Soldiers and goods moved fast. Example: Watling Street.",
      "- Term: villa — a large Roman country house with farmland.",
    ].join("\n"),
  },
};

const PIN: { version: string; hash: string } = {
  version: "plan-facts-objective.v14",
  hash: "e4a54b63401fa8c49a7de13f30bfd84999f0d2e2dbda8a3525150c40e4985c8b",
};

/** One objective's facts, as the schema accepts them; the pieces tests vary field by field. */
const KEY_IDEA = {
  statement: "Roman roads let soldiers and goods move quickly between new towns.",
  explanation: "Straight, paved roads meant an army could march to trouble in days, not weeks.",
  example: "Watling Street ran from Dover to Wroxeter, about 250 miles.",
};
const MISCONCEPTION = {
  belief: "The Romans left no trace in Britain.",
  correction: "Roads, baths and town walls from Roman Britain still stand today.",
};
const VOCABULARY = { term: "Empire", definition: "A group of lands ruled by one country." };
const WORKED_EXAMPLE = {
  problem: "Why did the Romans build a road from Dover to London?",
  steps: ["Dover is where soldiers landed.", "London was the biggest town."],
  answer: "So soldiers and supplies could reach the biggest town quickly.",
  objectiveRefs: [{ type: "objective", index: 1 }],
};
const QUESTION = {
  stem: "How did Roman roads change trade in Britain?",
  answer: "Goods could be carried further and faster between towns.",
  reasoning: "Paved, straight roads stayed usable in winter.",
  tier: "core",
  use: "slide",
  demand: "recall",
  forms: ["multiple-choice", "open-response"],
};
const facts = (over: Record<string, unknown> = {}) => ({
  keyIdeas: [KEY_IDEA],
  misconceptions: [MISCONCEPTION],
  vocabulary: [VOCABULARY],
  workedExamples: [WORKED_EXAMPLE],
  questions: [QUESTION, QUESTION, QUESTION, QUESTION],
  ...over,
});
/** Three more questions, so a test varying one question carries the v14 target of four. */
const REST = [QUESTION, QUESTION, QUESTION];

describe("plan-facts-objective", () => {
  test("text hash matches its pinned version", () => {
    const text = `${planFactsObjectivePrompt.system}\n---\n${planFactsObjectivePrompt.user(SAMPLE)}`;
    const actual: { version: string; hash: string } = {
      version: planFactsObjectivePrompt.version,
      hash: new Bun.CryptoHasher("sha256").update(text).digest("hex"),
    };
    expect(actual).toEqual(PIN);
  });

  test("v10: reference facts render after the curriculum extract under their own line, only when given", () => {
    const withRef = planFactsObjectivePrompt.user(SAMPLE);
    const refAt = withRef.indexOf(REFERENCE_INSTRUCTION);
    expect(refAt).toBeGreaterThan(withRef.indexOf(CURRICULUM_INSTRUCTION));
    expect(withRef.slice(refAt)).toContain("- Term: villa");
    expect(withRef).toContain("already checked");
    const { reference: _r, ...noRef } = SAMPLE;
    const without = planFactsObjectivePrompt.user(noRef);
    expect(without).not.toContain("Reference facts");
    // The system text says nothing about references: the line travels with the input.
    expect(planFactsObjectivePrompt.system).not.toContain("eference");
  });

  test("the system text stays in one objective's lane and writes no outline", () => {
    const system = planFactsObjectivePrompt.system;
    /*
     * Provider-neutral and short: it runs on whichever gateway model is cheapest, and N of these
     * run in parallel, so the system text is re-sent N times. The budget is an alarm, not a target.
     */
    // v5 (minimalism rubric, 23 Sept 2026) trimmed 448 to 350; v6 369; v7 317; v8 331; v9 368 (the
    // three declarations, review pack np1, paid for in part by the shared JSON line and the
    // misconception clause); v11 384 (keyIdeaRefs: one sketch slot, one clause); v13 436 (the
    // multiple-choice option rule, answer tells 93% -> 29% longest); v14 487 (cb cause 5: four
    // rules the judges marked and the prompt never asked for, each named to a lab output in the
    // prompt file's header; the rest is v2–v13 measured wording). The alarm follows it.
    expect(system.trim().split(/\s+/).length).toBeLessThan(495);
    expect(system).toContain("British English");
    expect(system).toContain("Never invent or include the name of any pupil");
    // v14: pitch is one sentence here, covering numbers and problem steps (Y5-L: amounts to 35,
    // one step on every question) and keeping the house rule's two clauses, in place of the
    // shared language-only line.
    expect(system).toContain("Pitch the language, numbers and problem steps");
    expect(system).toContain("explain any word a pupil at that level would not know");
    expect(system).not.toContain("Pitch the language at the reading level");
    // v14: a key idea's example is a named case (Y4-L, Y11-L restated the statement; Y10-L o1 had
    // no quotation), the worked example and questions take their own (Y11-L x1 became its exit
    // question), two quick exit questions (no v13 call knew what "exit" meant; the starter is the
    // outline's own selection, nothing is marked here), and a distractor is a real error (Y4-L
    // "build pyramids"). The v2 invention sentence is unchanged.
    expect(system).toContain("A key idea's example is one named case");
    expect(system).toContain("quotation or worked numbers");
    expect(system).toContain("take a case of their own");
    expect(system).toContain('Two questions are for "exit" use, each answered in one line');
    expect(system).not.toContain("starter");
    expect(system).not.toContain('"keyIdeaRefs" is empty');
    expect(system).toContain("a key idea's date, figure or case is real");
    expect(system).toContain("a wrong option a pupil reaches by a real error");
    expect(system).not.toContain("three or four");
    expect(system).toMatch(/JSON/);
    // No fact ids reach this call, so the house rules' `factRefs` line is left out.
    expect(system).not.toContain("factRefs");
    // The other objectives are listed so the model can stay out of their lane, not to be taught.
    expect(system).toContain("Other calls write the others: do not teach them here");
    // Outline and minutes are assigned later, in code or a call of their own.
    expect(system).not.toContain("outline");
    expect(system).not.toContain("minute");
    // v9: the call declares what code used to guess. A worked example names the objectives it
    // serves (the outline took `ownersOf[x] ?? [o]`); a question declares its demand and the forms
    // it can take (the outline read three distractors as multiple-choice). Each is a slot in the
    // sketch and one rule defines the enum words; no other item is asked for `objectiveRefs`.
    expect(system).toContain('Its "objectiveRefs" list every objective it serves, by index');
    expect(system).toContain('"objectiveRefs":[{"type":"objective","index":0}]');
    expect(system).toContain('"demand" is what the question asks of the pupil: recall');
    expect(system).toContain('"forms" lists every way the question can be set');
    expect(system).toContain('"demand":"apply","forms":["multiple-choice","open-response"]');
    expect(system.split("objectiveRefs").length - 1).toBe(2);
    // The ref is named, not rendered (v7: the sketch is the shape once). v9 cut "one pupils really
    // hold, not a slip": BENCH-facts-1 graded misconceptions real and named no failure (rubric 3).
    expect(system).not.toContain("not a slip");
    expect(system).toContain('say so in "misconceptionRef"');
    expect(system).not.toContain('{"type":"misconception","index":0}');
    // The house rules' JSON-only line is code's (`call.ts` repairs and validates), so it is gone.
    expect(system).not.toContain("JSON only");
    // The two v5 correctness rules that stay, each named to a BENCH-luna6 fault:
    // "35 ÷ 7 = 5." with the unit only in the answer (ratio worked examples, 4 of 26 steps).
    expect(system).toContain("Every quantity carries its unit, in each step and answer");
    // "ratio part" as "…the sum of the ratio numbers" (2 of 30 definitions on the benched briefs).
    expect(system).toContain("A definition uses none of the term's own words");
    // Rubric 3 and 5 (v7): rules with no named bench failure are gone, and so is what code repairs
    // (merge dedupes vocabulary by term) or the schema requires (`correction`).
    expect(system).not.toContain("a term an earlier objective needs first");
    expect(system).not.toContain("true of any topic");
    expect(system).not.toContain('Tier "core"');
    expect(system).not.toContain("with its correction");
    // v8: tier coverage is a count the per-call schema cannot hold; without it, v7 left the
    // evolution lesson with no "stretch" question (5 of 9 calls on two tiers).
    expect(system).toContain('at least one "easy", one "core" and one "stretch"');
    // The counts are the measured exception to rubric 5: v5 dropped them and 3 of 3 calls needed a
    // second attempt (v6); the provider's non-strict route ignores minItems/maxItems.
    expect(system).toContain("Write one or two key ideas, one misconception");
    expect(system).not.toContain("Write, in this order");
    expect(system).not.toContain("Slightly over passes");
    // The distractor count is shape: the sketch shows three slots, no rule names a number.
    expect(system).toContain('"distractors":[{"text":"…"},{"text":"…"},{"text":"…"}]');
    // The worked-example floor is decided in code and reaches the model as a user-turn line; the
    // system text names that line, never a verb or an objective (v3).
    expect(system).toContain("Follow the brief's worked-example line");
    expect(system).not.toContain("An Apply lesson needs one");
    // Outside a calculation subject a worked example is an annotated model answer.
    expect(system).toContain("steps annotate a model answer");
  });

  test("the user turn numbers every objective and names the one to write", () => {
    const rendered = planFactsObjectivePrompt.user(SAMPLE);
    // Ruling 82: lesson length sizes nothing in this call, so it is not rendered (v5).
    expect(rendered).not.toMatch(/Lesson length|minutes/);
    // v9: listed by 0-based index, the number a worked example's `objectiveRefs` copies.
    expect(rendered).toContain(
      "Objectives of the lesson, by index:\n  0: Explain why the Romans invaded",
    );
    expect(rendered).toContain("  2: Explain why Boudica led a revolt");
    expect(rendered).toContain(
      "Write the facts for objective 1: Explain how the Romans changed daily life in Britain",
    );
    // The curriculum extract is an anchor, not a script, and is introduced the objectives call's way.
    expect(rendered).toContain(CURRICULUM_INSTRUCTION);
    expect(rendered).toContain("Boudica's revolt was defeated in AD 61");
    const without = planFactsObjectivePrompt.user({ ...SAMPLE, curriculum: undefined });
    expect(without).not.toContain(CURRICULUM_INSTRUCTION);
  });

  test("the prior-knowledge line is rendered and the system rule names it", () => {
    // Supplying the fact is half of it; the system must point at the line, or the input is inert.
    expect(planFactsObjectivePrompt.system).toContain(`"${PRIOR_KNOWLEDGE_LABEL}"`);
    expect(planFactsObjectivePrompt.system).toContain("build nothing outside it");
    const covered = planFactsObjectivePrompt.user({
      ...SAMPLE,
      priorKnowledge: "the Roman army and its weapons",
    });
    expect(covered).toContain(`${PRIOR_KNOWLEDGE_LABEL}: the Roman army and its weapons`);
    expect(planFactsObjectivePrompt.user(SAMPLE)).not.toContain(PRIOR_KNOWLEDGE_LABEL);
  });

  test("one objective's facts: the counts are a third of a lesson's", () => {
    const parse = (value: unknown) => PlanFactsObjectiveOutputSchema.safeParse(value).success;
    expect(parse(facts())).toBe(true);
    // Vocabulary and the worked example are optional; a key idea, the misconception and 3 questions
    // are not. v14 asks for four to six (one cycle's check set of 2–4 plus 2 exit): the prose
    // states the target, the floor of 3 is tolerance, so a short answer is not a retry.
    expect(parse(facts({ vocabulary: [], workedExamples: [] }))).toBe(true);
    expect(parse(facts({ questions: [QUESTION, QUESTION, QUESTION] }))).toBe(true);
    expect(parse(facts({ questions: [...REST, ...REST] }))).toBe(true);
    expect(parse(facts({ keyIdeas: [] }))).toBe(false);
    expect(parse(facts({ keyIdeas: [KEY_IDEA, KEY_IDEA, KEY_IDEA] }))).toBe(false);
    expect(parse(facts({ misconceptions: [] }))).toBe(false);
    expect(parse(facts({ misconceptions: [MISCONCEPTION, MISCONCEPTION] }))).toBe(false);
    expect(parse(facts({ vocabulary: [VOCABULARY, VOCABULARY, VOCABULARY] }))).toBe(false);
    expect(parse(facts({ workedExamples: [WORKED_EXAMPLE, WORKED_EXAMPLE] }))).toBe(false);
    expect(parse(facts({ questions: [QUESTION, QUESTION] }))).toBe(false);
    expect(parse(facts({ questions: [...REST, ...REST, QUESTION] }))).toBe(false);
    // Item text caps are the ones `specs.ts` enforces, so a merged item cannot break the slides.
    expect(parse(facts({ keyIdeas: [{ ...KEY_IDEA, statement: "x".repeat(161) }] }))).toBe(false);
    // An invented list is a real shape error; a stray key on an item is stripped, not a retry.
    expect(parse({ ...facts(), pitch: { readingAgeTarget: 9 } })).toBe(false);
    const stripped = PlanFactsObjectiveOutputSchema.safeParse(
      facts({ keyIdeas: [{ ...KEY_IDEA, objectiveRefs: [{ type: "objective", index: 0 }] }] }),
    );
    expect(stripped.success).toBe(true);
    expect(stripped.success && stripped.data.keyIdeas[0]).toEqual(KEY_IDEA);
  });

  test("v11: a question may declare the key ideas it tests, by this call's index", () => {
    const parse = (value: unknown) => PlanFactsObjectiveOutputSchema.safeParse(value).success;
    const refs = (...indices: number[]) => indices.map((index) => ({ type: "keyIdea", index }));
    expect(SHAPE_SKETCH).toContain('"keyIdeaRefs":[{"type":"keyIdea","index":0}]');
    expect(planFactsObjectivePrompt.system).toContain('"keyIdeaRefs" lists every key idea');
    // Optional: absence (older outputs, pack fills) parses and the outline falls back.
    expect(parse(facts())).toBe(true);
    expect(parse(facts({ questions: [...REST, { ...QUESTION, keyIdeaRefs: refs(0, 1) }] }))).toBe(
      true,
    );
    // At most two key ideas per call, so an index past 1 is a shape error.
    expect(parse(facts({ questions: [...REST, { ...QUESTION, keyIdeaRefs: refs(2) }] }))).toBe(
      false,
    );
  });

  test("v9: a worked example names its objectives and a question declares demand and forms", () => {
    const general = (value: unknown) => PlanFactsObjectiveOutputSchema.safeParse(value).success;
    const live = (value: unknown) =>
      planFactsObjectiveOutputSchemaFor(SAMPLE).safeParse(value).success;
    const { objectiveRefs: _refs, ...unowned } = WORKED_EXAMPLE;
    expect(general(facts({ workedExamples: [unowned] }))).toBe(false);
    expect(general(facts({ workedExamples: [{ ...unowned, objectiveRefs: [] }] }))).toBe(false);
    // Two objectives served is the case the outline could not see before.
    const two = {
      ...unowned,
      objectiveRefs: [
        { type: "objective", index: 0 },
        { type: "objective", index: 1 },
      ],
    };
    expect(general(facts({ workedExamples: [two] }))).toBe(true);
    // A live call bounds the index to the objectives it listed; the general schema does not.
    const beyond = { ...unowned, objectiveRefs: [{ type: "objective", index: 3 }] };
    expect(general(facts({ workedExamples: [beyond] }))).toBe(true);
    expect(live(facts({ workedExamples: [beyond] }))).toBe(false);
    expect(live(facts({ workedExamples: [two] }))).toBe(true);
    const { demand: _d, forms: _f, ...bare } = QUESTION;
    const q = (over: Record<string, unknown>) =>
      facts({ questions: [{ ...bare, ...over }, ...REST] });
    expect(general(q({ forms: ["true-false"] }))).toBe(false);
    expect(general(q({ demand: "recall" }))).toBe(false);
    expect(general(q({ demand: "evaluate", forms: ["true-false"] }))).toBe(false);
    expect(general(q({ demand: "judgement", forms: [] }))).toBe(false);
    // Only the kinds the outline chooses a practise slide from are forms; nothing reads the rest.
    expect(general(q({ demand: "judgement", forms: ["discussion"] }))).toBe(false);
    expect(general(q({ demand: "judgement", forms: ["fill-gap"] }))).toBe(false);
    expect(general(q({ demand: "judgement", forms: ["open-response"] }))).toBe(true);
    expect(general(q({ demand: "explanation", forms: ["open-response", "true-false"] }))).toBe(
      true,
    );
    expect(general(q({ demand: "apply", forms: ["multiple-choice", "true-false"] }))).toBe(true);
    // The soft build keeps every declaration: it drops text caps only.
    const soft = planFactsObjectiveOutputSchemaFor(SAMPLE, { soft: true });
    expect(soft.safeParse(facts({ workedExamples: [unowned] })).success).toBe(false);
    expect(soft.safeParse(q({ demand: "recall" })).success).toBe(false);
  });

  test("the lesson's last objective carries the worked example when the shape needs one", () => {
    const at = (verb: "Apply" | "Explain" | "Recall" | "Evaluate", target: number) => ({
      ...SAMPLE,
      shape: lessonShapeOf({ objectiveVerb: verb }, { yearGroup: "Year 6" }),
      target,
    });
    const none = facts({ workedExamples: [] });
    const accepts = (verb: Parameters<typeof at>[0], target: number, value: unknown) =>
      planFactsObjectiveOutputSchemaFor(at(verb, target)).safeParse(value).success;
    // Explain and Apply require a worked-example slide: the reach (last) objective must write one.
    expect(carriesWorkedExample(at("Explain", 2))).toBe(true);
    expect(carriesWorkedExample(at("Apply", 2))).toBe(true);
    expect(accepts("Explain", 2, none)).toBe(false);
    expect(accepts("Apply", 2, none)).toBe(false);
    expect(accepts("Explain", 2, facts())).toBe(true);
    // Earlier objectives may skip it, on Apply too: one floor per lesson, not one per call.
    expect(accepts("Explain", 0, none)).toBe(true);
    expect(accepts("Apply", 1, none)).toBe(true);
    expect(accepts("Apply", 1, facts())).toBe(true);
    // Recall and Evaluate require no worked-example slide, so no call is floored.
    expect(carriesWorkedExample(at("Recall", 2))).toBe(false);
    expect(carriesWorkedExample(at("Evaluate", 2))).toBe(false);
    expect(accepts("Recall", 2, none)).toBe(true);
    // The user turn carries the decision on exactly the floored call, and nowhere else.
    const required = "Worked example: required for this objective.";
    const elsewhere = "Worked example: none for this objective.";
    expect(planFactsObjectivePrompt.user(at("Explain", 2))).toContain(required);
    expect(planFactsObjectivePrompt.user(at("Explain", 2))).not.toContain(elsewhere);
    expect(planFactsObjectivePrompt.user(at("Apply", 0))).toContain(elsewhere);
    expect(planFactsObjectivePrompt.user(at("Apply", 0))).not.toContain(required);
    // A lesson with no worked-example slide gets no line at all; the system rule stands alone.
    expect(planFactsObjectivePrompt.user(at("Recall", 2))).not.toContain("Worked example:");
    expect(planFactsObjectivePrompt.user(at("Evaluate", 0))).not.toContain("Worked example:");
    // The worked example may head off this call's one misconception; the caller remaps the index.
    const headsOff = facts({
      workedExamples: [
        { ...WORKED_EXAMPLE, misconceptionRef: { type: "misconception", index: 0 } },
      ],
    });
    expect(accepts("Apply", 2, headsOff)).toBe(true);
  });

  test("an objective whose own verb is at Apply level carries a worked example, whatever its place", () => {
    // v4: round7 (Y6 ratio) lost the two "Calculate…" objectives' worked examples under v3's hedge.
    const ratio = {
      ...SAMPLE,
      shape: lessonShapeOf({ objectiveVerb: "Apply" }, { yearGroup: "Year 6" }),
      objectives: [
        { text: "Calculate the total number of equal parts in a given ratio." },
        { text: "Name the two quantities a ratio compares." },
        { text: "Solve unequal-sharing problems using a given ratio." },
      ],
    };
    const at = (target: number) => ({ ...ratio, target });
    expect([0, 1, 2].map((t) => carriesWorkedExample(at(t)))).toEqual([true, false, true]);
    const none = facts({ workedExamples: [] });
    expect(planFactsObjectiveOutputSchemaFor(at(0)).safeParse(none).success).toBe(false);
    expect(planFactsObjectiveOutputSchemaFor(at(1)).safeParse(none).success).toBe(true);
    expect(planFactsObjectivePrompt.user(at(0))).toContain(
      "Worked example: required for this objective.",
    );
    expect(planFactsObjectivePrompt.user(at(1))).toContain(
      "Worked example: none for this objective.",
    );
    // An Apply-level objective in a lesson whose shape needs no worked-example slide is still floored,
    // and then every call in that lesson gets a line.
    const recall = { ...ratio, shape: lessonShapeOf({ objectiveVerb: "Recall" }, {}) };
    expect(carriesWorkedExample({ ...recall, target: 0 })).toBe(true);
    expect(carriesWorkedExample({ ...recall, target: 2 })).toBe(true);
    expect(planFactsObjectivePrompt.user({ ...recall, target: 1 })).toContain(
      "Worked example: none",
    );
  });

  /*
   * BENCH-facts-2: every schema failure on the Evaluate briefs was a text cap, and the monolithic
   * facts call does not fail on those because `specs.ts` builds a soft variant for
   * `callStructured`'s `soft`. This call now builds one the same way, so an overrun on the retry is
   * accepted and recorded as an editorial miss rather than costing the slowest parallel call.
   */
  test("the soft build drops the text caps and keeps every shape rule", () => {
    const hard = planFactsObjectiveOutputSchemaFor(SAMPLE);
    const soft = planFactsObjectiveOutputSchemaFor(SAMPLE, { soft: true });
    const longAnswer = facts({
      workedExamples: [{ ...WORKED_EXAMPLE, answer: "x".repeat(SPEC_LIMITS.answer + 40) }],
    });
    expect(hard.safeParse(longAnswer).success).toBe(false);
    expect(soft.safeParse(longAnswer).success).toBe(true);
    // `questions.N.reasoning` was the other cap the bench broke; `footnote` is its limit.
    const longReasoning = facts({
      questions: [{ ...QUESTION, reasoning: "x".repeat(SPEC_LIMITS.footnote + 20) }, ...REST],
    });
    expect(hard.safeParse(longReasoning).success).toBe(false);
    expect(soft.safeParse(longReasoning).success).toBe(true);
    // A cap is all it drops: an empty string is still shape, and so are the counts and the enums.
    expect(
      soft.safeParse(facts({ vocabulary: [{ ...VOCABULARY, definition: "  " }] })).success,
    ).toBe(false);
    expect(soft.safeParse(facts({ questions: [QUESTION, QUESTION] })).success).toBe(false);
    expect(
      soft.safeParse(facts({ questions: [{ ...QUESTION, tier: "medium" }, ...REST] })).success,
    ).toBe(false);
  });

  test("w0b: a distractor that repeats the answer (case, spaces, punctuation aside) is an editorial issue: the strict build rejects it so the call retries, the soft build accepts", () => {
    const hard = planFactsObjectiveOutputSchemaFor(SAMPLE);
    const soft = planFactsObjectiveOutputSchemaFor(SAMPLE, { soft: true });
    const withDistractors = (texts: string[]) =>
      facts({
        questions: [{ ...QUESTION, distractors: texts.map((text) => ({ text })) }, ...REST],
      });
    const distinct = withDistractors(["Only soldiers used them", "Nothing changed", "Trade fell"]);
    expect(hard.safeParse(distinct).success).toBe(true);
    const echo = withDistractors([
      "Only soldiers used them",
      "  goods could be carried FURTHER, and faster between towns ",
      "Trade fell",
    ]);
    const result = hard.safeParse(echo);
    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual([
      expect.objectContaining({
        path: ["questions", 0, "distractors", 1, "text"],
        message:
          "This distractor repeats the answer: every option must differ from the correct one.",
      }),
    ]);
    expect(result.error?.issues.every(isEditorialIssue)).toBe(true);
    expect(soft.safeParse(echo).success).toBe(true);
    // Maths signs are content, not punctuation: "-3" is not "3".
    const signed = facts({
      questions: [
        { ...QUESTION, answer: "3", distractors: [{ text: "-3" }, { text: "6" }, { text: "9" }] },
        ...REST,
      ],
    });
    expect(hard.safeParse(signed).success).toBe(true);
  });

  test("both builds require the floored call's worked example", () => {
    const reach = { ...SAMPLE, target: SAMPLE.objectives.length - 1 };
    const none = facts({ workedExamples: [] });
    expect(planFactsObjectiveOutputSchemaFor(reach).safeParse(none).success).toBe(false);
    expect(planFactsObjectiveOutputSchemaFor(reach, { soft: true }).safeParse(none).success).toBe(
      false,
    );
    // The floor is the only thing the reach changes: with the example, both builds take it.
    expect(
      planFactsObjectiveOutputSchemaFor(reach, { soft: true }).safeParse(facts()).success,
    ).toBe(true);
  });
});

describe("plan-facts-objective: an answer listed as a fourth distractor", () => {
  const question = (distractors: string[]) => ({
    stem: "Which is a unit fraction?",
    answer: "one third",
    reasoning: "One part of three equal parts.",
    tier: "core",
    use: "slide",
    demand: "recall",
    forms: ["multiple-choice"],
    distractors: distractors.map((text) => ({ text })),
  });
  const facts = (q: unknown) => ({
    keyIdeas: [
      {
        statement: "A unit fraction has numerator one.",
        explanation: "One part.",
        example: "1/3 of 12 is 4.",
      },
    ],
    misconceptions: [
      { belief: "Bigger denominator, bigger part.", correction: "More parts means smaller parts." },
    ],
    vocabulary: [],
    workedExamples: [],
    questions: [q, q, q],
  });
  test("is dropped when it is the extra fourth option", () => {
    const r = PlanFactsObjectiveOutputSchema.safeParse(
      facts(question(["One third", "two thirds", "three quarters", "one half"])),
    );
    expect(r.success).toBe(true);
    if (r.success)
      expect(r.data.questions[0]?.distractors?.map((d) => d.text)).toEqual([
        "two thirds",
        "three quarters",
        "one half",
      ]);
  });
  test("stays a miss when it takes one of three slots", () => {
    const r = PlanFactsObjectiveOutputSchema.safeParse(
      facts(question(["one third", "two thirds", "one half"])),
    );
    expect(r.success).toBe(false);
  });
});
