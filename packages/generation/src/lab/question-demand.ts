import {
  type OutlineFacts,
  type OutlineFromFactsInput,
  type OutlineFromFactsResult,
  outlineFromFacts,
} from "../outline-from-facts";
import { EXIT_QUIZ_MAX, MC_LINE_MAX, questionLine, SET_MAX } from "./coded-slides";
/** The uses the question-set calls write (`plan-question-set`): a slide question, an exit question. */
export type QuestionSetUse = "slide" | "exit";

/*
 * Question demand (lab pw, wave 3): how many questions the outline will place per objective and
 * per use, decided BEFORE any question is written, so the question-set calls (wave 4) write only
 * what gets placed plus one spare where the outline's filters can reject an item.
 *
 * The outline (`outlineFromFacts`, 1.6k lines) decides where questions go by running its fill
 * against the facts: a check set of 2–3 after each objective's cycle, single practise slides for
 * the shape's floors and kinds, the exit quiz's one-per-objective ranking and top-up, each step
 * asking of a question whether it is `fair` (its key ideas are on a slide), `showable` (a form a
 * slide can print), `settable` (a line that fits a set) and unused. Re-deriving those rules here
 * would be a second outline to keep in step. Instead the demand is READ OFF THE OUTLINE ITSELF:
 * the fill runs once on the taught facts with PLACEHOLDER questions — for every objective, more
 * slide and exit questions than the outline could ever place, each shaped to pass every filter
 * (short stem, both forms with three distractors, every key idea of its objective referenced,
 * tiers cycling easy → core → stretch) — and the count of placeholders the outline placed per
 * (objective, use) is the demand. A real question can only be LESS placeable than its placeholder
 * (a stem over the line cap, a form the slot cannot show, a key idea the deck left untaught), never
 * more, so the demand is an upper bound on what the outline wants and the spare covers one
 * rejection a set.
 *
 * The facts the fill runs on are the teach calls' outputs when they are in hand, or a count-only
 * sketch of them (`sketchTaught`: two key ideas, one misconception, two terms, a worked example
 * where `carriesWorkedExample` requires one) so the demand can be known straight after the
 * objectives call and each objective's question-set calls can start the moment its own teach
 * call returns, without waiting for the slowest. The fill's placement of QUESTIONS depends on the
 * taught facts only through the content slides (one per objective for one or two key ideas) and
 * the worked example (`apply` demand), so the sketch and the real output agree in the usual case;
 * where they do not, the spare and the outline's own gaps carry the difference as they do today.
 *
 * `demand` on the placeholders: `apply` where the objective carries a worked example, so P1c's
 * "model, then practise" places it before the check as it would for real apply questions; else
 * `recall`.
 *
 * Retrieval starter: unchanged. The starter prints the retrieval set and takes none of the
 * lesson's questions, so with `retrieval` given the placeholders are never starter items; without
 * it, the round-1 starter's easiest-question set counts toward the slide demand, as it should.
 */

/** Per objective: how many questions of each use the outline placed for it. */
export type ObjectiveQuestionDemand = Record<QuestionSetUse, number>;

export type QuestionDemandResult = {
  /** The outline's demand, per objective (index as in the objectives). */
  demand: ObjectiveQuestionDemand[];
  /** What to ask each question-set call for: the demand plus the spare; 0 means no call. */
  counts: ObjectiveQuestionDemand[];
  /** The fill that produced the demand, for the log and the bench. */
  outline: OutlineFromFactsResult;
};

/** The teach call's output for one objective, as far as the demand reads it. */
export type TaughtForDemand = Omit<OutlineFacts, "questions">;

/**
 * Placeholders offered per objective and use, more than the fill can place: the check set takes
 * at most `SET_MAX` and a second practise slide for the floors one more; the exit quiz holds
 * `EXIT_QUIZ_MAX` lines in total.
 */
export const PLACEHOLDERS_PER_OBJECTIVE: ObjectiveQuestionDemand = {
  slide: SET_MAX * 2,
  exit: EXIT_QUIZ_MAX,
};

/**
 * One spare per slide set: the outline's `settable` (line length), `showable` (forms) and `fair`
 * (key ideas taught) filters can each reject a real question that its placeholder passed. None
 * for the exit set: the exit quiz tops itself up from unused slide questions and misconceptions
 * (`topUp`), so the slide spare is the exit's spare too.
 */
export const SPARE: ObjectiveQuestionDemand = { slide: 1, exit: 0 };

const obj = (index: number) => ({ type: "objective" as const, index });

/**
 * A count-only sketch of one objective's teach output, for a demand computed before the teach
 * calls return: two key ideas (the schema's maximum, so the content slide count is not
 * under-read), one misconception, two terms, a worked example where the call is floored to one.
 */
export function sketchTaught(
  objectives: { text: string }[],
  workedExample: boolean[],
): TaughtForDemand {
  const taught: TaughtForDemand = {
    keyIdeas: [],
    misconceptions: [],
    vocabulary: [],
    workedExamples: [],
  };
  objectives.forEach((_, o) => {
    for (let k = 0; k < 2; k++) {
      taught.keyIdeas.push({
        statement: `Key idea ${k + 1} of objective ${o + 1}`,
        explanation: `Why key idea ${k + 1} of objective ${o + 1} holds.`,
        example: `An example of key idea ${k + 1} of objective ${o + 1}.`,
        objectiveRefs: [obj(o)],
      });
    }
    taught.misconceptions.push({
      belief: `A wrong belief about objective ${o + 1}`,
      correction: `The correction for objective ${o + 1}.`,
      objectiveRefs: [obj(o)],
    });
    taught.vocabulary.push(
      { term: `term ${o + 1}a`, definition: `Definition ${o + 1}a.`, objectiveRefs: [obj(o)] },
      { term: `term ${o + 1}b`, definition: `Definition ${o + 1}b.`, objectiveRefs: [obj(o)] },
    );
    if (workedExample[o]) {
      taught.workedExamples.push({
        problem: `A worked problem for objective ${o + 1}?`,
        steps: ["Step one.", "Step two."],
        answer: `Answer ${o + 1}`,
        misconceptionRef: { type: "misconception", index: o },
        objectiveRefs: [obj(o)],
      });
    }
  });
  return taught;
}

const TIERS = ["easy", "core", "stretch"] as const;

/**
 * A placeholder's stem length. The outline's set and exit budgets are in characters
 * (`SET_CHARS`, `EXIT_CHARS`, `MC_LINE_MAX`), so a placeholder has to be as long as a real
 * question, not a token: with one-line placeholders the fill placed four to a set and six on
 * the exit quiz, while the real questions (pw w1/b1, ten lessons, 160 questions) made a median
 * multiple-choice line of exactly `MC_LINE_MAX` and a median stem of 80 characters, and the
 * fill placed two or three to a set and three or four on the quiz — the waves asked 16 a lesson
 * and placed 5–9. So a placeholder is a multiple-choice question with an 80-character stem whose
 * line is as long as a real one may be and still be placed (`MC_LINE_MAX`): the budgets then
 * bite as they do on real questions. The stem stays under `SHARED_STEM_MAX` (120), so the
 * shared practise slide's own filter reads it as a real stem would usually pass.
 */
export const PLACEHOLDER_STEM_CHARS = 80;

/** Pad `text` with a filler to `length` characters (or leave it when already longer). */
const padTo = (text: string, length: number) =>
  text.length >= length ? text : `${text} ${"x".repeat(length - text.length - 1)}`;

/**
 * A placeholder's options, sized so its multiple-choice line (`questionLine`: the stem, then the
 * four lettered options) is exactly `MC_LINE_MAX` characters long.
 */
function placeholderOptions(stem: string, n: number) {
  const probe = {
    stem,
    answer: `Answer ${n + 1}`,
    distractors: [{ text: "Wrong 1" }, { text: "Wrong 2" }, { text: "Wrong 3" }],
  };
  // The line's fixed part: the stem, the four letters and the separators. The options share the rest.
  const fixed = questionLine({
    ...probe,
    answer: "",
    distractors: probe.distractors.map(() => ({ text: "" })),
  }).text.length;
  const room = Math.max(0, MC_LINE_MAX - fixed);
  const each = Math.floor(room / 4);
  const extra = room - each * 4;
  return {
    answer: padTo(probe.answer, each + extra),
    distractors: probe.distractors.map((d) => ({ text: padTo(d.text, each) })),
  };
}

/** The placeholder questions for every objective and use, shaped to pass every outline filter. */
export function placeholderQuestions(
  taught: TaughtForDemand,
  objectiveCount: number,
  per: ObjectiveQuestionDemand = PLACEHOLDERS_PER_OBJECTIVE,
): OutlineFacts["questions"] {
  const questions: OutlineFacts["questions"] = [];
  for (let o = 0; o < objectiveCount; o++) {
    const keyIdeaRefs = taught.keyIdeas.flatMap((k, i) =>
      k.objectiveRefs.some((r) => r.index === o) ? [{ type: "keyIdea" as const, index: i }] : [],
    );
    const applies = taught.workedExamples.some((x) =>
      (x.objectiveRefs ?? []).some((r) => r.index === o),
    );
    for (const use of ["slide", "exit"] as const) {
      for (let n = 0; n < per[use]; n++) {
        const stem = padTo(
          // A tag of its own ("1.2"), so no two placeholders read as one question (`sameQuestion`).
          `${use} question ${o + 1}.${n + 1}?`,
          PLACEHOLDER_STEM_CHARS,
        );
        questions.push({
          stem,
          ...placeholderOptions(stem, n),
          reasoning: "Because.",
          tier: TIERS[n % TIERS.length] ?? "core",
          use,
          demand: applies ? "apply" : "recall",
          forms: ["multiple-choice", "open-response"],
          keyIdeaRefs,
          objectiveRefs: [obj(o)],
        });
      }
    }
  }
  return questions;
}

/**
 * The outline's question demand per objective and use, read off a fill over placeholder
 * questions (see the header). `input.facts` is the taught facts without questions.
 */
export function questionDemand(
  input: Omit<OutlineFromFactsInput, "facts"> & { facts: TaughtForDemand },
): QuestionDemandResult {
  const count = input.objectives.length;
  const questions = placeholderQuestions(input.facts, count);
  const outline = outlineFromFacts({ ...input, facts: { ...input.facts, questions } });
  // What the slides carry (`outlineFactRefs`), the exit quiz's lines included: `unplaced` counts
  // the practise slides only, and an exit question the quiz left off is not demand.
  const placed = new Set(
    outline.outlineFactRefs.flatMap((e) =>
      e.factRefs.flatMap((r) => (r.type === "question" ? [r.index] : [])),
    ),
  );
  const demand: ObjectiveQuestionDemand[] = input.objectives.map(() => ({ slide: 0, exit: 0 }));
  questions.forEach((q, i) => {
    if (!placed.has(i)) return;
    const o = q.objectiveRefs[0]?.index ?? 0;
    const use = q.use as QuestionSetUse;
    const d = demand[o];
    if (d) d[use] += 1;
  });
  const counts = demand.map((d) => ({
    slide: d.slide > 0 ? d.slide + SPARE.slide : 0,
    exit: d.exit > 0 ? d.exit + SPARE.exit : 0,
  }));
  return { demand, counts, outline };
}
