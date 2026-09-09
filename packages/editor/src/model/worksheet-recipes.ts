import type { Id, LessonFacts, WorksheetBlock } from "@tj/domain/documents";
import { WORD_SEARCH_MAX_SIZE } from "@tj/domain/documents";
import { clampSize, normaliseWords } from "../worksheet/word-search";
import { docFromText, now, uid } from "./factories";
import { answerLinesForMarks, WORD_SEARCH_DEFAULT_SIZE } from "./worksheet-factories";

/*
 * The nine worksheet recipes (Worksheets and activities, rulings 46 to 55). A recipe is a named
 * block list with a job, a minutes range and a rule for which facts fill which block. `build`
 * makes the frame from `LessonFacts` at once; the model's fill (Omer's, not built here) arrives
 * later and replaces the one placeholder block each recipe leaves for it, so the frame is honest
 * about what is written and what is still to come.
 *
 * With facts, every block cites the fact ids it drew on in `generatedFrom.factRefs` (ADR 0025
 * §2): the derived blocks cite their own facts, the framing blocks (a heading, an instruction
 * line, the placeholder) cite everything the recipe used. Without facts the same shapes come back
 * with placeholder copy and no provenance at all.
 */

export type Job = "starter" | "check" | "practise" | "homework" | "revise" | "assess";

export const JOBS: { id: Job; label: string }[] = [
  { id: "starter", label: "Starter" },
  { id: "check", label: "Check" },
  { id: "practise", label: "Practise" },
  { id: "homework", label: "Homework" },
  { id: "revise", label: "Revise" },
  { id: "assess", label: "Assess" },
];

export type WorksheetRecipe = {
  id: string;
  name: string;
  /** One line under the name: what the sheet does, in Greg's voice. */
  line: string;
  jobs: Job[];
  /** Whole minutes the recipe is designed to take, low to high. */
  minutes: [number, number];
  build: (facts?: LessonFacts) => WorksheetBlock[];
};

/** The copy on a question the teacher has to write. */
export const PLACEHOLDER_QUESTION = "Write a question on the topic";

/** Recorded on every block a recipe derives from facts. */
export const RECIPE_PROMPT_VERSION = "worksheet-recipes.v1";

/* ---- block helpers ---------------------------------------------------------- */

type Question = Extract<WorksheetBlock, { type: "question" }>;

function cite<T extends WorksheetBlock>(block: T, factRefs: string[] | undefined): T {
  if (!factRefs || factRefs.length === 0) return block;
  return {
    ...block,
    generatedFrom: { factRefs, promptVersion: RECIPE_PROMPT_VERSION, model: "recipe", at: now() },
  };
}

const heading = (text: string, refs?: string[], level: 1 | 2 = 1): WorksheetBlock =>
  cite({ id: uid(), type: "heading", doc: docFromText(text), level }, refs);

const instructions = (text: string, refs?: string[]): WorksheetBlock =>
  cite({ id: uid(), type: "instructions", doc: docFromText(text) }, refs);

const paragraph = (text: string, refs?: string[]): WorksheetBlock =>
  cite({ id: uid(), type: "paragraph", doc: docFromText(text) }, refs);

/** A paragraph that says what the model will write in its place. */
const placeholder = (text: string, refs?: string[]): WorksheetBlock =>
  paragraph(`Generation writes this part: ${text}`, refs);

function question(text: string, marks: number, answer?: string, refs?: string[]): Question {
  const block: Question = {
    id: uid(),
    type: "question",
    doc: docFromText(text),
    answerLines: answerLinesForMarks(marks),
    marks,
  };
  if (answer !== undefined) block.answer = answer;
  return cite(block, refs);
}

/**
 * `count` question blocks with the given marks, taken from `facts.questions` in order and topped
 * up with placeholder questions when the lesson has fewer.
 */
function questionsFrom(
  facts: LessonFacts | undefined,
  marks: number[],
  start = 0,
): WorksheetBlock[] {
  return marks.map((m, i) => {
    const fact = facts?.questions[start + i];
    return fact
      ? question(fact.stem, m, fact.answer, [fact.id])
      : question(PLACEHOLDER_QUESTION, m);
  });
}

const factRefsOf = (blocks: WorksheetBlock[]): string[] =>
  Array.from(new Set(blocks.flatMap((b) => b.generatedFrom?.factRefs ?? [])));

/** The placeholder questions among `blocks` cite what the rest of the frame drew on. */
const citeBare = (blocks: WorksheetBlock[], refs: string[] | undefined): WorksheetBlock[] =>
  blocks.map((b) => (b.generatedFrom ? b : cite(b, refs)));

/** Two-option true/false block for one claim. */
function claim(text: string, isTrue: boolean, refs?: string[]): WorksheetBlock {
  return cite(
    {
      id: uid(),
      type: "multiple-choice",
      doc: docFromText(text),
      options: [
        { id: uid(), text: "True", correct: isTrue },
        { id: uid(), text: "False", correct: !isTrue },
      ],
    },
    refs,
  );
}

/** "Evaporation is …" from a definition, so a true claim reads as a sentence. */
function definitionClaim(term: string, definition: string): string {
  const body = definition.trim().replace(/\.$/, "");
  return `${capitalise(term)} is ${lowerFirst(body)}.`;
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/**
 * The definition with its term gapped. When the definition does not mention the term, the term
 * becomes the gap at the front: "____ is water vapour turning back into liquid."
 */
function gapSentence(term: string, definition: string, gapId: Id): string {
  const body = definition.trim().replace(/\.$/, "");
  const at = body.toLowerCase().indexOf(term.toLowerCase());
  if (at !== -1) {
    return `${body.slice(0, at)}[[gap:${gapId}]]${body.slice(at + term.length)}.`;
  }
  return `[[gap:${gapId}]] is ${lowerFirst(body)}.`;
}

function fillGap(
  text: string,
  gaps: { id: Id; answer: string }[],
  refs?: string[],
): WorksheetBlock {
  return cite({ id: uid(), type: "fill-gap", doc: docFromText(text), gaps }, refs);
}

const wordBank = (words: string[], refs?: string[]): WorksheetBlock =>
  cite({ id: uid(), type: "word-bank", words }, refs);

const PLACEHOLDER_TERMS = ["Term one", "Term two", "Term three", "Term four"];

/* ---- the nine ---------------------------------------------------------------- */

const exitTicket: WorksheetRecipe = {
  id: "exit-ticket",
  name: "Exit ticket",
  line: "Three quick questions and one thing they learned, on the way out.",
  jobs: ["check"],
  minutes: [5, 5],
  build: (facts) => {
    const questions = questionsFrom(facts, [1, 1, 1]);
    const refs = facts ? factRefsOf(questions) : undefined;
    return [
      ...questions,
      cite({ id: uid(), type: "answer-box", heightPt: 90, label: "One thing I learned" }, refs),
      placeholder("a fourth question on the objective the class found hardest.", refs),
    ];
  },
};

const knowledgeCheck: WorksheetRecipe = {
  id: "knowledge-check",
  name: "Knowledge check",
  line: "Two short answers, then three multiple choice items.",
  jobs: ["check"],
  minutes: [10, 15],
  build: (facts) => {
    const questions = questionsFrom(facts, [1, 2]);
    const refs = facts ? factRefsOf(questions) : undefined;
    return [
      instructions("Answer every question. Tick one box for each multiple choice item.", refs),
      ...questions,
      placeholder(
        "three multiple choice items, with wrong options taken from the lesson's misconceptions.",
        facts ? [...(refs ?? []), ...facts.misconceptions.map((m) => m.id)] : undefined,
      ),
    ];
  },
};

const misconceptionCheck: WorksheetRecipe = {
  id: "misconception-check",
  name: "Misconception check",
  line: "True or false for each claim, then explain why.",
  jobs: ["check", "starter"],
  minutes: [10, 10],
  build: (facts) => {
    const claims: WorksheetBlock[] = [];
    if (facts) {
      for (const m of facts.misconceptions) claims.push(claim(m.text, false, [m.id]));
      // As many true claims as false ones, so the answer is not always the same box.
      const trueCount = Math.max(2, facts.misconceptions.length);
      for (const v of facts.vocabulary.slice(0, trueCount)) {
        claims.push(claim(definitionClaim(v.term, v.definition), true, [v.id]));
      }
    } else {
      claims.push(claim("Write a claim that pupils often get wrong.", false));
      claims.push(claim("Write a claim that is true.", true));
    }
    const refs = facts ? factRefsOf(claims) : undefined;
    return [
      instructions("Tick True or False for each claim.", refs),
      ...claims,
      question("Choose one false claim. Explain why it is wrong.", 2, undefined, refs),
      placeholder(
        "each claim again in pupil language, and one more for any objective not covered.",
        refs,
      ),
    ];
  },
};

const cloze: WorksheetRecipe = {
  id: "cloze",
  name: "Cloze",
  line: "Each definition with its term missing; the words are in the bank.",
  jobs: ["practise"],
  minutes: [10, 15],
  build: (facts) => {
    const terms = facts ? facts.vocabulary.map((v) => v.term) : PLACEHOLDER_TERMS;
    const vocabRefs = facts ? facts.vocabulary.map((v) => v.id) : undefined;
    const sentences: WorksheetBlock[] = facts
      ? facts.vocabulary.map((v) => {
          const gap = uid();
          return fillGap(
            gapSentence(v.term, v.definition, gap),
            [{ id: gap, answer: v.term }],
            [v.id],
          );
        })
      : PLACEHOLDER_TERMS.slice(0, 2).map((term) => {
          const gap = uid();
          return fillGap(`Write a sentence with [[gap:${gap}]] missing.`, [
            { id: gap, answer: term },
          ]);
        });
    return [
      instructions("Fill each gap with a word from the bank. Each word is used once.", vocabRefs),
      wordBank(terms, vocabRefs),
      ...sentences,
      placeholder(
        "two more sentences per term that use the word rather than define it.",
        vocabRefs,
      ),
    ];
  },
};

const matching: WorksheetRecipe = {
  id: "matching",
  name: "Matching",
  line: "Terms on the left, definitions on the right, letters in the boxes.",
  jobs: ["practise", "revise"],
  minutes: [10, 10],
  build: (facts) => {
    const vocabRefs = facts ? facts.vocabulary.map((v) => v.id) : undefined;
    const pairs = facts
      ? facts.vocabulary.map((v) => ({ id: uid(), left: v.term, right: v.definition }))
      : PLACEHOLDER_TERMS.map((term) => ({ id: uid(), left: term, right: "Write its definition" }));
    return [
      instructions("Match each term to its definition. Write the letter in the box.", vocabRefs),
      cite({ id: uid(), type: "matching", pairs }, vocabRefs),
      wordBank(
        pairs.map((p) => p.left),
        vocabRefs,
      ),
      placeholder("a second matching block: cause to effect, or example to idea.", vocabRefs),
    ];
  },
};

/** How many letters a term takes in the grid (letters only, no blanks). */
const gridLength = (term: string): number => normaliseWords([term])[0]?.length ?? 0;

const wordSearch: WorksheetRecipe = {
  id: "word-search",
  name: "Word search",
  line: "The lesson's terms hidden in a grid, with the list to find.",
  jobs: ["starter"],
  minutes: [10, 15],
  // No placeholder: the seeded grid is already exact, so generation has nothing to write here.
  build: (facts) => {
    const vocabRefs = facts ? facts.vocabulary.map((v) => v.id) : undefined;
    const terms = facts ? facts.vocabulary : [];
    // The grid is sized to the longest term (never under the default side). A term longer than
    // the largest grid stays out of it and is named on the instruction line, so nothing vanishes.
    const inGrid = terms.filter((v) => gridLength(v.term) <= WORD_SEARCH_MAX_SIZE);
    const leftOut = terms.filter((v) => gridLength(v.term) > WORD_SEARCH_MAX_SIZE);
    const size = clampSize(
      Math.max(WORD_SEARCH_DEFAULT_SIZE, ...inGrid.map((v) => gridLength(v.term))),
    );
    const words = facts ? inGrid.map((v) => v.term) : ["write", "your", "words", "here"];
    const lead = "Find every word in the grid. They run across and down.";
    const note = leftOut.length
      ? ` Not in the grid: ${leftOut.map((v) => v.term).join(", ")}.`
      : "";
    return [
      instructions(`${lead}${note}`, vocabRefs),
      cite(
        {
          id: uid(),
          type: "word-search",
          words,
          size,
          directions: "across-down",
          seed: 1,
          showWordBank: true,
        },
        facts ? inGrid.map((v) => v.id) : undefined,
      ),
    ];
  },
};

const workedExample: WorksheetRecipe = {
  id: "worked-example",
  name: "Worked example and practice",
  line: "One example done in steps, then three to try the same way.",
  jobs: ["practise"],
  minutes: [15, 20],
  build: (facts) => {
    const example = facts?.workedExamples[0];
    const exampleRefs = example ? [example.id] : undefined;
    const exampleText = example
      ? [
          `Problem: ${example.problem}`,
          ...example.steps.map((step, i) => `Step ${i + 1}: ${step}`),
          `Answer: ${example.answer}`,
        ].join(" ")
      : "Write the problem, then each step on the way to the answer.";
    const drawn = questionsFrom(facts, [1, 2, 3]);
    const refs = facts ? [...(exampleRefs ?? []), ...factRefsOf(drawn)] : undefined;
    const tries = citeBare(drawn, refs);
    // A lesson with fewer than three questions leaves "Now try" for generation to finish.
    const missing = facts && facts.questions.length < 3;
    return [
      heading("Worked example", exampleRefs),
      paragraph(exampleText, exampleRefs),
      heading("Now try", refs, 2),
      ...tries,
      ...(missing
        ? [
            placeholder(
              "the remaining Now try questions, in the example's shape, with rising difficulty.",
              refs,
            ),
          ]
        : []),
    ];
  },
};

const reading: WorksheetRecipe = {
  id: "reading",
  name: "Reading and questions",
  line: "A passage to read, then four questions worth more as they go.",
  jobs: ["homework", "revise"],
  minutes: [20, 30],
  build: (facts) => {
    const questions = questionsFrom(facts, [1, 2, 3, 4]);
    const passageRefs = facts
      ? [...facts.objectives.map((o) => o.id), ...facts.vocabulary.map((v) => v.id)]
      : undefined;
    const refs = facts ? [...(passageRefs ?? []), ...factRefsOf(questions)] : undefined;
    return [
      heading("Read and answer", refs),
      instructions("Read the passage, then answer the questions in full sentences.", refs),
      placeholder(
        "the passage, at the year group's reading level, from the lesson's facts.",
        passageRefs,
      ),
      ...questions,
    ];
  },
};

const examStyle: WorksheetRecipe = {
  id: "exam-style",
  name: "Exam style",
  line: "Six questions with marks in brackets, on their own page.",
  jobs: ["assess"],
  minutes: [30, 45],
  build: (facts) => {
    const drawn = questionsFrom(facts, [1, 1, 2, 2, 3, 4]);
    const refs = facts ? factRefsOf(drawn) : undefined;
    return [
      heading("Exam style questions", refs),
      instructions("Answer all questions. The marks for each question are in brackets.", refs),
      ...citeBare(drawn, refs),
      cite({ id: uid(), type: "page-break" }, refs),
    ];
  },
};

export const WORKSHEET_RECIPES: WorksheetRecipe[] = [
  exitTicket,
  knowledgeCheck,
  misconceptionCheck,
  cloze,
  matching,
  wordSearch,
  workedExample,
  reading,
  examStyle,
];

export function recipeById(id: string): WorksheetRecipe | undefined {
  return WORKSHEET_RECIPES.find((r) => r.id === id);
}
