import { describe, expect, test } from "bun:test";
import { isEditorialIssue, SPEC_LIMITS } from "@tj/slides";
import { planFactsObjectivePrompt, SHAPE_SKETCH } from "./plan-facts-objective";
import { CURRICULUM_INSTRUCTION, PRIOR_KNOWLEDGE_LABEL } from "./plan-objectives";
import {
  EXIT_LINE,
  PlanQuestionSetOutputSchema,
  planQuestionSetOutputSchemaFor,
  planQuestionSetPrompt,
  QUESTION_SET_SHAPE_SKETCH,
  taughtBlock,
  tierLine,
} from "./plan-question-set";
import { PLAN_QUESTION_SET_SAMPLE as SAMPLE, PLAN_TAUGHT_SAMPLE as TAUGHT } from "./plan-samples";

const QUESTION = {
  stem: "Why could a Roman army reach trouble in days rather than weeks?",
  answer: "Straight, paved roads joined the towns.",
  reasoning: "Key idea 0 states the roads and the reason.",
  tier: "core",
  use: "exit",
  demand: "explanation",
  forms: ["open-response"],
  keyIdeaRefs: [{ type: "keyIdea", index: 0 }],
};
const set = (questions: unknown[]) => ({ questions });

describe("plan-question-set", () => {
  test("the system text is v14's question rules, the taught-text rule, and no teach rule", () => {
    const system = planQuestionSetPrompt.system;
    const v14 = planFactsObjectivePrompt.system;
    // v14 is 487 words; this call is 357: v14 question rules plus the one judge sentence. The alarm follows the count.
    // v4: 361. v5: 376, the one-right-answer sentence (7 "anotherCorrect" on gpt-6-luna low).
    // v6: 392, the part-way clause (both round-B question-set faults were a part-way answer the stem allowed).
    // v7 (l6e): 402, the ratio exception to the unit rule (two round-D keyWrong flags).
    expect(system.trim().split(/\s+/).length).toBeLessThan(410);
    expect(system).toContain("A ratio's parts carry none: 2:3, not 2 cm:3 cm.");
    expect(system).toContain("British English");
    expect(system).toContain("Never invent or include the name of any pupil");
    expect(system).not.toContain("factRefs");
    // The rule the split exists for: the judged "tested but not taught" class. The check is
    // described (Luna guide 1) and the goals ranked (guide 2), answerable first.
    expect(system).toContain(
      "A judge reads each question beside the taught text and nothing else.",
    );
    expect(system).toContain("every question is answerable from the taught text alone");
    expect(system).toContain(
      "the fact, reason, method or quotation its answer needs being stated there",
    );
    expect(system).toContain(
      "a case of its own rather than repeating any example in the taught text",
    );
    // The count and the use come from the packet line; the system names the line, not a number.
    expect(system).toContain('Write as many questions as the brief\'s "Write" line says');
    expect(system).toContain('set "use" to that use');
    expect(system).not.toMatch(/four to six|Two questions are for/);
    expect(system).toContain("Follow the brief's tier line.");
    expect(system).not.toContain('at least one "easy"');
    // v4 (audit B3): three distractors, the true-false condition, and no exit sentence (EXIT_LINE says it).
    // v5 (luna-direct checklist): each distractor wrong by the taught text, the taught misconception
    // first among the real errors, its ref folded into the clause.
    expect(system).toContain(
      'Where "forms" includes multiple-choice, pupils see the answer beside its distractors. Write the answer as a short phrase within the distractor limit, then three distractors (without three real errors to use, leave multiple-choice out of "forms"), each wrong by the taught text and reached by a real error: the taught misconception applied to this case (give its "misconceptionRef"), a neighbouring idea or a wrong step. Write them in the same form, with at least one as long as the answer and none ending in a full stop, so length, punctuation and wording never give the answer away.',
    );
    // v5: a "name one" item keyed to one of several right answers was the commonest question fault.
    expect(system).toContain(
      'Each question has one right answer: where a pupil could stop part way, the stem asks for the finished form ("simplest form"); where several are right ("name one…"), "answer" lists each.',
    );
    expect(system).toContain(
      '"forms" lists every way the question can be set: multiple-choice, true-false (only with a distractor that has a "misconceptionRef", never on exit), open-response.',
    );
    expect(system).not.toContain("answered in one line or by choosing an option");
    // v14's question rules, byte for byte.
    for (const kept of [
      "Pitch the language, numbers and problem steps at the year group and reading level given",
      "A quotation is one line, cut with an ellipsis.",
    ]) {
      expect(v14).toContain(kept);
      expect(system).toContain(kept);
    }
    // Reworded for the split: the index is the one the taught block shows; units name the
    // question's own fields; the ref rule names the distractor alone; no "explain any word".
    expect(system).toContain(
      '"keyIdeaRefs" lists every key idea a pupil needs to answer it, by the index shown.',
    );
    expect(system).toContain(
      "Every quantity carries its unit, in the answer and each option as well as the stem",
    );
    // v5: folded into the multiple-choice clause.
    expect(system).not.toContain("Where a distractor heads off the misconception");
    expect(system).not.toContain("explain any word");
    // No teach rule: key ideas, vocabulary, the worked-example line, prior knowledge, invention of
    // real figures, and no input the call is not given.
    for (const gone of [
      "Write one or two key ideas",
      "Vocabulary is the terms",
      "worked-example line",
      "objectiveRefs",
      PRIOR_KNOWLEDGE_LABEL,
      "curriculum extract",
      "never estimated",
      "outline",
      "minute",
    ]) {
      expect(system).not.toContain(gone);
    }
    expect(system).toContain(
      `Length limits (characters): stem and answer ${SPEC_LIMITS.stem}; reasoning ${SPEC_LIMITS.footnote}; distractor ${SPEC_LIMITS.option}.`,
    );
    // The sketch is v14's question item, unchanged, inside the one list.
    const v14Item = SHAPE_SKETCH.slice(SHAPE_SKETCH.indexOf('"questions":'));
    // v2: the `use` slot is a placeholder like every other; the schema pins the value per call.
    expect(QUESTION_SET_SHAPE_SKETCH).toBe(
      `{${v14Item.replace('"use":"slide"', '"use":"…"')}}`.slice(0, -1),
    );
    expect(QUESTION_SET_SHAPE_SKETCH).not.toContain('"use":"slide"');
    expect(system).toContain(QUESTION_SET_SHAPE_SKETCH);
  });

  test("the user turn shows the taught text indexed as the refs copy it, the use and the count", () => {
    const rendered = planQuestionSetPrompt.user(SAMPLE);
    expect(rendered).toContain(
      "Lesson shape: This is an Explain lesson for a class new to the topic.",
    );
    expect(rendered).toContain("Objective: Explain how the Romans changed daily life in Britain");
    expect(rendered).toContain("Taught text for this objective, as the slides will say it:");
    expect(rendered).toContain(
      "Key ideas, by index:\n  0: Roman roads let soldiers and goods move quickly between new towns. — Straight, paved roads",
    );
    expect(rendered).toContain("\n  1: Roman towns had a forum, baths and straight streets. —");
    expect(rendered).toContain("    Example: Colchester was the first Roman town in Britain.");
    expect(rendered).toContain("    Analogy: A forum was like a town square");
    expect(rendered).toContain(
      "Misconceptions, by index:\n  0: believes The Romans left no trace in Britain.; correct: Roads, baths",
    );
    expect(rendered).toContain("Vocabulary:\n  forum — The open square");
    expect(rendered).toContain(
      "Worked example: Why did the Romans build a road from Dover to London?\n  1. Dover is where soldiers landed.\n  2. London was the biggest town.\n  Answer: So soldiers",
    );
    expect(rendered).toContain(
      "Already asked of this objective; write different questions:\n  - How did Roman roads change trade in Britain?\n  - What was a forum for?",
    );
    expect(rendered).toMatch(/\nWrite 2 "exit" questions\.\nTiers: one "easy" and one "core"\.\n/);
    // v3: an exit call carries the exit quiz's line budget, from the outline's own caps.
    expect(rendered.endsWith(`\n${EXIT_LINE}`)).toBe(true);
    expect(EXIT_LINE).toBe(
      'Each is one line of the exit quiz: either multiple choice, with a stem of at most 100 characters and the answer and each distractor at most 30; or "forms" ["open-response"] with no distractors and a stem of at most 160 characters. These caps replace the general length limits.',
    );
    // Nothing the call does not use: no curriculum, reference, prior-knowledge or other objectives.
    expect(rendered).not.toContain(CURRICULUM_INSTRUCTION);
    expect(rendered).not.toContain("Reference facts");
    expect(rendered).not.toContain(PRIOR_KNOWLEDGE_LABEL);
    expect(rendered).not.toContain("by index:\n  0: Explain");
    expect(rendered).not.toMatch(/Lesson length|minutes/);
    // Without `avoid` the block is absent; a set of one takes the singular and the core tier.
    const { avoid: _a, ...bare } = SAMPLE;
    const one = planQuestionSetPrompt.user({ ...bare, use: "slide", count: 1 });
    expect(one).not.toContain("Already asked");
    expect(one).toMatch(/\nWrite 1 "slide" question\.\nTier: "core"\.$/);
    expect(one).not.toContain("exit quiz");
    expect(planQuestionSetPrompt.user({ ...bare, use: "slide", count: 4 })).toMatch(
      /\nWrite 4 "slide" questions\.\nTiers: at least one "easy", one "core" and one "stretch"\.$/,
    );
    expect(tierLine(3)).toBe('Tiers: at least one "easy", one "core" and one "stretch".');
    // The block renders only what the teach call wrote.
    const thin = taughtBlock({ ...TAUGHT, vocabulary: [], workedExamples: [] });
    expect(thin).not.toContain("Vocabulary");
    expect(thin).not.toContain("Worked example");
  });

  test("the item is v14's question shape; the per-call schema pins use, count and the key-idea bound", () => {
    const general = (value: unknown) => PlanQuestionSetOutputSchema.safeParse(value).success;
    const live = (value: unknown) =>
      planQuestionSetOutputSchemaFor(SAMPLE).safeParse(value).success;
    // General: any use, one or more questions, an index past the second key idea rejected.
    expect(general(set([QUESTION]))).toBe(true);
    expect(general(set([{ ...QUESTION, use: "slide" }, QUESTION, QUESTION]))).toBe(true);
    expect(general(set([]))).toBe(false);
    expect(general(set([{ ...QUESTION, use: "starter" }]))).toBe(false);
    expect(general(set([{ ...QUESTION, keyIdeaRefs: [{ type: "keyIdea", index: 2 }] }]))).toBe(
      false,
    );
    expect(general({ ...set([QUESTION]), keyIdeas: [] })).toBe(false);
    // Live: exactly `count`, every `use` the brief's, refs within the taught key ideas.
    expect(live(set([QUESTION, QUESTION]))).toBe(true);
    expect(live(set([QUESTION]))).toBe(false);
    expect(live(set([QUESTION, QUESTION, QUESTION]))).toBe(false);
    expect(live(set([QUESTION, { ...QUESTION, use: "slide" }]))).toBe(false);
    expect(
      live(set([QUESTION, { ...QUESTION, keyIdeaRefs: [{ type: "keyIdea", index: 1 }] }])),
    ).toBe(true);
    const oneIdea = planQuestionSetOutputSchemaFor({
      ...SAMPLE,
      taught: { ...TAUGHT, keyIdeas: TAUGHT.keyIdeas.slice(0, 1) },
    });
    expect(
      oneIdea.safeParse(
        set([QUESTION, { ...QUESTION, keyIdeaRefs: [{ type: "keyIdea", index: 1 }] }]),
      ).success,
    ).toBe(false);
    // v14's enums, forms and optional refs are unchanged.
    const { keyIdeaRefs: _k, ...noRefs } = QUESTION;
    expect(live(set([noRefs, noRefs]))).toBe(true);
    expect(live(set([{ ...QUESTION, demand: "evaluate" }, QUESTION]))).toBe(false);
    expect(live(set([{ ...QUESTION, forms: [] }, QUESTION]))).toBe(false);
    expect(live(set([{ ...QUESTION, forms: ["fill-gap"] }, QUESTION]))).toBe(false);
    expect(live(set([{ ...QUESTION, tier: "medium" }, QUESTION]))).toBe(false);
    // Caps as v14: reasoning at `footnote`; the soft build drops caps and keeps use and count.
    const long = set([{ ...QUESTION, reasoning: "x".repeat(SPEC_LIMITS.footnote + 20) }, QUESTION]);
    expect(live(long)).toBe(false);
    const soft = planQuestionSetOutputSchemaFor(SAMPLE, { soft: true });
    expect(soft.safeParse(long).success).toBe(true);
    // v2: the soft build takes max(1, count - 1) to count + 2, so a near miss is not a third attempt.
    expect(soft.safeParse(set([QUESTION])).success).toBe(true);
    expect(soft.safeParse(set([QUESTION, QUESTION, QUESTION, QUESTION])).success).toBe(true);
    expect(soft.safeParse(set([QUESTION, QUESTION, QUESTION, QUESTION, QUESTION])).success).toBe(
      false,
    );
    expect(soft.safeParse(set([])).success).toBe(false);
    const single = planQuestionSetOutputSchemaFor({ ...SAMPLE, count: 1 }, { soft: true });
    expect(single.safeParse(set([QUESTION])).success).toBe(true);
    expect(single.safeParse(set([])).success).toBe(false);
    expect(soft.safeParse(set([QUESTION, { ...QUESTION, use: "slide" }])).success).toBe(false);
  });

  test("w0b and r1 carry over: an echoed distractor is an editorial issue, a fourth echo is dropped", () => {
    const mc = (distractors: string[]) => ({
      ...QUESTION,
      answer: "Straight roads",
      forms: ["multiple-choice"],
      distractors: distractors.map((text) => ({ text })),
    });
    const hard = planQuestionSetOutputSchemaFor(SAMPLE);
    const echo = hard.safeParse(set([mc(["Straight roads.", "Boats", "Horses"]), QUESTION]));
    expect(echo.success).toBe(false);
    expect(echo.error?.issues.every(isEditorialIssue)).toBe(true);
    expect(
      planQuestionSetOutputSchemaFor(SAMPLE, { soft: true }).safeParse(
        set([mc(["Straight roads.", "Boats", "Horses"]), QUESTION]),
      ).success,
    ).toBe(true);
    const four = hard.safeParse(
      set([mc(["Straight roads", "Boats", "Horses", "Walls"]), QUESTION]),
    );
    expect(four.success && four.data.questions[0]?.distractors?.map((d) => d.text)).toEqual([
      "Boats",
      "Horses",
      "Walls",
    ]);
  });
});
