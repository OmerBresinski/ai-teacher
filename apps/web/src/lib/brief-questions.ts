/**
 * The two clarifying questions on the lesson brief screen (F01: "at most two, each with a default
 * the teacher can accept without reading"; TEACH-122, presentation reworked in TEACH-177). Pure:
 * the options come from the topic text, no model call at F01. Answers travel as
 * `brief.answers[question.id]` — the option `value`, the full sentence the Plan stage reads
 * ("Explain the water cycle"). The `label` is what the teacher sees: the verb alone, with a
 * one-line `gloss` under it. The wording is a product surface (Greg's to change) and lives only
 * here.
 */

export type BriefQuestion = {
  /** The `brief.answers` key. */
  id: "objectiveVerb" | "priorConfidence";
  prompt: string;
};

export type BriefOption = {
  /** What travels in `brief.answers`. */
  value: string;
  /** What the teacher reads on the radio. */
  label: string;
  /** One line under the label saying what the choice means for the lesson. */
  gloss: string;
};

export const OBJECTIVE_QUESTION: BriefQuestion = {
  id: "objectiveVerb",
  prompt: "What should pupils be able to do by the end?",
};

export const CONFIDENCE_QUESTION: BriefQuestion = {
  id: "priorConfidence",
  prompt: "How confident is the class with this already?",
};

/** Questions appear once the topic reads like a topic, not a word. */
export const MIN_TOPIC_WORDS = 3;

/** Bloom-style verbs, plainest first. */
const OBJECTIVE_VERBS = ["Recall", "Explain", "Apply", "Evaluate"] as const;
type ObjectiveVerb = (typeof OBJECTIVE_VERBS)[number];

const OBJECTIVE_GLOSS: Record<ObjectiveVerb, string> = {
  Recall: "Remember the facts and the words.",
  Explain: "Say how it works and why.",
  Apply: "Use it to solve new problems.",
  Evaluate: "Weigh it up and make a judgement.",
};

/** Options in the topic's own words are capped so a pasted objective stays one line. */
const TOPIC_IN_OPTION_MAX = 60;

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function shouldAskQuestions(topic: string): boolean {
  return wordCount(topic) >= MIN_TOPIC_WORDS;
}

/** The topic as it reads inside an option: trimmed, lower-cased first letter, cut to one line. */
function topicPhrase(topic: string): string {
  const trimmed = topic.trim().replace(/[.!?]+$/, "");
  const lowered = trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
  return lowered.length > TOPIC_IN_OPTION_MAX
    ? `${lowered.slice(0, TOPIC_IN_OPTION_MAX).trimEnd()}…`
    : lowered;
}

/** `Recall …`, `Explain …`, `Apply …`, `Evaluate …` over the topic; the verb is the answer's key idea. */
export function objectiveOptions(topic: string): BriefOption[] {
  const phrase = topicPhrase(topic);
  return OBJECTIVE_VERBS.map((verb) => ({
    value: `${verb} ${phrase}`,
    label: verb,
    gloss: OBJECTIVE_GLOSS[verb],
  }));
}

const RECALL_CUES =
  /\b(recall|remember|name|names|list|know|spell|spelling|vocabulary|key words|times tables?|number bonds|dates|facts)\b/i;
const APPLY_CUES =
  /\b(find|finding|calculate|calculating|solve|solving|use|using|measure|measuring|add|adding|subtract|subtracting|multiply|multiplying|divide|dividing|convert|converting|draw|drawing|write|writing|plan|planning|design|designing|make|making|build|building|practise|practising)\b/i;
const EVALUATE_CUES =
  /\b(evaluate|evaluating|compare|comparing|judge|judging|argue|arguing|debate|debating|assess|assessing|justify|justifying|critique|which is better|for and against|should)\b/i;

/**
 * Which objective verb the form pre-selects for a topic. A plain noun phrase ("the water cycle")
 * suggests Explain; a topic that names a skill ("finding fractions of amounts") suggests Apply;
 * a topic about facts or words suggests Recall; one that asks for a judgement suggests Evaluate.
 * A guess, marked "suggested" on screen so the teacher can change it in one click.
 */
export function suggestedObjectiveIndex(topic: string): number {
  const verb: ObjectiveVerb = EVALUATE_CUES.test(topic)
    ? "Evaluate"
    : APPLY_CUES.test(topic)
      ? "Apply"
      : RECALL_CUES.test(topic)
        ? "Recall"
        : "Explain";
  return OBJECTIVE_VERBS.indexOf(verb);
}

export function confidenceOptions(): BriefOption[] {
  return [
    { value: "New to it", label: "New to it", gloss: "Start from the beginning." },
    {
      value: "Some prior knowledge",
      label: "Some prior knowledge",
      gloss: "A short recap, then build on it.",
    },
    { value: "Revisiting", label: "Revisiting", gloss: "Go straight to practice and depth." },
  ];
}

/** The confidence question's pre-selected option: nothing in the topic says otherwise. */
export const SUGGESTED_CONFIDENCE_INDEX = 0;
