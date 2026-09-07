/**
 * The two clarifying questions on the lesson brief screen (F01: "at most two, each with a default
 * the teacher can accept without reading"; TEACH-122). Pure: the options come from the topic
 * text, no model call at F01. Answers travel as `brief.answers[question.id]` — the option label,
 * so the Plan stage reads what the teacher saw. The wording is a product surface (Greg's to
 * change) and lives only here.
 */

export type BriefQuestion = {
  /** The `brief.answers` key. */
  id: "objectiveVerb" | "priorConfidence";
  prompt: string;
};

export type BriefOption = { value: string; label: string };

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

/** Bloom-style verbs, plainest first; the first option is the default. */
const OBJECTIVE_VERBS = ["Recall", "Explain", "Apply", "Evaluate"] as const;

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
  return OBJECTIVE_VERBS.map((verb) => {
    const label = `${verb} ${phrase}`;
    return { value: label, label };
  });
}

export function confidenceOptions(): BriefOption[] {
  return [
    { value: "New to it", label: "New to it" },
    { value: "Some prior knowledge", label: "Some prior knowledge" },
    { value: "Revisiting", label: "Revisiting" },
  ];
}
